"""traffic.py: capture, parse and store agent traffic for the dashboard.

Standard library only. The proxy hands raw events (request arrived, reply
headers, reply chunk, reply ended) to a `Recorder`, which only puts them on a
queue and returns at once. A single worker thread turns them into `Exchange`
records (SPEC section 5), keeps them in a `Store`, appends finished exchanges
to a JSONL log, and publishes live events to dashboard subscribers. Nothing in
here runs in the forwarding path.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import queue
import re
import threading
import time
from datetime import datetime
from typing import Any, Callable

SECRET_HEADERS = {"authorization", "x-api-key", "proxy-authorization", "cookie", "set-cookie"}
UPDATE_INTERVAL = 0.1  # exchange.updated throttle: about 10 per second
HERE = os.path.dirname(os.path.abspath(__file__))


# --------------------------------------------------------------------------- helpers

def redact(value: str) -> str:
    """Truncate a secret the same way the terminal output always has."""
    return value[:16] + "..." if len(value) > 16 else "..."


def redact_headers(headers: list[tuple[str, str]] | dict[str, str]) -> list[list[str]]:
    items = headers.items() if isinstance(headers, dict) else headers
    out = []
    for name, value in items:
        if name.lower() in SECRET_HEADERS:
            value = redact(value)
        out.append([name, value])
    return out


def strip_cache_control(obj: Any) -> Any:
    """Cache breakpoints move between requests; ignore them when comparing."""
    if isinstance(obj, dict):
        return {k: strip_cache_control(v) for k, v in obj.items() if k != "cache_control"}
    if isinstance(obj, list):
        return [strip_cache_control(v) for v in obj]
    return obj


def digest(obj: Any) -> str:
    raw = json.dumps(strip_cache_control(obj), sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(raw.encode("utf-8", "replace")).hexdigest()[:16]


def blocks_of(content: Any) -> list[dict]:
    """Message content may be a plain string or a list of blocks."""
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if isinstance(content, list):
        return [b if isinstance(b, dict) else {"type": "text", "text": str(b)} for b in content]
    return []


def result_text(block: dict) -> str:
    """Flatten a tool_result's content to text."""
    content = block.get("content")
    if isinstance(content, str):
        return content
    parts = []
    for b in blocks_of(content):
        if b.get("type") == "text":
            parts.append(b.get("text", ""))
        else:
            parts.append(f"[{b.get('type', '?')}]")
    return "\n".join(parts)


def message_text(msg: dict) -> str:
    """A readable flat text of a message, used for diffs and search."""
    parts = []
    for b in blocks_of(msg.get("content")):
        t = b.get("type")
        if t == "text":
            parts.append(b.get("text", ""))
        elif t == "thinking":
            parts.append("[thinking] " + b.get("thinking", ""))
        elif t == "tool_use":
            parts.append(f"[tool_use {b.get('name')}] " + json.dumps(b.get("input"), ensure_ascii=False))
        elif t == "tool_result":
            parts.append("[tool_result] " + result_text(b))
        else:
            parts.append(f"[{t}]")
    return "\n".join(parts)


def system_blocks(system: Any) -> list[dict]:
    if system is None:
        return []
    return blocks_of(system)


def system_text(blocks: list[dict]) -> str:
    return "\n\n".join(b.get("text", "") for b in blocks if b.get("type") == "text")


def iso(t: float | None) -> float | None:
    return None if t is None else round(t, 3)


# --------------------------------------------------------------------------- prices (D5)

class Prices:
    """Per-model price table from an editable JSON file. Cost is an estimate."""

    def __init__(self, path: str | None = None):
        self.path = path or os.path.join(HERE, "prices.json")
        self.mtime = 0.0
        self.table: dict = {}
        self.load()

    def load(self) -> None:
        try:
            mtime = os.path.getmtime(self.path)
            if mtime != self.mtime:
                with open(self.path, encoding="utf-8") as f:
                    self.table = json.load(f)
                self.mtime = mtime
        except (OSError, ValueError):
            if not self.table:
                self.table = {"models": {}, "default": {"input": 3, "output": 15},
                              "cache_multipliers": {"read": 0.1, "write_5m": 1.25, "write_1h": 2.0}}

    def lookup(self, model: str | None) -> tuple[dict, str]:
        self.load()
        name = (model or "").lower()
        best = None
        for key in self.table.get("models", {}):
            if key.lower() in name and (best is None or len(key) > len(best)):
                best = key
        if best:
            return self.table["models"][best], best
        return self.table.get("default", {"input": 3, "output": 15}), "default"

    def cost(self, model: str | None, usage: dict) -> tuple[float, str]:
        price, source = self.lookup(model)
        mult = self.table.get("cache_multipliers", {})
        per_in = price.get("input", 0) / 1e6
        per_out = price.get("output", 0) / 1e6
        cache = usage.get("cache_creation") or {}
        w1h = cache.get("ephemeral_1h_input_tokens") or 0
        w5m = (usage.get("cache_creation_input_tokens") or 0) - w1h
        total = (
            (usage.get("input_tokens") or 0) * per_in
            + (usage.get("output_tokens") or 0) * per_out
            + (usage.get("cache_read_input_tokens") or 0) * per_in * mult.get("read", 0.1)
            + max(w5m, 0) * per_in * mult.get("write_5m", 1.25)
            + w1h * per_in * mult.get("write_1h", 2.0)
        )
        return round(total, 6), source


