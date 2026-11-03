# SPEC: Agent Traffic Dashboard

Status: **FINAL** (2026-11-01). All decisions are recorded in section 9. No code has been written yet; implementation is still to come.

## 1. Purpose

`proxy.py` already sits between an agent harness (Claude Code, and optionally Codex) and the model API. It prints every request and reply to the terminal. That output is complete, but hard to read: a single request can run to thousands of lines of JSON.

This feature adds a **browser dashboard** that shows the same traffic **live** and in a structured form. The main goal is readability. The user should be able to tell each kind of message apart at a glance:

| Kind | What it is |
|---|---|
| **System** | System instructions sent by the harness |
| **Tools** | Tool definitions offered to the model |
| **User / prompt** | Text typed by the human, or injected by the harness |
| **Assistant text** | The model's prose reply |
| **Tool call** | A `tool_use` block the model asks for |
| **Tool result** | A `tool_result` block the harness sends back |
| **Thinking** | Extended-thinking blocks, if present |
| **Error** | HTTP errors, stream `error` events, `is_error` tool results |

Every kind gets **one fixed color, icon, and label**, and these stay the same everywhere they appear: the list, the detail view, the filters, and the stats.

## 2. Settled constraints (from the existing proxy)

- The proxy **forwards traffic unchanged**. Headers pass through untouched, and the reply streams back byte for byte. The dashboard must never delay, alter, or block that stream. Capture happens next to forwarding, not in its path.
- The proxy uses **Python standard library only**, with nothing to install. The dashboard keeps this: Python stdlib on the server, plus plain HTML/CSS/JS in the browser. No build step and no CDN (see D2).
- The proxy **binds to 127.0.0.1 only**.
- **Secrets are redacted.** `authorization` and `x-api-key` are truncated, as the terminal output already does. Full values are never sent to the browser or written to disk.
- The default upstream is the Anthropic Messages API. `--upstream` can point somewhere else.

## 3. Scope

### In scope (v1)
- Live list of exchanges (one request plus its reply), **newest first**.
- Drill-down into every part of every request and reply.
- Pairing of tool calls with their results.
- A "what changed since the previous request" view.
- Per-request and per-session statistics.
- Filters (by kind, tool, model, errors) and text search.
- Making errors and anomalies easy to spot.

### Out of scope (v1)
- Modifying, replaying, or blocking requests. The dashboard is read-only.
- Authentication for the dashboard, since it is localhost only.
- Remote or multi-user access.
- Full parity for non-Anthropic API formats (see D4).

## 4. Architecture

```
agent ──HTTP──▶ proxy.py ──HTTPS──▶ api.anthropic.com
                   │  (forwards unchanged, as today)
                   │
                   ├─ capture: request body + headers, raw SSE chunks, timings
                   ├─ parse:   build an Exchange record (section 5)
                   ├─ store:   in memory, plus append to a JSONL log (D3)
                   │
                   └─ dashboard server ──SSE──▶ browser (index.html + app.js)
```

- **Dashboard serving (D1).** The same process serves the dashboard on a second port (default `8042`), so the agent-facing port keeps behaving exactly like today.
- **Live updates.** The browser opens `GET /events`, a Server-Sent Events stream. Three events are sent:
  - `exchange.started`, when the request arrives.
  - `exchange.updated`, as reply chunks are parsed. These events are throttled to about 10 per second.
  - `exchange.finished`, with the final record.
- **Initial load.** `GET /api/exchanges` returns summaries. `GET /api/exchanges/{id}` returns the full record. This keeps the first load small, even when single requests are hundreds of KB.
- **Raw view.** `GET /api/exchanges/{id}/raw` returns the redacted original request JSON and the raw SSE text.

## 5. Data model: Exchange

```
Exchange {
  id                  sequential int (#1, #2, ...)
  session_id          grouping key (D6)
  method, path        e.g. POST /v1/messages?beta=true
  kind                "messages" | "count_tokens" | "other"
  started_at, first_byte_at, finished_at
  status              HTTP status, or null while pending
  state               "pending" | "streaming" | "done" | "error" | "aborted"
  request: {
    headers           redacted
    model, max_tokens, temperature, thinking, stream, metadata
    system            [text blocks, with cache_control markers]
    tools             [{name, description, input_schema}]
    messages          full array, as sent
    new_messages      the part not present in the previous request (section 7)
  }
  response: {
    content           [text | tool_use | thinking blocks], assembled from the stream
    stop_reason       end_turn | tool_use | max_tokens | stop_sequence | ...
    usage             input, output, cache_creation, cache_read tokens
    error             {type, message} if any
  }
  derived: {
    cost_usd          from the price table (D5)
    duration_ms, ttfb_ms
    tool_calls        [{id, name, input}]
    tool_results      [{tool_use_id, is_error, size}], results sent in this request
  }
}
```

