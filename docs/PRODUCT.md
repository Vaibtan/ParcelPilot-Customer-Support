# Product Note

## Additional Client Problems

Both problems are addressed; Problem 2 is load-bearing.

**Problem 1 — Proactive Issue Detection:** Deterministic detectors (`src/lib/detectors.ts`) over seeded data: SLA breach/approaching-breach (policy engine per open ticket), recurring clusters (keyword + KI-208 linking), carrier/cross-account patterns (SwiftShip KI-211, RoadRunner unresolved, multi-account carriers). Persisted as `insights` with evidence IDs and plain-language summaries. Runs on Cron (`0 * * * *`) and on-demand via staff `/api/insights/recompute`; UI at Insights dashboard (staff-only) with Recompute + Open-in-chat.

**Problem 2 — Trust & Reliability:** Core of the system. Source-precedence engine (tier metadata + retrieval filters), deprecated exclusion, contract-override computation in code, conflict surfacing, deterministic calculators with rule traces, and confirmation-gated actions (nonce+expiry, exactly-once). Every answer shows tool calls; traces are inspectable.

## What Else Would Be Built (prioritized)

1. Feedback on answers (thumbs + correction → eval suite).
2. Document lifecycle: effective-date-aware ingestion, deprecation checks.
3. Ticket-drafting assist for staff.
4. Carrier scorecards from order data.
5. Customer-visible SLA countdowns.

## Intentionally Left Out

- Real auth/SSO, carrier/billing integrations, ingestion UI, multi-session memory, rate limiting/fine-tuning — per spec, mocked where appropriate.

## Usefulness Metric

**Confident-resolution rate** — share of requests resolved without escalation whose answers pass source-grounding checks — balanced against a measured **confidently-wrong rate** on the golden suite. The latter is the adoption-killing failure the client named; the eval harness makes it measurable.

## AI Tool Usage

Claude/Opus for scaffolding, PDF extraction, and iteration on detectors/eval; manual verification of deployed behavior and free-tier limits. Stack facts taken from `research-notes.md` without re-research.