# --------------------------------------------------------------------------- reply parsing

class ReplyParser:
    """Assembles a Messages API reply from SSE chunks (or a JSON body).

    Keeps the raw text so the Raw tab can show exactly what arrived.
    """

    def __init__(self) -> None:
        self.raw = bytearray()
        self.buf = ""
        self.decoder = None
        self.content: list[dict] = []
        self.partial: dict[int, str] = {}
        self.stop_reason: str | None = None
        self.stop_sequence: str | None = None
        self.usage: dict = {}
        self.error: dict | None = None
        self.message: dict = {}
        self.parse_errors: list[str] = []
        self.saw_events = False

    def feed(self, chunk: bytes) -> None:
        import codecs
        if self.decoder is None:
            self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.raw += chunk
        self.buf += self.decoder.decode(chunk).replace("\r\n", "\n")
        while "\n\n" in self.buf:
            frame, self.buf = self.buf.split("\n\n", 1)
            self._frame(frame)

    def finish_stream(self) -> None:
        if self.decoder is not None:
            self.buf += self.decoder.decode(b"", final=True)
        if self.buf.strip():
            self._frame(self.buf)
            self.buf = ""
        for index in list(self.partial):
            self._close_block(index)

    def _frame(self, frame: str) -> None:
        event, data = None, []
        for line in frame.split("\n"):
            if line.startswith(":"):
                continue
            name, _, value = line.partition(":")
            value = value[1:] if value.startswith(" ") else value
            if name == "event":
                event = value
            elif name == "data":
                data.append(value)
        if not data:
            return
        payload = "\n".join(data)
        if payload == "[DONE]":
            return
        try:
            obj = json.loads(payload)
        except ValueError:
            self.parse_errors.append(f"bad JSON in SSE event {event!r}")
            return
        self.saw_events = True
        try:
            self._event(obj.get("type") or event, obj)
        except Exception as e:  # never let one odd event kill the record
            self.parse_errors.append(f"{event}: {e!r}")

    def _event(self, kind: str, obj: dict) -> None:
        if kind == "message_start":
            self.message = dict(obj.get("message") or {})
            self.usage.update({k: v for k, v in (self.message.get("usage") or {}).items() if v is not None})
            self.message.pop("usage", None)
            for block in self.message.pop("content", None) or []:
                self.content.append(block)
        elif kind == "content_block_start":
            index = obj.get("index", len(self.content))
            block = dict(obj.get("content_block") or {})
            if block.get("type") in ("tool_use", "server_tool_use", "mcp_tool_use"):
                self.partial[index] = ""
            while len(self.content) <= index:
                self.content.append({"type": "text", "text": ""})
            self.content[index] = block
        elif kind == "content_block_delta":
            index = obj.get("index", 0)
            delta = obj.get("delta") or {}
            block = self.content[index]
            dt = delta.get("type")
            if dt == "text_delta":
                block["text"] = block.get("text", "") + delta.get("text", "")
            elif dt == "input_json_delta":
                self.partial[index] = self.partial.get(index, "") + delta.get("partial_json", "")
                block["_partial_json"] = self.partial[index]
            elif dt == "thinking_delta":
                block["thinking"] = block.get("thinking", "") + delta.get("thinking", "")
            elif dt == "signature_delta":
                block["signature"] = block.get("signature", "") + delta.get("signature", "")
            elif dt == "citations_delta":
                block.setdefault("citations", []).append(delta.get("citation"))
        elif kind == "content_block_stop":
            self._close_block(obj.get("index", 0))
        elif kind == "message_delta":
            delta = obj.get("delta") or {}
            if "stop_reason" in delta:
                self.stop_reason = delta["stop_reason"]
            if "stop_sequence" in delta:
                self.stop_sequence = delta["stop_sequence"]
            self.usage.update({k: v for k, v in (obj.get("usage") or {}).items() if v is not None})
        elif kind == "error":
            err = obj.get("error") or {}
            self.error = {"type": err.get("type", "error"), "message": err.get("message", json.dumps(obj))}

    def _close_block(self, index: int) -> None:
        if index not in self.partial:
            return
        text = self.partial.pop(index)
        block = self.content[index]
        block.pop("_partial_json", None)
        try:
            block["input"] = json.loads(text) if text.strip() else (block.get("input") or {})
        except ValueError:
            block["input"] = {"_unparsed": text}
            self.parse_errors.append(f"tool input of block {index} is not valid JSON")

    def parse_json_body(self, data: bytes) -> None:
        self.raw += data
        try:
            obj = json.loads(data)
        except ValueError:
            if data.strip():
                self.parse_errors.append("reply body is not JSON")
            return
        if not isinstance(obj, dict):
            self.parse_errors.append("reply body is not a JSON object")
            return
        if obj.get("type") == "error" or "error" in obj and obj.get("type") != "message":
            err = obj.get("error") or {}
            if isinstance(err, dict):
                self.error = {"type": err.get("type", "error"), "message": err.get("message", "")}
            else:
                self.error = {"type": "error", "message": str(err)}
            return
        self.content = list(obj.get("content") or [])
        self.stop_reason = obj.get("stop_reason")
        self.stop_sequence = obj.get("stop_sequence")
        self.usage = {k: v for k, v in (obj.get("usage") or {}).items() if v is not None}
        self.message = {k: obj.get(k) for k in ("id", "model", "role", "type")}

    def raw_text(self) -> str:
        return self.raw.decode("utf-8", "replace")


