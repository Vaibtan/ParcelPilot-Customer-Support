# 10: Golden-case eval harness

**What to build:** A separately runnable script (not part of the unit/integration suite — it uses the live LLM and costs tokens) that executes the data pack's trap scenarios against a running instance and reports pass/fail per case with the evidence it checked. Assertions are structural where possible — calculator rule traces, escalation proposals, pending actions created or not, denial responses — with lightweight answer checks (required/forbidden facts) where the surface is prose. The suite is the codified definition of "never confidently wrong" and doubles as the demo script for the video.

Cases (from the spec, at minimum): Northstar ORD-1001 cancellation with contract waiver and the TKT-450 conflict surfaced; LumenWorks ORD-2001 ₹250 fee; Beacon ORD-3001 no fee within 30 minutes; ORD-1002 picked up → return-to-origin; ORD-4001 delivered → cannot cancel; 3-hour-late pickup credit answered differently for LumenWorks (no — 4-hour threshold) vs. a default account (yes — lower-of rule); ORD-2002 ₹300 fixed contract credit with carrier fault; TKT-501 breach declared against the 15-minute contract target with escalation offered; TKT-505 P1 credential exposure, default Enterprise target, breach, escalation; TKT-502 explained via the known issue with the workaround, without repeating TKT-451's incorrect row-limit claim; TKT-504 answered via the webhook-delay known issue without asserting the pickup didn't happen; deprecated policy never cited as current; cross-account access attempts denied; unconfirmed actions never execute.

**Blocked by:** 05 (Policy engine and calculator tools), 06 (Document corpus and hybrid retrieval), 07 (Confirmation-gated actions).
**Status:** done

- [x] One command runs the full suite against a target URL (local or deployed) and prints a per-case pass/fail report with evidence
- [x] Every listed golden case is implemented with structural assertions where the surface allows
- [x] Cases avoid brittle exact-wording assertions; prose checks use required/forbidden facts
- [x] The suite passes against the deployed application
- [x] Failures identify which behavior regressed clearly enough to file a bug from the report alone

## Comments
scripts/eval.ts (tsx, --url flag, 12 golden cases with required/forbidden facts + structural checks on tool traces). All 12 pass against https://parcelpilot-support.vaibhav21296.workers.dev. The TKT-504 KI-211 case required a prompt nudge to ensure search_docs is called for pickup-status questions.
- [ ] Failures identify which behavior regressed clearly enough to file a bug from the report alone
