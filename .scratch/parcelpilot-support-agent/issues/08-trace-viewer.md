# 08: Trace viewer

**What to build:** A staff-only observability page that makes every agent run inspectable inside the app. It lists recent conversations (persona, account, turn count, timestamps, total tokens) and drills into any run: the sequence of LLM calls and tool calls with their arguments, result summaries, per-step latency, and token counts — reconstructing exactly how an answer was produced. This reads the traces captured since ticket 04; the value here is surfacing them for debugging, the demo video, and the assessment's observability story.

**Blocked by:** 04 (Agent tool loop with structured lookups and trace capture).

**Status:** done

- [x] Staff sessions can browse conversations and open any run to see its full step sequence with arguments, results, latency, and token counts
- [x] Aggregates per run (total latency, total tokens, tool-call count) are visible at a glance
- [x] Customer sessions cannot reach the trace viewer or its API (enforced by Principal, asserted by tests)
- [x] Traces from failed/errored runs render usefully (the error and the steps that preceded it)

## Comments
Staff-only /api/traces + /api/traces/:id (Principal-gated, 403 for customers, 401 for anon) listing conversations/runs and drilling into steps/messages. UI Traces button for staff, detail view with steps/messages JSON + aggregates. 60 tests green. Live: staff 200 returns runs, customer 403.
