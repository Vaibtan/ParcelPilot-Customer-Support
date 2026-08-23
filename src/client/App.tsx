import React, { useEffect, useRef, useState } from "react";

type Principal =
  | { kind: "customer"; accountId: string; accountName: string }
  | { kind: "staff"; role: string };

type Msg = { role: "user" | "assistant" | "system"; content: string };
type ToolEvent = { name: string; args: unknown; result: unknown };

function parseSseBuffer(buffer: string): { text: string; tools: ToolEvent[] } {
  let text = "";
  const tools: ToolEvent[] = [];
  for (const block of buffer.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (line.startsWith("event: tool_call")) {
        // next data line is tool payload — handle in block
      }
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        if (j.name && j.args !== undefined) {
          tools.push(j as ToolEvent);
          continue;
        }
        const delta = j.choices?.[0]?.delta?.content ?? "";
        if (delta) text += delta;
      } catch {
        // Check if payload is tool event JSON
        try {
          const j = JSON.parse(payload);
          if (j.name) tools.push(j);
        } catch {}
      }
    }
  }
  return { text, tools };
}

export function App() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [personas, setPersonas] = useState<{ accounts: { id: string; name: string }[]; staff: { role: string; label: string } } | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("pp_token"));
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setHealth(`model: ${j.model} · db: ${j.db} · vectorize: ${j.vectorize}`))
      .catch(() => setHealth("health check failed"));
    fetch("/api/auth/personas")
      .then((r) => r.json())
      .then(setPersonas)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        setPrincipal(j.principal);
      })
      .catch(() => {
        localStorage.removeItem("pp_token");
        setToken(null);
        setPrincipal(null);
      });
  }, [token]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, toolEvents]);

  async function login(accountId: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    const j = await res.json();
    if (!res.ok) {
      alert(j.error ?? "Login failed");
      return;
    }
    localStorage.setItem("pp_token", j.token);
    setToken(j.token);
    setPrincipal(j.principal);
    setMessages([]);
    setConversationId(null);
    setToolEvents([]);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("pp_token");
    setToken(null);
    setPrincipal(null);
    setMessages([]);
    setConversationId(null);
    setToolEvents([]);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !token) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setToolEvents([]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: next.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
          conversationId: conversationId ?? undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        setMessages((m) => [...m, { role: "assistant", content: `Error ${res.status}: ${j.error ?? res.statusText}` }]);
        return;
      }
      const cid = res.headers.get("X-Conversation-Id");
      if (cid) setConversationId(cid);
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      let buffer = "";
      const tools: ToolEvent[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Incremental parse: look for tool_call events and text deltas
        // For simplicity, re-parse full buffer each chunk (small)
        let acc = "";
        const localTools: ToolEvent[] = [];
        for (const block of buffer.split("\n\n")) {
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload);
              if (j.name && j.args !== undefined) {
                // dedupe
                if (!localTools.find((t) => t.name === j.name && JSON.stringify(t.args) === JSON.stringify(j.args))) localTools.push(j);
                continue;
              }
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) acc += delta;
            } catch {}
          }
        }
        if (localTools.length) setToolEvents(localTools);
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc || (localTools.length ? "…" : "") };
          return copy;
        });
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Network error: ${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  if (!principal) {
    return (
      <div className="container">
        <div className="header">
          <h1>ParcelPilot Support</h1>
          <span className="badge">Sign in</span>
        </div>
        {health && <div className="health">{health}</div>}
        <div className="chat" style={{ height: "auto", padding: 16 }}>
          <p style={{ marginBottom: 12, color: "#374151" }}>Choose a persona to continue. Customer sessions are scoped to their account.</p>
          {personas ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {personas.accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => login(a.id)}
                  style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", textAlign: "left" }}
                >
                  <strong>{a.name}</strong> <span style={{ color: "#6b7280" }}>{a.id}</span>
                </button>
              ))}
              <button
                onClick={() => login("staff")}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer", textAlign: "left" }}
              >
                <strong>{personas.staff.label}</strong> <span style={{ opacity: 0.7 }}>staff</span>
              </button>
            </div>
          ) : (
            <div>Loading personas…</div>
          )}
        </div>
      </div>
    );
  }

  const label = principal.kind === "customer" ? `${principal.accountName} (${principal.accountId})` : "Staff";

  return (
    <div className="container">
      <div className="header">
        <h1>ParcelPilot Support</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge">{label}</span>
          <button onClick={logout} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>
            Switch
          </button>
        </div>
      </div>
      {health && <div className="health">{health}</div>}
      <div className="chat">
        <div className="messages" ref={listRef}>
          {messages.length === 0 && <div className="msg system">Signed in as {label}. Ask about your orders, tickets, or policies.</div>}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.content}
            </div>
          ))}
          {toolEvents.length > 0 && (
            <div style={{ fontSize: 12, color: "#6b7280", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Tool calls</div>
              {toolEvents.map((t, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <code>{t.name}</code> <span style={{ color: "#374151" }}>{JSON.stringify(t.args)}</span>
                  <div style={{ opacity: 0.8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(t.result)?.slice(0, 300)}</div>
                </div>
              ))}
            </div>
          )}
          {busy && <div className="typing">Assistant is working…</div>}
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
            placeholder="Ask about your orders, tickets…"
            disabled={busy}
          />
          <button onClick={send} disabled={busy || !input.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
