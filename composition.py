"""composition.py: where every part of a prompt came from, and its token cost (SPEC 6.10).

Standard library only. A request is split into *segments*. Each segment belongs to
exactly one *source* (system prompt, built-in or MCP tools, CLAUDE.md, memory,
skills, hooks, environment, system reminders, user prompt, history, tool results,
images and documents, other). Every character of every text block belongs to
exactly one segment.

Token counts are estimated (about 4 characters per token, images by the published
formula), then calibrated: they are scaled so they add up exactly to the input
tokens the API reported. No extra API calls are made.

Detection rules live in sources.json, next to prices.json, and are reloaded when
the file changes.
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
import struct
from typing import Any, Callable

HERE = os.path.dirname(os.path.abspath(__file__))
REMINDER_RE = re.compile(r"<system-reminder>.*?(?:</system-reminder>|\Z)", re.S)
HEADING_RE = re.compile(r"# \S")

DEFAULT_TABLE: dict = {
    "chars_per_token": 4,
    "image_fallback_tokens": 1600,
    "document_page_tokens": 1500,
    "sources": [{"id": s, "label": {"he": s, "en": s}} for s in (
        "system_prompt", "tools_builtin", "tools_mcp", "claude_md", "memory", "skills", "hooks", "environment",
        "system_reminder", "user_prompt", "history", "tool_results", "media", "other")],
    "markers": [],
}


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


class Sources:
    """The editable rule table (sources.json). Reloaded when the file changes."""

    def __init__(self, path: str | None = None):
        self.path = path or os.path.join(HERE, "sources.json")
        self.mtime = 0.0
        self.version = 0
        self.table: dict = DEFAULT_TABLE
        self.markers: list[tuple[re.Pattern, dict]] = []
        self.load()

    def load(self) -> None:
        try:
            mtime = os.path.getmtime(self.path)
            if mtime == self.mtime:
                return
            with open(self.path, encoding="utf-8") as f:
                table = json.load(f)
            markers = []
            for m in table.get("markers", []):
                try:
                    markers.append((re.compile(m["pattern"]), m))
                except (re.error, KeyError, TypeError):
                    continue  # a broken rule is skipped, never fatal
            self.table, self.markers, self.mtime = table, markers, mtime
            self.version += 1
        except (OSError, ValueError):
            pass

    @property
    def cpt(self) -> float:
        return float(self.table.get("chars_per_token") or 4)

    def public(self) -> dict:
        """What the browser needs: the ordered source ids and their labels."""
        self.load()
        return {"sources": self.table.get("sources", []), "chars_per_token": self.cpt}


# --------------------------------------------------------------------------- token estimates

def _image_dims(data: bytes) -> tuple[int, int] | None:
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", data[16:24])
        if data[:6] in (b"GIF87a", b"GIF89a"):
            return struct.unpack("<HH", data[6:10])
        if data[:2] == b"\xff\xd8":
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            if data[12:16] == b"VP8X":
                w = int.from_bytes(data[24:27], "little") + 1
                h = int.from_bytes(data[27:30], "little") + 1
                return w, h
    except (struct.error, IndexError):
        return None
    return None


def image_tokens(source: Any, fallback: int) -> int:
    """The published formula: tokens ≈ width × height / 750, after the API's resize."""
    if not isinstance(source, dict) or source.get("type") != "base64" or not isinstance(source.get("data"), str):
        return fallback
    head = source["data"][:65536]
    head = head[:len(head) - len(head) % 4]
    try:
        dims = _image_dims(base64.b64decode(head, validate=False))
    except (ValueError, TypeError):
        dims = None
    if not dims or not all(dims):
        return fallback
    w, h = dims
    scale = min(1.0, 1568 / max(w, h))
    w, h = w * scale, h * scale
    if w * h > 1_150_000:
        s2 = math.sqrt(1_150_000 / (w * h))
        w, h = w * s2, h * s2
    return max(1, math.ceil(w * h / 750))


def document_tokens(block: dict, cpt: float, page_tokens: int) -> int:
    src = block.get("source") if isinstance(block.get("source"), dict) else {}
    if src.get("type") == "text" and isinstance(src.get("data"), str):
        return math.ceil(len(src["data"]) / cpt)
    if src.get("type") == "base64" and isinstance(src.get("data"), str):
        try:
            raw = base64.b64decode(src["data"], validate=False)
            pages = len(re.findall(rb"/Type\s*/Page(?!s)", raw)) or 1
        except (ValueError, TypeError):
            pages = 1
        return pages * page_tokens
    return math.ceil(len(_dumps(block)) / cpt)


