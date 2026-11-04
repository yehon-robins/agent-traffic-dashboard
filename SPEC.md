# SPEC: Agent Traffic Dashboard

Status: **FINAL** (2026-11-01), **revised 2026-11-04**. All decisions are recorded in section 9. v1 is implemented. The 2026-11-04 revision adds a Hebrew, right-to-left interface with a switch to English (section 6.8), a modern visual design (section 6.9), and a per-source breakdown of every prompt with token counts (section 6.10). See D11 to D13.

## 1. Purpose

`proxy.py` already sits between an agent harness (Claude Code, and optionally Codex) and the model API. It prints every request and reply to the terminal. That output is complete, but hard to read: a single request can run to thousands of lines of JSON.

This feature adds a **browser dashboard** that shows the same traffic **live** and in a structured form. The main goal is readability. The user should be able to tell each kind of message apart at a glance:

| Kind | UI label (Hebrew) | What it is |
|---|---|---|
| **System** | מערכת | System instructions sent by the harness |
| **Tools** | כלים | Tool definitions offered to the model |
| **User / prompt** | משתמש | Text typed by the human, or injected by the harness |
| **Assistant text** | תשובת המודל | The model's prose reply |
| **Tool call** | קריאה לכלי | A `tool_use` block the model asks for |
| **Tool result** | תוצאת כלי | A `tool_result` block the harness sends back |
| **Thinking** | חשיבה | Extended-thinking blocks, if present |
| **Error** | שגיאה | HTTP errors, stream `error` events, `is_error` tool results |

Every kind gets **one fixed color, icon, and label**, and these stay the same everywhere they appear: the list, the detail view, the filters, and the stats. The interface shows the Hebrew label (section 6.8).

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
    composition       [{source, detail, location, chars, tokens_est, cached}], one entry per segment (section 6.10)
  }
}
```

Stream parsing handles these SSE events: `message_start`, `content_block_start`, `content_block_delta` (`text_delta`, `input_json_delta`, `thinking_delta`), `content_block_stop`, `message_delta`, `message_stop`, `ping`, and `error`. Non-streaming JSON replies are parsed directly. If anything fails to parse, the exchange is still shown, with its raw view and a "could not parse" badge. The dashboard never drops data silently.

## 6. User interface

### 6.1 Layout
Two panes, plus a top bar. The layout is **mirrored for right-to-left reading**: the exchange list sits on the **right**, and the detail view sits on the **left**. Below is the logical layout. Your terminal may not render the Hebrew in the right order.

```
╭───────────────────────────────────────────────────────────────────────────╮
│   [חיפוש…] [שגיאות בלבד] [כלי ▾] [סוגים ▾]  מודל ▾  סשן ▾  חי ●          │
│   השהה ⏸ · 12 דק׳ · $3.10 · 1.2M נכנס / 38k יוצא · 42 בקשות              │
╰───────────────────────────────────────────────────────────────────────────╯
╭────────────────────────────────────────────╮ ╭────────────────────────────╮
│  3.2s ·  200  POST /v1/messages  #41       │ │ #42  12:04:31  ▶ בהזרמה…   │
│  $0.04  out 412  in 31k (cache 29k) opus-… │ │ #41  12:04:28  Bash ×2 3.2s│
│  ┌ סקירה | בקשה | תשובה | שינויים | גולמי │ │ #40  12:04:20  "Fix the…"  │
│  │                                         │ │ #39  12:04:11  ⚠ 529       │
│  └───────────────────────────────────────  │ │ …                          │
╰────────────────────────────────────────────╯ ╰────────────────────────────╯
            detail view (left)                     exchange list (right)
