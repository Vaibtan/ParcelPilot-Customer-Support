import { Hono } from "hono";
import { Effect } from "effect";
import type { Env } from "./env";
import { ClockLive } from "../lib/clock";
import { makeLlmGatewayLayer, LlmGateway } from "../lib/llm/gateway";
import {
  ACCOUNTS,
  STAFF,
  createSessionToken,
  getSessionFromRequest,
  sessionCookie,
  clearSessionCookie,
  verifySessionToken,
  type Principal,
} from "../lib/auth";
import { makeRepo } from "../lib/repo";
import { ensureConversation, saveMessage, saveRun } from "../lib/traces";
import { runAgentLoop } from "../lib/agent";
import { setDocToolProvider, setActionToolProvider } from "../lib/tools";
import { docSearchTool } from "../lib/doc-search-tool";
import { actionTools, confirmPendingAction, declinePendingAction } from "../lib/actions";

type Bindings = Env;
type Variables = { principal: Principal };
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function secretForEnv(env: Bindings): string {
  return (env as unknown as { SESSION_SECRET?: string }).SESSION_SECRET || env.CF_AI_GATEWAY_AUTH_API_TOKEN || "dev-secret-change-me";
}

app.get("/api/health", async (c) => {
  const env = c.env;
  let dbOk = false;
  let vectorizeOk = false;
  try {
    const r = (await env.DB.prepare("SELECT 1 as v").first()) as { v: number } | null;
    dbOk = r?.v === 1;
  } catch { dbOk = !!env.DB; }
  vectorizeOk = !!env.VECTORIZE;
  return c.json({ ok: true, db: dbOk ? "ok" : "unavailable", vectorize: vectorizeOk ? "ok" : "unavailable", model: env.LLM_MODEL ?? "not-set", gateway: env.CF_AI_GATEWAY_NAME ?? "not-set" });
});

app.get("/api/auth/personas", (c) => {
  return c.json({ accounts: ACCOUNTS.map((a) => ({ id: a.id, name: a.name })), staff: { role: STAFF.role, label: STAFF.label } });
});

app.post("/api/auth/login", async (c) => {
  const secret = secretForEnv(c.env);
  let body: { persona?: string; accountId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  let principal: Principal | null = null;
  if (body.persona === "staff" || body.accountId === "staff") principal = { kind: "staff", role: "staff" };
  else if (body.accountId) {
    const acct = ACCOUNTS.find((a) => a.id === body.accountId);
    if (!acct) return c.json({ error: "Unknown account" }, 400);
    principal = { kind: "customer", accountId: acct.id, accountName: acct.name };
  } else if (body.persona && body.persona.startsWith("ACCT-")) {
    const acct = ACCOUNTS.find((a) => a.id === body.persona);
    if (!acct) return c.json({ error: "Unknown persona" }, 400);
    principal = { kind: "customer", accountId: acct.id, accountName: acct.name };
  } else return c.json({ error: "Missing persona/accountId" }, 400);
  const token = await createSessionToken(principal, secret);
  return c.json({ principal, token }, { headers: { "Set-Cookie": sessionCookie(token) } });
});

app.post("/api/auth/logout", (c) => c.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } }));

app.get("/api/auth/me", async (c) => {
  const secret = secretForEnv(c.env);
  const token = getSessionFromRequest(c.req.raw);
  if (!token) return c.json({ principal: null }, 401);
  const principal = await verifySessionToken(token, secret);
  if (!principal) return c.json({ error: "Invalid session" }, 401);
  return c.json({ principal });
});

app.get("/api/traces", async (c) => {
  const secret = secretForEnv(c.env);
  const token = getSessionFromRequest(c.req.raw);
  if (!token) return c.json({ error: "Authentication required" }, 401);
  const p = await verifySessionToken(token, secret);
  if (!p) return c.json({ error: "Invalid session" }, 401);
  if (p.kind !== "staff") return c.json({ error: "Staff only" }, 403);
  const convs = await c.env.DB.prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 50").all();
  const runs = await c.env.DB.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 50").all();
  return c.json({ conversations: convs.results, runs: runs.results });
});

app.get("/api/traces/:id", async (c) => {
  const secret = secretForEnv(c.env);
  const token = getSessionFromRequest(c.req.raw);
  if (!token) return c.json({ error: "Authentication required" }, 401);
  const p = await verifySessionToken(token, secret);
  if (!p) return c.json({ error: "Invalid session" }, 401);
  if (p.kind !== "staff") return c.json({ error: "Staff only" }, 403);
  const id = c.req.param("id");
  const run = await c.env.DB.prepare("SELECT * FROM runs WHERE id = ?").bind(id).first();
  if (!run) return c.json({ error: "Not found" }, 404);
  const steps = await c.env.DB.prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY seq").bind(id).all();
  const msgs = await c.env.DB.prepare("SELECT * FROM messages WHERE conversation_id = (SELECT conversation_id FROM runs WHERE id = ?) ORDER BY created_at").bind(id).all();
  return c.json({ run, steps: steps.results, messages: msgs.results });
});

