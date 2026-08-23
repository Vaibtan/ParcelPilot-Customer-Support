import { Context, Effect, Layer } from "effect";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatOptions = { model?: string; stream?: boolean };

export class LlmError extends Error {
  readonly _tag = "LlmError";
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export class LlmGateway extends Context.Tag("LlmGateway")<
  LlmGateway,
  {
    chat: (messages: ChatMessage[], opts?: ChatOptions) => Effect.Effect<string, LlmError>;
    chatStream: (messages: ChatMessage[], opts?: ChatOptions) => Effect.Effect<ReadableStream<Uint8Array>, LlmError>;
  }
>() {}

type EnvLike = {
  CF_ACCOUNT_ID: string;
  CF_AI_GATEWAY_NAME: string;
  CF_AI_GATEWAY_AUTH_API_TOKEN: string;
  LLM_MODEL: string;
};

function gatewayUrl(env: EnvLike): string {
  return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_AI_GATEWAY_NAME}/openai/chat/completions`;
}

function gatewayHeaders(env: EnvLike): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "cf-aig-authorization": `Bearer ${env.CF_AI_GATEWAY_AUTH_API_TOKEN}`,
  };
}

export const makeLlmGatewayLayer = (env: EnvLike) =>
  Layer.succeed(LlmGateway, {
    chat: (messages, opts) =>
      Effect.tryPromise({
        try: async () => {
          const model = opts?.model ?? env.LLM_MODEL ?? "gpt-4o-mini";
          const res = await fetch(gatewayUrl(env), {
            method: "POST",
            headers: gatewayHeaders(env),
            body: JSON.stringify({ model, messages, stream: false }),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new LlmError(`Gateway error ${res.status}: ${text.slice(0, 500)}`);
          }
          const json = (await res.json()) as {
            choices: { message: { content: string } }[];
          };
          return json.choices[0]?.message?.content ?? "";
        },
        catch: (e) => (e instanceof LlmError ? e : new LlmError(String(e), e)),
      }),
    chatStream: (messages, opts) =>
      Effect.tryPromise({
        try: async () => {
          const model = opts?.model ?? env.LLM_MODEL ?? "gpt-4o-mini";
          const res = await fetch(gatewayUrl(env), {
            method: "POST",
            headers: gatewayHeaders(env),
            body: JSON.stringify({ model, messages, stream: true }),
          });
          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => "");
            throw new LlmError(`Gateway stream error ${res.status}: ${text.slice(0, 500)}`);
          }
          return res.body as ReadableStream<Uint8Array>;
        },
        catch: (e) => (e instanceof LlmError ? e : new LlmError(String(e), e)),
      }),
  });

// Test layer — scripted responses
export const makeScriptedLlmLayer = (responses: string[]) => {
  let idx = 0;
  return Layer.succeed(LlmGateway, {
    chat: () =>
      Effect.succeed(responses[idx++] ?? responses[responses.length - 1] ?? "test response"),
    chatStream: (messages) =>
      Effect.succeed(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const text = responses[idx++] ?? responses[responses.length - 1] ?? "test response";
            const enc = new TextEncoder();
            // Simulate token-by-token streaming via SSE-like chunks (OpenAI SSE format)
            // For simplicity, emit whole content as one chunk then done
            const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
            controller.enqueue(enc.encode(payload));
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
      ),
  });
};
