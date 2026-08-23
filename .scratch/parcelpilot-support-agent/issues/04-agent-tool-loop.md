# 04: Agent tool loop with structured lookups and trace capture

**What to build:** The chat becomes an agent. A hand-rolled tool loop drives the OpenAI API (function calling, bounded iterations, streaming), with tool definitions derived from Effect Schema so inputs/outputs are validated at the boundary. First tools: account profile/entitlements, order lookup/list, ticket lookup/list — all Principal-scoped through the ticket-03 repositories, and the tool registry itself is Principal-aware (a customer session is never even offered staff tools). The chat UI shows tool calls live as they happen (which tool, status, then result summary). Every run is persisted as a trace: conversation → run → steps (LLM calls and tool calls with arguments, result summaries, latency, token counts). Conversation history persists per session so follow-up questions work.

Demo: signed in as Northstar, "What's the status of ORD-1001?" answers from a tool call; the same question signed in as LumenWorks is refused because the data layer returns nothing.

**Status:** done

- [x] A customer can ask about their own orders/tickets/account in natural language and get answers grounded in tool results
- [x] Cross-account questions return a denial with zero data leakage (enforced by the scoped repositories, not the prompt)
- [x] Tool calls appear in the chat UI in real time with the tool name and outcome
- [x] The tool loop is bounded (max iterations) and failures surface as graceful, typed errors in chat
- [x] Every run writes a complete trace (steps, arguments, latencies, token counts) keyed to the conversation
- [x] Tests at the API boundary with a scripted LLM layer cover: a multi-tool turn, a scoping denial, loop bound enforcement, and trace persistence

## Comments
Hand-rolled tool loop (bounded 6, OpenAI function calling via Gateway) with get_account/list_accounts/get_order/list_orders/get_ticket/list_tickets (Principal-aware). SSE emits tool_call events + streamed answer. Traces persisted to D1 (conversations→runs→steps). UI shows live tool calls. 26 tests green. Live: Northstar ORD-1001 returns BOOKED/SwiftShip; LumenWorks ORD-1001 returns not-accessible denial.