# --------------------------------------------------------------------------- segmentation

def split_text(text: str, default: str, detail: str | None, sources: Sources) -> list[tuple[int, int, str, str | None]]:
    """Split one text block into (start, end, source, detail) pieces covering every character once."""
    out: list[list] = []

    def add(a: int, b: int, src: str, det: str | None) -> None:
        if b <= a:
            return
        if out and out[-1][2] == src and out[-1][3] == det and out[-1][1] == a:
            out[-1][1] = b
        else:
            out.append([a, b, src, det])

    # Regions: system reminders vs. the block's own text.
    regions, pos = [], 0
    for m in REMINDER_RE.finditer(text):
        if m.start() > pos:
            regions.append((pos, m.start(), default, detail))
        regions.append((m.start(), m.end(), "system_reminder", None))
        pos = m.end()
    if pos < len(text):
        regions.append((pos, len(text), default, detail))

    for a, b, rsrc, rdet in regions:
        cur_src, cur_det, until, seg_start = rsrc, rdet, None, a
        p = a
        while p < b:
            eol = text.find("\n", p, b)
            eol = b if eol == -1 else eol + 1
            line = text[p:eol]
            hit = None
            for rx, rule in sources.markers:
                m = rx.match(line)
                if m:
                    det = m.groupdict().get("detail") or rule.get("detail")
                    hit = (rule.get("source", "other"), det, rule.get("until", "heading"))
                    break
            if hit:
                add(seg_start, p, cur_src, cur_det)
                cur_src, cur_det, until, seg_start = hit[0], hit[1], hit[2], p
            elif until == "heading" and HEADING_RE.match(line):
                add(seg_start, p, cur_src, cur_det)
                cur_src, cur_det, until, seg_start = rsrc, rdet, None, p
            p = eol
        add(seg_start, b, cur_src, cur_det)

    # Whitespace-only slivers join their neighbor, so they never show up as their own source.
    merged: list[list] = []
    for piece in out:
        if merged and not text[piece[0]:piece[1]].strip():
            merged[-1][1] = piece[1]
        elif merged and not text[merged[-1][0]:merged[-1][1]].strip():
            piece[0] = merged[-1][0]
            merged[-1] = piece
        else:
            merged.append(piece)
    final: list[list] = []
    for piece in merged:
        if final and final[-1][2] == piece[2] and final[-1][3] == piece[3]:
            final[-1][1] = piece[1]
        else:
            final.append(piece)
    return [tuple(x) for x in final]


def _tool_source(name: str | None) -> tuple[str, str | None]:
    name = name or ""
    if name.startswith("mcp__"):
        parts = name.split("__")
        return "tools_mcp", parts[1] if len(parts) > 2 else name
    return "tools_builtin", None