Stream parsing handles these SSE events: `message_start`, `content_block_start`, `content_block_delta` (`text_delta`, `input_json_delta`, `thinking_delta`), `content_block_stop`, `message_delta`, `message_stop`, `ping`, and `error`. Non-streaming JSON replies are parsed directly. If anything fails to parse, the exchange is still shown, with its raw view and a "could not parse" badge. The dashboard never drops data silently.

## 6. User interface

### 6.1 Layout
Two panes, plus a top bar.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ● live  session ▾  model ▾  [kinds ▾] [tool ▾] [errors only] [search…]   │
│ 42 requests · 1.2M in / 38k out · $3.10 · 12m  · pause ⏸                 │
├──────────────────────────────┬────────────────────────────────────────────┤
│ #42 12:04:31 ▶ streaming…    │  #41  POST /v1/messages  200  · 3.2s       │
│ #41 12:04:28 🔧 Bash ×2  3.2s │  opus-…  in 31k (cache 29k) out 412  $0.04 │
│ #40 12:04:20 💬 "Fix the…"    │  ┌ Tabs: Overview | Request | Reply |      │
│ #39 12:04:11 ⚠ 529 overloaded │  │       Changes | Raw                     │
│ …                            │  └──────────────────────────────────────   │
└──────────────────────────────┴────────────────────────────────────────────┘
```

### 6.2 Exchange list (left pane)
- Newest first. A new row slides in at the top. If the user has scrolled down or has a row selected, the list does **not** jump. A "N new ↑" pill appears instead.
- Each row shows:
  - id and time
  - state (spinner, ✓, or ⚠)
  - a **one-line gist**: the new user text, *or* the tool results being returned, *or* the tool calls the model asked for
  - chips for each tool called
  - duration, tokens, and cost
- Error rows have a red left border and a ⚠ icon, so they are visible when scrolling.
- Non-`messages` traffic (`count_tokens`, HEAD, GETs) is shown as compact grey rows. It can be hidden with one toggle, and is hidden by default (D7).

### 6.3 Detail view (right pane)
**Overview tab (default).** The conversation turn reads as a chat transcript:
1. **New in this request**: only the messages added since the previous request.
2. **Reply**: the model's text, its thinking (collapsed), and its tool calls.
3. **Tool call ↔ result pairs.** Each tool call card shows its result *inside the same card* when the result exists. The result arrives in a later request; the card links to that request (`result in #42 →`). From the other side, a tool result in a request links back to the exchange that made the call. Pending calls show "awaiting result".

**Request tab.** Four sections, each with a distinct header color and a size badge (characters and estimated tokens):
- **System**: the full text, rendered with line breaks preserved. Each `cache_control` breakpoint is marked.
- **Tools (N)**: a list of tool names. Expanding one shows its description and a pretty-printed `input_schema`.
- **Conversation so far (M messages)**: collapsed by default. Inside, each message appears as a role-colored card.
- **New message(s)**: expanded by default.

**Reply tab.** The assembled content blocks, plus `stop_reason`, usage, and timing.

**Changes tab.** The diff against the previous request in the same session (section 7).

**Raw tab.** The redacted request JSON and the raw SSE stream, both with a copy button.

### 6.4 Formatting rules
- **Collapsible long text.** Any text longer than about 20 lines, or 2,000 characters, is collapsed to a preview. A "show all (N lines)" control expands it.
- **JSON** is pretty-printed with syntax coloring, and objects and arrays can be collapsed. Nodes deeper than 2 levels start collapsed. Long strings inside JSON are collapsible too. A tool `input` whose value is a code string, such as a `command`, is shown as a code block, not as an escaped string.
- **Text** is shown as plain text, with whitespace preserved and wrapped. Markdown rendering is optional (D8).
- **Expand all / collapse all** controls exist per section.
- **Copy** buttons exist on every block.
- **Timestamps** appear in local time, with relative time on hover.
- A **light and dark theme** follows the OS. Color is never the only signal: each kind also has an icon and a text label.

### 6.5 Filters and search
- **Kinds filter.** Show or hide each message kind inside the detail view. For example, the user can hide tool results to read only the dialogue.
- **Tool filter.** Shows only exchanges that call, or return results for, the selected tools. The list of tools is built from the traffic.
- **Errors only.**
- **Model and session** dropdowns.
- **Search.** Full-text search over new messages and replies, with matches highlighted. An option extends the search to the system prompt and tools.
- Filter state is kept in the URL hash, so a view can be bookmarked.

