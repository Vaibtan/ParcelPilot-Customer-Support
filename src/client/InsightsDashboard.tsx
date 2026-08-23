import React, { useEffect, useState } from "react";

type Insight = { id: string; type: string; severity: string; title: string; summary: string | null; evidence_json: string; rationale: string | null; created_at?: string };

export function InsightsDashboard({ token }: { token: string }) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/insights", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json() as { insights: Insight[] };
      setInsights(j.insights);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [token]);

  async function recompute() {
    await fetch("/api/insights/recompute", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    await load();
  }

  if (loading) return <div style={{ padding: 16 }}>Loading insights…</div>;
  if (error) return <div style={{ padding: 16 }}>Error: {error}</div>;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2>Proactive Insights</h2>
        <button onClick={recompute} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer" }}>Recompute</button>
      </div>
      {insights.length === 0 && <div style={{ color: "#6b7280" }}>No insights — data looks quiet.</div>}
      {insights.map((ins) => (
        <div key={ins.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 8, background: "#fff", borderLeft: `4px solid ${ins.severity === "critical" ? "#dc2626" : ins.severity === "high" ? "#f59e0b" : "#6b7280"}` }}>
          <div style={{ fontWeight: 600 }}>{ins.title} <span style={{ fontSize: 11, background: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>{ins.type}</span> <span style={{ fontSize: 11, color: "#6b7280" }}>{ins.severity}</span></div>
          <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>{ins.summary}</div>
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 12, cursor: "pointer", color: "#1a56db" }}>Evidence</summary>
            <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", background: "#f9fafb", padding: 8, borderRadius: 6 }}>{ins.evidence_json}</pre>
            {ins.rationale && <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", background: "#fff", padding: 8 }}>{ins.rationale.slice(0, 800)}</pre>}
          </details>
          <div style={{ marginTop: 6 }}>
            <button onClick={() => { window.location.hash = `chat?insight=${encodeURIComponent(ins.id)}`; window.dispatchEvent(new HashChangeEvent("hashchange")); }} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #1a56db", background: "#e8f0fe", color: "#1a56db", cursor: "pointer" }}>Open in chat</button>
          </div>
        </div>
      ))}
    </div>
  );
}
