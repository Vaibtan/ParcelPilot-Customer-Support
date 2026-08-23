# 05: Policy engine and calculator tools

**What to build:** All money and time arithmetic becomes deterministic code. A pure policy engine computes: cancellation-fee quotes (order status rules, elapsed-minutes-since-booking, contract fee waivers), failed-pickup service-credit quotes (delay past pickup-window end, carrier/customer fault, the SOP's lower-of-₹500-or-10% default, contract-overridden thresholds and fixed amounts, the ₹1,000 manager-approval threshold, contract aggregate caps), and SLA status (plan defaults from the current policy, contract-overridden targets, business-hours arithmetic against the snapshot clock, breach determination). Contract overrides are resolved by the engine from structured account/agreement terms — precedence is computed, never left to the LLM comparing documents. Every result carries a rule trace naming which rules fired and which source (agreement clause vs. policy/SOP section) supplied each parameter.

The engine is exposed to the agent as calculator tools; the chat UI renders the rule trace so users see how a number was derived. The system prompt is updated so the agent may only state fees, credits, and deadlines that come from calculator traces.

Demo: "Can Northstar cancel ORD-1001 without a cancellation fee?" → no fee, agreement clause cited over the SOP default. The same elapsed time for LumenWorks → ₹250 fee under the SOP.
**Status:** done

- [x] Cancellation, service-credit, and SLA calculators produce correct results for every golden scenario in the spec, each with a rule trace citing its sources
- [x] Contract overrides (Northstar fee waiver and SLA targets, LumenWorks 4-hour/₹300 credit clause) beat defaults; accounts without agreements fall through to defaults gracefully
- [x] Business-hours math uses the documented calendar assumption and the snapshot clock; 24x7 targets are honored where stated
- [x] Pure unit tests cover boundaries: exactly 30 minutes after booking, exactly at the 2-hour and 4-hour delay thresholds, the lower-of credit rule, the manager-approval threshold, breach at the snapshot instant
- [x] The agent answers fee/credit/SLA questions using calculator tools and presents the rule trace; severities are an explicit calculator input with the applied definitions reported

## Comments
Pure policy-engine (policy-engine.ts) with rule traces; calculator tools quote_cancellation/quote_credit/check_sla wired into registry. Northstar waiver + conflictNote, Lumen 4h/₹300 override, SOP defaults, business-hours (Mon-Fri 09-18 IST) + 24x7. 21 pure unit tests. Live: Northstar ORD-1001 → no fee, cites agreement §2 with conflictNote vs SOP ₹250.