### 6.6 Statistics
These sit in a collapsible "Stats" drawer. They supplement the messages and never replace them. Every chart element links to the matching exchanges.
- Per-session totals: requests, input, output, cache-read and cache-write tokens, cost, wall time, and error count.
- Tokens per request: a stacked bar of input, cache read, cache write, and output. Clicking a bar opens that exchange.
- Latency per request: time to first byte, and total duration.
- Tool usage: calls per tool, error rate per tool, and mean result size.
- Context growth: input tokens over time, which makes compaction visible as a drop.

### 6.7 Errors and anomalies, highlighted
These conditions get a ⚠ badge in the list and a banner in the detail view:
- HTTP status ≥ 400, a stream `error` event, or a connection that aborted mid-stream.
- `stop_reason: max_tokens`.
- A `tool_result` with `is_error: true`.
- A tool call that never received a result.
- Any change to the system prompt or tool set mid-session (section 7).
- Parse failures.

## 7. "What changed since the previous request"

Normally, request N+1 is request N's messages, plus N's reply, plus new content (tool results or user text). Requests are compared against the previous `messages` request in the same session.

- **Normal append.** Only the new tail is shown, as "New in this request".
- **Prefix mismatch.** If the earlier messages differ (compaction, edits, or a different conversation), the request is flagged "history rewritten". The changes tab shows a message-level diff: added, removed, and modified messages, with text diffs for the modified ones.
- **System and tools.** If either differs from the previous request, the change is flagged, and a line diff of the system text and an add/remove/change list of tools are shown. If neither changed, the tab says "unchanged" in one line.
- **Parameters.** Changes to model, `max_tokens`, or `thinking` are listed.

## 8. Checks (how we will know it works)

1. With the dashboard enabled, the agent behaves the same as with today's proxy. Streaming is not visibly slower, and a 10-minute Claude Code session works normally.
2. Each request appears in the list within about 200 ms of arriving. Reply text updates while it streams.
3. For a recorded session, every `tool_use` id is paired with exactly one `tool_result`, or is marked unanswered.
4. The token totals match the `usage` fields the API returned.
5. Secrets never reach the browser or disk. A test greps the API output and the log for the full token.
6. A 1 MB request opens in its detail view in under 1 second. A 500-exchange session stays responsive.
7. Fixture tests feed the parser recorded SSE streams: text only, tool use, thinking, error mid-stream, a non-streaming reply, and a 529 error.
8. A manual readability check: given a screenshot, someone unfamiliar with the dashboard can name each block's kind.

## 9. Decisions

### Decided (2026-11-01)

| # | Decision | Reason |
|---|---|---|
| D1 | The dashboard runs **inside `proxy.py`, on a second port** (default 8042). | One command starts everything, and the agent-facing port stays exactly as it is today. |
| D2 | **Vanilla JS/CSS/HTML, no dependencies, no CDN, no build step.** | Matches the proxy's "nothing to install" and works offline. |
| D3 | **Memory plus a JSONL log** in `traffic/<date>.jsonl`. `--replay <file>` opens an old session. | Sessions survive restarts and can be reviewed later. |
| D4 | **Only the Anthropic Messages format is parsed.** Other formats (such as Codex/OpenAI Responses) are captured and shown in the Raw tab only. | Covers the main use case. Other parsers can be added later. |
| D5 | **Cost is estimated** from a price table per model, kept in an editable JSON file, and always labeled "est." | Useful for comparison. With a subscription login the figure is only a rough guide. |
| D6 | **Automatic lanes.** Exchanges are grouped by session header or metadata, then subagents and side calls are split out by matching system prompt and message prefix. Diffs compare only within a lane. | Keeps "what changed" meaningful when subagents interleave. |
| D7 | **Non-`messages` traffic is hidden by default** (`count_tokens`, HEAD, GETs). One toggle shows it. | Keeps the list focused on the conversation. |
| D8 | **Text is shown as plain text**, with a per-block "render Markdown" toggle. | Shows exactly what was sent, with nothing hidden by rendering. |
| D9 | **The terminal prints one line per request.** `--verbose` brings back the full dump. | The dashboard is now where the detail is read. |
| D10 | Logging is **on by default**, into a git-ignored `traffic/` directory. Secrets are redacted before writing. | Follows from D3. |

### Deferred (not in v1)

- Parsing non-Anthropic API formats (see D4).
- Replaying, editing, or blocking requests.
- Remote or multi-user access to the dashboard.
