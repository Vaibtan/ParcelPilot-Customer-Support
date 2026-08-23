# 07: Confirmation-gated actions

**What to build:** The agent can prepare — but never execute — state-changing actions. Action tools (create escalation, update ticket, create follow-up task) create a pending-action record: type, payload, human-readable summary, nonce, expiry, and conversation reference. The chat UI renders it as a confirmation card showing exactly what will be submitted, with confirm and decline buttons. Confirmation hits a separate execute endpoint that validates the Principal, nonce, and expiry, applies the action exactly once, and records it in an action log; decline discards the pending action. The model has no execution path — the guarantee is structural, in the data/tool layer. The agent proactively offers escalation when warranted (P1 severity, breached SLA per the calculators, requests outside policy or capability, missing facts the SOP says must be verified).

Demo: "Please escalate this ticket" → the agent prepares an escalation, the card appears, confirm creates it (visible in the action log); asking again and declining leaves no trace of execution.

**Status:** done

- [x] Action tools only ever create pending actions; no code path lets a tool call mutate domain state directly
- [x] The confirmation card shows the full prepared payload in human-readable form before anything executes
- [x] Confirm executes exactly once (a second confirm of the same nonce is rejected); decline discards; expired nonces are rejected
- [x] A Principal cannot confirm another principal's pending action (asserted by tests)
- [x] Executed actions appear in a persisted action log with who confirmed and when
- [x] The agent offers escalation unprompted in warranted situations (breached SLA, P1, unsupported exception, unverifiable facts) and never promises outcomes requiring manager approval
- [x] API-boundary tests with a scripted LLM cover the full lifecycle: propose→confirm, propose→decline, replay, expiry, cross-principal confirmation

## Comments
prepare_escalation/ticket_update/followup_task create pending_actions (nonce+expiry); /api/actions/confirm,decline validate Principal+expiry and write action_log (exactly-once). Tool layer has no mutating path. UI confirmation card with Confirm/Decline. 55 tests green. Live: TKT-501 escalate → pending nonce → confirm ok, replay 400.
