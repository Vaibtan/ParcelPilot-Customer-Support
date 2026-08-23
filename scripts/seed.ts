import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const PACK = "AI Agent Assessment - Candidate Pack/ParcelPilot_Assessment_Data.xlsx";

type D1Like = { prepare: (sql: string) => { bind: (...a: unknown[]) => { run: () => Promise<unknown>; first: () => Promise<unknown> }; run: () => Promise<unknown>; first: () => Promise<unknown> } };

async function seed(db: D1Like) {
  const wb = XLSX.readFile(PACK);
  const accounts = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["accounts"], { defval: null });
  const orders = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["orders"], { defval: null });
  const tickets = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["tickets"], { defval: null });

  // Schema — run migration inline for local dev without wrangler d1 execute
  const schema = fs.readFileSync(path.join("migrations/001_init.sql"), "utf8");
  // Split on ; and execute each statement that is not empty
  for (const stmt of schema.split(";")) {
    const s = stmt.trim();
    if (!s || s.startsWith("--")) continue;
    // Naive: skip comment lines inside
    try {
      await db.prepare(s).run();
    } catch (e) {
      // FTS triggers may fail on re-run; ignore "already exists"
      const msg = String(e);
      if (!msg.includes("already exists")) throw e;
    }
  }

  // Idempotent: delete then insert (simple for assessment dataset)
  await db.prepare("DELETE FROM tickets").run();
  await db.prepare("DELETE FROM orders").run();
  await db.prepare("DELETE FROM accounts").run();

  for (const r of accounts) {
    if (!r.account_id) continue;
    await db
      .prepare(
        "INSERT INTO accounts (account_id, account_name, plan, status, csm, contract_file, premium_support, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        String(r.account_id),
        String(r.account_name ?? ""),
        String(r.plan ?? ""),
        String(r.status ?? ""),
        r.csm ? String(r.csm) : null,
        r.contract_file ? String(r.contract_file) : null,
        r.premium_support ? 1 : 0,
        r.notes ? String(r.notes) : null,
      )
      .run();
  }

  for (const r of orders) {
    if (!r.order_id) continue;
    await db
      .prepare(
        "INSERT INTO orders (order_id, account_id, carrier, status, booked_at, pickup_window_start, pickup_window_end, pickup_actual_at, shipment_fee_inr, carrier_fault, customer_fault, cancellation_requested_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        String(r.order_id),
        String(r.account_id),
        r.carrier ? String(r.carrier) : null,
        String(r.status ?? ""),
        r.booked_at ? String(r.booked_at) : null,
        r.pickup_window_start ? String(r.pickup_window_start) : null,
        r.pickup_window_end ? String(r.pickup_window_end) : null,
        r.pickup_actual_at ? String(r.pickup_actual_at) : null,
        r.shipment_fee_inr != null ? Number(r.shipment_fee_inr) : null,
        r.carrier_fault ? 1 : 0,
        r.customer_fault ? 1 : 0,
        r.cancellation_requested_at ? String(r.cancellation_requested_at) : null,
        r.notes ? String(r.notes) : null,
      )
      .run();
  }

  for (const r of tickets) {
    if (!r.ticket_id) continue;
    await db
      .prepare(
        "INSERT INTO tickets (ticket_id, account_id, created_at, status, subject, description, channel, assigned_to, last_customer_message_at, historical_resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        String(r.ticket_id),
        String(r.account_id),
        r.created_at ? String(r.created_at) : null,
        String(r.status ?? ""),
        r.subject ? String(r.subject) : null,
        r.description ? String(r.description) : null,
        r.channel ? String(r.channel) : null,
        r.assigned_to ? String(r.assigned_to) : null,
        r.last_customer_message_at ? String(r.last_customer_message_at) : null,
        r.historical_resolution ? String(r.historical_resolution) : null,
      )
      .run();
  }

  console.log(`Seeded ${accounts.filter((r) => r.account_id).length} accounts, ${orders.filter((r) => r.order_id).length} orders, ${tickets.filter((r) => r.ticket_id).length} tickets`);
}

// If run directly via tsx, use wrangler D1 via HTTP if available, else use local sqliteish path?
// For now, support: npx wrangler d1 execute parcelpilot-db --file migrations/001_init.sql
// and seed via wrangler d1 execute with generated SQL dump.

if (import.meta.url.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.ts")) {
  // When run with `tsx scripts/seed.ts --local` we build a SQL dump and exec via wrangler
  const local = process.argv.includes("--local");
  if (local) {
    // Use better-sqlite3 if available for local testing — fallback to dump
    console.log("Local seed: generating SQL dump at /tmp/seed.sql — run with wrangler d1 execute");
    const wb = XLSX.readFile(PACK);
    const accounts = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["accounts"], { defval: null });
    const orders = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["orders"], { defval: null });
    const tickets = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["tickets"], { defval: null });
    let sql = fs.readFileSync("migrations/001_init.sql", "utf8") + "\n";
    sql += "DELETE FROM tickets; DELETE FROM orders; DELETE FROM accounts;\n";
    for (const r of accounts) {
      if (!r.account_id) continue;
      sql += `INSERT INTO accounts VALUES ('${r.account_id}','${String(r.account_name).replace(/'/g, "''")}','${r.plan}','${r.status}','${r.csm ?? ""}','${r.contract_file ?? ""}',${r.premium_support ? 1 : 0},'${String(r.notes ?? "").replace(/'/g, "''")}');\n`;
    }
    for (const r of orders) {
      if (!r.order_id) continue;
      sql += `INSERT INTO orders VALUES ('${r.order_id}','${r.account_id}','${r.carrier ?? ""}','${r.status}','${r.booked_at ?? ""}','${r.pickup_window_start ?? ""}','${r.pickup_window_end ?? ""}','${r.pickup_actual_at ?? ""}',${r.shipment_fee_inr ?? "NULL"},${r.carrier_fault ? 1 : 0},${r.customer_fault ? 1 : 0},'${r.cancellation_requested_at ?? ""}','${String(r.notes ?? "").replace(/'/g, "''")}');\n`;
    }
    for (const r of tickets) {
      if (!r.ticket_id) continue;
      sql += `INSERT INTO tickets VALUES ('${r.ticket_id}','${r.account_id}','${r.created_at ?? ""}','${r.status}','${String(r.subject ?? "").replace(/'/g, "''")}','${String(r.description ?? "").replace(/'/g, "''")}','${r.channel ?? ""}','${r.assigned_to ?? ""}','${r.last_customer_message_at ?? ""}','${String(r.historical_resolution ?? "").replace(/'/g, "''")}');\n`;
    }
    fs.writeFileSync("/tmp/seed.sql", sql);
    console.log("Wrote /tmp/seed.sql");
  } else {
    console.log("Usage: tsx scripts/seed.ts --local (then wrangler d1 execute) or import seed() from worker");
  }
}

export { seed };
