# 03: Structured data layer with scoped repositories

**What to build:** The workbook's accounts, orders, and tickets live in D1 via a repeatable seed script, and all reads go through Principal-scoped repositories: a customer Principal can only ever receive rows belonging to its own account (filtering applied inside the queries, not after), while a staff Principal sees all accounts. Historical ticket resolutions are stored flagged as context-only. A snapshot-clock service supplies the dataset snapshot time (2026-08-16 11:00 Asia/Kolkata, from the workbook README) as "now" to everything downstream, injectable so tests can fix time.

This ticket is verified through its test suite rather than the UI — it lands the access-control guarantee (assessment requirement: enforcement in the data layer, not model instructions) before any LLM can touch the data.

**Blocked by:** 02 (Mock auth and Principal sessions).
**Status:** done

- [x] A seed command loads all accounts, orders, and tickets from the supplied workbook into D1; re-running it is idempotent
- [x] Repository reads take a Principal; customer-scoped queries structurally cannot return another account's rows (asserted by tests attempting cross-account access for every entity type)
- [x] Staff-scoped queries return data across all accounts
- [x] Historical ticket resolutions are retrievable but marked context-only in the returned shape
- [x] The snapshot clock is the single source of "now", injected as a service, and defaults to the workbook README's snapshot timestamp
- [x] No hard-coded record IDs anywhere in behavior — everything flows from seeded data

## Comments
D1 schema (accounts/orders/tickets/conversations/traces/pending_actions/doc_chunks/insights) + seed script from workbook (.xlsx) seeded to remote D1 (4/6/7 rows). Principal-scoped repo with account-filter inside queries, context_only flag on closed tickets with historical_resolution. Clock service defaults to 2026-08-16T11:00+05:30. 22 tests green; seed verified via wrangler d1 execute.