```

The panes are separate cards with a gap between them, not one boxed grid (section 6.9). The divider between the panes can be dragged, and the width the user picks is remembered.

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

**Composition tab.** Where every part of the prompt came from, and how many tokens each part took (section 6.10).

### 6.4 Formatting rules
- **Collapsible long text.** Any text longer than about 20 lines, or 2,000 characters, is collapsed to a preview. A "show all (N lines)" control expands it.
- **JSON** is pretty-printed with syntax coloring, and objects and arrays can be collapsed. Nodes deeper than 2 levels start collapsed. Long strings inside JSON are collapsible too. A tool `input` whose value is a code string, such as a `command`, is shown as a code block, not as an escaped string.
- **Text** is shown as plain text, with whitespace preserved and wrapped. Markdown rendering is optional (D8).
- **Expand all / collapse all** controls exist per section.
- **Copy** buttons exist on every block.
- **Timestamps** appear in local time, with relative time on hover.
- A **light and dark theme** follows the OS. A toggle in the top bar can override it, and the choice is remembered. Color is never the only signal: each kind also has an icon and a text label.
- Visual styling follows section 6.9. Language and text direction follow section 6.8.

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

### 6.8 Language and text direction (Hebrew default, switchable to English)
- **Two interface languages: Hebrew (default) and English.** In Hebrew the page is `<html lang="he" dir="rtl">`. In English it is `<html lang="en" dir="ltr">`. All interface text follows the chosen language: labels, buttons, tabs, filters, tooltips, banners, empty states, and stats titles.
- **Language switch.** A compact toggle in the top bar ("עב / EN") switches between the two languages instantly, with no page reload and no loss of state: the selection, filters, scroll position, and live connection all stay. The whole layout mirrors with the direction. In English the list moves to the left and the detail view to the right.
- The choice is remembered in the browser (`localStorage`). A `lang=he|en` parameter in the URL hash overrides it, so a bookmarked view opens in its language. With no stored choice, the dashboard opens in Hebrew.
- All interface strings live in one table per language (`STRINGS.he`, `STRINGS.en` in `app.js`), with identical keys. The markup holds no hard-coded interface text. A missing key in one language falls back to the other, never to a blank.
- Kind labels follow the language too: the Hebrew labels from section 1, or the English names in its "Kind" column.
- **Captured content is never translated.** Prompts, replies, tool names, JSON, code, model IDs, header names, and `stop_reason` values appear exactly as they arrived.
- **Mixed direction.** Each text block of content gets `dir="auto"`, so English text reads left to right and Hebrew right to left. JSON, code, Raw, and diff views are always `dir="ltr"` and left-aligned. IDs, times, token counts, sizes, and costs are wrapped in `<bdi>` or LTR spans so they never come out scrambled inside Hebrew text.
- **Mirroring.** Layout uses CSS logical properties (`margin-inline-start`, `inset-inline-end`, `border-inline-start`, and so on). Direction-aware icons are mirrored, such as chevrons and the arrow in the "result in #42" link.
- The direction rules below apply in both languages. In English, content blocks still use `dir="auto"`, so Hebrew content still reads right to left.
- **Locale formatting** follows the language (`he-IL` or `en-US`). In Hebrew it uses `he-IL`: `Intl.DateTimeFormat` for times, `Intl.RelativeTimeFormat` for relative times ("לפני 3 דקות"), and `Intl.NumberFormat` for numbers. Cost stays in USD (`$`) and keeps its estimate label (הערכה, see D5).
- **Fonts.** A system font stack with good Hebrew support: `"Segoe UI", "Noto Sans Hebrew", "Arial Hebrew", Arial, sans-serif`. Code uses a monospace stack. No web fonts are loaded (D2).

### 6.9 Visual design (modern look)
- **Design tokens.** Colors, radii, spacing, shadows, and the type scale are CSS custom properties, with one set for light and one for dark. Components use only tokens, never raw values.
- **Surfaces.** A soft neutral page background. Panes, cards, and blocks have a 12px radius, a subtle 1px border, and a light shadow (dark theme: elevation through lighter surfaces, not shadows). The top bar is sticky, with a translucent, blurred background.
- **Spacing and type.** An 8px spacing grid with generous padding. The base font size is 15–16px, keeping the earlier readability change. A clear type scale (e.g. 13 / 15 / 18 / 22px) and `font-variant-numeric: tabular-nums` for all figures.
- **Kinds.** Each kind is shown as a rounded pill chip: tinted background, icon, and Hebrew label. Message cards use a tinted header and a 3px accent on their inline-start edge (the right edge, in RTL), both in the kind's color.
- **Icons.** One consistent line-icon set as inline SVG, bundled in the page. These replace the emoji used in the mockups. No CDN.
- **Interaction.** Clear hover and selected states, visible focus rings, 150–200ms transitions, a short slide-in for new rows, and skeleton placeholders while a detail view loads. All motion is turned off under `prefers-reduced-motion`.
- **States.** Friendly empty states (e.g. "ממתין לתעבורה…" when nothing has arrived yet). Anomaly banners use a soft tinted background with an icon, not solid red blocks.
- **Accessibility.** Text contrast is at least 4.5:1 in both themes. Full keyboard navigation: ↑/↓ moves through the list, Enter opens an exchange, Esc closes a drawer or an expanded block.
- **Stats.** Each figure sits on its own card. Charts are minimal (light or no gridlines, direct labels where possible) and use the same kind colors.

### 6.10 Prompt composition: where every part came from, and its token cost
Every prompt the model receives is assembled from many sources. The dashboard splits **every request** into **segments**. For each segment it shows **which source it came from** and **how many tokens it took**.

**Sources.** Each segment gets exactly one source label. Sources are detected from the request content with the rules below, checked in this order. The first match wins.

| Source | Label (he / en) | How it is detected |
|---|---|---|
| **System prompt** | הנחיות מערכת / System prompt | A `system` block, minus any parts claimed by a more specific source below |
| **Tool definitions, built-in** | כלים מובנים / Built-in tools | An entry in `tools` whose name does not start with `mcp__` |
| **Tool definitions, MCP** | כלי MCP / MCP tools | An entry in `tools` named `mcp__<server>__<tool>`, grouped per server |
| **CLAUDE.md** | CLAUDE.md | A text section introduced by `Contents of <path>/CLAUDE.md` (also `CLAUDE.local.md` and `.claude/CLAUDE.md`). The file path is kept, so several CLAUDE.md files (user, project, nested) appear separately. |
| **MEMORY.md / memory** | זיכרון / Memory | A section introduced by `Contents of <path>/MEMORY.md`, or by the harness's memory section in the system prompt |
| **Skills** | סקילים / Skills | The "skills available" listing, and skill bodies loaded by a `Skill` tool call |
| **Hooks** | הוקים / Hooks | Text the harness labels as hook output (e.g. `hook additional context`, `SessionStart hook`) |
| **Environment** | סביבה / Environment | The environment block (working directory, platform, git status, date) |
| **System reminders** | תזכורות מערכת / System reminders | Any other `<system-reminder>…</system-reminder>` span inside a user message |
| **User prompt** | הנחיית המשתמש / User prompt | Text typed by the human: user text that is not inside a reminder or another source |
| **Conversation history** | היסטוריית שיחה / History | Earlier user and assistant turns repeated from previous requests, kept apart from what is new in this request |
| **Tool results** | תוצאות כלים / Tool results | `tool_result` blocks, sub-labelled by tool name (e.g. `Read`, `Bash`) |
| **Images and documents** | תמונות ומסמכים / Images & documents | `image` and `document` blocks |
| **Other** | אחר / Other | Anything no rule claims. Never hidden, and never silently merged into another source. |

A single block can hold several sources. For example, the first user message often carries CLAUDE.md, memory, and the environment inside system reminders, followed by the typed prompt. Such a block is split at the source boundaries, so **every character belongs to exactly one segment**.

The detection rules live in one editable table (`sources.json`, next to `prices.json`). They are matched as text markers and regexes, so new harness markers can be added without code changes.

**Token counts.**
- Each segment's tokens are **estimated** from its text: about 4 characters per token, with JSON and tool schemas counted on their serialized form. Images use the API's published image formula.
- Segment estimates are then **calibrated to the real total**. They are scaled so they add up exactly to the input tokens the API reported for the request (`input + cache_read + cache_write`). Displayed counts therefore always sum to the true total, and the split between them is the estimate.
- Counts are always marked as estimates (≈, "est."). Only the per-request total is exact.
- Each segment also shows whether it was **served from cache**, from where it sits relative to the `cache_control` breakpoints and the reported `cache_read` / `cache_write` counts.
- The proxy makes **no extra API calls** to count tokens: it adds no cost and does not change traffic (section 2).

**Where it is shown.**
- **A new "Composition" tab** (הרכב) in the detail view, for every request:
  - A single **stacked bar** of the whole input, one colored segment per source and sized by tokens. Hovering shows the source, tokens, and percent. Clicking a segment jumps to that block in the Request tab.
  - A **table** with one row per segment: source, location (e.g. "system block 2", "message 1, part 3", "tool `mcp__github__create_issue`"), tokens (≈), percent of input, and cached yes/no. The table can be grouped by source, with totals per source and sub-rows per file, server, or tool. It sorts by tokens, so the biggest consumers are on top.
- **Source chips everywhere.** Every block card in the Request and Overview tabs carries a small chip with its source and token count (e.g. `CLAUDE.md · ≈1.2k`). A split block shows its segments in sequence, each with its own chip, and the boundaries are marked.
- **In the list.** Each row can show a thin composition bar under the gist (toggle in the top bar, off by default).
- **In the stats drawer.** A new chart, "Prompt composition over time", shows input tokens per request stacked by source. It shows which sources dominate and how they grow, for example tool results piling up before a compaction.
- **In the Changes tab.** Per-source token deltas against the previous request, e.g. "Tool results +4.1k, CLAUDE.md unchanged".

Source colors are their own fixed palette, separate from the message-kind colors (section 1). Each source also has an icon and a label, so color is never the only signal.

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
9. Language check. In Hebrew, apart from technical identifiers, no interface text is in English. In English, no interface text is in Hebrew. Switching language keeps the selection and filters, mirrors the layout, and survives a reload. Mixed Hebrew and English content, numbers, and IDs come out in the correct order. JSON, code, and Raw views are LTR.
10. Visual check, in both light and dark themes. Contrast passes 4.5:1, and the layout holds up at 1280px and at 1920px wide.
11. Composition check. For every request, the segment token counts add up exactly to the reported input tokens, and every character of the request belongs to exactly one segment. On a recorded Claude Code session, CLAUDE.md, memory, skills, system reminders, MCP tools, and the typed prompt are each labeled correctly. A fixture with an unknown marker lands in "Other".

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

### Decided (2026-11-04)

| # | Decision | Reason |
|---|---|---|
| D11 | **The interface is in Hebrew and right-to-left by default, with a switch to English (LTR)** (section 6.8). Captured content is never translated, and code, JSON, and Raw views stay LTR. | The users read Hebrew, but English stays one click away for sharing and for English-speaking colleagues. The traffic itself must be shown exactly as sent. |
| D12 | **A modern, card-based visual design** built from CSS design tokens and inline SVG icons (section 6.9). | Better readability and polish, still with no dependencies, so D2 holds. |
| D13 | **Every request is split into source-labeled segments with token counts** (section 6.10). Tokens are estimated, then calibrated to the API's reported total. No extra API calls are made. | Shows what fills the context window (CLAUDE.md, memory, tools, reminders, history) and what it costs, without changing traffic or adding cost. |

### Deferred (not in v1)

- Parsing non-Anthropic API formats (see D4).
- Replaying, editing, or blocking requests.
- Remote or multi-user access to the dashboard.
