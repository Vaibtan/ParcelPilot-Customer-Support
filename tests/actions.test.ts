import { describe, it, expect } from "vitest";
import worker from "../src/worker/index";
import { createSessionToken } from "../src/lib/auth";

function mockEnv(db: ReturnType<typeof makeMockDb>) {
  return {
    DB: db,
    VECTORIZE: { query: async () => ({ matches: [] }) },
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    CF_ACCOUNT_ID: "test",
    CF_AI_GATEWAY_NAME: "gw",
    CF_AI_GATEWAY_AUTH_API_TOKEN: "t",
    SESSION_SECRET: "secret",
    LLM_MODEL: "gpt-4o-mini",
    EMBEDDING_MODEL: "text-embedding-3-small",
  };
}

function makeMockDb() {
  const pending = new Map<string, Record<string, unknown>>();
  const log: Record<string, unknown>[] = [];
  const tickets = new Map<string, Record<string, unknown>>([
    ["TKT-501", { ticket_id: "TKT-501", account_id: "ACCT-001", status: "open" }],
  ]);
  return {
    _pending: pending,
    _log: log,
    prepare: (sql: string) => {
      let params: unknown[] = [];
      return {
        bind: (...a: unknown[]) => {
          params = a;
          return {
            first: async () => {
              if (sql.includes("FROM pending_actions WHERE nonce")) return pending.get(String(params[0])) ?? null;
              if (sql.includes("FROM conversations")) return null;
              if (sql.includes("FROM doc_chunks")) return null;
              return null;
            },
            all: async () => {
              if (sql.includes("FROM action_log")) return { results: log };
              if (sql.includes("FROM doc_chunks")) return { results: [] };
              return { results: [] };
            },
            run: async () => {
              if (sql.includes("INSERT INTO pending_actions")) {
                pending.set(String(params[0]), { nonce: String(params[0]), type: String(params[1]), payload_json: String(params[2]), summary: String(params[3]), principal_json: String(params[4]), conversation_id: params[5], expires_at: String(params[6]) });
              } else if (sql.includes("INSERT INTO action_log")) {
                log.push({ id: String(params[0]), type: String(params[1]), payload_json: String(params[2]), principal_json: String(params[3]), nonce: String(params[4]) });
              } else if (sql.includes("DELETE FROM pending_actions")) {
                pending.delete(String(params[0]));
              } else if (sql.includes("UPDATE tickets")) {
                const t = tickets.get(String(params[1]));
                if (t) t.status = String(params[0]);
              }
              return {};
            },
          };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({}),
      };
    },
  } as unknown as { prepare: (s: string) => { bind: (...a: unknown[]) => { first: () => Promise<unknown>; all: () => Promise<{ results: unknown[] }>; run: () => Promise<unknown> }; first: () => Promise<unknown>; all: () => Promise<{ results: unknown[] }>; run: () => Promise<unknown> } } & { _pending: Map<string, Record<string, unknown>>; _log: Record<string, unknown>[] };
}

async function callWorker(req: Request, env: Record<string, unknown>) {
  return (worker as unknown as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(req, env as never, {});
}

describe("confirmation-gated actions", () => {
  it("prepare → confirm executes once; second confirm rejected", async () => {
    const db = makeMockDb();
    const env = mockEnv(db);
    const origFetch = globalThis.fetch;
    // Scripted LLM: returns prepare_escalation tool call, then final answer
    const llmResponses: unknown[] = [
      { choices: [{ message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "prepare_escalation", arguments: JSON.stringify({ ticket_id: "TKT-501", reason: "Need help", priority: "P1" }) } }] } }] },
      { choices: [{ message: { content: "Escalation prepared, please confirm.", tool_calls: [] } }] },
    ];
    let idx = 0;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes("gateway.ai.cloudflare.com")) {
        return new Response(JSON.stringify(llmResponses[idx++] ?? llmResponses[llmResponses.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return origFetch(input as never, init);
    };

    const tok = await createSessionToken({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar" }, "secret");
    const chatRes = await callWorker(new Request("https://test/api/chat", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ message: "please escalate TKT-501" }) }), env);
    expect(chatRes.status).toBe(200);
    const body = await chatRes.text();
    // Extract nonce from tool_call event
    const m = body.match(/"nonce":"([^"]+)"/);
    expect(m).toBeTruthy();
    const nonce = m![1];

    // Confirm
    const c1 = await callWorker(new Request("https://test/api/actions/confirm", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ nonce }) }), env);
    expect(c1.status).toBe(200);
    // Replay should fail
    const c2 = await callWorker(new Request("https://test/api/actions/confirm", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ nonce }) }), env);
    expect(c2.status).toBe(400);
    expect(db._log.length).toBe(1);

    globalThis.fetch = origFetch;
  });

  it("prepare → decline leaves no log", async () => {
    const db = makeMockDb();
    const env = mockEnv(db);
    const origFetch = globalThis.fetch;
    const llmResponses: unknown[] = [
      { choices: [{ message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "prepare_escalation", arguments: JSON.stringify({ ticket_id: "TKT-501", reason: "test" }) } }] } }] },
      { choices: [{ message: { content: "prepared", tool_calls: [] } }] },
    ];
    let idx = 0;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      if (String(input).includes("gateway.ai.cloudflare.com")) return new Response(JSON.stringify(llmResponses[idx++] ?? llmResponses[llmResponses.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
      return origFetch(input as never);
    };
    const tok = await createSessionToken({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar" }, "secret");
    const chatRes = await callWorker(new Request("https://test/api/chat", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ message: "escalate" }) }), env);
    const body = await chatRes.text();
    const nonce = body.match(/"nonce":"([^"]+)"/)![1];
    const d = await callWorker(new Request("https://test/api/actions/decline", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ nonce }) }), env);
    expect(d.status).toBe(200);
    expect(db._log.length).toBe(0);
    // Confirm after decline should fail
    const c = await callWorker(new Request("https://test/api/actions/confirm", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ nonce }) }), env);
    expect(c.status).toBe(400);
    globalThis.fetch = origFetch;
  });

  it("cross-principal confirm rejected", async () => {
    const db = makeMockDb();
    const env = mockEnv(db);
    const origFetch = globalThis.fetch;
    const llmResponses: unknown[] = [
      { choices: [{ message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "prepare_escalation", arguments: JSON.stringify({ ticket_id: "TKT-501", reason: "x" }) } }] } }] },
      { choices: [{ message: { content: "prepared", tool_calls: [] } }] },
    ];
    let idx = 0;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      if (String(input).includes("gateway.ai.cloudflare.com")) return new Response(JSON.stringify(llmResponses[idx++] ?? llmResponses[llmResponses.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
      return origFetch(input as never);
    };
    const tok1 = await createSessionToken({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar" }, "secret");
    const chatRes = await callWorker(new Request("https://test/api/chat", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok1}` }, body: JSON.stringify({ message: "escalate" }) }), env);
    const nonce = (await chatRes.text()).match(/"nonce":"([^"]+)"/)![1];
    const tok2 = await createSessionToken({ kind: "customer", accountId: "ACCT-002", accountName: "LumenWorks" }, "secret");
    const c = await callWorker(new Request("https://test/api/actions/confirm", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok2}` }, body: JSON.stringify({ nonce }) }), env);
    expect(c.status).toBe(400);
    globalThis.fetch = origFetch;
  });

  it("expired nonce rejected", async () => {
    const db = makeMockDb();
    const env = mockEnv(db);
    // Directly insert expired pending action
    const nonce = "expired-nonce";
    db._pending.set(nonce, { nonce, type: "escalation", payload_json: "{}", summary: "test", principal_json: JSON.stringify({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar" }), conversation_id: null, expires_at: new Date(Date.now() - 60000).toISOString() });
    const tok = await createSessionToken({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar" }, "secret");
    const c = await callWorker(new Request("https://test/api/actions/confirm", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ nonce }) }), env);
    expect(c.status).toBe(400);
    const j = await c.json() as { error: string };
    expect(j.error).toMatch(/expired/i);
  });
});
