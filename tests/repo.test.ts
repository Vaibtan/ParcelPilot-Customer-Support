import { describe, it, expect, beforeAll } from "vitest";
import { makeRepo } from "../src/lib/repo";
import type { Principal } from "../src/lib/auth";

// In-memory D1 mock via Map
function makeMockDb() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    accounts: new Map(),
    orders: new Map(),
    tickets: new Map(),
  };
  // Seed from workbook data directly (no file read in test — hard-coded seed derived from xlsx)
  const accounts = [
    { account_id: "ACCT-001", account_name: "Northstar Logistics", plan: "Enterprise", status: "active", csm: "Priya Mehta", contract_file: "05_Northstar_Logistics_Enterprise_Agreement.pdf", premium_support: 1, notes: "x" },
    { account_id: "ACCT-002", account_name: "LumenWorks", plan: "Growth", status: "active", csm: "Arjun Rao", contract_file: "06_LumenWorks_Service_Agreement.pdf", premium_support: 0, notes: "x" },
    { account_id: "ACCT-003", account_name: "Beacon Retail", plan: "Standard", status: "active", csm: "Neha Kapoor", contract_file: null, premium_support: 0, notes: "x" },
    { account_id: "ACCT-004", account_name: "Axis Labs", plan: "Enterprise", status: "active", csm: "Priya Mehta", contract_file: null, premium_support: 0, notes: "x" },
  ];
  const orders = [
    { order_id: "ORD-1001", account_id: "ACCT-001", carrier: "SwiftShip", status: "BOOKED", booked_at: "2026-08-16 09:00", pickup_window_start: "2026-08-16 10:30", pickup_window_end: "2026-08-16 11:30", pickup_actual_at: null, shipment_fee_inr: 4200, carrier_fault: 0, customer_fault: 0, cancellation_requested_at: "2026-08-16 11:00", notes: "" },
    { order_id: "ORD-2001", account_id: "ACCT-002", carrier: "SwiftShip", status: "BOOKED", booked_at: "2026-08-16 09:00", pickup_window_start: "2026-08-16 11:00", pickup_window_end: "2026-08-16 12:00", pickup_actual_at: null, shipment_fee_inr: 1800, carrier_fault: 0, customer_fault: 0, cancellation_requested_at: "2026-08-16 10:15", notes: "" },
    { order_id: "ORD-4001", account_id: "ACCT-004", carrier: "SwiftShip", status: "DELIVERED", booked_at: "2026-08-14 14:00", pickup_window_start: "2026-08-15 09:00", pickup_window_end: "2026-08-15 10:00", pickup_actual_at: "2026-08-15 09:20", shipment_fee_inr: 3600, carrier_fault: 0, customer_fault: 0, cancellation_requested_at: null, notes: "" },
  ];
  const tickets = [
    { ticket_id: "TKT-501", account_id: "ACCT-001", created_at: "2026-08-16 10:30", status: "open", subject: "x", description: "x", channel: "email", assigned_to: "Rohit", last_customer_message_at: "2026-08-16 10:52", historical_resolution: null },
    { ticket_id: "TKT-450", account_id: "ACCT-001", created_at: "2026-07-12 14:10", status: "closed", subject: "x", description: "x", channel: "email", assigned_to: "Maya", last_customer_message_at: "2026-07-12 15:00", historical_resolution: "Agent told customer a INR 250 cancellation fee applied after 30 minutes." },
    { ticket_id: "TKT-451", account_id: "ACCT-002", created_at: "2026-08-11 11:20", status: "closed", subject: "x", description: "x", channel: "chat", assigned_to: "Rohit", last_customer_message_at: "2026-08-11 12:10", historical_resolution: "Agent told customer Growth plan only supports 3,000 rows." },
  ];
  for (const a of accounts) tables.accounts.set(a.account_id, a as unknown as Record<string, unknown>);
  for (const o of orders) tables.orders.set(o.order_id, o as unknown as Record<string, unknown>);
  for (const t of tickets) tables.tickets.set(t.ticket_id, t as unknown as Record<string, unknown>);

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
    return [];
  }

  const db = {
    prepare: (sql: string) => {
      let params: unknown[] = [];
      return {
        bind: (...a: unknown[]) => {
          params = a;
          return {
            first: async () => allFor(sql, params)[0] ?? null,
            all: async () => ({ results: allFor(sql, params) }),
            run: async () => ({}),
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

const northstar: Principal = { kind: "customer", accountId: "ACCT-001", accountName: "Northstar Logistics" };
const lumen: Principal = { kind: "customer", accountId: "ACCT-002", accountName: "LumenWorks" };
const staff: Principal = { kind: "staff", role: "staff" };

describe("scoped repositories", () => {
  const db = makeMockDb();
  const repo = makeRepo(db);

  it("customer can read own order", async () => {
    expect(await repo.getOrder(northstar, "ORD-1001")).not.toBeNull();
  });
  it("customer cannot read other account order", async () => {
    expect(await repo.getOrder(northstar, "ORD-2001")).toBeNull();
    expect(await repo.getOrder(lumen, "ORD-1001")).toBeNull();
  });
  it("staff can read any order", async () => {
    expect(await repo.getOrder(staff, "ORD-1001")).not.toBeNull();
    expect(await repo.getOrder(staff, "ORD-2001")).not.toBeNull();
  });
  it("customer listOrders only own", async () => {
    const rows = await repo.listOrders(northstar);
    expect(rows.every((r) => r.account_id === "ACCT-001")).toBe(true);
    expect(rows.length).toBe(1);
  });
  it("customer cannot list other account via accountId param", async () => {
    expect(await repo.listOrders(northstar, "ACCT-002")).toEqual([]);
  });
  it("staff listOrders all", async () => {
    const rows = await repo.listOrders(staff);
    expect(rows.length).toBe(3);
  });
  it("customer cannot read other ticket", async () => {
    expect(await repo.getTicket(lumen, "TKT-501")).toBeNull();
  });
  it("historical tickets flagged context_only", async () => {
    const t = await repo.getTicket(northstar, "TKT-450");
    expect(t?.context_only).toBe(true);
    const open = await repo.getTicket(northstar, "TKT-501");
    expect(open?.context_only).toBe(false);
  });
  it("accounts scoped: customer sees only own", async () => {
    expect((await repo.listAccounts(northstar)).map((a) => a.account_id)).toEqual(["ACCT-001"]);
    expect((await repo.listAccounts(staff)).length).toBe(4);
    expect(await repo.getAccount(northstar, "ACCT-002")).toBeNull();
    expect(await repo.getAccount(staff, "ACCT-002")).not.toBeNull();
  });
  it("snapshot clock defaults", async () => {
    const { Clock, ClockLive } = await import("../src/lib/clock");
    const { Effect } = await import("effect");
    const prog = Effect.flatMap(Clock, (c) => Effect.sync(() => c.now().toISOString()));
    const iso = await Effect.runPromise(Effect.provide(prog, ClockLive));
    expect(iso).toContain("2026-08-16");
  });
});
