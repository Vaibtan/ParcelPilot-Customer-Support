# ParcelPilot Support

AI support system for B2B logistics — customer + staff chat, deterministic policy engine, hybrid retrieval, confirmation-gated actions, proactive insights.

**Deployed:** https://parcelpilot-support.vaibhav21296.workers.dev

## Setup

```bash
npm install
```

Requires Node 22+, Wrangler logged in (`npx wrangler whoami`).

## Environment

Copy `.env.example` (or use `.env`):
```
CF_ACCOUNT_ID=...
CF_AI_GATEWAY_NAME=parcelpilot-cf-gateway
CF_AI_GATEWAY_AUTH_API_TOKEN=cfut_...
OPENAI_API_KEY=... # only for local ingestion, never committed
```

Worker secrets (deployed):
```bash
echo "<token>" | npx wrangler secret put CF_AI_GATEWAY_AUTH_API_TOKEN
```

Vars (`wrangler.toml`): `CF_ACCOUNT_ID`, `CF_AI_GATEWAY_NAME`, `LLM_MODEL` (default `gpt-4o-mini`), `EMBEDDING_MODEL` (`text-embedding-3-small`).

## D1 & Vectorize

```bash
npx wrangler d1 create parcelpilot-db        # update database_id in wrangler.toml
npx wrangler vectorize create parcelpilot-docs --dimensions=1536 --metric=cosine
npx wrangler d1 execute parcelpilot-db --remote --file migrations/001_init.sql
```

## Data

- `data/corpus/chunks.json` — 18 chunks from the 6 PDFs (built via `npx tsx scripts/process-docs.ts`).
- Seed structured data (workbook) + docs to D1:
  ```bash
  npx tsx scripts/ingest-docs.ts
  npx wrangler d1 execute parcelpilot-db --remote --file /tmp/docs_seed.sql
  # vectors
  npx tsx scripts/upload-vectorize.ts
  npx wrangler vectorize insert parcelpilot-docs --file /tmp/vectors.ndjson
  npx wrangler vectorize insert parcelpilot-docs --file /tmp/vectors_deprecated.ndjson
  ```
- Workbook seed: `migrations/001_init.sql` + `scripts/seed.ts` (`npx tsx scripts/seed.ts --local` then `wrangler d1 execute`).

Snapshot clock: `2026-08-16 11:00 Asia/Kolkata` (workbook README).

## Dev & Test

```bash
npm run dev           # vite dev (client)
npx wrangler dev      # worker with assets + D1/Vectorize bindings
npm test              # vitest (64 tests)
npx tsx scripts/eval.ts --url https://parcelpilot-support.vaibhav21296.workers.dev
npx tsx scripts/eval.ts --url http://localhost:8787 --verbose
```

## Deploy

```bash
npm run build
npx wrangler deploy
```

## Project Structure

- `src/lib/policy-engine.ts` — deterministic cancellation/credit/SLA with rule traces
- `src/lib/repo.ts` — Principal-scoped D1 access
- `src/lib/doc-search.ts` — hybrid FTS5 + Vectorize RRF, conflict notes
- `src/lib/agent.ts` — hand-rolled tool loop (bounded, streaming)
- `src/lib/actions.ts` — pending actions (nonce/expiry, exactly-once)
- `src/lib/detectors.ts` — SLA/cluster/carrier insights
- `src/worker/index.ts` — Hono + Effect, auth, chat, traces, insights
- `src/client/` — React chat, TraceViewer, InsightsDashboard

## Docs

- [Architecture Note](docs/ARCHITECTURE.md)
- [Product Note](docs/PRODUCT.md)
