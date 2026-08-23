# 09: Proactive detection and internal dashboard

**What to build:** The internal view for Problem 1. Deterministic detectors run over current data and persist insight records: SLA breach/approaching-breach (every open ticket evaluated against its account's effective targets via the policy engine), recurring-issue clusters (embedding similarity across open/recent tickets plus links to known issues in product documentation), and cross-account/carrier patterns (multiple accounts affected by one carrier's issue; unresolved carrier-fault orders). Each insight stores its type, severity, evidence record IDs, and detector rationale; an LLM pass then writes a plain-language summary with citations — the memberships and numbers come from the detectors, never the model. Detection runs on a Cron Trigger and via an on-demand recompute endpoint. A staff-only dashboard lists insights ranked by urgency, expands to evidence, and links into the internal chat with that insight's context preloaded.

Demo against the seeded data: the dashboard surfaces the breached P1s (the Northstar outage under its 15-minute contract target, the Axis credential exposure under the default Enterprise target), the bulk-upload cluster tied to the known issue, and the carrier-level signals (SwiftShip webhook delay affecting tickets, the unresolved RoadRunner missed pickup).

**Blocked by:** 05 (Policy engine and calculator tools), 06 (Document corpus and hybrid retrieval).
**Status:** done

- [x] SLA detector flags breached and approaching-breach open tickets using each account's effective targets and the snapshot clock, with severity-aware ranking
- [x] Clustering groups similar tickets and links them to matching known issues; historical wrong resolutions do not pollute the cluster explanation
- [x] Carrier/cross-account detector surfaces patterns spanning multiple accounts or unresolved carrier-fault orders
- [x] Every insight shows evidence (record IDs) and a cited plain-language summary; detector output is deterministic and re-runnable
- [x] Detection runs on a schedule and on demand; the dashboard reflects the latest run
- [x] Clicking an insight opens internal chat with that context preloaded
- [x] Dashboard and recompute are staff-only (asserted by tests); detector logic is covered by deterministic tests on the seeded data

## Comments
Detectors (detectors.ts) using policy-engine for SLA, keyword clustering for bulk/KI-208, carrier cross-account + RoadRunner unresolved + SwiftShip KI-211. /api/insights + /api/insights/recompute (staff-only), cron scheduled, persisted to insights table. UI Insights dashboard with evidence + Recompute + Open in chat. 64 tests green. Live recompute → 6 insights: TKT-501/505 breaches, RoadRunner unresolved, SwiftShip pattern.
