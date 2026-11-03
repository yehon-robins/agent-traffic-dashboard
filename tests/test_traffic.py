"""Tests for the traffic dashboard. Standard library only:

    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import dashboard  # noqa: E402
import proxy  # noqa: E402
from traffic import Prices, Recorder, ReplyParser, Store  # noqa: E402

FIX = os.path.join(ROOT, "tests", "fixtures")
SECRET = "sk-ant-oat01-THIS-IS-THE-FULL-SECRET-TOKEN-0123456789"


def fixture(name: str) -> bytes:
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


def feed_in_pieces(data: bytes, size: int = 7) -> ReplyParser:
    p = ReplyParser()
    for i in range(0, len(data), size):
        p.feed(data[i:i + size])
    p.finish_stream()
    return p


SSE_HEADERS = [("content-type", "text/event-stream; charset=utf-8")]
JSON_HEADERS = [("content-type", "application/json")]


def run_exchange(store: Store, body: dict, reply: bytes, status: int = 200, headers=None, streaming=True,
                 req_headers=None, state="done"):
    hdrs = req_headers or [("x-api-key", SECRET), ("content-type", "application/json")]
    ex = store.begin("POST", "/v1/messages?beta=true", hdrs, json.dumps(body).encode(), time.time())
    store.response(ex, status, "OK", headers or (SSE_HEADERS if streaming else JSON_HEADERS), time.time())
    for i in range(0, len(reply), 50):
        store.chunk(ex, reply[i:i + 50], time.time())
    store.end(ex, state, None, time.time())
    return ex


class ParserTests(unittest.TestCase):
    def test_text_only(self):
        p = feed_in_pieces(fixture("text_only.sse"), 3)  # splits a multibyte char too
        self.assertEqual(p.content, [{"type": "text", "text": "Hello, wörld!"}])
        self.assertEqual(p.stop_reason, "end_turn")
        self.assertEqual(p.usage["output_tokens"], 5)
        self.assertEqual(p.usage["cache_read_input_tokens"], 2000)
        self.assertEqual(p.parse_errors, [])

    def test_tool_use(self):
        p = feed_in_pieces(fixture("tool_use.sse"))
        calls = [b for b in p.content if b["type"] == "tool_use"]
        self.assertEqual([c["name"] for c in calls], ["Bash", "Read"])
        self.assertEqual(calls[0]["input"], {"command": "ls -la\npwd", "description": "list"})
        self.assertNotIn("_partial_json", calls[0])
        self.assertEqual(p.stop_reason, "tool_use")

    def test_thinking(self):
        p = feed_in_pieces(fixture("thinking.sse"))
        self.assertEqual(p.content[0]["type"], "thinking")
        self.assertEqual(p.content[0]["thinking"], "The user wants a number.")
        self.assertEqual(p.content[0]["signature"], "EqQBCgIYAh")
        self.assertEqual(p.content[1]["text"], "42")
        self.assertEqual(p.stop_reason, "max_tokens")

    def test_error_mid_stream(self):
        p = feed_in_pieces(fixture("error_mid_stream.sse"))
        self.assertEqual(p.error, {"type": "overloaded_error", "message": "Overloaded"})
        self.assertEqual(p.content[0]["text"], "Partial ans")

    def test_non_streaming(self):
        p = ReplyParser()
        p.parse_json_body(fixture("non_streaming.json"))
        self.assertEqual(p.content[1]["name"], "Grep")
        self.assertEqual(p.stop_reason, "tool_use")
        self.assertEqual(p.usage["input_tokens"], 100)

    def test_529(self):
        p = ReplyParser()
        p.parse_json_body(fixture("error_529.json"))
        self.assertEqual(p.error["type"], "overloaded_error")

    def test_garbage_is_flagged_not_dropped(self):
        p = feed_in_pieces(b"event: message_start\ndata: {not json\n\n")
        self.assertTrue(p.parse_errors)
        self.assertIn(b"not json", bytes(p.raw))


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(Prices(os.path.join(ROOT, "prices.json")), None)

    def base(self, messages, system="You are helpful.", tools=None):
        return {"model": "claude-sonnet-4-5", "max_tokens": 1000, "stream": True, "system": system,
                "tools": tools if tools is not None else [{"name": "Bash", "description": "run", "input_schema": {}}],
                "messages": messages}

    def test_records_and_cost(self):
        ex = run_exchange(self.store, self.base([{"role": "user", "content": "hi"}]), fixture("text_only.sse"))
        s = ex.summary(self.store)
        self.assertEqual(s["state"], "done")
        self.assertEqual(s["usage"], {"input": 12, "output": 5, "cache_read": 2000, "cache_write": 100})
        # sonnet: $3 in, $15 out, read 0.1x, write 1.25x
        expected = (12 * 3 + 5 * 15 + 2000 * 0.3 + 100 * 3.75) / 1e6
        self.assertAlmostEqual(s["cost_usd"], expected, places=6)
        self.assertEqual(s["gist"], {"kind": "user", "text": "hi"})

    def test_pairing_append_and_unanswered(self):
        m1 = [{"role": "user", "content": "list files"}]
        ex1 = run_exchange(self.store, self.base(m1), fixture("tool_use.sse"))
        self.assertEqual(ex1.summary(self.store)["gist"]["kind"], "user")
        reply = [b for b in ex1.parser.content]
        # Next request answers only toolu_A; cache_control moved: still an append.
        m2 = m1 + [{"role": "assistant", "content": reply},
                   {"role": "user", "content": [
                       {"type": "tool_result", "tool_use_id": "toolu_A", "content": "a\nb", "is_error": True,
                        "cache_control": {"type": "ephemeral"}}]}]
        ex2 = run_exchange(self.store, self.base(m2), fixture("text_only.sse"))
        self.assertEqual(ex2.relation, "append")
        self.assertEqual(ex2.prev_id, ex1.id)
        self.assertEqual(ex2.echo_index, 1)
        self.assertEqual(ex2.new_from, 2)
        self.assertEqual(ex2.lane, ex1.lane)
        self.assertEqual(self.store.tool_index["toolu_A"]["result_ex"], ex2.id)
        self.assertIn("tool_error", ex2.anomalies)
        self.assertIn("unanswered", ex1.anomalies)  # toolu_B never answered
        self.assertIn("toolu_B", ex1.anomalies["unanswered"])
        detail = self.store.detail(ex1.id)
        self.assertEqual(detail["paired_results"]["toolu_A"]["exchange_id"], ex2.id)
        self.assertNotIn("toolu_B", detail["paired_results"])
        d2 = self.store.detail(ex2.id)
        self.assertEqual(d2["paired_calls"]["toolu_A"]["exchange_id"], ex1.id)
        self.assertEqual(d2["changes"]["messages"]["mode"], "append")
        self.assertFalse(d2["changes"]["system"]["changed"])
        # A third request repeats the old result: it is not paired twice.
        m3 = m2 + [{"role": "assistant", "content": [{"type": "text", "text": "ok"}]},
                   {"role": "user", "content": "thanks"}]
        ex3 = run_exchange(self.store, self.base(m3), fixture("text_only.sse"))
        self.assertEqual(ex3.tool_results, [])
        self.assertEqual(self.store.tool_index["toolu_A"]["result_ex"], ex2.id)

    def test_every_tool_use_paired_exactly_once(self):
        m = [{"role": "user", "content": "go"}]
        ex = run_exchange(self.store, self.base(m), fixture("tool_use.sse"))
        m = m + [{"role": "assistant", "content": ex.parser.content},
                 {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_A", "content": "x"},
                                              {"type": "tool_result", "tool_use_id": "toolu_B", "content": "y"}]}]
        ex2 = run_exchange(self.store, self.base(m), fixture("text_only.sse"))
        self.assertEqual(sorted(r["tool_use_id"] for r in ex2.tool_results), ["toolu_A", "toolu_B"])
        self.assertNotIn("unanswered", ex.anomalies)
        self.assertEqual(ex2.summary(self.store)["gist"]["kind"], "tool_result")

    def test_lanes_and_rewrite(self):
        main1 = run_exchange(self.store, self.base([{"role": "user", "content": "main task"}]), fixture("text_only.sse"))
        sub = run_exchange(self.store, self.base([{"role": "user", "content": "subagent task"}], system="You are a subagent.",
                                                 tools=[{"name": "Read", "input_schema": {}}]), fixture("text_only.sse"))
        side = run_exchange(self.store, self.base([{"role": "user", "content": "title?"}], system="Make a title.", tools=[]),
                            fixture("text_only.sse"))
        self.assertEqual(len({main1.lane, sub.lane, side.lane}), 3)
        # Compaction: same system and tools, different history -> same lane, flagged rewritten.
        main2 = run_exchange(self.store, self.base([{"role": "user", "content": "summary of before"},
                                                    {"role": "assistant", "content": "ok"},
                                                    {"role": "user", "content": "continue"}]), fixture("text_only.sse"))
        self.assertEqual(main2.lane, main1.lane)
        self.assertEqual(main2.relation, "rewritten")
        ch = self.store.detail(main2.id)["changes"]
        self.assertEqual(ch["messages"]["mode"], "rewritten")
        self.assertTrue(any(op["op"] in ("modified", "added", "removed") for op in ch["messages"]["ops"]))

    def test_system_and_tools_change_flagged(self):
        m1 = [{"role": "user", "content": "a"}]
        ex1 = run_exchange(self.store, self.base(m1), fixture("text_only.sse"))
        m2 = m1 + [{"role": "assistant", "content": ex1.parser.content}, {"role": "user", "content": "b"}]
        body = self.base(m2, system="You are VERY helpful.",
                         tools=[{"name": "Bash", "description": "run", "input_schema": {}}, {"name": "Edit", "input_schema": {}}])
        body["max_tokens"] = 2000
        ex2 = run_exchange(self.store, body, fixture("text_only.sse"))
        self.assertIn("system_changed", ex2.anomalies)
        self.assertIn("tools_changed", ex2.anomalies)
        ch = self.store.detail(ex2.id)["changes"]
        self.assertIn("+You are VERY helpful.", ch["system"]["diff"])
        self.assertEqual(ch["tools"]["added"], ["Edit"])
        self.assertEqual(ch["params"], [{"name": "max_tokens", "before": 1000, "after": 2000}])

    def test_errors_flagged(self):
        ex = run_exchange(self.store, self.base([{"role": "user", "content": "x"}]), fixture("error_529.json"),
                          status=529, streaming=False)
        self.assertEqual(ex.state, "error")
        self.assertIn("overloaded_error", ex.anomalies["http_error"])
        ex2 = run_exchange(self.store, self.base([{"role": "user", "content": "y"}]), fixture("error_mid_stream.sse"))
        self.assertIn("stream_error", ex2.anomalies)
        ex3 = run_exchange(self.store, self.base([{"role": "user", "content": "z"}]), fixture("thinking.sse"))
        self.assertIn("max_tokens", ex3.anomalies)
        ex4 = run_exchange(self.store, self.base([{"role": "user", "content": "w"}]), fixture("text_only.sse")[:300],
                           state="aborted")
        self.assertEqual(ex4.state, "aborted")
        ex5 = run_exchange(self.store, self.base([{"role": "user", "content": "v"}]), b"event: x\ndata: {oops\n\n")
        self.assertTrue(any(a["code"] == "parse_error" for a in ex5.anomaly_list()))
        self.assertIsNotNone(self.store.raw(ex5.id))

    def test_non_messages_traffic(self):
        ex = self.store.begin("POST", "/v1/messages/count_tokens", [], b'{"messages":[]}', time.time())
        self.store.response(ex, 200, "OK", JSON_HEADERS, time.time())
        self.store.chunk(ex, b'{"input_tokens": 5}', time.time())
        self.store.end(ex, "done", None, time.time())
        self.assertEqual(ex.kind, "count_tokens")
        self.assertEqual(ex.anomaly_list(), [])
        ex2 = self.store.begin("POST", "/responses", [], b'{"input":"hi"}', time.time())
        self.assertEqual(ex2.kind, "other")

    def test_search(self):
        run_exchange(self.store, self.base([{"role": "user", "content": "find the needle"}]), fixture("text_only.sse"))
        run_exchange(self.store, self.base([{"role": "user", "content": "other"}], system="sys with HAYSTACK"),
                     fixture("text_only.sse"))
        self.assertEqual(self.store.search("NEEDLE", "messages"), [1])
        self.assertEqual(self.store.search("haystack", "messages"), [])
        self.assertEqual(self.store.search("haystack", "all"), [2])
        self.assertEqual(self.store.search("wörld", "messages"), [1, 2])  # reply text

    def test_secrets_never_leave(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Prices(os.path.join(ROOT, "prices.json")), tmp)
            hdrs = [("authorization", "Bearer " + SECRET), ("x-api-key", SECRET), ("cookie", "s=" + SECRET)]
            ex = run_exchange(store, self.base([{"role": "user", "content": "hi"}]), fixture("text_only.sse"),
                              req_headers=hdrs)
            out = json.dumps([store.summaries(), store.detail(ex.id), store.raw(ex.id)])
            self.assertNotIn(SECRET, out)
            self.assertIn(SECRET[:9], out)  # truncated prefix is kept, as in the terminal
            log = ""
            for name in os.listdir(tmp):
                with open(os.path.join(tmp, name), encoding="utf-8") as f:
                    log += f.read()
            self.assertTrue(log)
            self.assertNotIn(SECRET, log)

    def test_replay_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Prices(os.path.join(ROOT, "prices.json")), tmp)
            m1 = [{"role": "user", "content": "go"}]
            ex1 = run_exchange(store, self.base(m1), fixture("tool_use.sse"))
            m2 = m1 + [{"role": "assistant", "content": ex1.parser.content},
                       {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_A", "content": "x"},
                                                    {"type": "tool_result", "tool_use_id": "toolu_B", "content": "y"}]}]
            run_exchange(store, self.base(m2), fixture("text_only.sse"))
            run_exchange(store, self.base(m1), fixture("error_529.json"), status=529, streaming=False)
            logfile = os.path.join(tmp, os.listdir(tmp)[0])
            again = Store(Prices(os.path.join(ROOT, "prices.json")), None)
            self.assertEqual(again.replay(logfile), 3)
            a, b = store.summaries(), again.summaries()
            for x, y in zip(a, b):
                for key in ("usage", "cost_usd", "state", "anomalies", "relation", "lane", "tool_results", "gist"):
                    self.assertEqual(x[key], y[key], key)


# ---------------------------------------------------------------------------- end to end

class FakeUpstream(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    seen: list = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        FakeUpstream.seen.append((dict(self.headers), body))
        name = self.headers.get("x-fixture", "text_only.sse")
        data = fixture(name)
        status = 529 if name == "error_529.json" else 200
        self.send_response(status)
        self.send_header("content-type", "text/event-stream" if name.endswith(".sse") else "application/json")
        self.send_header("x-upstream", "yes")
        self.send_header("connection", "close")
        self.end_headers()
        for i in range(0, len(data), 64):
            self.wfile.write(data[i:i + 64])
            self.wfile.flush()
            time.sleep(0.005)
        self.close_connection = True


class EndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeUpstream)
        threading.Thread(target=cls.upstream.serve_forever, daemon=True).start()
        cls.store = Store(Prices(os.path.join(ROOT, "prices.json")), cls.tmp.name)
        proxy.UPSTREAM = f"http://127.0.0.1:{cls.upstream.server_address[1]}"
        proxy.VERBOSE = False
        proxy.RECORDER = Recorder(cls.store)
        cls.proxy = ThreadingHTTPServer(("127.0.0.1", 0), proxy.Tap)
        threading.Thread(target=cls.proxy.serve_forever, daemon=True).start()
        cls.dash = dashboard.start(cls.store, 0, {"upstream": proxy.UPSTREAM, "proxy_port": 0})

    @classmethod
    def tearDownClass(cls):
        for s in (cls.upstream, cls.proxy, cls.dash):
            s.shutdown()
            s.server_close()
        proxy.RECORDER = None
        cls.tmp.cleanup()

    def get(self, path):
        c = http.client.HTTPConnection("127.0.0.1", self.dash.server_address[1], timeout=5)
        c.request("GET", path)
        r = c.getresponse()
        try:
            return r.status, r.read()
        finally:
            c.close()

    def send(self, fixture_name, body):
        c = http.client.HTTPConnection("127.0.0.1", self.proxy.server_address[1], timeout=10)
        raw = json.dumps(body).encode()
        c.request("POST", "/v1/messages?beta=true", body=raw,
                  headers={"x-fixture": fixture_name, "authorization": "Bearer " + SECRET,
                           "anthropic-beta": "oauth-2025-04-20", "content-type": "application/json"})
        r = c.getresponse()
        try:
            return r.status, dict(r.getheaders()), r.read(), raw
        finally:
            c.close()

    def test_forwarding_is_unchanged_and_captured(self):
        body = {"model": "claude-sonnet-4-5", "max_tokens": 10, "stream": True,
                "messages": [{"role": "user", "content": "hello e2e"}]}
        status, headers, data, raw = self.send("tool_use.sse", body)
        self.assertEqual(status, 200)
        self.assertEqual(data, fixture("tool_use.sse"))  # byte for byte
        self.assertEqual(headers.get("x-upstream"), "yes")
        seen_headers, seen_body = FakeUpstream.seen[-1]
        self.assertEqual(seen_body, raw)
        self.assertEqual(seen_headers.get("authorization"), "Bearer " + SECRET)  # passed through untouched
        self.assertEqual(seen_headers.get("anthropic-beta"), "oauth-2025-04-20")

        proxy.RECORDER.drain()
        st, payload = self.get("/api/exchanges")
        self.assertEqual(st, 200)
        self.assertNotIn(SECRET.encode(), payload)
        summaries = json.loads(payload)
        mine = [s for s in summaries if s["gist"]["text"] == "hello e2e"]
        self.assertEqual(len(mine), 1)
        s = mine[0]
        self.assertEqual(s["state"], "done")
        self.assertEqual([c["name"] for c in s["tool_calls"]], ["Bash", "Read"])
        st, detail = self.get(f"/api/exchanges/{s['id']}")
        self.assertNotIn(SECRET.encode(), detail)
        st, raw_view = self.get(f"/api/exchanges/{s['id']}/raw")
        self.assertEqual(json.loads(raw_view)["response"], fixture("tool_use.sse").decode())
        self.assertNotIn(SECRET.encode(), raw_view)

    def test_529_passes_through(self):
        status, _, data, _ = self.send("error_529.json", {"model": "m", "messages": [{"role": "user", "content": "q"}]})
        self.assertEqual(status, 529)
        self.assertEqual(data, fixture("error_529.json"))
        proxy.RECORDER.drain()
        last = json.loads(self.get("/api/exchanges")[1])[-1]
        self.assertEqual(last["state"], "error")

    def test_static_and_events(self):
        for path in ("/", "/app.js", "/style.css"):
            self.assertEqual(self.get(path)[0], 200)
        c = http.client.HTTPConnection("127.0.0.1", self.dash.server_address[1], timeout=5)
        c.request("GET", "/events")
        r = c.getresponse()
        self.assertEqual(r.getheader("content-type").split(";")[0], "text/event-stream")
        r.read1(100)  # the "connected" comment
        t0 = time.time()
        threading.Thread(target=self.send, args=("text_only.sse", {"model": "m", "stream": True,
                                                                   "messages": [{"role": "user", "content": "live"}]})).start()
        buf = b""
        while b"exchange.started" not in buf and time.time() - t0 < 3:
            buf += r.read1(65536)
        self.assertIn(b"exchange.started", buf)
        self.assertLess(time.time() - t0, 1.0)  # appears well within the 200 ms budget plus thread start
        while b"exchange.finished" not in buf and time.time() - t0 < 5:
            buf += r.read1(65536)
        self.assertIn(b"exchange.finished", buf)
        c.close()

    def test_secrets_not_in_log(self):
        proxy.RECORDER.drain()
        for name in os.listdir(self.tmp.name):
            with open(os.path.join(self.tmp.name, name), encoding="utf-8") as f:
                self.assertNotIn(SECRET, f.read())


if __name__ == "__main__":
    unittest.main()
