import { computeSla } from "./policy-engine";

type Ticket = {
  ticket_id: string;
  account_id: string;
  created_at: string | null;
  status: string;
  subject: string | null;
  description: string | null;
  channel: string | null;
};

type Order = {
  order_id: string;
  account_id: string;
  carrier: string | null;
  status: string;
  pickup_window_end: string | null;
  carrier_fault: number;
};

type Account = { account_id: string; plan: string };

type Insight = {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string | null;
  evidence_json: string;
  rationale: string;
};

function inferSeverity(ticket: Ticket): "P1" | "P2" | "P3" {
  const s = `${ticket.subject ?? ""} ${ticket.description ?? ""}`.toLowerCase();
  if (s.includes("500") || s.includes("all shipment") || s.includes("failing") || s.includes("outage") || s.includes("api key") || s.includes("exposure") || s.includes("credential")) return "P1";
  if (s.includes("bulk upload") || s.includes("major") || s.includes("webhook")) return "P2";
  return "P3";
}

function ticketSeverity(ticket: Ticket): "P1" | "P2" | "P3" {
  return inferSeverity(ticket);
}

export function slaInsights(
  tickets: Ticket[],
  accounts: Map<string, Account>,
  nowIso: string,
): Insight[] {
  const insights: Insight[] = [];
  for (const t of tickets.filter((x) => x.status === "open" && x.created_at)) {
    const acct = accounts.get(t.account_id);
    if (!acct) continue;
    const sev = ticketSeverity(t);
    const sla = computeSla({ accountId: t.account_id, plan: acct.plan, severity: sev, createdAt: t.created_at!, nowIso });
    const approachingMs = 30 * 60000; // 30m window
    if (sla.breached) {
      insights.push({
        id: `sla-breach-${t.ticket_id}`,
        type: "sla_breach",
        severity: sev === "P1" ? "critical" : "high",
        title: `SLA breached: ${t.ticket_id} (${sev})`,
        summary: `${t.subject ?? t.ticket_id} — ${sev} target ${sla.target} via ${sla.targetSource} breached at ${sla.deadline}`,
        evidence_json: JSON.stringify({ ticket_id: t.ticket_id, account_id: t.account_id, severity: sev, target: sla.target, deadline: sla.deadline }),
        rationale: JSON.stringify(sla.trace),
      });
    } else if (sla.remainingMs <= approachingMs) {
      insights.push({
        id: `sla-approaching-${t.ticket_id}`,
        type: "sla_approaching",
        severity: "medium",
        title: `SLA approaching: ${t.ticket_id} (${sev})`,
        summary: `${t.ticket_id} breaches in ${Math.round(sla.remainingMs / 60000)}m (target ${sla.target})`,
        evidence_json: JSON.stringify({ ticket_id: t.ticket_id, account_id: t.account_id, severity: sev, remainingMs: sla.remainingMs }),
        rationale: JSON.stringify(sla.trace),
      });
    }
  }
  return insights.sort((a, b) => {
    const ord: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (ord[a.severity] ?? 9) - (ord[b.severity] ?? 9);
  });
}

export function clusteringInsights(tickets: Ticket[]): Insight[] {
  const open = tickets.filter((t) => t.status === "open");
  // Group bulk upload failures
  const bulk = open.filter((t) => (t.subject?.toLowerCase().includes("bulk") || t.description?.toLowerCase().includes("csv")));
  if (bulk.length >= 2) {
    return [{
      id: "cluster-bulk-upload",
      type: "recurring_cluster",
      severity: "high",
      title: "Recurring: Bulk upload failures",
      summary: `${bulk.length} tickets report bulk/Csv upload failures — linked to KI-208 (split uploads <3000 rows)`,
      evidence_json: JSON.stringify({ ticket_ids: bulk.map((t) => t.ticket_id), known_issue: "KI-208" }),
      rationale: "Keyword clustering on 'bulk'/'CSV'; KI-208 is the current known issue for >3000-row failures (limit remains 5000)",
    }];
  }
  if (bulk.length === 1) {
    return [{
      id: "cluster-bulk-single",
      type: "known_issue_link",
      severity: "medium",
      title: "Bulk upload failure — check KI-208",
      summary: `${bulk[0].ticket_id} matches KI-208 (intermittent failures above ~3000 rows, workaround split <3000)`,
      evidence_json: JSON.stringify({ ticket_id: bulk[0].ticket_id, known_issue: "KI-208" }),
      rationale: "Single ticket matches KI-208",
    }];
  }
  return [];
}

