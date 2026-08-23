# Architecture Note

## Agent Design

Hand-rolled loop against OpenAI via Cloudflare AI Gateway (no `@effect/ai`). Bounded iterations (6), function calling, streaming SSE. `src/lib/agent.ts` orchestrates LLM calls; tool registry is Principal-aware so unauthorized tools are never offered. System prompt encodes: answer only from tools, cite sources, acknowledge agreement-vs-SOP conflicts, escalate when facts missing. Every run persists steps (latency, tokens, args, results) to D1 for the trace viewer.

## Tool Design

- **Structured lookups:** `get_account`, `list_accounts`, `get_order`, `list_orders`, `get_ticket`, `list_tickets` — all Principal-scoped inside SQL (account-filtered), not prompt-based.
- **Calculators:** `quote_cancellation`, `quote_credit`, `check_sla` — thin wrappers over `policy-engine.ts` returning rule traces.
- **Document search:** `search_docs` — hybrid retrieval (below).
- **Actions:** `prepare_escalation`, `prepare_ticket_update`, `prepare_followup_task` — create `pending_actions` (nonce + expiry); `/api/actions/confirm,decline` validate Principal + expiry, write `action_log` exactly once. Model has no execution path.
- All inputs/outputs validated via tool schemas handed to the LLM.

## Document & Structured Data

- **Corpus:** 6 PDFs chunked at build time (`scripts/process-docs.ts`) into 18 section-level chunks with `authority_tier` (1 agreement, 2 policy/SOP, 3 product docs), `status` (current/deprecated), `account_scope`, `effective_date`. Committed at `data/corpus/chunks.json`.
- **Hybrid retrieval:** D1 FTS5 keyword + Vectorize vector search in parallel, merged via reciprocal rank fusion (k=60), then account-scope and deprecated filters, conflict-note detection.
- **Structured data:** Workbook (`ParcelPilot_Assessment_Data.xlsx`) seeded to D1 via `scripts/seed.ts` + `migrations/001_init.sql`. Historical tickets flagged `context_only` when closed with `historical_resolution`.

## Source Reliability & Conflicts

Precedence per Policy v3 §1: signed agreement (tier 1) > current policy/SOP (tier 2) > product docs (tier 3) > historical tickets (tier 4, context-only). Implemented via:
- Chunk metadata + retrieval filters (deprecated excluded by default, agreements scoped).
- Policy engine computes overrides (e.g., Northstar fee waiver, LumenWorks 4h/₹300) from account + agreement, not LLM document comparison.
- `detectConflicts` surfaces tier 1-vs-2 disagreements; the prompt requires acknowledging them.

## Major Trade-offs

- Hand-rolled agent vs `@effect/ai` / Agents SDK: avoids pre-1.0 churn and buys server-enforced confirmation (stronger than `needsApproval` HITL).
- Hono for routing, Effect for domain (services/layers, typed errors). Clock and gateway are Effect layers, injectable for tests.
- Business-hours assumption: Mon-Fri 09:00–18:00 IST, no holidays; 24x7 for P1 where stated. Enterprise P1 targets use wall-clock.
- Hybrid retrieval needs both FTS5 and Vectorize; free-tier limits (5M stored dims, 30M queried dims/month) comfortably fit 18 vectors × 1536 dims.
- No fine-tuning; `gpt-4o-mini` as default agentic caller, `text-embedding-3-small` for embeddings, both configurable.
