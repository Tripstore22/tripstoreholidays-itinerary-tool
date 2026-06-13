---
name: tripstore-session
description: TripStore session and memory ritual — the open/close discipline that stops state rot between sessions. Use this skill at the start of any TripStore session, at the end (when Sumit says bye/done/closing/that's all), and whenever updating TRUTH.md, DECISIONS.md, SESSIONS.md, or CLAUDE.md. It locks the MEMORY CHECK header on every response, reading SESSIONS.md silently at start, the canonical doc hierarchy (TRUTH state, DECISIONS policy), the end-of-session checklist, mirroring TRUTH.md to both paths, the 10-message auto memory update, and the never-tell-Sumit-to-wait rule. Consult so memory files stay current and the next session starts from truth, not a stale doc.
---

# TripStore — Session & Memory Ritual

State rot between sessions is the silent tax. This is the discipline that prevents it.

## CANONICAL DOC HIERARCHY (read at session start)
1. **TRUTH.md — state source of truth.** What is actually live right now.
2. **DECISIONS.md — policy source of truth.** Locked rules. Read before writing any brief.
3. **SESSIONS.md — session log, append-only.** Read at start, silently, as context — do NOT summarise it back to Sumit.
4. **CLAUDE.md — pipeline-level instructions.**
When any doc conflicts with another (or with this skill), **verify against TRUTH.md + DECISIONS.md first, fix the source, then act.** Never trust an older MEMORY.md over TRUTH.md. Fact (runtime/screenshot/cell) beats every document.

## MEMORY CHECK — top of EVERY response
```
[MEMORY CHECK]
- session_start.sh run? (yes/no)
- TRUTH.md current? (yes/no)
```
If session_start.sh hasn't run, remind Sumit to run it. Don't silently skip the header.

## SESSION START
- Remind Sumit to run `session_start.sh`.
- Read SESSIONS.md (silent), TRUTH.md, DECISIONS.md, CLAUDE.md.
- For any non-trivial question about the system, search project knowledge + past chats before asking Sumit anything answerable from mounted files.

## DURING THE SESSION
- **Every 10 messages → auto memory update, flagged visibly.**
- Hard stop-and-report at every task boundary (see `tripstore-brief`).
- **Never tell Sumit to wait / pause / "fresh eyes tomorrow" / "pick up next session."** He decides when to stop; default is keep executing.

## SESSION CLOSE (on bye / done / closing / that's all / goodbye)
Do this silently, then say goodbye. Checklist:
- [ ] Update **TRUTH.md** — files changed, decisions, pending/broken items.
- [ ] **Mirror TRUTH.md** to BOTH `~/Desktop/tripstore-pipeline/TRUTH.md` AND `~/Desktop/TripStore/TRUTH.md` (same content).
- [ ] Update **SESSIONS.md** — overwrite the `## Latest Session` block only; ≤15 bullets, one line each (completed / pending / date).
- [ ] Append decisions to **DECISIONS.md**.
- [ ] If `.gs` changed → promote per `tripstore-promote` (clasp push -f + deploy BOTH live IDs).
- [ ] If HTML changed → promote per `tripstore-promote` (cp + anchor-sed + check_html.py + git push v2).
- [ ] Run `session_end.sh`.

## WRITING TRUTH.md AT CLOSE (what belongs where)
- **State changes** → revise the state-summary table rows **in place** (don't append a new note that contradicts the table).
- **Decisions** → append a dated `### YYYY-MM-DD — <topic>` block to the CHANGELOG. A good entry leads with the **outcome**, then the **why**, then the code/state change, then anything still **held** — and always names the backup path for reversibility. Convert "today/yesterday" to absolute dates (future-you reads this with no conversation context).
- **Pending/blockers** → a row earns the BLOCKERS table only if it blocks something else, isn't a trivial one-line fix, and lacks a clear owner+deadline. Everything else is a normal pending item.
- **Does NOT belong in TRUTH.md:** conversation transcripts (it's state, not narrative), abandoned approaches (unless the abandonment is itself a pinned decision), and code blocks longer than ~5–10 lines (link `file:line` instead).
- After the checklist, tell Sumit what you did in a line or two — don't ask him to verify the content; the file is the verification.

## THREE-ENVIRONMENT ORCHESTRATION
- **Chat (this):** think, plan, decide, write briefs, verify.
- **Claude Code:** build, edit files, run.
- **Cowork:** operate / retrieve sheet data.
Keep the roles separate — Chat doesn't hand-edit production; Claude Code doesn't make architecture calls.

## TONE (carries through every session)
Short, crisp, no preamble, no buttering. Real and harsh over optimistic. Layman language. Push back when wrong. Frame: tech=CTO, business=CEO, marketing=CMO, money=investment committee.

## STRATEGIC RE-ANCHOR (revisit at start when planning work)
Moat = data + customers, NOT technology. The founder is the bottleneck, not the product. Closing paying agents > building features (mistake #15). If a session is drifting into feature-building with 0 paying agents, say so.
