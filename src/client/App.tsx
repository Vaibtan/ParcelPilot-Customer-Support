import React, { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant" | "system"; content: string };

function parseSseStream(text: string): string {
  // Extract content from OpenAI SSE lines
  let out = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const j = JSON.parse(payload);
      const delta = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? "";
      if (delta) out += delta;
      if (j.error) out += `\n[error: ${j.error}]`;
    } catch {
      // plain data line
      if (payload && payload !== "[DONE]") out += payload;
    }
  }
  return out;
}

export function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<string>("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setHealth(`model: ${j.model} · db: ${j.db} · vectorize: ${j.vectorize}`))
      .catch(() => setHealth("health check failed"));
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);

    // Stream via SSE
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        setMessages((m) => [...m, { role: "assistant", content: `Error ${res.status}: ${j.error ?? res.statusText}` }]);
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      // add placeholder assistant message
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Parse incremental SSE chunks; for simplicity, re-parse buffer each time for full content and update placeholder
        // But we need incremental: accumulate deltas without re-parsing whole buffer from scratch marking duplicates?
        // Approach: parse buffer fully each time and set content to parsed result (idempotent if we re-parse).
        // However streaming emits deltas; re-parsing full buffer yields correct concatenation if we reset acc each time.
        const parsed = parseSseStream(buffer);
        acc = parsed;
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc || "…" };
          return copy;
        });
      }
      if (!acc) {
        // Fallback: buffer may be JSON if non-stream
        try {
          const j = JSON.parse(buffer);
          if (j.reply) {
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: "assistant", content: j.reply };
              return copy;
            });
          }
        } catch {}
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Network error: ${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1>ParcelPilot Support</h1>
        <span className="badge">Walking skeleton · 01</span>
      </div>
      {health && <div className="health">{health}</div>}
      <div className="chat">
        <div className="messages" ref={listRef}>
          {messages.length === 0 && (
            <div className="msg system">Send a message to test the streamed LLM path (via AI Gateway).</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.content}
            </div>
          ))}
          {busy && <div className="typing">Assistant is streaming…</div>}
        </div>
        <div className="composer">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask anything…"
            disabled={busy}
          />
          <button onClick={send} disabled={busy || !input.trim()}>
            Send
          </button>
        </div>
      </div>
      <div className="hint">All LLM calls go through Cloudflare AI Gateway. No tools yet — this is the skeleton.</div>
    </div>
  );
}
