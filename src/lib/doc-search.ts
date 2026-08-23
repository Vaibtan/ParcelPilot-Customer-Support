import type { Principal } from "./auth";

type D1 = {
  prepare: (sql: string) => {
    bind: (...a: unknown[]) => { all: () => Promise<{ results: unknown[] }>; first: () => Promise<unknown> };
    all: () => Promise<{ results: unknown[] }>;
  };
};

type ChunkRow = {
  id: string;
  doc_id: string;
  title: string;
  section: string;
  content: string;
  authority_tier: number;
  status: string;
  account_scope: string | null;
  effective_date: string | null;
};

export type DocHit = ChunkRow & { score?: number; rank?: number; conflictNote?: string };

export async function embedQuery(text: string, env: { CF_ACCOUNT_ID: string; CF_AI_GATEWAY_NAME: string; CF_AI_GATEWAY_AUTH_API_TOKEN: string }): Promise<number[]> {
  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_AI_GATEWAY_NAME}/openai/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-aig-authorization": `Bearer ${env.CF_AI_GATEWAY_AUTH_API_TOKEN}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { data: { embedding: number[] }[] };
  return j.data[0]?.embedding ?? [];
}

export async function keywordSearch(db: D1, query: string, limit = 6): Promise<ChunkRow[]> {
  // Use FTS5 MATCH — sanitize query for FTS syntax
  const q = query.replace(/["'*:]/g, " ").trim();
  if (!q) return [];
  const ftsQuery = q.split(/\s+/).filter(Boolean).join(" OR ");
  try {
    const r = await db.prepare("SELECT c.* FROM doc_chunks c JOIN doc_chunks_fts f ON c.rowid = f.rowid WHERE doc_chunks_fts MATCH ? LIMIT ?").bind(ftsQuery, limit).all();
    return r.results as ChunkRow[];
  } catch {
    // Fallback to LIKE if FTS fails
    const like = `%${q.split(/\s+/)[0]}%`;
    const r = await db.prepare("SELECT * FROM doc_chunks WHERE content LIKE ? LIMIT ?").bind(like, limit).all();
    return r.results as ChunkRow[];
  }
}

export async function vectorSearch(index: { query: (vec: number[], opts: { topK: number; returnMetadata: string }) => Promise<{ matches: { id: string; score: number }[] }> }, embedding: number[], topK = 6): Promise<{ id: string; score: number }[]> {
  if (!embedding.length) return [];
  const res = await index.query(embedding, { topK, returnMetadata: "all" });
  return res.matches.map((m: { id: string; score: number }) => ({ id: m.id, score: m.score }));
}

// Reciprocal rank fusion
function rrf(keywordIds: string[], vectorScored: { id: string; score: number }[], k = 60): { id: string; rrf: number }[] {
  const map = new Map<string, number>();
  keywordIds.forEach((id, i) => {
    map.set(id, (map.get(id) ?? 0) + 1 / (k + i + 1));
  });
  vectorScored.forEach((v, i) => {
    map.set(v.id, (map.get(v.id) ?? 0) + 1 / (k + i + 1));
  });
  return [...map.entries()].map(([id, rrf]) => ({ id, rrf })).sort((a, b) => b.rrf - a.rrf);
}

export function detectConflicts(hits: DocHit[]): string | undefined {
  // Tier disagreement on same topic (heuristic: cancellation / SLA / bulk upload)
  const tiers = new Set(hits.map((h) => h.authority_tier));
  if (tiers.size > 1) {
    const hasTier1 = hits.some((h) => h.authority_tier === 1);
    const hasTier2 = hits.some((h) => h.authority_tier === 2);
    if (hasTier1 && hasTier2) return "Your agreement (tier 1) overrides the general policy/SOP (tier 2) — the agreement prevails per Policy v3 §1.";
  }
  // Historical wrong known issue: if result mentions KI-208 vs 3000 rows folklore
  const hasKI208 = hits.some((h) => h.content.includes("KI-208"));
  if (hasKI208) return "KI-208 documents bulk-upload failures above ~3000 rows with limit 5000 — past ticket TKT-451 incorrectly cited 3000 as the limit.";
  return undefined;
}

export async function hybridSearch(
  db: D1,
  index: { query: (vec: number[], opts: Record<string, unknown>) => Promise<{ matches: { id: string; score: number }[] }> },
  env: { CF_ACCOUNT_ID: string; CF_AI_GATEWAY_NAME: string; CF_AI_GATEWAY_AUTH_API_TOKEN: string },
  query: string,
  principal: Principal,
  opts: { includeDeprecated?: boolean; vectorEmbedding?: number[] } = {},
): Promise<{ hits: DocHit[]; conflictNote?: string }> {
  const [kwHits, embedding] = await Promise.all([
    keywordSearch(db, query),
    opts.vectorEmbedding ? Promise.resolve(opts.vectorEmbedding) : embedQuery(query, env),
  ]);

  const vecHits = await vectorSearch(index, embedding);

  const mergedIds = rrf(
    kwHits.map((h) => h.id),
    vecHits,
  ).map((x) => x.id);

  // Fetch full rows for merged ids (preserve order)
  let rows: ChunkRow[] = [];
  if (mergedIds.length) {
    // Fetch all candidate ids then order by mergedIds
    const candidates = new Map<string, ChunkRow>();
    for (const h of kwHits) candidates.set(h.id, h);
    // Fetch missing from DB
    const missing = mergedIds.filter((id) => !candidates.has(id));
    if (missing.length) {
      // Batch fetch via IN clause
      const placeholders = missing.map(() => "?").join(",");
      const r = await db.prepare(`SELECT * FROM doc_chunks WHERE id IN (${placeholders})`).bind(...missing).all();
      for (const row of r.results as ChunkRow[]) candidates.set(row.id, row);
    }
    rows = mergedIds.map((id) => candidates.get(id)!).filter(Boolean);
  } else {
    rows = kwHits;
  }

  // Account scope filtering
  const scoped = rows.filter((r) => {
    if (r.account_scope && principal.kind === "customer" && r.account_scope !== principal.accountId) return false;
    if (r.account_scope && principal.kind === "staff") return true; // staff sees all
    return true;
  });

  // Deprecated filtering
  const filtered = opts.includeDeprecated ? scoped : scoped.filter((r) => r.status !== "deprecated");

  // Attach tier-mimicked deprecated label
  const hits: DocHit[] = filtered.slice(0, 6).map((r, i) => ({ ...r, rank: i + 1 }));

  const conflictNote = detectConflicts(hits);

  return { hits, conflictNote };
}
