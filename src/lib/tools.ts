import type { Principal } from "./auth";
import type { Repo } from "./repo";
import { calculatorTools } from "./calculator-tools";

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  staffOnly?: boolean;
  execute: (args: Record<string, unknown>, ctx: { principal: Principal; repo: Repo }) => Promise<unknown>;
};

let docToolProvider: (() => ToolDef | null) | null = null;
export function setDocToolProvider(fn: () => ToolDef | null) { docToolProvider = fn; }
let actionToolProvider: (() => ToolDef[]) | null = null;
export function setActionToolProvider(fn: () => ToolDef[]) { actionToolProvider = fn; }

function accountTools(repo: Repo): ToolDef[] {
  return [
    { name: "get_account", description: "Get account profile/entitlements for an account. For customers, only own account is accessible.", parameters: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"] }, execute: async (args, { principal }) => { const id = String(args.account_id); const acc = await repo.getAccount(principal, id); if (!acc) return { error: "Account not found or not accessible", account_id: id }; return acc; } },
    { name: "list_accounts", description: "List accessible accounts.", parameters: { type: "object", properties: {}, required: [] }, execute: async (_args, { principal }) => repo.listAccounts(principal) },
  ];
}
function orderTools(repo: Repo): ToolDef[] {
  return [
    { name: "get_order", description: "Get a single order by ID.", parameters: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] }, execute: async (args, { principal }) => { const row = await repo.getOrder(principal, String(args.order_id)); if (!row) return { error: "Order not found or not accessible", order_id: String(args.order_id) }; return row; } },
    { name: "list_orders", description: "List accessible orders, optionally filtered by account_id.", parameters: { type: "object", properties: { account_id: { type: "string" } }, required: [] }, execute: async (args, { principal }) => repo.listOrders(principal, args.account_id ? String(args.account_id) : undefined) },
  ];
}
function ticketTools(repo: Repo): ToolDef[] {
  return [
    { name: "get_ticket", description: "Get a single ticket by ID. Historical tickets marked context_only.", parameters: { type: "object", properties: { ticket_id: { type: "string" } }, required: ["ticket_id"] }, execute: async (args, { principal }) => { const row = await repo.getTicket(principal, String(args.ticket_id)); if (!row) return { error: "Ticket not found or not accessible", ticket_id: String(args.ticket_id) }; return row; } },
    { name: "list_tickets", description: "List accessible tickets, optionally filtered by account_id.", parameters: { type: "object", properties: { account_id: { type: "string" } }, required: [] }, execute: async (args, { principal }) => repo.listTickets(principal, args.account_id ? String(args.account_id) : undefined) },
  ];
}
export function getToolRegistry(repo: Repo, principal: Principal): ToolDef[] {
  const base = [...accountTools(repo), ...orderTools(repo), ...ticketTools(repo), ...calculatorTools(repo)];
  if (docToolProvider) { const t = docToolProvider(); if (t) base.push(t); }
  if (actionToolProvider) base.push(...actionToolProvider());
  return base.filter((t) => !t.staffOnly || principal.kind === "staff");
}
export function toOpenAITools(tools: ToolDef[]) {
  return tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}
export async function executeTool(name: string, args: Record<string, unknown>, ctx: { principal: Principal; repo: Repo }, registry: ToolDef[]): Promise<unknown> {
  const tool = registry.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  return tool.execute(args, ctx);
}