export function carrierInsights(tickets: Ticket[], orders: Order[]): Insight[] {
  const insights: Insight[] = [];
  // SwiftShip webhook delay affects multiple tickets/orders with SwiftShip + BOOKED
  const swiftTickets = tickets.filter((t) => t.subject?.toLowerCase().includes("swiftship") || t.description?.toLowerCase().includes("swiftship"));
  const swiftOrders = orders.filter((o) => o.carrier === "SwiftShip" && o.status === "BOOKED");
  if (swiftTickets.length || swiftOrders.length >= 2) {
    insights.push({
      id: "carrier-swiftship",
      type: "carrier_pattern",
      severity: "medium",
      title: "Carrier SwiftShip — webhook delay (KI-211)",
      summary: `SwiftShip pickups may show BOOKED up to 20m after collection (KI-211). ${swiftTickets.length} tickets, ${swiftOrders.length} BOOKED orders`,
      evidence_json: JSON.stringify({ carrier: "SwiftShip", ticket_ids: swiftTickets.map((t) => t.ticket_id), order_ids: swiftOrders.map((o) => o.order_id), known_issue: "KI-211" }),
      rationale: "KI-211: SwiftShip webhook delay up to 20m",
    });
  }
  // RoadRunner unresolved carrier-fault order
  const roadrunnerUnresolved = orders.filter((o) => o.carrier === "RoadRunner" && o.status === "BOOKED" && o.carrier_fault);
  for (const o of roadrunnerUnresolved) {
    insights.push({
      id: `carrier-roadrunner-${o.order_id}`,
      type: "unresolved_carrier_fault",
      severity: "high",
      title: `Unresolved carrier fault: ${o.order_id} (RoadRunner)`,
      summary: `${o.order_id} missed pickup, carrier accepted fault, still BOOKED at snapshot`,
      evidence_json: JSON.stringify({ order_id: o.order_id, account_id: o.account_id, carrier: "RoadRunner" }),
      rationale: "Carrier fault with no pickup confirmation",
    });
  }
  // Cross-account carrier affecting multiple accounts (RoadRunner)
  const carriers = new Map<string, Set<string>>();
  for (const o of orders) if (o.carrier) {
    if (!carriers.has(o.carrier)) carriers.set(o.carrier, new Set());
    carriers.get(o.carrier)!.add(o.account_id);
  }
  for (const [carrier, accounts] of carriers) {
    if (accounts.size >= 2 && carrier !== "SwiftShip") {
      // already covered SwiftShip
      insights.push({
        id: `carrier-cross-${carrier}`,
        type: "cross_account",
        severity: "medium",
        title: `Cross-account carrier: ${carrier} affects ${accounts.size} accounts`,
        summary: `${carrier} appears across accounts: ${[...accounts].join(", ")}`,
        evidence_json: JSON.stringify({ carrier, account_ids: [...accounts] }),
        rationale: "Multiple accounts share same carrier",
      });
    }
  }
  return insights;
}

export function allInsights(
  tickets: Ticket[],
  orders: Order[],
  accounts: Account[],
  nowIso = "2026-08-16 11:00",
): Insight[] {
  const map = new Map<string, Account>(accounts.map((a) => [a.account_id, a]));
  return [
    ...slaInsights(tickets, map, nowIso),
    ...clusteringInsights(tickets),
    ...carrierInsights(tickets, orders),
  ];
}
