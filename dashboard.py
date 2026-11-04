"""dashboard.py: serves the traffic dashboard (static files, JSON API, SSE).

Runs inside proxy.py on its own port (D1), bound to 127.0.0.1 only.

    GET /                         index.html (plus /app.js, /style.css)
    GET /events                   Server-Sent Events: exchange.started / .updated / .finished
    GET /api/exchanges            summaries of every exchange
    GET /api/exchanges/{id}       full record
    GET /api/exchanges/{id}/raw   redacted request JSON and raw reply text
    GET /api/search?q=..&scope=   ids of matching exchanges (scope=all adds system + tools)
    GET /api/info                 upstream, start time, price table, prompt-source labels
"""

from __future__ import annotations

import json
import os
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from traffic import Store

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}
HEARTBEAT = 15.0


def make_handler(store: Store, info: dict) -> type[BaseHTTPRequestHandler]:
    class Dashboard(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            pass

        def send_json(self, obj: object, status: int = 200) -> None:
            body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            url = urlsplit(self.path)
            path = url.path
            try:
                if path in ("/", "/index.html"):
                    return self.static("index.html")
                if path in ("/app.js", "/style.css"):
                    return self.static(path[1:])
                if path == "/events":
                    return self.events()
                if path == "/api/info":
                    return self.send_json({**info, "prices": store.prices.table, **store.sources.public()})
                if path == "/api/exchanges":
                    return self.send_json(store.summaries())
                if path == "/api/search":
                    qs = parse_qs(url.query)
                    q = (qs.get("q") or [""])[0]
                    scope = (qs.get("scope") or ["messages"])[0]
                    return self.send_json({"q": q, "ids": store.search(q, scope)})
                parts = path.strip("/").split("/")
                if len(parts) >= 3 and parts[:2] == ["api", "exchanges"] and parts[2].isdigit():
                    ex_id = int(parts[2])
                    if len(parts) == 3:
                        data = store.detail(ex_id)
                    elif len(parts) == 4 and parts[3] == "raw":
                        data = store.raw(ex_id)
                    else:
                        data = None
                    if data is None:
                        return self.send_json({"error": "not found"}, 404)
                    return self.send_json(data)
                self.send_json({"error": "not found"}, 404)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def static(self, name: str) -> None:
            try:
                with open(os.path.join(STATIC, name), "rb") as f:
                    body = f.read()
            except OSError:
                return self.send_json({"error": "missing static file"}, 404)
            self.send_response(200)
            self.send_header("Content-Type", TYPES.get(os.path.splitext(name)[1], "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

        def events(self) -> None:
            q = store.subscribe()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(b"retry: 1000\n: connected\n\n")
                self.wfile.flush()
                while True:
                    try:
                        event, payload = q.get(timeout=HEARTBEAT)
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        continue
                    self.wfile.write(f"event: {event}\ndata: {payload}\n\n".encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                store.unsubscribe(q)

    return Dashboard


def start(store: Store, port: int, info: dict) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(store, info))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name="dashboard", daemon=True).start()
    return server
