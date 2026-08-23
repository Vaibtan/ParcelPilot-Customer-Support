import type { Principal } from "./auth";

export type Account = {
  account_id: string;
  account_name: string;
  plan: string;
  status: string;
  csm: string | null;
  contract_file: string | null;
  premium_support: number;
  notes: string | null;
};
export type Order = {
  order_id: string;
  account_id: string;
  carrier: string | null;
  status: string;
  booked_at: string | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  pickup_actual_at: string | null;
  shipment_fee_inr: number | null;
  carrier_fault: number;
  customer_fault: number;
  cancellation_requested_at: string | null;
  notes: string | null;
};
export type Ticket = {
  ticket_id: string;
  account_id: string;
  created_at: string | null;
  status: string;
  subject: string | null;
  description: string | null;
  channel: string | null;
  assigned_to: string | null;
  last_customer_message_at: string | null;
  historical_resolution: string | null;
  // computed flag for API
  context_only?: boolean;
};

type D1 = {
  prepare: (sql: string) => {
    bind: (...a: unknown[]) => { first: () => Promise<unknown>; all: () => Promise<{ results: unknown[] }>; run: () => Promise<unknown> };
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<unknown>;
  };
};

function isStaff(p: Principal): boolean {
  return p.kind === "staff";
}
function accountFilter(p: Principal): string | null {
  return p.kind === "customer" ? p.accountId : null;
}

export function makeRepo(db: D1) {
  return {
    // Accounts
    async getAccount(p: Principal, accountId: string): Promise<Account | null> {
      const filter = accountFilter(p);
      if (filter && filter !== accountId) return null;
      const row = (await db.prepare("SELECT * FROM accounts WHERE account_id = ?").bind(accountId).first()) as Account | null;
      if (!row) return null;
      if (filter && row.account_id !== filter) return null;
      return row;
    },
    async listAccounts(p: Principal): Promise<Account[]> {
      if (isStaff(p)) {
        const r = await db.prepare("SELECT * FROM accounts ORDER BY account_id").all();
        return r.results as Account[];
      }
      const filter = accountFilter(p)!;
      const r = await db.prepare("SELECT * FROM accounts WHERE account_id = ?").bind(filter).all();
      return r.results as Account[];
    },
    async getOwnAccount(p: Principal): Promise<Account | null> {
      if (p.kind !== "customer") return null;
      return (await db.prepare("SELECT * FROM accounts WHERE account_id = ?").bind(p.accountId).first()) as Account | null;
    },

    // Orders
    async getOrder(p: Principal, orderId: string): Promise<Order | null> {
      const row = (await db.prepare("SELECT * FROM orders WHERE order_id = ?").bind(orderId).first()) as Order | null;
      if (!row) return null;
      if (!isStaff(p) && row.account_id !== (p as Extract<Principal, { kind: "customer" }>).accountId) return null;
      return row;
    },
    async listOrders(p: Principal, accountId?: string): Promise<Order[]> {
      if (isStaff(p)) {
        if (accountId) {
          const r = await db.prepare("SELECT * FROM orders WHERE account_id = ? ORDER BY order_id").bind(accountId).all();
          return r.results as Order[];
        }
        const r = await db.prepare("SELECT * FROM orders ORDER BY order_id").all();
        return r.results as Order[];
      }
      const own = (p as Extract<Principal, { kind: "customer" }>).accountId;
      if (accountId && accountId !== own) return [];
      const r = await db.prepare("SELECT * FROM orders WHERE account_id = ? ORDER BY order_id").bind(own).all();
      return r.results as Order[];
    },

    // Tickets
    async getTicket(p: Principal, ticketId: string): Promise<(Ticket & { context_only: boolean }) | null> {
      const row = (await db.prepare("SELECT * FROM tickets WHERE ticket_id = ?").bind(ticketId).first()) as Ticket | null;
      if (!row) return null;
      if (!isStaff(p) && row.account_id !== (p as Extract<Principal, { kind: "customer" }>).accountId) return null;
      const contextOnly = row.status === "closed" && !!row.historical_resolution;
      return { ...row, context_only: contextOnly } as Ticket & { context_only: boolean };
    },
    async listTickets(p: Principal, accountId?: string): Promise<(Ticket & { context_only: boolean })[]> {
      let rows: Ticket[];
      if (isStaff(p)) {
        if (accountId) {
          const r = await db.prepare("SELECT * FROM tickets WHERE account_id = ? ORDER BY ticket_id").bind(accountId).all();
          rows = r.results as Ticket[];
        } else {
          const r = await db.prepare("SELECT * FROM tickets ORDER BY ticket_id").all();
          rows = r.results as Ticket[];
        }
      } else {
        const own = (p as Extract<Principal, { kind: "customer" }>).accountId;
        if (accountId && accountId !== own) return [];
        const r = await db.prepare("SELECT * FROM tickets WHERE account_id = ? ORDER BY ticket_id").bind(own).all();
        rows = r.results as Ticket[];
      }
      return rows.map((t) => ({ ...t, context_only: t.status === "closed" && !!t.historical_resolution })) as (Ticket & { context_only: boolean })[];
    },
  };
}

export type Repo = ReturnType<typeof makeRepo>;
