# 11: Docs and submission polish

**What to build:** Everything the submission form needs except the video. A README with clear setup, seed, run, test, and deploy instructions verified from a clean checkout; the architecture note (agent design, tool design, document and structured-data handling, source reliability and conflict handling, major trade-offs — drawn from the spec's implementation decisions); the product note (which additional client problem was addressed and how — both, with Problem 1 built as the dashboard and Problem 2 as the trust core; what else would be built, prioritized; what was intentionally left out; the usefulness metric: confident-resolution rate balanced against the confidently-wrong rate on the golden suite); a brief AI-tool-usage statement; and a final end-to-end pass over the deployed app (fresh deploy from main, seed, eval suite green, all personas exercised, AI Gateway logs confirming traffic). Also a documented assumptions section (business-hours calendar, snapshot clock as "now").

**Blocked by:** 08 (Trace viewer), 09 (Proactive detection and internal dashboard), 10 (Golden-case eval harness).

**Status:** done

- [x] README instructions work from a clean clone to a running local instance and a deploy (verified, not assumed)
- [x] Architecture note covers all five required topics concisely, consistent with what was actually built
- [x] Product note covers the chosen client problems, prioritized future work, intentional omissions, and the single usefulness metric with rationale
- [x] AI tool usage statement included
- [x] Deployed URL is live, seeded, and passes the golden-case eval suite at submission time
- [x] Repository is public-ready: no secrets committed, license/attribution sane, scratch and temp artifacts excluded

## Comments
README + docs/ARCHITECTURE.md + docs/PRODUCT.md committed. Deployed https://parcelpilot-support.vaibhav21296.workers.dev live, 64/64 tests green, 12/12 eval pass. No secrets in repo; image.png and scratch ignored.
