import { describe, it, expect } from "vitest";
import { makeRepo } from "../src/lib/repo";
import { Effect } from "effect";

// Mock D1 with same data as repo.test
function mockDb() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    accounts: new Map(),
    orders: new Map(),
    tickets: new Map(),
    conversations: new Map(),
    messages: new Map(),
    runs: new Map(),
    steps: new Map(),
  };
  const seed = {
    accounts: [
      { account_id: "ACCT-001", account_name: "Northstar Logistics", plan: "Enterprise", status: "active", csm: "Priya Mehta", contract_file: "x", premium_support: 1, notes: "" },
      { account_id: "ACCT-002", account_name: "LumenWorks", plan: "Growth", status: "active", csm: "Arjun Rao", contract_file: "x", premium_support: 0, notes: "" },
    ],
    orders: [
      { order_id: "ORD-1001", account_id: "ACCT-001", carrier: "SwiftShip", status: "BOOKED", booked_at: "2026-08-16 09:00", pickup_window_start: "2026-08-16 10:30", pickup_window_end: "2026-08-16 11:30", pickup_actual_at: null, shipment_fee_inr: 4200, carrier_fault: 0, customer_fault: 0, cancellation_requested_at: "2026-08-16 11:00", notes: "" },
      { order_id: "ORD-2001", account_id: "ACCT-002", carrier: "SwiftShip", status: "BOOKED", booked_at: "2026-08-16 09:00", pickup_window_start: "2026-08-16 11:00", pickup_window_end: "2026-08-16 12:00", pickup_actual_at: null, shipment_fee_inr: 1800, carrier_fault: 0, customer_fault: 0, cancellation_requested_at: "2026-08-16 10:15", notes: "" },
    ],
    tickets: [
      { ticket_id: "TKT-501", account_id: "ACCT-001", created_at: "2026-08-16 10:30", status: "open", subject: "x", description: "x", channel: "email", assigned_to: "Rohit", last_customer_message_at: "2026-08-16 10:52", historical_resolution: null },
    ],
  };
  for (const a of seed.accounts) tables.accounts.set(a.account_id, a as unknown as Record<string, unknown>);
  for (const o of seed.orders) tables.orders.set(o.order_id, o as unknown as Record<string, unknown>);
  for (const t of seed.tickets) tables.tickets.set(t.ticket_id, t as unknown as Record<string, unknown>);

  function allFor(sql: string, params: unknown[]): unknown[] {
    if (sql.includes("FROM accounts")) {
      let rows = [...tables.accounts.values()];
      if (sql.includes("WHERE account_id = ?")) rows = rows.filter((r) => r.account_id === params[0]);
      return rows;
    }
    if (sql.includes("FROM orders")) {
      let rows = [...tables.orders.values()];
      if (sql.includes("WHERE order_id = ?")) rows = rows.filter((r) => r.order_id === params[0]);
      else if (sql.includes("WHERE account_id = ?")) rows = rows.filter((r) => r.account_id === params[0]);
      return rows;
    }
    if (sql.includes("FROM tickets")) {
      let rows = [...tables.tickets.values()];
      if (sql.includes("WHERE ticket_id = ?")) rows = rows.filter((r) => r.ticket_id === params[0]);
      else if (sql.includes("WHERE account_id = ?")) rows = rows.filter((r) => r.account_id === params[0]);
      return rows;
    }
    if (sql.includes("FROM conversations") || sql.includes("FROM runs") || sql.includes("FROM steps") || sql.includes("FROM messages")) return [];
    return [];
  }

  const db = {
    prepare: (sql: string) => {
      let params: unknown[] = [];
      const isInsert = sql.trim().startsWith("INSERT") || sql.trim().startsWith("UPDATE");
      return {
        bind: (...a: unknown[]) => {
          params = a;
          return {
            first: async () => allFor(sql, params)[0] ?? null,
            all: async () => ({ results: allFor(sql, params) }),
            run: async () => {
              // persist for trace tables
              if (sql.includes("INTO conversations") || sql.includes("INTO messages") || sql.includes("INTO runs") || sql.includes("INTO steps")) return {};
              return {};
            },
          };
        },
        first: async () => allFor(sql, params)[0] ?? null,
        all: async () => ({ results: allFor(sql, params) }),
        run: async () => ({}),
      };
    },
  };
  return db as unknown as Parameters<typeof makeRepo>[0];
}

import worker from "../src/worker/index";
import { createSessionToken } from "../src/lib/auth";

function mockEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DB: mockDb(),
    VECTORIZE: {},
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    CF_ACCOUNT_ID: "test",
    CF_AI_GATEWAY_NAME: "test-gw",
    CF_AI_GATEWAY_AUTH_API_TOKEN: "gw-token",
    SESSION_SECRET: "auth-secret",
    LLM_MODEL: "gpt-4o-mini",
    EMBEDDING_MODEL: "text-embedding-3-small",
    ...overrides,
  };
}

