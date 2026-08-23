import React, { useEffect, useState } from "react";

export function TraceViewer({ token }: { token: string }) {
  const [convs, setConvs] = useState<unknown[]>([]);
  const [runs, setRuns] = useState<unknown[]>([]);
  const [selected, setSelected] = useState<{ run: unknown; steps: unknown[]; messages: unknown[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/traces", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) { setError(`${r.status}`); return null; }
        return r.json();
      })
      .then((j) => { if (j) { setConvs((j.conversations as unknown[]) ?? []); setRuns((j.runs as unknown[]) ?? []); } })
      .catch((e) => setError(String(e)));
  }, [token]);

  async function openRun(id: string) {
    const r = await fetch(`/api/traces/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (r.ok) setSelected(j);
  }

  if (error) return <div style={{ padding: 16 }}>Trace access error: {error}</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginBottom: 8 }}>Trace Viewer (staff)</h2>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3>Runs ({(runs as { id: string }[]).length})</h3>
          {(runs as { id: string; status: string; total_tokens: number; total_latency_ms: number; created_at: string; principal_json: string }[]).map((r) => (
            <div key={r.id} onClick={() => openRun(r.id)} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, marginBottom: 8, cursor: "pointer", background: "#fff" }}>
              <div style={{ fontFamily: "monospace", fontSize: 12 }}>{r.id.slice(0, 8)} — {r.status} — {r.total_tokens ?? 0} tokens — {r.total_latency_ms ?? 0}ms</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{r.created_at} — {r.principal_json?.slice(0, 80)}</div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {selected ? (
            <div>
              <h3>Steps</h3>
              <pre style={{ background: "#f9fafb", padding: 8, borderRadius: 8, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 500, overflow: "auto" }}>
                {JSON.stringify(selected.steps, null, 2)}
              </pre>
              <h3>Messages</h3>
              <pre style={{ background: "#f9fafb", padding: 8, borderRadius: 8, fontSize: 11, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(selected.messages, null, 2)}
              </pre>
              <div style={{ fontSize: 11, color: "#6b7280" }}>Run: {JSON.stringify(selected.run, null, 2).slice(0, 1000)}</div>
            </div>
          ) : <div style={{ color: "#6b7280" }}>Select a run</div>}
        </div>
      </div>
    </div>
  );
}
