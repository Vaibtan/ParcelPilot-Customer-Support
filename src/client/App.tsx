import React, { useEffect, useRef, useState } from "react";

type Principal =
  | { kind: "customer"; accountId: string; accountName: string }
  | { kind: "staff"; role: string };

type Msg = { role: "user" | "assistant" | "system"; content: string };

function parseSseStream(text: string): string {
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
      if (payload && payload !== "[DONE]") out += payload;
    }
  }
  return out;
}

export function App() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [personas, setPersonas] = useState<{ accounts: { id: string; name: string }[]; staff: { role: string; label: string } } | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("pp_token"));
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState("");
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

  // Verify stored token
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
  }, [messages, busy]);

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
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("pp_token");
    setToken(null);
    setPrincipal(null);
    setMessages([]);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !token) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: next.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        setMessages((m) => [...m, { role: "assistant", content: `Error ${res.status}: ${j.error ?? res.statusText}` }]);
        return;
      }
      if (!res.body) {
        setMessages((m) => [...m, { role: "assistant", content: "No response body" }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseStream(buffer);
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: parsed || "…" };
          return copy;
        });
      }
      // If server returned JSON (non-stream), handle
      if (buffer.trim().startsWith("{")) {
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
    </div>
  );
}
