import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken, ACCOUNTS } from "../src/lib/auth";

// Helper to call worker fetch without full Wrangler env — we test auth lib + route logic via direct worker import
// For route tests, we invoke the Worker's fetch via a minimal Hono app built from the same module.
// Simpler: test the token primitives + simulate middleware expectations.

describe("auth token", () => {
  const secret = "test-secret-xyz";

  it("round-trips customer principal", async () => {
    const p = { kind: "customer" as const, accountId: "ACCT-001", accountName: "Northstar Logistics" };
    const tok = await createSessionToken(p, secret);
    const out = await verifySessionToken(tok, secret);
    expect(out).toEqual(p);
  });

  it("round-trips staff principal", async () => {
    const p = { kind: "staff" as const, role: "staff" };
    const tok = await createSessionToken(p, secret);
    expect(await verifySessionToken(tok, secret)).toEqual(p);
  });

  it("rejects tampered payload", async () => {
    const p = { kind: "customer" as const, accountId: "ACCT-001", accountName: "Northstar" };
    const tok = await createSessionToken(p, secret);
    const [payload, sig] = tok.split(".");
    // flip last char of payload
    const tampered = payload.slice(0, -1) + (payload.slice(-1) === "A" ? "B" : "A");
    expect(await verifySessionToken(`${tampered}.${sig}`, secret)).toBeNull();
  });

  it("rejects tampered signature", async () => {
    const p = { kind: "customer" as const, accountId: "ACCT-001", accountName: "Northstar" };
    const tok = await createSessionToken(p, secret);
    const [payload] = tok.split(".");
    expect(await verifySessionToken(`${payload}.invalidsig`, secret)).toBeNull();
  });

  it("rejects wrong secret", async () => {
    const p = { kind: "customer" as const, accountId: "ACCT-001", accountName: "Northstar" };
    const tok = await createSessionToken(p, secret);
    expect(await verifySessionToken(tok, "other-secret")).toBeNull();
  });

  it("accounts list has 4 entries", () => {
    expect(ACCOUNTS).toHaveLength(4);
  });
});

// API-boundary tests: exercise the Worker fetch handler with auth gates.
// We need a minimal Env; D1/Vectorize are not used for auth routes.
import worker from "../src/worker/index";

function mockEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DB: { prepare: () => ({ first: async () => ({ v: 1 }) }) },
    VECTORIZE: {},
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    CF_ACCOUNT_ID: "test",
    CF_AI_GATEWAY_NAME: "test-gw",
    CF_AI_GATEWAY_AUTH_API_TOKEN: "test-token",
    SESSION_SECRET: "auth-test-secret",
    LLM_MODEL: "gpt-4o-mini",
    EMBEDDING_MODEL: "text-embedding-3-small",
    ...overrides,
  };
}

async function callWorker(req: Request, envOverrides: Record<string, unknown> = {}) {
  const env = mockEnv(envOverrides) as never;
  return (worker as unknown as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(req, env, {});
}

describe("auth routes", () => {
  it("chat without session is 401", async () => {
    const res = await callWorker(new Request("https://test/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) }));
    expect(res.status).toBe(401);
    const j = await res.json() as { error: string };
    expect(j.error).toMatch(/Authentication required/);
  });

  it("chat with valid customer session is not 401 (may be 400/502 but not auth)", async () => {
    const { createSessionToken: cst } = await import("../src/lib/auth");
    const tok = await cst({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar Logistics" }, "auth-test-secret");
    // Send invalid body to avoid LLM call; 400 is expected, but not 401
    const res = await callWorker(new Request("https://test/api/chat", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({}) }));
    expect(res.status).not.toBe(401);
  });

  it("chat with tampered token is 401", async () => {
    const { createSessionToken: cst } = await import("../src/lib/auth");
    const tok = await cst({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar Logistics" }, "auth-test-secret");
    const tampered = tok.slice(0, -2) + "xx";
    const res = await callWorker(new Request("https://test/api/chat", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tampered}` }, body: JSON.stringify({ message: "hi" }) }));
    expect(res.status).toBe(401);
  });

  it("valid staff session not rejected by auth", async () => {
    const { createSessionToken: cst } = await import("../src/lib/auth");
    const tok = await cst({ kind: "staff", role: "staff" }, "auth-test-secret");
    const res = await callWorker(new Request("https://test/api/chat", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({}) }));
    expect(res.status).not.toBe(401);
  });

  it("login rejects unknown account", async () => {
    const res = await callWorker(new Request("https://test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: "ACCT-999" }) }));
    expect(res.status).toBe(400);
  });

  it("auth/me rejects without token 401", async () => {
    const res = await callWorker(new Request("https://test/api/auth/me"));
    expect(res.status).toBe(401);
  });
});
