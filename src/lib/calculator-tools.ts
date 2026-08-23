import type { Principal } from "./auth";
import { makeRepo, type Repo } from "./repo";
import { quoteCancellation, quoteCredit, computeSla } from "./policy-engine";
import type { ToolDef } from "./tools";

export function calculatorTools(repo: Repo): ToolDef[] {
  return [
    {
      name: "quote_cancellation",
      description: "Compute cancellation eligibility and fee for an order. Returns canCancel, fee, and rule trace. Use for 'can I cancel ORD-xxx?'",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "Order ID" },
        },
        required: ["order_id"],
      },
      execute: async (args, { principal }) => {
        const orderId = String(args.order_id);
        const order = await repo.getOrder(principal, orderId);
        if (!order) return { error: "Order not found or not accessible", order_id: orderId };
        const accountId = order.account_id;
        const res = quoteCancellation({ accountId, order: { status: order.status, booked_at: order.booked_at, cancellation_requested_at: order.cancellation_requested_at } });
        return { order_id: orderId, account_id: accountId, ...res };
      },
    },
    {
      name: "quote_credit",
      description: "Compute failed-pickup service credit eligibility and amount. Requires carrier_fault and pickup timing. Returns eligibility, credit amount, and trace.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "Order ID" },
        },
        required: ["order_id"],
      },
      execute: async (args, { principal }) => {
        const orderId = String(args.order_id);
        const order = await repo.getOrder(principal, orderId);
        if (!order) return { error: "Order not found or not accessible", order_id: orderId };
        const nowIso = "2026-08-16T11:00:00+05:30";
        const res = quoteCredit({
          accountId: order.account_id,
          order: { pickup_window_end: order.pickup_window_end, carrier_fault: !!order.carrier_fault, customer_fault: !!order.customer_fault, shipment_fee_inr: order.shipment_fee_inr },
          nowIso,
        });
        return { order_id: orderId, account_id: order.account_id, ...res };
      },
    },
    {
      name: "check_sla",
      description: "Compute SLA status for a ticket. Requires severity (P1/P2/P3). Returns target, deadline, breached, and trace.",
      parameters: {
        type: "object",
        properties: {
          ticket_id: { type: "string", description: "Ticket ID" },
          severity: { type: "string", enum: ["P1", "P2", "P3"], description: "Severity P1/P2/P3" },
        },
        required: ["ticket_id", "severity"],
      },
      execute: async (args, { principal }) => {
        const ticket = await repo.getTicket(principal, String(args.ticket_id));
        if (!ticket) return { error: "Ticket not found or not accessible", ticket_id: String(args.ticket_id) };
        const severity = String(args.severity) as "P1" | "P2" | "P3";
        // Look up account plan
        const acct = await repo.getAccount(principal, ticket.account_id);
        const plan = acct?.plan ?? "Standard";
        const nowIso = "2026-08-16 11:00";
        const res = computeSla({ accountId: ticket.account_id, plan, severity, createdAt: ticket.created_at ?? nowIso, nowIso });
        return { ticket_id: ticket.ticket_id, account_id: ticket.account_id, plan, severity, ...res };
      },
    },
  ];
}