# --------------------------------------------------------------------------- exchange

ANOMALY_LEVEL = {
    "http_error": "error", "stream_error": "error", "aborted": "error", "parse_error": "error",
    "tool_error": "error", "unanswered": "error", "max_tokens": "warn",
    "system_changed": "warn", "tools_changed": "warn",
}


class Exchange:
    """One request plus its reply (SPEC section 5)."""

    def __init__(self, ex_id: int, method: str, path: str, headers: list[list[str]], body: bytes, t: float):
        self.id = ex_id
        self.method = method
        self.path = path
        self.started_at = t
        self.first_byte_at: float | None = None
        self.finished_at: float | None = None
        self.status: int | None = None
        self.reason = ""
        self.state = "pending"
        self.req_headers = headers
        self.resp_headers: list[list[str]] = []
        self.body_obj: Any = None
        self.body_text: str | None = None
        self.parser = ReplyParser()
        self.streaming = False
        self.note: str | None = None
        self.anomalies: dict[str, str] = {}
        self.parse_failed: list[str] = []
        # lane bookkeeping, filled by the store
        self.session_id = "-"
        self.lane = 0
        self.lane_role = ""
        self.prev_id: int | None = None
        self.relation = "first"
        self.common_prefix = 0
        self.new_from = 0
        self.echo_index: int | None = None
        self.msg_hashes: list[str] = []
        self.sys_hash = ""
        self.tools_hash = ""
        self.tool_results: list[dict] = []  # results sent in this request
        self.cost = 0.0
        self.cost_source = ""

        path_only = path.split("?", 1)[0]
        if "count_tokens" in path_only:
            self.kind = "count_tokens"
        elif method == "POST" and path_only.rstrip("/").endswith("/v1/messages"):
            self.kind = "messages"
        else:
            self.kind = "other"

        if body:
            try:
                self.body_obj = json.loads(body)
            except ValueError:
                self.body_text = body.decode("utf-8", "replace")
                if self.kind == "messages":
                    self.parse_failed.append("request body is not JSON")
        if self.kind == "messages" and not isinstance(self.body_obj, dict):
            if self.body_obj is not None:
                self.parse_failed.append("request body is not a JSON object")
            self.body_obj = None

    # -- request accessors
    @property
    def req(self) -> dict:
        return self.body_obj if isinstance(self.body_obj, dict) else {}

    @property
    def messages(self) -> list[dict]:
        m = self.req.get("messages")
        return m if isinstance(m, list) else []

    @property
    def system(self) -> list[dict]:
        return system_blocks(self.req.get("system"))

    @property
    def tools(self) -> list[dict]:
        t = self.req.get("tools")
        return t if isinstance(t, list) else []

    @property
    def model(self) -> str | None:
        return self.req.get("model") or self.parser.message.get("model")

    def header(self, name: str) -> str | None:
        for k, v in self.req_headers:
            if k.lower() == name:
                return v
        return None

    def new_messages(self) -> list[dict]:
        return self.messages[self.new_from:]

    # -- derived
    def tool_calls(self) -> list[dict]:
        out = []
        for b in self.parser.content:
            if b.get("type") == "tool_use":
                out.append({"id": b.get("id"), "name": b.get("name"), "input": b.get("input")})
        return out

    def usage(self) -> dict:
        u = self.parser.usage
        return {
            "input": u.get("input_tokens") or 0,
            "output": u.get("output_tokens") or 0,
            "cache_read": u.get("cache_read_input_tokens") or 0,
            "cache_write": u.get("cache_creation_input_tokens") or 0,
        }

    def duration_ms(self) -> int | None:
        if self.finished_at is None:
            return None
        return int((self.finished_at - self.started_at) * 1000)

    def ttfb_ms(self) -> int | None:
        if self.first_byte_at is None:
            return None
        return int((self.first_byte_at - self.started_at) * 1000)

    def flag(self, code: str, msg: str) -> None:
        self.anomalies[code] = msg

    def anomaly_list(self) -> list[dict]:
        out = [{"code": c, "level": ANOMALY_LEVEL.get(c, "warn"), "msg": m} for c, m in self.anomalies.items()]
        if self.parse_failed or self.parser.parse_errors:
            out.append({"code": "parse_error", "level": "error",
                        "msg": "could not parse: " + "; ".join((self.parse_failed + self.parser.parse_errors)[:3])})
        return out

    def gist(self, store: "Store") -> dict:
        if self.kind != "messages":
            return {"kind": "other", "text": f"{self.method} {self.path}"}
        human, results = [], []
        for msg in self.new_messages():
            if msg.get("role") != "user":
                continue
            for b in blocks_of(msg.get("content")):
                if b.get("type") == "text":
                    text = b.get("text", "").strip()
                    if text and not text.startswith("<system-reminder>"):
                        human.append(text)
                elif b.get("type") == "tool_result":
                    results.append(b)
        if human:
            return {"kind": "user", "text": human[-1][:240]}
        if results:
            names = []
            for b in results:
                entry = store.tool_index.get(b.get("tool_use_id"))
                name = entry["name"] if entry else "?"
                names.append(name + (" ✗" if b.get("is_error") else ""))
            return {"kind": "tool_result", "text": "results: " + ", ".join(names)}
        calls = self.tool_calls()
        if calls:
            return {"kind": "tool_call", "text": "calls " + ", ".join(c["name"] or "?" for c in calls)}
        for b in self.parser.content:
            if b.get("type") == "text" and b.get("text", "").strip():
                return {"kind": "assistant", "text": b["text"].strip()[:240]}
        msgs = self.new_messages()
        if msgs:
            return {"kind": "user", "text": message_text(msgs[-1])[:240]}
        if self.parser.error:
            return {"kind": "error", "text": f"{self.parser.error['type']}: {self.parser.error['message']}"[:240]}
        if self.status is not None and self.status >= 400:
            return {"kind": "error", "text": f"HTTP {self.status} {self.reason}"}
        if self.prev_id is not None:
            return {"kind": "other", "text": f"no new messages (same conversation as #{self.prev_id})"}
        return {"kind": "other", "text": ""}

    def summary(self, store: "Store") -> dict:
        calls = []
        for c in self.tool_calls():
            entry = store.tool_index.get(c["id"]) or {}
            calls.append({"id": c["id"], "name": c["name"], "result_in": entry.get("result_ex"),
                          "is_error": entry.get("is_error", False)})
        return {
            "id": self.id,
            "session_id": self.session_id,
            "lane": self.lane,
            "lane_role": self.lane_role,
            "method": self.method,
            "path": self.path,
            "kind": self.kind,
            "started_at": iso(self.started_at),
            "first_byte_at": iso(self.first_byte_at),
            "finished_at": iso(self.finished_at),
            "status": self.status,
            "state": self.state,
            "model": self.model,
            "stream": bool(self.req.get("stream")),
            "gist": self.gist(store),
            "tool_calls": calls,
            "tool_results": [{k: r[k] for k in ("tool_use_id", "name", "is_error", "size", "call_ex")}
                             for r in self.tool_results],
            "usage": self.usage(),
            "cost_usd": self.cost,
            "cost_source": self.cost_source,
            "duration_ms": self.duration_ms(),
            "ttfb_ms": self.ttfb_ms(),
            "stop_reason": self.parser.stop_reason,
            "anomalies": self.anomaly_list(),
            "relation": self.relation,
            "prev_id": self.prev_id,
            "msg_count": len(self.messages),
            "new_count": len(self.messages) - self.new_from,
        }