def segment(req: dict, new_from: int, echo_index: int | None, tool_name: Callable[[str | None], str],
            sources: Sources) -> list[dict]:
    """Split a Messages request into source-labelled segments, in prompt order (tools, system, messages)."""
    cpt = sources.cpt
    img_fallback = int(sources.table.get("image_fallback_tokens") or 1600)
    page_tokens = int(sources.table.get("document_page_tokens") or 1500)
    segs: list[dict] = []

    def add(source: str, detail: str | None, ref: str, chars: int, est: float,
            start: int | None = None, end: int | None = None) -> None:
        segs.append({"source": source, "detail": detail, "ref": ref, "start": start, "end": end,
                     "chars": chars, "est": est})

    def add_text(text: str, default: str, detail: str | None, ref: str) -> None:
        pieces = split_text(text, default, detail, sources)
        whole = len(pieces) == 1
        for a, b, src, det in pieces:
            add(src, det, ref, b - a, (b - a) / cpt, None if whole else a, None if whole else b)

    tools = req.get("tools") if isinstance(req.get("tools"), list) else []
    for i, t in enumerate(tools):
        t = t if isinstance(t, dict) else {}
        src, det = _tool_source(t.get("name"))
        size = len(_dumps(t))
        add(src, det or t.get("name") or t.get("type"), f"t:{i}", size, size / cpt)

    system = req.get("system")
    sys_blocks = [{"type": "text", "text": system}] if isinstance(system, str) else (system if isinstance(system, list) else [])
    for i, b in enumerate(sys_blocks):
        if isinstance(b, dict) and b.get("type") == "text":
            add_text(b.get("text") or "", "system_prompt", None, f"s:{i}")
        else:
            size = len(_dumps(b))
            add("other", None, f"s:{i}", size, size / cpt)

    msgs = req.get("messages") if isinstance(req.get("messages"), list) else []
    for mi, m in enumerate(msgs):
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        old = mi < new_from or mi == echo_index
        content = m.get("content")
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else (content if isinstance(content, list) else [])
        for bi, b in enumerate(blocks):
            ref = f"m:{mi}:{bi}"
            if not isinstance(b, dict):
                b = {"type": "text", "text": str(b)}
            t = b.get("type")
            if t == "text":
                text = b.get("text") or ""
                if role == "user":
                    add_text(text, "history" if old else "user_prompt", None, ref)
                elif role == "system":
                    add_text(text, "system_prompt", "system message", ref)
                elif role == "assistant":
                    add("history", "assistant", ref, len(text), len(text) / cpt)
                else:
                    add("other", role, ref, len(text), len(text) / cpt)
            elif t in ("thinking", "redacted_thinking"):
                body = b.get("thinking") or b.get("data") or ""
                add("history", "thinking", ref, len(body), len(body) / cpt)
            elif t in ("tool_use", "server_tool_use", "mcp_tool_use"):
                size = len(b.get("name") or "") + len(_dumps(b.get("input")))
                add("history", b.get("name") or "tool_use", ref, size, size / cpt)
            elif t == "tool_result":
                content_r = b.get("content")
                if isinstance(content_r, str):
                    chars, est = len(content_r), len(content_r) / cpt
                else:
                    chars, est = 0, 0.0
                    for x in content_r if isinstance(content_r, list) else []:
                        if isinstance(x, dict) and x.get("type") == "text":
                            chars += len(x.get("text") or "")
                            est += len(x.get("text") or "") / cpt
                        elif isinstance(x, dict) and x.get("type") == "image":
                            est += image_tokens(x.get("source"), img_fallback)
                        elif isinstance(x, dict) and x.get("type") == "document":
                            est += document_tokens(x, cpt, page_tokens)
                        else:
                            est += len(_dumps(x)) / cpt
                add("tool_results", tool_name(b.get("tool_use_id")), ref, chars, est)
            elif t == "image":
                add("media", "image", ref, 0, image_tokens(b.get("source"), img_fallback))
            elif t == "document":
                add("media", "document", ref, 0, document_tokens(b, cpt, page_tokens))
            elif t == "tool_addition":
                tool = b.get("tool") if isinstance(b.get("tool"), dict) else {}
                definition = tool.get("definition") if isinstance(tool.get("definition"), dict) else tool
                src, det = _tool_source(definition.get("name"))
                size = len(_dumps(tool))
                add(src, det or definition.get("name"), ref, size, size / cpt)
            else:
                size = len(_dumps(b))
                add("other", t, ref, size, size / cpt)
    return segs


# --------------------------------------------------------------------------- calibration

def calibrate(segs: list[dict], usage: dict | None) -> tuple[list[dict], bool, int]:
    """Scale estimates so they sum exactly to the reported input; mark which tokens were cached.

    Returns (segments with 'tokens' and 'cache', exact, total). Without a reported total the
    raw estimates are returned and 'exact' is False.
    """
    usage = usage or {}
    read, write, unc = usage.get("cache_read") or 0, usage.get("cache_write") or 0, usage.get("input") or 0
    target = read + write + unc
    est_total = sum(s["est"] for s in segs)
    out = [dict(s) for s in segs]
    if target <= 0 or est_total <= 0:
        for s in out:
            s["tokens"], s["cache"] = round(s["est"]), None
        return out, False, sum(s["tokens"] for s in out)
    # Largest-remainder rounding: integers that add up to the target exactly.
    factor = target / est_total
    raw = [s["est"] * factor for s in out]
    floors = [math.floor(x) for x in raw]
    short = target - sum(floors)
    order = sorted(range(len(raw)), key=lambda i: raw[i] - floors[i], reverse=True)
    for i in order[:short]:
        floors[i] += 1
    # Prompt order is tools, system, messages: the first `read` tokens came from cache,
    # the next `write` were written to it, the rest were uncached input.
    pos = 0
    for s, tok in zip(out, floors):
        s["tokens"] = tok
        a, b = pos, pos + tok
        if tok == 0:
            s["cache"] = "read" if a < read else "write" if a < read + write else "none"
        elif b <= read:
            s["cache"] = "read"
        elif a >= read and b <= read + write:
            s["cache"] = "write"
        elif a >= read + write:
            s["cache"] = "none"
        else:
            s["cache"] = "mixed"
        pos = b
    return out, True, target


def totals(segs: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for s in segs:
        out[s["source"]] = out.get(s["source"], 0) + s.get("tokens", 0)
    return out