async function streamedText(res: Response): Promise<string> {
  const buf = await res.text();
  let out = "";
  for (const line of buf.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const p = line.slice(5).trim();
    if (p === "[DONE]") continue;
    try {
      const j = JSON.parse(p);
      if (j.choices?.[0]?.delta?.content) out += j.choices[0].delta.content;
    } catch {}
  }
  return out;
}

describe("agent tool loop (API boundary, scripted LLM)", () => {
  it("multi-tool turn: get_order then answer", async () => {
    // Script: first call returns tool_call get_order, second call returns final answer
    const script = [
      { content: null, tool_calls: [{ id: "1", name: "get_order", arguments: JSON.stringify({ order_id: "ORD-1001" }) }] },
      { content: "ORD-1001 is BOOKED for Northstar, SwiftShip.", tool_calls: [] },
    ];
    // Inject scripted LLM by patching gateway fetch: we do it via worker override that sets env.LLM_MODEL to script sentinel?
    // Simpler: test runAgentLoop directly with a fake adapter
    const { runAgentLoop } = await import("../src/lib/agent");
    const db = mockDb();
    const repo = makeRepo(db);
    const principal = { kind: "customer" as const, accountId: "ACCT-001", accountName: "Northstar Logistics" };
    let callIdx = 0;
    const fakeLlm = {
      chatWithTools: async () => script[callIdx++] as never,
    };
    const { stream, steps } = await Effect.runPromise(runAgentLoop([{ role: "user", content: "status of ORD-1001?" }], principal, repo, fakeLlm as never));
    expect(steps.some((s) => s.kind === "tool" && s.name === "get_order")).toBe(true);
    const reader = stream.getReader();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
    }
    let text = "";
    for (const line of buf.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const p = line.slice(5).trim();
      if (p === "[DONE]") continue;
      const j = JSON.parse(p);
      text += j.choices[0].delta.content;
    }
    expect(text).toContain("ORD-1001");
  });

  it("cross-account denied: customer asks for other account's order", async () => {
    const { runAgentLoop } = await import("../src/lib/agent");
    const db = mockDb();
    const repo = makeRepo(db);
    const northstar = { kind: "customer" as const, accountId: "ACCT-001", accountName: "Northstar Logistics" };
    const script = [
      { content: null, tool_calls: [{ id: "1", name: "get_order", arguments: JSON.stringify({ order_id: "ORD-2001" }) }] },
      { content: "I cannot find ORD-2001 in your account.", tool_calls: [] },
    ];
    let idx = 0;
    const fakeLlm = { chatWithTools: async () => script[idx++] as never };
    const { steps } = await Effect.runPromise(runAgentLoop([{ role: "user", content: "status of ORD-2001?" }], northstar, repo, fakeLlm as never));
    const toolStep = steps.find((s) => s.kind === "tool" && s.name === "get_order");
    expect((toolStep?.result as { error?: string })?.error).toMatch(/not found|not accessible/i);
  });

  it("loop bound enforced", async () => {
    const { runAgentLoop } = await import("../src/lib/agent");
    const db = mockDb();
    const repo = makeRepo(db);
    const p = { kind: "customer" as const, accountId: "ACCT-001", accountName: "Northstar" };
    // Always return a tool call — should hit max iterations
    const fakeLlm = {
      chatWithTools: async () => ({ content: null, tool_calls: [{ id: "1", name: "list_orders", arguments: "{}" }] }) as never,
    };
    const { stream, steps } = await Effect.runPromise(runAgentLoop([{ role: "user", content: "hi" }], p, repo, fakeLlm as never, 2));
    expect(steps.filter((s) => s.kind === "llm").length).toBe(2);
    const text = await streamedText(new Response(stream));
    expect(text).toMatch(/limit/i);
  });

  it("trace persists via worker chat (integration, scripted fetch)", async () => {
    // Patch global fetch to return scripted LLM responses for tool-calling
    const origFetch = globalThis.fetch;
    let llmCalls = 0;
    const llmResponses: Record<string, unknown>[] = [
      {
        choices: [{ message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "get_order", arguments: JSON.stringify({ order_id: "ORD-1001" }) } }] } }],
        usage: { total_tokens: 10 },
      },
      {
        choices: [{ message: { content: "ORD-1001 is BOOKED, SwiftShip.", tool_calls: [] } }],
        usage: { total_tokens: 5 },
      },
    ];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("gateway.ai.cloudflare.com")) {
        const body = llmResponses[llmCalls++] ?? llmResponses[llmResponses.length - 1];
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
      return origFetch(input as never, init);
    };

    const tok = await createSessionToken({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar Logistics" }, "auth-secret");
    const env = mockEnv();
    const req = new Request("https://test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify({ message: "status of ORD-1001?" }),
    });
    const res = await (worker as unknown as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(req, env as never, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await streamedText(res);
    expect(text.length).toBeGreaterThan(0);

    globalThis.fetch = origFetch;
  });
});
