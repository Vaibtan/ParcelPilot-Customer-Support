import fs from "node:fs";

const enriched: { id: string; content: string; embedding: number[]; authority_tier: number; account_scope: string | null; status: string }[] = JSON.parse(
  fs.readFileSync("data/corpus/chunks-with-embeddings.json", "utf8"),
);

async function run() {
  // Use wrangler vectorize insert via CLI wrapper: generate ndjson and use wrangler
  // But wrangler vectorize insert expects file with vectors — easiest is to use the index via fetch with bearer
  // For simplicity, use wrangler CLI bulk insert by writing vectors file
  const vectors = enriched
    .filter((c) => c.status !== "deprecated") // still index deprecated but mark metadata
    .map((c) => ({
      id: c.id,
      values: c.embedding,
      metadata: { tier: c.authority_tier, scope: c.account_scope ?? "general", status: c.status, title: c.content.slice(0, 80) },
    }));
  fs.writeFileSync("/tmp/vectors.json", JSON.stringify(vectors, null, 2));
  console.log(`Prepared ${vectors.length} vectors -> /tmp/vectors.json`);

  // Also include deprecated for explicit flag testing (separate)
  const deprecated = enriched.filter((c) => c.status === "deprecated").map((c) => ({
    id: c.id,
    values: c.embedding,
    metadata: { tier: c.authority_tier, scope: c.account_scope ?? "general", status: c.status },
  }));
  fs.writeFileSync("/tmp/vectors_deprecated.json", JSON.stringify(deprecated, null, 2));
  console.log(`Deprecated vectors ${deprecated.length} -> /tmp/vectors_deprecated.json`);
}

run();
