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

type Bindings = Env;
type Variables = { principal: Principal };

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function runEffect<R, E, A>(effect: Effect.Effect<A, E, R>, env: Bindings): Promise<A> {
  const program = Effect.provide(effect, makeLlmGatewayLayer(env)).pipe(
    Effect.provide(ClockLive),
  ) as Effect.Effect<A, E, never>;
  return Effect.runPromise(program);
}

function secretForEnv(env: Bindings): string {
  return env.SESSION_SECRET || env.CF_AI_GATEWAY_AUTH_API_TOKEN || "dev-secret-change-me";
}

// Public
app.get("/api/health", async (c) => {
  const env = c.env;
  let dbOk = false;
  let vectorizeOk = false;
  try {
    const r = (await env.DB.prepare("SELECT 1 as v").first()) as { v: number } | null;
    dbOk = r?.v === 1;
  } catch {
    dbOk = !!env.DB;
  }
  vectorizeOk = !!env.VECTORIZE;
  return c.json({
    ok: true,
    db: dbOk ? "ok" : "unavailable",
    vectorize: vectorizeOk ? "ok" : "unavailable",
    model: env.LLM_MODEL ?? "not-set",
    gateway: env.CF_AI_GATEWAY_NAME ?? "not-set",
  });
});

app.get("/api/auth/personas", (c) => {
  return c.json({
    accounts: ACCOUNTS.map((a) => ({ id: a.id, name: a.name })),
    staff: { role: STAFF.role, label: STAFF.label },
  });
});

app.post("/api/auth/login", async (c) => {
  const secret = secretForEnv(c.env);
  let body: { persona?: string; accountId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  let principal: Principal | null = null;
  if (body.persona === "staff" || body.accountId === "staff") {
    principal = { kind: "staff", role: "staff" };
  } else if (body.accountId) {
    const acct = ACCOUNTS.find((a) => a.id === body.accountId);
    if (!acct) return c.json({ error: "Unknown account" }, 400);
    principal = { kind: "customer", accountId: acct.id, accountName: acct.name };
  } else if (body.persona && body.persona.startsWith("ACCT-")) {
    const acct = ACCOUNTS.find((a) => a.id === body.persona);
    if (!acct) return c.json({ error: "Unknown persona" }, 400);
    principal = { kind: "customer", accountId: acct.id, accountName: acct.name };
  } else {
    return c.json({ error: "Missing persona/accountId" }, 400);
  }
  const token = await createSessionToken(principal, secret);
  return c.json({ principal, token }, { headers: { "Set-Cookie": sessionCookie(token) } });
});

app.post("/api/auth/logout", (c) => {
  return c.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
});

app.get("/api/auth/me", async (c) => {
  const secret = secretForEnv(c.env);
  const token = getSessionFromRequest(c.req.raw);
  if (!token) return c.json({ principal: null }, 401);
  const principal = await verifySessionToken(token, secret);
  if (!principal) return c.json({ error: "Invalid session" }, 401);
  return c.json({ principal });
});

// Auth middleware for protected routes
async function requireAuth(
  c: { req: { raw: Request }; env: Bindings; json: (d: unknown, s?: number) => Response; get: (k: string) => unknown; set: (k: string, v: unknown) => void },
  next: () => Promise<void>,
) {
  const secret = secretForEnv(c.env as Bindings);
  const token = getSessionFromRequest(c.req.raw);
  if (!token) return c.json({ error: "Authentication required" }, 401);
  const principal = await verifySessionToken(token, secret);
  if (!principal) return c.json({ error: "Invalid or tampered session" }, 401);
  c.set("principal", principal);
  await next();
}

// Protected: chat
app.post("/api/chat", async (c, next) => {
  // auth gate inline (avoid Hono middleware ordering quirks)
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
  let body: { message?: string; messages?: { role: string; content: string }[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const messages =
    body.messages ?? (body.message ? [{ role: "user" as const, content: body.message }] : []);
  if (!messages.length) return c.json({ error: "Missing message" }, 400);

  const personaNote =
    principal.kind === "customer"
      ? `The user is ${principal.accountName} (${principal.accountId}). Only answer from that account's data. Never reveal other accounts exist.`
      : `The user is ParcelPilot Staff — you may access all accounts.`;

  const systemPrompt = `You are ParcelPilot Support. Today is 2026-08-16 11:00 Asia/Kolkata. ${personaNote} Answer concisely from tool results when available.`;

  const chatMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: String(m.content),
    })),
  ];

  const wantStream = c.req.query("stream") !== "false";

  try {
    if (wantStream) {
      const upstream = (await runEffect(
        Effect.flatMap(LlmGateway, (llm) => llm.chatStream(chatMessages as never)),
        env,
      )) as unknown as ReadableStream<Uint8Array>;
      return new Response(upstream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    } else {
      const text = (await runEffect(
        Effect.flatMap(LlmGateway, (llm) => llm.chat(chatMessages as never)),
        env,
      )) as unknown as string;
      return c.json({ reply: text, principal });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Gateway") ? 502 : 500;
    return c.json({ error: msg }, status as 502 | 500);
  }
});

app.get("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async scheduled(event: any, _env: Env, _ctx: any) {
    console.log("cron tick", event.cron);
  },
};
