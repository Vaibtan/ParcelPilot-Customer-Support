import type { Principal } from "./auth";
import type { ToolDef } from "./tools";

type D1 = {
  prepare: (sql: string) => {
    bind: (...a: unknown[]) => { run: () => Promise<unknown>; first: () => Promise<unknown>; all: () => Promise<{ results: unknown[] }> };
    run: () => Promise<unknown>;
  };
};

function nowIso(): string { return new Date().toISOString(); }

export type PendingAction = {
  nonce: string;
  type: string;
  payload_json: string;
  summary: string;
  principal_json: string;
  conversation_id: string | null;
  expires_at: string;
  created_at: string;
};

export async function createPendingAction(
  db: D1,
  params: { type: string; payload: Record<string, unknown>; summary: string; principal: Principal; conversationId?: string; ttlMinutes?: number },
): Promise<{ nonce: string; summary: string; type: string; payload: Record<string, unknown>; expires_at: string }> {
  const nonce = crypto.randomUUID();
  const ttl = params.ttlMinutes ?? 30;
  const expires = new Date(Date.now() + ttl * 60000).toISOString();
  await db
    .prepare("INSERT INTO pending_actions (nonce, type, payload_json, summary, principal_json, conversation_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(nonce, params.type, JSON.stringify(params.payload), params.summary, JSON.stringify(params.principal), params.conversationId ?? null, expires)
    .run();
  return { nonce, summary: params.summary, type: params.type, payload: params.payload, expires_at: expires };
}

export async function confirmPendingAction(
  db: D1,
  nonce: string,
  confirmer: Principal,
): Promise<{ ok: boolean; error?: string }> {
  const row = (await db.prepare("SELECT * FROM pending_actions WHERE nonce = ?").bind(nonce).first()) as PendingAction | null;
  if (!row) return { ok: false, error: "Pending action not found or already processed" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare("DELETE FROM pending_actions WHERE nonce = ?").bind(nonce).run();
    return { ok: false, error: "Pending action expired" };
  }
  const owner = JSON.parse(row.principal_json) as Principal;
  // Principal must match (customer account must match, staff matches staff)
  if (owner.kind !== confirmer.kind) return { ok: false, error: "Principal mismatch" };
  if (owner.kind === "customer" && confirmer.kind === "customer" && owner.accountId !== confirmer.accountId) {
    return { ok: false, error: "Cannot confirm another account's action" };
  }
  // Execute: insert into action_log and apply side-effects for mocked actions
  await db.prepare("INSERT INTO action_log (id, type, payload_json, principal_json, nonce) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), row.type, row.payload_json, JSON.stringify(confirmer), nonce).run();
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  // Mocked side-effects: update ticket status if type is update_ticket
  if (row.type === "update_ticket" && payload.ticket_id && payload.status) {
    try {
      await db.prepare("UPDATE tickets SET status = ? WHERE ticket_id = ?").bind(String(payload.status), String(payload.ticket_id)).run();
    } catch {}
  }
  await db.prepare("DELETE FROM pending_actions WHERE nonce = ?").bind(nonce).run();
  return { ok: true };
}

export async function declinePendingAction(db: D1, nonce: string, decliner: Principal): Promise<{ ok: boolean; error?: string }> {
  const row = (await db.prepare("SELECT * FROM pending_actions WHERE nonce = ?").bind(nonce).first()) as PendingAction | null;
  if (!row) return { ok: false, error: "Pending action not found" };
  const owner = JSON.parse(row.principal_json) as Principal;
  if (owner.kind !== decliner.kind) return { ok: false, error: "Principal mismatch" };
  if (owner.kind === "customer" && decliner.kind === "customer" && owner.accountId !== decliner.accountId) return { ok: false, error: "Cannot decline another account's action" };
  await db.prepare("DELETE FROM pending_actions WHERE nonce = ?").bind(nonce).run();
  return { ok: true };
}

export function actionTools(db: D1): ToolDef[] {
  return [
    {
      name: "prepare_escalation",
      description: "Prepare an escalation to the human support team. Creates a pending action requiring user confirmation. Include ticket_id and reason.",
      parameters: {
        type: "object",
        properties: {
          ticket_id: { type: "string", description: "Ticket to escalate" },
          reason: { type: "string", description: "Why escalation is needed" },
          priority: { type: "string", enum: ["P1", "P2", "P3"], description: "Priority" },
        },
        required: ["ticket_id", "reason"],
      },
      execute: async (args, { principal }) => {
        const payload = { ticket_id: String(args.ticket_id), reason: String(args.reason), priority: String(args.priority ?? "P2") };
        const summary = `Escalate ${payload.ticket_id} (${payload.priority}): ${payload.reason}`;
        const p = await createPendingAction(db, { type: "escalation", payload, summary, principal });
        return { pending_action: p, message: "Escalation prepared — awaiting user confirmation", summary: p.summary, nonce: p.nonce };
      },
    },
    {
      name: "prepare_ticket_update",
      description: "Prepare a ticket status update (pending action).",
      parameters: {
        type: "object",
        properties: {
          ticket_id: { type: "string" },
          status: { type: "string", enum: ["open", "pending", "closed"] },
          note: { type: "string" },
        },
        required: ["ticket_id", "status"],
      },
      execute: async (args, { principal }) => {
        const payload = { ticket_id: String(args.ticket_id), status: String(args.status), note: String(args.note ?? "") };
        const summary = `Update ${payload.ticket_id} to ${payload.status}${payload.note ? `: ${payload.note}` : ""}`;
        const p = await createPendingAction(db, { type: "update_ticket", payload, summary, principal });
        return { pending_action: p, summary: p.summary, nonce: p.nonce };
      },
    },
    {
      name: "prepare_followup_task",
      description: "Prepare a follow-up task (pending action).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          ticket_id: { type: "string" },
        },
        required: ["title"],
      },
      execute: async (args, { principal }) => {
        const payload = { title: String(args.title), description: String(args.description ?? ""), ticket_id: args.ticket_id ? String(args.ticket_id) : null };
        const summary = `Create follow-up: ${payload.title}`;
        const p = await createPendingAction(db, { type: "followup_task", payload, summary, principal });
        return { pending_action: p, summary: p.summary, nonce: p.nonce };
      },
    },
  ];
}
