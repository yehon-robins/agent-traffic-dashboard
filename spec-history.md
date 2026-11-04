# Spec history

Two commits changed `SPEC.md`. For each one: what changed, why, and where the reason comes from. "Session" means a Claude Code transcript in `~/.claude/projects/-home-yehon-robins-AIcode-lab4/`, named by its first 8 characters.

## 1. `5604d74` "Initial state" (2026-11-03 23:20)

**What changed.** Added the whole spec (228 lines), together with `proxy.py`. It covered sections 1–9, checks 1–8 and decisions D1–D10, with status "FINAL (2026-11-01)… No code has been written yet."

**Why.** The commit message gives no reason. Looking deeper:
- Session `d0d99420` only asked to "open a git repo, add the files SPEC.md, proxy.py to it and commit as initial state".
- There was no earlier build, so no build could have prompted it.
- The only stated reason is in the spec itself (§1 Purpose): the proxy's terminal output "is complete, but hard to read: a single request can run to thousands of lines of JSON".
- Where the spec was written, dated 2026-11-01, is not in this project's sessions. The search of other projects' transcripts was stopped before it finished.

*Sources:* the spec text and session `d0d99420`.

## 2. `bfbee1f` "Hebrew/English modern dashboard and per-source prompt composition" (2026-11-04 16:02)

One commit (+111/−24 lines) that holds two separate pieces of work from session `9da55a24`. Each piece had its own spec request followed by its own implementation, and both were squashed together on the user's 15:55 request to "commit and push" once everything was done. The commit message says what changed, not why. The reasons below come from the user's requests in the session. Times are local (UTC+2).

### 2a. Hebrew and the modern look (15:25–15:48)

**What changed:**
- **§6.8:** the interface is in Hebrew and right-to-left, with a live switch to English.
- **§6.9:** a modern visual design.
- **Also:** checks 9–10 and decisions D11–D12. The status line no longer says "no code written yet".

**Why.** Two requests:
1. **15:25:** "edit the SPEC.md file such that the dashboard will be presented in hebrew, and will make the look of it more modern". It was implemented from 15:27 ("now implement it in the dashboard code").
2. **15:44:** "add (in the SPEC) the option to switch the lenguage between hebrew and english". It arrived while the Hebrew build was still being tested, and was added to the spec and the code in the same pass.

Neither request says what the build before it showed. *Inference:* that build (`f35e1a2` + `ec59a66`) was English-only, with a plain grid layout.

*Sources:* session `9da55a24` and the code of `f35e1a2`.

### 2b. Prompt composition (15:48–16:02)

**What changed:**
- **§6.10:** every part of a request is labeled with its source (CLAUDE.md, memory, tools, skills, reminders, and so on) and its token count.
- **Also:** a new `composition` field in the data model (§5), a Composition tab (§6.3), check 11 and decision D13.

**Why.** At 15:48 the user wrote: "in every promt the model recieves, every part of it will mark from which part of the model it came (CLAUDE.md, MEMORY.md, system, tools, etc.) and how many tokens were takens". It was implemented from 15:53 ("implement it").

The request doesn't say what the build before it showed. *Inference:* that build's Request tab sized only whole sections (System, Tools, Messages) and never said where content came from.

*Sources:* session `9da55a24` and the code of `f35e1a2`.

**Commits that changed code but not the spec:**
- **`f35e1a2`:** the build itself.
- **`ec59a66`:** larger fonts. Session `822d6494`: "the font size in the dashboard look small to the eye". The spec was never updated, so this change exists only in the code.
- **`280c97c`:** clearer messages in the Composition tab. Your screenshots showed it empty because the proxy was still running old server code.

## Rebuilding vs. editing

- **`f35e1a2` was a rebuild from the spec.** Session `65d31ebc`: "build the dashboard from scratch based on the spec". Its build check was skipped: "Commit the files exactly as they are. Skip the performance check." So checks 1 and 6 were never verified.
- **We switched to editing between `f35e1a2` and `ec59a66`.** From `ec59a66` on, every change edited the existing code. Even `bfbee1f`, which changed the spec, was carried out as edits to the existing `app.js`, `style.css`, `index.html` and `traffic.py`, not as a rebuild.
- **The spec is no longer the only source of truth.** The font change in `ec59a66` exists only in the code, and a rebuild from `SPEC.md` would lose it.

*Sources:* sessions `65d31ebc`, `822d6494` and `9da55a24`, plus the diff stats in `git log`.

## Findings in the traffic

- **Tool definitions fill the prompt.** Built-in tool schemas are 67.5% of all input tokens, and the skills list is 14.0%. Text the user typed is only 0.2%.
- **Caching works.** 81% of the 792k input tokens were read from the cache. The estimated total cost is $1.91, and one request (#18) cost $0.41 on its own.
- **Every user turn triggers side calls.** These are a "quota" probe (lane L1), which failed with 429 all 4 times, and a session-title call (lane L2).
- **Calls the user never typed.** Some agent-lane requests are harness prompts, such as "SUGGESTION MODE" (guessing your next message) and "The user stepped away… Recap".
- **One tool error (#12):** reading a file that doesn't exist. This was a deliberate test prompt.
