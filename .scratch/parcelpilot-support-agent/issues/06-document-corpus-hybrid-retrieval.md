# 06: Document corpus and hybrid retrieval

**What to build:** The six PDFs become a searchable, trust-annotated corpus, and the agent gains a document-search tool with honest citations. A build-time processing step (output committed) turns each document into section-level chunks with first-class metadata: authority tier (1 signed agreements, 2 current policy/SOP, 3 current product documentation, 4 historical-ticket context), status (current/deprecated), effective dates, and account scope. Retrieval is hybrid: D1 FTS5 keyword search and Vectorize vector search run in parallel and merge via reciprocal rank fusion, then metadata filters apply — a customer's search can only return the general corpus plus their own agreement; deprecated documents are excluded from default retrieval (reachable only via an explicit include-deprecated flag and always labelled). When retrieved chunks from different tiers address the same topic, or a context-only source contradicts a higher-tier source, the tool response carries an explicit conflict note naming both sources and which prevails under precedence; the system prompt requires conflicts to be acknowledged in answers. The chat UI renders citations (document, section) on answers.

Demo: an SLA policy question cites Support Policy v3 and never v2; "can I cancel after 30 minutes?" as Northstar surfaces the agreement-vs-SOP conflict and answers from the agreement.

**Blocked by:** 04 (Agent tool loop with structured lookups and trace capture).
**Status:** done

- [x] All six documents are chunked with complete metadata; processing is repeatable and its output committed
- [x] Hybrid search returns merged keyword+vector results annotated with tier and status; keyword-only exact matches (IDs, clause numbers) and semantic paraphrases both retrieve
- [x] A customer Principal can never retrieve another account's agreement (asserted by tests); staff retrieval spans the corpus
- [x] Deprecated documents never appear in default retrieval; with the explicit flag they appear clearly labelled deprecated
- [x] Conflict notes are emitted for cross-tier disagreements and context-only contradictions, and answers acknowledge them
- [x] Answers grounded in documents show citations in the UI
- [x] Retrieval tests run hermetically (deterministic keyword path; vector path faked or recorded)

## Comments
18 chunks (6 docs, tier 1-3 + deprecated) committed to data/corpus/chunks.json + D1 FTS5 (18 rows) + Vectorize (18 vectors, ndjson). Hybrid RRF merges FTS + vector, account-scope + deprecated filters, conflict notes for tier 1vs2. search_docs tool wired via provider. 51 tests green. Live: bulk upload limit → cites 04_guide §1 (5000 rows, KI-208 workaround).
