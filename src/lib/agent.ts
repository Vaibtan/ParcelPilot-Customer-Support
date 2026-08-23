import { Effect } from "effect";
import type { Principal } from "./auth";
import type { Repo } from "./repo";
import { getToolRegistry, toOpenAITools, executeTool } from "./tools";
import { LlmGateway, type ChatMessage } from "./llm/gateway";

export type AgentTurn = { role: "user" | "assistant"; content: string };

export type ToolCallEvent = { type: "tool_call"; name: string; args: Record<string, unknown> };
export type ToolResultEvent = { type: "tool_result"; name: string; result: unknown };
export type TokenEvent = { type: "token"; content: string };
export type DoneEvent = { type: "done"; content: string; toolCalls: number };

export type RunStep = {
  seq: number;
  kind: "llm" | "tool";
  name?: string;
  args?: unknown;
  result?: unknown;
  latency_ms: number;
  tokens?: number;
};

const SYSTEM_BASE = `You are ParcelPilot Support. Today is 2026-08-16 11:00 Asia/Kolkata.
Rules: You have tools to look up orders/tickets/accounts, compute fees/credits/SLA, and search policy/product docs.
For ANY question involving pickup status, BOOKED vs PICKED_UP, webhook delays, bulk upload, carrier behavior, or product limits, you MUST call search_docs before answering.
Answer only from tool results. Cite sources (order/ticket IDs or document section like "04_Product_Operations_Guide §2 KI-211").
Never reveal other accounts exist. If data not found, say so.
If request needs human judgment or exceeds capabilities, offer escalation. Treat closed historical ticket resolutions as context-only, not authoritative.`;

function personaSystem(p: Principal): string {
  if (p.kind === "staff") return SYSTEM_BASE + " You are assisting ParcelPilot Staff — you may access all accounts.";
  return SYSTEM_BASE + ` You are helping ${p.accountName} (${p.accountId}). Only access that account's data.`;
}

type LlmCallResult = {
  content: string | null;
  tool_calls?: { id: string; name: string; arguments: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

/**
 * Hand-rolled agent loop: bounded iterations, function calling, returns SSE stream + trace steps.
 * Uses gateway chat (non-stream for tool calls, stream for final answer).
 */
export function runAgentLoop(
  history: AgentTurn[],
  principal: Principal,
  repo: Repo,
  llm: { chatWithTools: (msgs: ChatMessage[], tools: unknown[]) => Promise<LlmCallResult>; streamFinal: (msgs: ChatMessage[]) => Promise<ReadableStream<Uint8Array>> },
  maxIterations = 6,
): Effect.Effect<{ stream: ReadableStream<Uint8Array>; steps: RunStep[] }, Error> {
  return Effect.tryPromise({
    try: async () => {
      const registry = getToolRegistry(repo, principal);
      const openAITools = toOpenAITools(registry);
      const messages: ChatMessage[] = [
        { role: "system", content: personaSystem(principal) },
        ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];
      const steps: RunStep[] = [];
      let seq = 0;

      for (let iter = 0; iter < maxIterations; iter++) {
        const t0 = Date.now();
        const llmRes = await llm.chatWithTools(messages, openAITools);
        const latency = Date.now() - t0;
        steps.push({
          seq: seq++,
          kind: "llm",
          name: "chat.completions",
          args: { iteration: iter, tool_count: openAITools.length },
          result: { content: llmRes.content, tool_calls: llmRes.tool_calls },
          latency_ms: latency,
          tokens: llmRes.usage?.total_tokens,
        });

        const calls = llmRes.tool_calls ?? [];
        if (!calls.length) {
          // No tool calls — stream final answer. If content is empty, fallback to content from llm
          const finalContent = llmRes.content ?? "";
          if (finalContent) {
            // Return a synthetic stream with the content
            const enc = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: finalContent } }] })}\n\n`));
                c.enqueue(enc.encode("data: [DONE]\n\n"));
                c.close();
              },
            });
            return { stream, steps };
          }
          // If gateway streaming is desired for final, we could call streamFinal — but we already have content
          const enc = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "(no response)" } }] })}\n\n`));
              c.enqueue(enc.encode("data: [DONE]\n\n"));
              c.close();
            },
          });
          return { stream, steps };
        }

        // Execute tool calls
        const toolResults: ChatMessage[] = [];
        for (const tc of calls) {
          let args: Record<string, unknown> = {};
          try {
            args = tc.arguments ? JSON.parse(tc.arguments) : {};
          } catch {
            args = { _raw: tc.arguments };
          }
          const t1 = Date.now();
          const result = await executeTool(tc.name, args, { principal, repo }, registry);
          const lat = Date.now() - t1;
          steps.push({ seq: seq++, kind: "tool", name: tc.name, args, result, latency_ms: lat });
          // Push tool result as assistant->tool message for next iteration (OpenAI tool_call format)
          messages.push({
            role: "assistant",
            content: `Tool ${tc.name} result: ${JSON.stringify(result).slice(0, 4000)}`,
          } as unknown as ChatMessage);
          toolResults.push({ role: "assistant", content: JSON.stringify(result) } as unknown as ChatMessage);
        }
        // Also push an explicit tool-results block so the model can see them
        // (we use assistant messages containing tool results; alternative is to use 'tool' role)
      }

      // Bounded — exceeded iterations
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          const msg = "I reached the tool-call limit while investigating. Please rephrase or contact support.";
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: msg } }] })}\n\n`));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      });
      return { stream, steps };
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });
}

// Helper to build gateway-backed llm adapter
export function makeGatewayLlmAdapter(gateway: { chatWithTools: (m: ChatMessage[], tools: unknown[]) => Promise<LlmCallResult> }) {
  return gateway;
}