// Chat with agent loop
app.post("/api/chat", async (c, next) => {
  const secret = secretForEnv(c.env);
  const token = getSessionFromRequest(c.req.raw);
  if (!token) return c.json({ error: "Authentication required" }, 401);
  const principal = await verifySessionToken(token, secret);
  if (!principal) return c.json({ error: "Invalid or tampered session" }, 401);
  (c as unknown as { set: (k: string, v: unknown) => void }).set("principal", principal);
  await next();
}, async (c) => {
  const principal = c.get("principal") as Principal;
  const env = c.env;
  let body: { message?: string; messages?: { role: string; content: string }[]; conversationId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const messages = body.messages ?? (body.message ? [{ role: "user" as const, content: body.message }] : []);
  if (!messages.length) return c.json({ error: "Missing message" }, 400);
  const conversationId = body.conversationId ?? crypto.randomUUID();
  const runId = crypto.randomUUID();
  const userContent = messages[messages.length - 1]?.content ?? "";
  try { await ensureConversation(env.DB, conversationId, principal); await saveMessage(env.DB, conversationId, "user", userContent); } catch (e) { console.error(e); }
  const history = messages.map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content) }));
  const repo = makeRepo(env.DB);
  setDocToolProvider(() => docSearchTool({ db: env.DB, index: env.VECTORIZE, env }));
  setActionToolProvider(() => actionTools(env.DB as never));
  const llmAdapter = {
    chatWithTools: async (msgs: unknown[], tools: unknown[]) => {
      const eff = Effect.flatMap(LlmGateway, (gw) => gw.chatWithTools(msgs as never, tools));
      const prog = Effect.provide(eff, makeLlmGatewayLayer(env)).pipe(Effect.provide(ClockLive)) as Effect.Effect<{ content: string | null; tool_calls?: { id: string; name: string; arguments: string }[]; usage?: { total_tokens?: number } }, unknown, never>;
      return Effect.runPromise(prog);
    },
  };
  try {
    const { stream, steps } = await Effect.runPromise(runAgentLoop(history, principal, repo, llmAdapter as never));
    let assistantText = "";
    const db = env.DB;
    const toolEvents = steps.filter((s) => s.kind === "tool").map((s) => `event: tool_call\ndata: ${JSON.stringify({ name: s.name, args: s.args, result: s.result })}\n\n`).join("");
    const wrapped = stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        const txt = new TextDecoder().decode(chunk);
        for (const line of txt.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const p = line.slice(5).trim(); if (p === "[DONE]") continue;
          try { const j = JSON.parse(p); const d = j.choices?.[0]?.delta?.content; if (d) assistantText += d; } catch {}
        }
      },
      async flush() {
        try { await saveRun(db, runId, conversationId, principal, steps, "ok"); if (assistantText) await saveMessage(db, conversationId, "assistant", assistantText); } catch (e) { console.error(e); }
      },
    }));
    const enc = new TextEncoder();
    const combined = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (toolEvents) controller.enqueue(enc.encode(toolEvents));
        const reader = wrapped.getReader();
        while (true) { const { done, value } = await reader.read(); if (done) break; controller.enqueue(value); }
        controller.close();
      },
    });
    return new Response(combined, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Conversation-Id": conversationId, "X-Run-Id": runId } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await saveRun(env.DB, runId, conversationId, principal, [], "error", msg); } catch {}
    const status = msg.includes("Gateway") ? 502 : 500;
    return c.json({ error: msg }, status as 502 | 500);
  }
});

app.post("/api/actions/confirm", async (c) => {
  const secret = secretForEnv(c.env);
  const token = getSessionFromRequest(c.req.raw);
  if (!token) return c.json({ error: "Authentication required" }, 401);
  const principal = await verifySessionToken(token, secret);
  if (!principal) return c.json({ error: "Invalid session" }, 401);
  let body: { nonce?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.nonce) return c.json({ error: "Missing nonce" }, 400);
  const res = await confirmPendingAction(c.env.DB as never, body.nonce, principal);
  if (!res.ok) return c.json({ error: res.error }, 400);
  return c.json({ ok: true });
});

app.post("/api/actions/decline", async (c) => {
  const secret = secretForEnv(c.env);
  const token = getSessionFromRequest(c.req.raw);
  if (!token) return c.json({ error: "Authentication required" }, 401);
  const principal = await verifySessionToken(token, secret);
  if (!principal) return c.json({ error: "Invalid session" }, 401);
  let body: { nonce?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.nonce) return c.json({ error: "Missing nonce" }, 400);
  const res = await declinePendingAction(c.env.DB as never, body.nonce, principal);
  if (!res.ok) return c.json({ error: res.error }, 400);
  return c.json({ ok: true });
});

app.get("/api/actions/log", async (c) => {
  const secret = secretForEnv(c.env);
  const token = getSessionFromRequest(c.req.raw);
  if (!token) return c.json({ error: "Authentication required" }, 401);
  const principal = await verifySessionToken(token, secret);
  if (!principal) return c.json({ error: "Invalid session" }, 401);
  if (principal.kind !== "staff") return c.json({ error: "Staff only" }, 403);
  const r = await c.env.DB.prepare("SELECT * FROM action_log ORDER BY executed_at DESC LIMIT 20").all();
  return c.json({ actions: r.results });
});

app.get("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> { return app.fetch(request, env, ctx); },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async scheduled(event: any, _env: Env, _ctx: any) { console.log("cron tick", event.cron); },
};
