import { Hono } from "hono";
import { Effect } from "effect";
import type { Env } from "./env";
import { ClockLive } from "../lib/clock";
import { makeLlmGatewayLayer, LlmGateway } from "../lib/llm/gateway";

type Bindings = Env;

const app = new Hono<{ Bindings: Bindings }>();

function runEffect<R, E, A>(effect: Effect.Effect<A, E, R>, env: Bindings): Promise<A> {
  const program = Effect.provide(effect, makeLlmGatewayLayer(env)).pipe(
    Effect.provide(ClockLive),
  ) as Effect.Effect<A, E, never>;
  return Effect.runPromise(program);
}

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

app.post("/api/chat", async (c) => {
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

  const systemPrompt =
    "You are ParcelPilot Support, a helpful assistant for ParcelPilot logistics. Answer concisely. Today is 2026-08-16 11:00 Asia/Kolkata.";
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
      return c.json({ reply: text });
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
