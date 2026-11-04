#!/usr/bin/env python3
"""proxy.py: the agent-traffic proxy for Lab 4, with a live browser dashboard.

A reverse proxy that forwards every request and reply unchanged, and shows the
traffic in a dashboard. Standard library only; nothing to install.

    python3 proxy.py                       # proxy on http://localhost:8041
                                           # dashboard on http://localhost:8042
    ANTHROPIC_BASE_URL=http://localhost:8041 claude

The proxy changes nothing: headers go through untouched (a subscription login
needs its bearer token and its `anthropic-beta` header), and the reply is
streamed back byte for byte as it arrives. Capture happens next to forwarding:
the handler only hands copies of the bytes to a queue, and a worker thread
parses them (see traffic.py).

The terminal prints one line per request; --verbose brings back the full dump.
Finished exchanges are logged (secrets redacted) to traffic/<date>.jsonl.

    python3 proxy.py --port 9000 --dashboard-port 9001
    python3 proxy.py --upstream https://chatgpt.com/backend-api/codex   # for Codex
    python3 proxy.py --replay traffic/2026-11-01.jsonl                  # review an old session
    python3 proxy.py --no-log --verbose
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import dashboard
from composition import Sources
from traffic import Exchange, Prices, Recorder, Store, redact

# Headers that describe one hop of the connection, not the message. They are
# never forwarded. `accept-encoding` is dropped too, so the API answers in plain
# text and what we print is readable.
SKIP = {
    "host", "connection", "keep-alive", "transfer-encoding", "te", "trailers",
    "upgrade", "proxy-authorization", "proxy-authenticate", "accept-encoding",
    "content-length",
}

UPSTREAM = "https://api.anthropic.com"
VERBOSE = False
RECORDER: Recorder | None = None
HERE = os.path.dirname(os.path.abspath(__file__))


def stamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def capture(method: str, *args: object) -> None:
    """Hand an event to the recorder. Never raises: forwarding comes first."""
    if RECORDER is None:
        return
    try:
        getattr(RECORDER, method)(*args)
    except Exception:
        pass


def kfmt(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


def one_line(ex: Exchange) -> None:
    """D9: one terminal line per request."""
    if VERBOSE:
        return
    dur = ex.duration_ms()
    parts = [f"[{datetime.fromtimestamp(ex.started_at).strftime('%H:%M:%S')}] #{ex.id:<4}",
             f"{ex.method} {ex.path}", str(ex.status or "---"), f"{dur / 1000:.1f}s" if dur is not None else ""]
    if ex.kind == "messages":
        u = ex.usage()
        parts.append(ex.model or "?")
        parts.append(f"in {kfmt(u['input'] + u['cache_read'] + u['cache_write'])}"
                     + (f" (cache {kfmt(u['cache_read'])})" if u["cache_read"] else "")
                     + f" out {kfmt(u['output'])}")
        parts.append(f"${ex.cost:.3f} est.")
        calls = ex.tool_calls()
        if calls:
            names: dict[str, int] = {}
            for c in calls:
                names[c["name"]] = names.get(c["name"], 0) + 1
            parts.append("-> " + ", ".join(f"{n}x{k}" if k > 1 else n for n, k in names.items()))
        elif ex.parser.stop_reason:
            parts.append(ex.parser.stop_reason)
    flags = [a["msg"] for a in ex.anomaly_list() if a["level"] == "error"]
    if flags:
        parts.append("!! " + flags[0])
    print("  ".join(p for p in parts if p), flush=True)


class Tap(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass  # we print our own lines

    def do_POST(self) -> None:
        self.relay()

    def do_GET(self) -> None:
        self.relay()

    def do_HEAD(self) -> None:
        self.relay()

    def relay(self) -> None:
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b""
        handle = None
        if RECORDER is not None:
            try:
                handle = RECORDER.begin(self.command, self.path, self.headers.items(), body)
            except Exception:
                handle = None

        # 1. Print what the agent sent (full dump only with --verbose).
        if VERBOSE:
            print(f"\n{'=' * 78}\n[{stamp()}] >>> {self.command} {self.path}", flush=True)
            for name, value in self.headers.items():
                if name.lower() in ("authorization", "x-api-key"):
                    value = redact(value)
                print(f"    {name}: {value}")
            if body:
                try:
                    print(json.dumps(json.loads(body), indent=2, ensure_ascii=False))
                except ValueError:
                    print(body.decode("utf-8", "replace"))

        # 2. Forward it, headers intact.
        target = urlsplit(UPSTREAM)
        conn_cls = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
        # Connect with a short timeout (a lost SYN must not stall the agent for
        # minutes); the long timeout is for reading a slow stream.
        upstream = conn_cls(target.netloc, timeout=10)
        try:
            upstream.connect()
        except OSError as e:
            print(f"\n[{stamp()}] !!! cannot reach {UPSTREAM}: {e}", flush=True)
            self.send_error(502, f"proxy: cannot reach {UPSTREAM}: {e}")
            self.close_connection = True
            if handle:
                capture("end", handle, "error", f"proxy: cannot reach {UPSTREAM}: {e}")
            return
        upstream.sock.settimeout(600)
        headers = {k: v for k, v in self.headers.items() if k.lower() not in SKIP}
        try:
            upstream.request(self.command, target.path.rstrip("/") + self.path, body=body or None, headers=headers)
            reply = upstream.getresponse()
        except (OSError, http.client.HTTPException) as e:
            print(f"\n[{stamp()}] !!! upstream failed: {e}", flush=True)
            self.send_error(502, f"proxy: upstream failed: {e}")
            self.close_connection = True
            if handle:
                capture("end", handle, "error", f"proxy: upstream failed: {e!r}")
            return

        # 3. Stream the reply back as it arrives, capturing it on the way.
        if VERBOSE:
            print(f"\n[{stamp()}] <<< {reply.status} {reply.reason}", flush=True)
        reply_headers = reply.getheaders()
        if handle:
            capture("response", handle, reply.status, reply.reason, reply_headers)
        self.send_response(reply.status, reply.reason)
        for name, value in reply_headers:
            if name.lower() not in SKIP and name.lower() != "content-encoding":
                self.send_header(name, value)
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        if self.command == "HEAD":
            if handle:
                capture("end", handle, "done")
            return
        state, note = "done", None
        try:
            while chunk := reply.read1(4096):  # read1: pass on each chunk as it lands, don't wait for 4096 bytes
                self.wfile.write(chunk)
                self.wfile.flush()
                if handle:
                    capture("chunk", handle, chunk)
                if VERBOSE:
                    sys.stdout.write(chunk.decode("utf-8", "replace"))
                    sys.stdout.flush()
        except (OSError, http.client.HTTPException) as e:
            state, note = "aborted", f"connection aborted mid-stream: {e!r}"
            if VERBOSE:
                print(f"\n[{stamp()}] !!! {note}", flush=True)
        if handle:
            capture("end", handle, state, note)
        if VERBOSE:
            print(f"\n[{stamp()}] --- done", flush=True)


def main() -> None:
    global UPSTREAM, VERBOSE, RECORDER
    parser = argparse.ArgumentParser(description="Forward an agent's API traffic and show it in a dashboard.")
    parser.add_argument("--port", type=int, default=8041, help="agent-facing proxy port (default 8041)")
    parser.add_argument("--dashboard-port", type=int, default=8042, help="dashboard port (default 8042)")
    parser.add_argument("--upstream", default=UPSTREAM, help="where to forward (default: the Anthropic API)")
    parser.add_argument("--verbose", action="store_true", help="print every request and reply in full")
    parser.add_argument("--no-dashboard", action="store_true", help="plain proxy: no capture, no dashboard")
    parser.add_argument("--log-dir", default=os.path.join(HERE, "traffic"), help="JSONL log directory")
    parser.add_argument("--no-log", action="store_true", help="do not write the JSONL log")
    parser.add_argument("--replay", action="append", default=[], metavar="FILE",
                        help="load a JSONL log into the dashboard (repeatable)")
    parser.add_argument("--prices", default=os.path.join(HERE, "prices.json"), help="price table (JSON)")
    parser.add_argument("--sources", default=os.path.join(HERE, "sources.json"),
                        help="prompt-source detection rules (JSON)")
    args = parser.parse_args()
    UPSTREAM = args.upstream.rstrip("/")
    VERBOSE = args.verbose

    if not args.no_dashboard:
        store = Store(Prices(args.prices), None if args.no_log else args.log_dir, Sources(args.sources))
        for path in args.replay:
            n = store.replay(path)
            print(f"replayed {n} exchanges from {path}")
        store.on_finish = one_line
        RECORDER = Recorder(store)
        info = {"upstream": UPSTREAM, "proxy_port": args.port,
                "log": None if args.no_log else args.log_dir, "replay": args.replay}
        dashboard.start(store, args.dashboard_port, info)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Tap)
    server.daemon_threads = True
    print(f"proxy listening on http://localhost:{args.port}  ->  {UPSTREAM}")
    if not args.no_dashboard:
        print(f"dashboard on http://localhost:{args.dashboard_port}"
              + ("" if args.no_log else f"   (logging to {os.path.relpath(args.log_dir)}/)"))
    print(f"run the agent with:  ANTHROPIC_BASE_URL=http://localhost:{args.port} claude")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