# --------------------------------------------------------------------------- store

class Lane:
    def __init__(self, number: int, role: str):
        self.number = number
        self.role = role
        self.last: Exchange | None = None


class Store:
    """All exchanges, in memory. Mutated only by the recorder's worker thread."""

    def __init__(self, prices: Prices | None = None, log_dir: str | None = None):
        self.lock = threading.RLock()
        self.exchanges: dict[int, Exchange] = {}
        self.order: list[int] = []
        self.next_id = 1
        self.lanes: dict[str, list[Lane]] = {}
        self.tool_index: dict[str, dict] = {}
        self.prices = prices or Prices()
        self.log_dir = log_dir
        self.subscribers: list[queue.Queue] = []
        self.sub_lock = threading.Lock()
        self.dirty: dict[int, float] = {}
        self.last_pub: dict[int, float] = {}
        self.on_finish: Callable[[Exchange], None] | None = None
        self.text_cache: dict[str, str] = {}

    # -- publishing
    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=2000)
        with self.sub_lock:
            self.subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self.sub_lock:
            if q in self.subscribers:
                self.subscribers.remove(q)

    def publish(self, event: str, data: dict) -> None:
        payload = json.dumps(data, ensure_ascii=False, default=str)
        with self.sub_lock:
            for q in list(self.subscribers):
                try:
                    q.put_nowait((event, payload))
                except queue.Full:  # a stuck browser: drop it, it will reconnect and resync
                    self.subscribers.remove(q)

    def publish_update(self, ex: Exchange, force: bool = False) -> None:
        now = time.time()
        if not force and now - self.last_pub.get(ex.id, 0) < UPDATE_INTERVAL:
            self.dirty[ex.id] = now
            return
        self.dirty.pop(ex.id, None)
        self.last_pub[ex.id] = now
        data = ex.summary(self)
        data["content"] = ex.parser.content
        self.publish("exchange.updated", data)

    def flush_dirty(self) -> None:
        now = time.time()
        for ex_id in list(self.dirty):
            if now - self.last_pub.get(ex_id, 0) >= UPDATE_INTERVAL:
                ex = self.exchanges.get(ex_id)
                if ex:
                    self.publish_update(ex, force=True)

    # -- lifecycle (called from the worker)
    def begin(self, method: str, path: str, headers: list, body: bytes, t: float) -> Exchange:
        with self.lock:
            ex = Exchange(self.next_id, method, path, redact_headers(headers), body, t)
            self.next_id += 1
            self.exchanges[ex.id] = ex
            self.order.append(ex.id)
            ex.session_id = self._session_of(ex)
            if ex.kind == "messages" and ex.body_obj is not None:
                self._place_in_lane(ex)
            self.publish("exchange.started", ex.summary(self))
            return ex

    def response(self, ex: Exchange, status: int, reason: str, headers: list, t: float) -> None:
        with self.lock:
            ex.status = status
            ex.reason = reason
            ex.resp_headers = redact_headers(headers)
            ctype = ""
            for k, v in headers:
                if k.lower() == "content-type":
                    ctype = v.lower()
            ex.streaming = "text/event-stream" in ctype
            ex.state = "streaming"
            if status >= 400:
                ex.flag("http_error", f"HTTP {status} {reason}")
            self.publish_update(ex, force=True)

    def chunk(self, ex: Exchange, data: bytes, t: float) -> None:
        with self.lock:
            if ex.first_byte_at is None:
                ex.first_byte_at = t
            if ex.streaming:
                ex.parser.feed(data)
            else:
                ex.parser.raw += data
            if ex.parser.error and "stream_error" not in ex.anomalies and ex.streaming:
                e = ex.parser.error
                ex.flag("stream_error", f"stream error: {e['type']}: {e['message']}")
            self.publish_update(ex)

    def end(self, ex: Exchange, state: str, note: str | None, t: float) -> None:
        with self.lock:
            ex.finished_at = t
            p = ex.parser
            if ex.streaming:
                p.finish_stream()
            elif p.raw and ex.kind in ("messages", "count_tokens"):
                raw = bytes(p.raw)
                p.raw = bytearray()
                p.parse_json_body(raw)
                if ex.kind == "count_tokens":
                    p.parse_errors.clear()
            if note:
                ex.note = note
            if state == "aborted":
                ex.flag("aborted", note or "connection aborted mid-stream")
            elif state == "error" and note and "http_error" not in ex.anomalies:
                ex.flag("http_error", note)
            if p.error:
                code = "stream_error" if ex.streaming else "http_error"
                if code not in ex.anomalies or code == "http_error":
                    ex.flag(code, f"{p.error['type']}: {p.error['message']}"
                            + (f" (HTTP {ex.status})" if code == "http_error" and ex.status else ""))
            if p.stop_reason == "max_tokens":
                ex.flag("max_tokens", "stop_reason: max_tokens (reply was cut off)")
            if ex.kind == "messages" and ex.streaming and not p.saw_events and p.raw:
                p.parse_errors.append("no SSE events found in the reply")
            if ex.kind == "other":
                p.parse_errors.clear()
            error = ex.status is not None and ex.status >= 400 or p.error or state in ("error", "aborted")
            ex.state = "aborted" if state == "aborted" else ("error" if error else "done")
            if ex.kind == "messages":
                ex.cost, ex.cost_source = self.prices.cost(ex.model, p.usage)
                for c in ex.tool_calls():
                    if c["id"]:
                        entry = self.tool_index.setdefault(c["id"], {"result_ex": None, "result_block": None,
                                                                     "is_error": False, "size": 0})
                        if entry.get("call_ex") is None:  # ids are unique; never re-point a pairing
                            entry.update({"call_ex": ex.id, "name": c["name"], "input": c["input"]})
            self.publish("exchange.finished", ex.summary(self))
            self.last_pub[ex.id] = time.time()
            self.dirty.pop(ex.id, None)
        if self.on_finish:
            try:
                self.on_finish(ex)
            except Exception:
                pass
        self._log(ex)

    # -- sessions and lanes (D6)
    def _session_of(self, ex: Exchange) -> str:
        sid = ex.header("x-claude-code-session-id") or ex.header("session_id") or ex.header("session-id")
        if sid:
            return sid
        meta = ex.req.get("metadata") if isinstance(ex.req.get("metadata"), dict) else {}
        user_id = meta.get("user_id") if meta else None
        if isinstance(user_id, str):
            m = re.search(r"session_([0-9a-fA-F-]{8,})", user_id)
            if m:
                return m.group(1)
            try:
                parsed = json.loads(user_id)
                if isinstance(parsed, dict) and parsed.get("session_id"):
                    return str(parsed["session_id"])
            except ValueError:
                pass
        return "default"

    def _place_in_lane(self, ex: Exchange) -> None:
        msgs = ex.messages
        ex.msg_hashes = [digest(m) for m in msgs]
        ex.sys_hash = digest(ex.system)
        ex.tools_hash = digest(ex.tools)
        lanes = self.lanes.setdefault(ex.session_id, [])

        best, best_score = None, None
        for lane in lanes:
            last = lane.last
            if last is None:
                continue
            cp = 0
            for a, b in zip(last.msg_hashes, ex.msg_hashes):
                if a != b:
                    break
                cp += 1
            same_sys = last.sys_hash == ex.sys_hash
            same_tools = last.tools_hash == ex.tools_hash
            if cp and cp == len(last.msg_hashes):
                score = (3, cp, same_sys, last.started_at)
            elif cp:
                score = (2, cp, same_sys, last.started_at)
            elif same_sys and same_tools:
                score = (1, 0, True, last.started_at)
            else:
                continue
            if best_score is None or score > best_score:
                best, best_score = lane, score

        if best is None:
            best = Lane(len(lanes) + 1, "agent" if ex.tools else "side")
            lanes.append(best)
        ex.lane = best.number
        ex.lane_role = best.role
        prev = best.last
        best.last = ex

        if prev is None:
            ex.relation = "first"
            ex.common_prefix = 0
            ex.new_from = 0 if len(msgs) <= 4 else self._trailing_user_start(msgs)
        else:
            ex.prev_id = prev.id
            cp = best_score[1]
            ex.common_prefix = cp
            if cp and cp == len(prev.msg_hashes):
                ex.relation = "append"
                start = cp
                if start < len(msgs) and msgs[start].get("role") == "assistant" and prev.parser.content:
                    ex.echo_index = start
                    start += 1
                ex.new_from = start
            elif cp == 0 and not ex.tools:
                ex.relation = "independent"
                ex.new_from = 0 if len(msgs) <= 4 else self._trailing_user_start(msgs)
            else:
                ex.relation = "rewritten"
                ex.new_from = self._trailing_user_start(msgs)
            if prev.sys_hash != ex.sys_hash and ex.relation != "independent":
                ex.flag("system_changed", f"system prompt changed since #{prev.id}")
            if prev.tools_hash != ex.tools_hash and ex.relation != "independent":
                ex.flag("tools_changed", f"tool set changed since #{prev.id}")

        self._register_results(ex)
        if prev is not None and prev.finished_at is not None and ex.relation in ("append", "rewritten"):
            missing = [c for c in prev.tool_calls()
                       if c["id"] and (self.tool_index.get(c["id"]) or {}).get("result_ex") is None]
            if missing:
                prev.flag("unanswered", "tool call never got a result: "
                          + ", ".join(f"{c['name']} ({c['id']})" for c in missing))
                self.publish_update(prev, force=True)

    @staticmethod
    def _trailing_user_start(msgs: list[dict]) -> int:
        i = len(msgs)
        while i > 0 and msgs[i - 1].get("role") == "user":
            i -= 1
        return min(i, max(len(msgs) - 1, 0)) if i == len(msgs) else i

    def _register_results(self, ex: Exchange) -> None:
        for msg in ex.messages:
            if msg.get("role") != "user" or isinstance(msg.get("content"), str):
                continue
            for b in blocks_of(msg.get("content")):
                if b.get("type") != "tool_result":
                    continue
                tid = b.get("tool_use_id")
                entry = self.tool_index.get(tid)
                if entry and entry.get("result_ex") is not None:
                    continue
                if entry is None:
                    entry = {"call_ex": None, "name": "?", "input": None}
                    self.tool_index[tid] = entry
                size = len(result_text(b))
                entry.update({"result_ex": ex.id, "result_block": b, "is_error": bool(b.get("is_error")),
                              "size": size})
                ex.tool_results.append({"tool_use_id": tid, "name": entry.get("name") or "?",
                                        "is_error": bool(b.get("is_error")), "size": size,
                                        "call_ex": entry.get("call_ex")})
                call_ex = self.exchanges.get(entry.get("call_ex") or -1)
                if call_ex is not None and call_ex is not ex:
                    self.publish_update(call_ex, force=True)
        errors = [r for r in ex.tool_results if r["is_error"]]
        if errors:
            ex.flag("tool_error", "tool result with is_error: " + ", ".join(r["name"] for r in errors))

    # -- reading (called from dashboard threads)
    def summaries(self) -> list[dict]:
        with self.lock:
            return [self.exchanges[i].summary(self) for i in self.order]

    def detail(self, ex_id: int) -> dict | None:
        with self.lock:
            ex = self.exchanges.get(ex_id)
            if ex is None:
                return None
            data = ex.summary(self)
            req = ex.req
            data["request"] = {
                "headers": ex.req_headers,
                "parsed": ex.kind == "messages" and ex.body_obj is not None,
                "model": req.get("model"),
                "max_tokens": req.get("max_tokens"),
                "temperature": req.get("temperature"),
                "thinking": req.get("thinking"),
                "stream": req.get("stream"),
                "metadata": req.get("metadata"),
                "system": ex.system if ex.kind == "messages" else [],
                "tools": ex.tools if ex.kind == "messages" else [],
                "messages": ex.messages if ex.kind == "messages" else [],
                "new_from": ex.new_from,
                "echo_index": ex.echo_index,
                "common_prefix": ex.common_prefix,
                "other_params": {k: v for k, v in req.items()
                                 if k not in ("system", "tools", "messages", "model", "max_tokens",
                                              "temperature", "thinking", "stream", "metadata")}
                if ex.kind == "messages" else {},
            }
            data["response"] = {
                "status": ex.status,
                "reason": ex.reason,
                "headers": ex.resp_headers,
                "content": ex.parser.content,
                "stop_reason": ex.parser.stop_reason,
                "stop_sequence": ex.parser.stop_sequence,
                "usage_raw": ex.parser.usage,
                "error": ex.parser.error,
                "message": ex.parser.message,
                "note": ex.note,
            }
            # Tool call <-> result pairing.
            paired_results = {}
            for c in ex.tool_calls():
                entry = self.tool_index.get(c["id"]) or {}
                if entry.get("result_ex") is not None:
                    paired_results[c["id"]] = {"exchange_id": entry["result_ex"], "is_error": entry["is_error"],
                                               "block": entry["result_block"]}
            paired_calls = {}
            for msg in ex.messages:
                for b in blocks_of(msg.get("content")) if msg.get("role") == "user" else []:
                    if b.get("type") == "tool_result":
                        entry = self.tool_index.get(b.get("tool_use_id")) or {}
                        if entry.get("call_ex") is not None:
                            paired_calls[b.get("tool_use_id")] = {
                                "exchange_id": entry["call_ex"], "name": entry.get("name"),
                                "result_in": entry.get("result_ex")}
            data["paired_results"] = paired_results
            data["paired_calls"] = paired_calls
            data["changes"] = self.changes(ex)
            return data

    def raw(self, ex_id: int) -> dict | None:
        with self.lock:
            ex = self.exchanges.get(ex_id)
            if ex is None:
                return None
            if ex.body_obj is not None:
                req = json.dumps(ex.body_obj, indent=2, ensure_ascii=False)
            else:
                req = ex.body_text or ""
            return {"request_headers": ex.req_headers, "request": req,
                    "response_headers": ex.resp_headers, "response": ex.parser.raw_text(),
                    "status": ex.status, "reason": ex.reason}

    def changes(self, ex: Exchange) -> dict:
        """What changed since the previous request in the same lane (SPEC section 7)."""
        if ex.kind != "messages" or ex.body_obj is None:
            return {"available": False}
        prev = self.exchanges.get(ex.prev_id) if ex.prev_id else None
        if prev is None:
            return {"available": True, "first": True, "relation": ex.relation}
        out: dict[str, Any] = {"available": True, "first": False, "prev_id": prev.id, "relation": ex.relation}

        if prev.sys_hash == ex.sys_hash:
            out["system"] = {"changed": False}
        else:
            a, b = system_text(prev.system), system_text(ex.system)
            diff = list(difflib.unified_diff(a.splitlines(), b.splitlines(), "previous", "this", n=2, lineterm=""))
            out["system"] = {"changed": True, "diff": diff[:4000],
                             "cache_only": not diff}

        if prev.tools_hash == ex.tools_hash:
            out["tools"] = {"changed": False}
        else:
            pa = {t.get("name"): digest(t) for t in prev.tools}
            pb = {t.get("name"): digest(t) for t in ex.tools}
            out["tools"] = {
                "changed": True,
                "added": sorted(n for n in pb if n not in pa),
                "removed": sorted(n for n in pa if n not in pb),
                "modified": sorted(n for n in pb if n in pa and pa[n] != pb[n]),
            }

        params = []
        for key in ("model", "max_tokens", "thinking", "temperature"):
            before, after = prev.req.get(key), ex.req.get(key)
            if before != after:
                params.append({"name": key, "before": before, "after": after})
        out["params"] = params

        if ex.relation == "append":
            out["messages"] = {"mode": "append", "kept": ex.common_prefix,
                               "echo_index": ex.echo_index, "new_from": ex.new_from,
                               "added": len(ex.messages) - ex.common_prefix}
        elif ex.relation == "independent":
            out["messages"] = {"mode": "independent"}
        else:
            ops = []
            sm = difflib.SequenceMatcher(a=prev.msg_hashes, b=ex.msg_hashes, autojunk=False)
            for tag, i1, i2, j1, j2 in sm.get_opcodes():
                if tag == "equal":
                    ops.append({"op": "equal", "count": i2 - i1, "from": j1})
                    continue
                if tag == "replace":
                    pairs = min(i2 - i1, j2 - j1)
                    for k in range(pairs):
                        ma, mb = prev.messages[i1 + k], ex.messages[j1 + k]
                        diff = list(difflib.unified_diff(message_text(ma).splitlines(),
                                                         message_text(mb).splitlines(), "previous", "this",
                                                         n=2, lineterm=""))
                        ops.append({"op": "modified", "prev_index": i1 + k, "index": j1 + k,
                                    "role": mb.get("role"), "diff": diff[:1500]})
                    i1, j1 = i1 + pairs, j1 + pairs
                for i in range(i1, i2):
                    ops.append({"op": "removed", "prev_index": i, "role": prev.messages[i].get("role"),
                                "preview": message_text(prev.messages[i])[:400]})
                for j in range(j1, j2):
                    ops.append({"op": "added", "index": j, "role": ex.messages[j].get("role"),
                                "preview": message_text(ex.messages[j])[:400]})
            out["messages"] = {"mode": "rewritten", "ops": ops}
        return out

    def search(self, q: str, scope: str) -> list[int]:
        q = q.lower().strip()
        if not q:
            return []
        hits = []
        with self.lock:
            for i in self.order:
                ex = self.exchanges[i]
                if q in self._search_text(ex).lower():
                    hits.append(i)
                elif scope == "all" and ex.kind == "messages":
                    key = ex.sys_hash + ex.tools_hash
                    if key not in self.text_cache:
                        self.text_cache[key] = (system_text(ex.system) + "\n"
                                                + json.dumps(ex.tools, ensure_ascii=False)).lower()
                    if q in self.text_cache[key]:
                        hits.append(i)
        return hits

    def _search_text(self, ex: Exchange) -> str:
        if ex.kind != "messages":
            return f"{ex.method} {ex.path}"
        parts = [message_text(m) for m in ex.new_messages()]
        parts.append(message_text({"content": ex.parser.content}))
        if ex.parser.error:
            parts.append(ex.parser.error.get("message", ""))
        return "\n".join(parts)

    # -- persistence (D3, D10)
    def _log(self, ex: Exchange) -> None:
        if not self.log_dir:
            return
        record = {
            "v": 1,
            "id": ex.id,
            "method": ex.method,
            "path": ex.path,
            "started_at": ex.started_at,
            "first_byte_at": ex.first_byte_at,
            "finished_at": ex.finished_at,
            "status": ex.status,
            "reason": ex.reason,
            "state": ex.state,
            "note": ex.note,
            "request_headers": ex.req_headers,  # already redacted
            "request_body": ex.body_obj if ex.body_obj is not None else ex.body_text,
            "response_headers": ex.resp_headers,  # already redacted
            "response": ex.parser.raw_text(),
        }
        try:
            os.makedirs(self.log_dir, exist_ok=True)
            day = datetime.fromtimestamp(ex.started_at).strftime("%Y-%m-%d")
            with open(os.path.join(self.log_dir, f"{day}.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            pass

    def replay(self, path: str) -> int:
        """Load a JSONL log through the same pipeline as live traffic."""
        log_dir, self.log_dir = self.log_dir, None
        count = 0
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    body = rec.get("request_body")
                    if body is None:
                        raw = b""
                    elif isinstance(body, str):
                        raw = body.encode("utf-8")
                    else:
                        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
                    ex = self.begin(rec.get("method", "POST"), rec.get("path", "/"),
                                    rec.get("request_headers") or [], raw, rec.get("started_at") or 0)
                    if rec.get("status") is not None:
                        self.response(ex, rec["status"], rec.get("reason", ""), rec.get("response_headers") or [],
                                      rec.get("first_byte_at") or rec.get("started_at") or 0)
                        response = (rec.get("response") or "").encode("utf-8")
                        if response:
                            self.chunk(ex, response, rec.get("first_byte_at") or 0)
                    state = rec.get("state")
                    self.end(ex, "aborted" if state == "aborted" else ("error" if state == "error" else "done"),
                             rec.get("note"), rec.get("finished_at") or rec.get("started_at") or 0)
                    if rec.get("status") is None:
                        ex.status = None
                    count += 1
        finally:
            self.log_dir = log_dir
        return count


# --------------------------------------------------------------------------- recorder

class Recorder:
    """Thread-safe front door used by the proxy. Every call only enqueues."""

    def __init__(self, store: Store):
        self.store = store
        self.q: queue.Queue = queue.Queue()
        self.handles: dict[int, Exchange] = {}
        self.counter = 0
        self.counter_lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, name="traffic-recorder", daemon=True)
        self.thread.start()

    def begin(self, method: str, path: str, headers: list, body: bytes) -> int:
        with self.counter_lock:
            self.counter += 1
            handle = self.counter
        self.q.put(("begin", handle, time.time(), (method, path, list(headers), body)))
        return handle

    def response(self, handle: int, status: int, reason: str, headers: list) -> None:
        self.q.put(("response", handle, time.time(), (status, reason, list(headers))))

    def chunk(self, handle: int, data: bytes) -> None:
        self.q.put(("chunk", handle, time.time(), (data,)))

    def end(self, handle: int, state: str = "done", note: str | None = None) -> None:
        self.q.put(("end", handle, time.time(), (state, note)))

    def drain(self, timeout: float = 5.0) -> None:
        """Wait until every queued event is processed (tests use this)."""
        done = threading.Event()
        self.q.put(("sync", 0, 0, (done,)))
        done.wait(timeout)

    def _run(self) -> None:
        store = self.store
        while True:
            try:
                kind, handle, t, args = self.q.get(timeout=UPDATE_INTERVAL)
            except queue.Empty:
                store.flush_dirty()
                continue
            try:
                if kind == "sync":
                    args[0].set()
                elif kind == "begin":
                    self.handles[handle] = store.begin(*args, t)
                else:
                    ex = self.handles.get(handle)
                    if ex is None:
                        continue
                    if kind == "response":
                        store.response(ex, *args, t)
                    elif kind == "chunk":
                        store.chunk(ex, *args, t)
                    elif kind == "end":
                        store.end(ex, *args, t)
                        self.handles.pop(handle, None)
            except Exception as e:  # capture must never take the proxy down
                ex = self.handles.get(handle)
                if ex is not None:
                    ex.parse_failed.append(f"internal: {e!r}")
            store.flush_dirty()
