import { describe, it, expect } from "vitest";
import worker from "../src/worker/index";
import { createSessionToken } from "../src/lib/auth";

function mockDb() {
  return {
    prepare: (sql: string) => {
      let params: unknown[] = [];
      const isTraces = sql.includes("FROM conversations") || sql.includes("FROM runs") || sql.includes("FROM steps") || sql.includes("FROM messages");
      return {
        bind: (...a: unknown[]) => { params = a; return { all: async () => ({ results: [] }), first: async () => ({ id: "r1", status: "ok", total_tokens: 10, total_latency_ms: 100, created_at: "2026-08-16T10:00:00Z", principal_json: "{}", conversation_id: "c1" }), run: async () => ({}) }; },
        all: async () => ({ results: [{ id: "c1", principal_json: "{}", updated_at: "2026-08-16T10:00:00Z" }] }),
        first: async () => ({ id: "r1", status: "ok", total_tokens: 10, total_latency_ms: 100, created_at: "2026-08-16T10:00:00Z", principal_json: "{}", conversation_id: "c1" }),
        run: async () => ({}),
      };
    },
  } as unknown as Parameters<(typeof worker)["fetch"]>[1];
}

function mockEnv(db: unknown) {
  return {
    DB: db, VECTORIZE: { query: async () => ({ matches: [] }) },
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    CF_ACCOUNT_ID: "t", CF_AI_GATEWAY_NAME: "g", CF_AI_GATEWAY_AUTH_API_TOKEN: "t",
    SESSION_SECRET: "secret", LLM_MODEL: "m", EMBEDDING_MODEL: "e",
  };
}

async function call(req: Request, env: unknown) {
  return (worker as unknown as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(req, env as never, {});
}

describe("trace viewer", () => {
  it("staff can list traces", async () => {
    const tok = await createSessionToken({ kind: "staff", role: "staff" }, "secret");
    const res = await call(new Request("https://test/api/traces", { headers: { authorization: `Bearer ${tok}` } }), mockEnv(mockDb()));
    expect(res.status).toBe(200);
    const j = await res.json() as { conversations: unknown[]; runs: unknown[] };
    expect(j.conversations).toBeDefined();
  });
  it("customer cannot list traces (403)", async () => {
    const tok = await createSessionToken({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar" }, "secret");
    const res = await call(new Request("https://test/api/traces", { headers: { authorization: `Bearer ${tok}` } }), mockEnv(mockDb()));
    expect(res.status).toBe(403);
  });
  it("unauth cannot list traces (401)", async () => {
    const res = await call(new Request("https://test/api/traces"), mockEnv(mockDb()));
    expect(res.status).toBe(401);
  });
  it("staff can get run detail", async () => {
    const tok = await createSessionToken({ kind: "staff", role: "staff" }, "secret");
    const res = await call(new Request("https://test/api/traces/r1", { headers: { authorization: `Bearer ${tok}` } }), mockEnv(mockDb()));
    expect(res.status).toBe(200);
  });
  it("customer cannot get run detail", async () => {
    const tok = await createSessionToken({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar" }, "secret");
    const res = await call(new Request("https://test/api/traces/r1", { headers: { authorization: `Bearer ${tok}` } }), mockEnv(mockDb()));
    expect(res.status).toBe(403);
  });
});
