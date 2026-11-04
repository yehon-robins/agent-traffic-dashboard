# Agent Traffic Dashboard

`proxy.py` sits between an agent harness (Claude Code, or Codex) and the model
API, forwards every request and reply unchanged, and shows the traffic live in
a browser dashboard. It's built to [SPEC.md](SPEC.md). Python standard library
only: nothing to install, no build step, no CDN.

```sh
python3 proxy.py                                   # proxy :8041, dashboard http://localhost:8042
ANTHROPIC_BASE_URL=http://localhost:8041 claude    # in another terminal
```

| Option | Effect |
|---|---|
| `--port 8041` / `--dashboard-port 8042` | Ports. Both bind to 127.0.0.1 only. |
| `--upstream URL` | Where to forward to (default `https://api.anthropic.com`). |
| `--verbose` | Print every request and reply in full, the old behaviour (D9). |
| `--replay FILE` | Load a JSONL log into the dashboard. Can be repeated (D3). |
| `--no-log` / `--log-dir DIR` | Turn off the log, or move it from `traffic/<date>.jsonl` (D10). |
| `--prices FILE` | Price table used for the estimated cost (D5). Defaults to `prices.json`. |
| `--sources FILE` | Rules that label each part of a prompt with its source (SPEC 6.10). Defaults to `sources.json`. |
| `--no-dashboard` | Plain proxy with no capture. |

## Files

- `proxy.py`: forwarding. It hands copies of the bytes to a queue and keeps forwarding.
- `traffic.py`: a recorder thread that parses requests and SSE replies into
  Exchange records. It also handles lanes, tool call/result pairing, diffs,
  anomalies, cost, search, the JSONL log and replay.
- `dashboard.py`: the dashboard HTTP server: static files, `/api/...`, and `/events` (SSE).
- `static/`: `index.html`, `app.js`, `style.css` (vanilla JS/CSS).
- `prices.json`: an editable price table. Every cost shown is labelled "est."
- `sources.json`: editable rules that label each part of a prompt with its source (CLAUDE.md, memory, tools, reminders, and so on). Token counts per source are estimates, calibrated to the input total the API reported.
- `tests/`: parser fixture tests, store tests, and end-to-end tests that run a
  fake upstream through the real proxy.

```sh
python3 -m unittest discover -s tests -v
```

## Using the dashboard

- Press `j` / `k` to move through the list and `/` to search. The filter
  state lives in the URL hash, so a view can be bookmarked.
- Click a kind badge in the detail header (or open the **kinds** menu) to
  hide that kind of block, for example tool results.
- Each **lane** (`L1`, `L2`, …) is one conversation thread inside a session.
  Subagents and side calls get their own lanes, and the Changes tab compares a
  request only with the previous request in the same lane.
