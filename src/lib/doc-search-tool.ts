import type { ToolDef } from "./tools";
import { hybridSearch } from "./doc-search";

type Deps = { db: unknown; index: unknown; env: unknown };

export function docSearchTool(deps: Deps): ToolDef {
  return {
    name: "search_docs",
    description: "Search ParcelPilot policies, SOP, product documentation, and your signed agreement (if any). Returns chunks with tier, status, and citations. Deprecated docs excluded unless requested. Historical tickets are context-only.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, e.g. 'cancellation fee after 30 minutes' or 'bulk upload limit'" },
        include_deprecated: { type: "boolean", description: "Include deprecated docs for 'what changed' questions" },
      },
      required: ["query"],
    },
    execute: async (args, { principal }) => {
      const query = String(args.query);
      const includeDeprecated = !!args.include_deprecated;
      const db = deps.db as Parameters<typeof hybridSearch>[0];
      const index = deps.index as Parameters<typeof hybridSearch>[1];
      const env = deps.env as Parameters<typeof hybridSearch>[2];
      const { hits, conflictNote } = await hybridSearch(db, index, env, query, principal, { includeDeprecated });
      return {
        query,
        hits: hits.map((h) => ({
          doc_id: h.doc_id,
          title: h.title,
          section: h.section,
          tier: h.authority_tier,
          status: h.status,
          account_scope: h.account_scope,
          citation: `${h.doc_id} §${h.section} (tier ${h.authority_tier}, ${h.status})`,
          snippet: h.content.slice(0, 600),
        })),
        conflict_note: conflictNote ?? null,
      };
    },
  };
}
