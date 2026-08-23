import fs from "node:fs";

const chunks: { id: string; content: string }[] = JSON.parse(fs.readFileSync("data/corpus/chunks.json", "utf8"));

async function run() {
  const env = Object.fromEntries(
    fs.readFileSync(".env", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_AI_GATEWAY_NAME}/openai/embeddings`;
  const headers = { "Content-Type": "application/json", "cf-aig-authorization": `Bearer ${env.CF_AI_GATEWAY_AUTH_API_TOKEN}` };

  // Batch embeddings (text-embedding-3-small)
  const embeddings: Record<string, number[]> = {};
  const BATCH = 10;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "text-embedding-3-small", input: batch.map((c) => c.content) }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Embeddings failed ${res.status}: ${t.slice(0, 800)}`);
    }
    const j = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    for (const d of j.data) embeddings[batch[d.index].id] = d.embedding;
    console.log(`Embedded batch ${i / BATCH + 1}/${Math.ceil(chunks.length / BATCH)}`);
  }

  // Write enriched chunks with embeddings
  const enriched = JSON.parse(fs.readFileSync("data/corpus/chunks.json", "utf8")).map((c: { id: string }) => ({ ...c, embedding: embeddings[c.id] }));
  fs.writeFileSync("data/corpus/chunks-with-embeddings.json", JSON.stringify(enriched, null, 2));
  console.log("Wrote data/corpus/chunks-with-embeddings.json");

  // Also seed D1 + Vectorize via wrangler
  // Generate SQL dump for D1
  const full = JSON.parse(fs.readFileSync("data/corpus/chunks.json", "utf8")) as {
    id: string; doc_id: string; title: string; section: string; content: string; authority_tier: number; status: string; account_scope: string | null; effective_date: string | null;
  }[];
  let sql = "DELETE FROM doc_chunks; DELETE FROM doc_chunks_fts;\n";
  for (const c of full) {
    const esc = (s: string) => s.replace(/'/g, "''");
    sql += `INSERT INTO doc_chunks (id, doc_id, title, section, content, authority_tier, status, account_scope, effective_date) VALUES ('${c.id}','${esc(c.doc_id)}','${esc(c.title)}','${esc(c.section)}','${esc(c.content)}',${c.authority_tier},'${c.status}',${c.account_scope ? `'${c.account_scope}'` : "NULL"},${c.effective_date ? `'${c.effective_date}'` : "NULL"});\n`;
  }
  fs.writeFileSync("/tmp/docs_seed.sql", sql);
  console.log("Wrote /tmp/docs_seed.sql");
}

run().catch((e) => { console.error(e); process.exit(1); });
