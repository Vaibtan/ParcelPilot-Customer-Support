# 01: Walking skeleton on Cloudflare

**What to build:** A deployed, public chat page where a visitor types a message and sees a streamed LLM reply. No tools, no auth, no data — the point is a complete, working path through every layer of the chosen stack: React chat UI served as Worker static assets, Hono routing into an Effect runtime, an OpenAI chat call routed through Cloudflare AI Gateway, and the reply streamed to the browser over SSE. Ends deployed to a public workers.dev URL on the free plan.

This ticket deliberately front-loads the riskiest integrations (Effect on Workers, free-plan streaming, AI Gateway proxying) so every later ticket builds on proven ground. Project scaffolding — wrangler configuration, D1 and Vectorize bindings declared, secrets handling for the OpenAI key, test runner, formatting/linting — lands here too.

**Blocked by:** None (can start immediately).
**Status:** done

- [x] A visitor can open the deployed URL, send a message, and watch a streamed model reply render token-by-token
- [x] All LLM traffic goes through Cloudflare AI Gateway (verifiable in the Gateway dashboard logs), with the model name configurable
- [x] HTTP handling runs through the Effect runtime with typed errors mapped to meaningful HTTP responses; Hono handlers are thin adapters
- [x] D1 and Vectorize bindings are declared and reachable (a trivial health endpoint proves both), even though nothing uses them yet
- [x] The repo has working local dev (wrangler dev), test, and deploy commands documented in a minimal README
- [x] Deployed and reachable on a public workers.dev URL on the free plan

## Comments
Walking skeleton deployed to https://parcelpilot-support.vaibhav21296.workers.dev. React chat streams via SSE through Effect + Hono + AI Gateway (gpt-4o-mini, configurable). Health endpoint proves D1/Vectorize bindings. Verified: Gateway 200s, SPA renders, chat returns streamed replies.
