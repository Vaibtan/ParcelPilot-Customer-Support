import type { Principal } from "./auth";
import type { RunStep } from "./agent";

type D1 = {
  prepare: (sql: string) => {
    bind: (...a: unknown[]) => { run: () => Promise<unknown>; first: () => Promise<unknown>; all: () => Promise<{ results: unknown[] }> };
    run: () => Promise<unknown>;
  };
};

export async function createConversation(db: D1, id: string, principal: Principal): Promise<void> {
  await db.prepare("INSERT INTO conversations (id, principal_json) VALUES (?, ?)").bind(id, JSON.stringify(principal)).run();
  await db.prepare("UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(id).run().catch(() => {});
}

export async function ensureConversation(db: D1, id: string, principal: Principal): Promise<void> {
  const row = (await db.prepare("SELECT id FROM conversations WHERE id = ?").bind(id).first()) as { id: string } | null;
  if (!row) await createConversation(db, id, principal);
}

export async function saveRun(
  db: D1,
  runId: string,
  conversationId: string,
  principal: Principal,
  steps: RunStep[],
  status: "ok" | "error",
  error?: string,
): Promise<void> {
  const totalLatency = steps.reduce((a, s) => a + (s.latency_ms || 0), 0);
  const totalTokens = steps.reduce((a, s) => a + (s.tokens || 0), 0);
  await db
    .prepare("INSERT INTO runs (id, conversation_id, principal_json, status, error, total_latency_ms, total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(runId, conversationId, JSON.stringify(principal), status, error ?? null, totalLatency, totalTokens)
    .run();
  for (const s of steps) {
    await db
      .prepare("INSERT INTO steps (id, run_id, seq, kind, name, args_json, result_json, latency_ms, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        `${runId}-${s.seq}`,
        runId,
        s.seq,
        s.kind,
        s.name ?? null,
        s.args != null ? JSON.stringify(s.args) : null,
        s.result != null ? JSON.stringify(s.result) : null,
        s.latency_ms,
        s.tokens ?? null,
      )
      .run();
  }
  await db.prepare("UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(conversationId).run().catch(() => {});
}

export async function saveMessage(db: D1, conversationId: string, role: string, content: string): Promise<void> {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)").bind(id, conversationId, role, content).run();
}
