import { describe, it, expect } from "vitest";
import { allInsights } from "../src/lib/detectors";
import worker from "../src/worker/index";
import { createSessionToken } from "../src/lib/auth";

const accounts = [
  { account_id: "ACCT-001", plan: "Enterprise" },
  { account_id: "ACCT-002", plan: "Growth" },
  { account_id: "ACCT-003", plan: "Standard" },
  { account_id: "ACCT-004", plan: "Enterprise" },
];
const tickets = [
  { ticket_id: "TKT-501", account_id: "ACCT-001", created_at: "2026-08-16 10:30", status: "open", subject: "All shipment creation is failing", description: "Every user gets 500", channel: "email" },
  { ticket_id: "TKT-505", account_id: "ACCT-004", created_at: "2026-08-16 08:30", status: "open", subject: "Possible API key exposure", description: "posted screenshot", channel: "email" },
  { ticket_id: "TKT-502", account_id: "ACCT-002", created_at: "2026-08-16 09:45", status: "open", subject: "Bulk upload fails for 4,200-row CSV", description: "CSV fails", channel: "chat" },
  { ticket_id: "TKT-504", account_id: "ACCT-001", created_at: "2026-08-16 10:50", status: "open", subject: "SwiftShip order still shows BOOKED after driver pickup", description: "Driver collected", channel: "chat" },
];
const orders = [
  { order_id: "ORD-1001", account_id: "ACCT-001", carrier: "SwiftShip", status: "BOOKED", pickup_window_end: "2026-08-16 11:30", carrier_fault: 0 },
  { order_id: "ORD-2002", account_id: "ACCT-002", carrier: "RoadRunner", status: "BOOKED", pickup_window_end: "2026-08-16 06:30", carrier_fault: 1 },
];

describe("detectors", () => {
  it("flags breached P1s", () => {
    const insights = allInsights(tickets as never, orders as never, accounts as never, "2026-08-16 11:00");
    const sla = insights.filter((i) => i.type === "sla_breach");
    expect(sla.some((i) => i.id.includes("TKT-501"))).toBe(true);
    expect(sla.some((i) => i.id.includes("TKT-505"))).toBe(true);
  });
  it("carrier unresolved RoadRunner", () => {
    const insights = allInsights(tickets as never, orders as never, accounts as never);
    expect(insights.some((i) => i.id.includes("roadrunner"))).toBe(true);
  });
  it("swiftship carrier pattern present", () => {
    const insights = allInsights(tickets as never, orders as never, accounts as never);
    expect(insights.some((i) => i.type === "carrier_pattern" && i.id.includes("swiftship"))).toBe(true);
  });
  it("insights API staff-only", async () => {
    function mockDb() {
      return {
        prepare: (sql: string) => {
          let params: unknown[] = [];
          return {
            bind: (...a: unknown[]) => { params = a; return { all: async () => ({ results: [] }), first: async () => null, run: async () => ({}) }; },
            all: async () => ({ results: [] }),
            first: async () => null,
            run: async () => ({}),
          };
        },
      } as unknown as never;
    }
    const mockEnv = (db: unknown) => ({
      DB: db, VECTORIZE: { query: async () => ({ matches: [] }) },
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
      CF_ACCOUNT_ID: "t", CF_AI_GATEWAY_NAME: "g", CF_AI_GATEWAY_AUTH_API_TOKEN: "t",
      SESSION_SECRET: "secret", LLM_MODEL: "m", EMBEDDING_MODEL: "e",
    });
    const call = (req: Request, env: unknown) => (worker as unknown as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(req, env as never, {});
    const custTok = await createSessionToken({ kind: "customer", accountId: "ACCT-001", accountName: "Northstar" }, "secret");
    const r = await call(new Request("https://test/api/insights", { headers: { authorization: `Bearer ${custTok}` } }), mockEnv(mockDb()));
    expect(r.status).toBe(403);
    const staffTok = await createSessionToken({ kind: "staff", role: "staff" }, "secret");
    const r2 = await call(new Request("https://test/api/insights", { headers: { authorization: `Bearer ${staffTok}` } }), mockEnv(mockDb()));
    expect(r2.status).toBe(200);
  });
});
