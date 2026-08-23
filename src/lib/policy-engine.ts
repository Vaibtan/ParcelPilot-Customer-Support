/**
 * Pure deterministic policy engine — no LLM, no I/O.
 * Implements cancellation, service-credit, and SLA logic from the data pack PDFs.
 */

export type CancellationInput = {
  accountId: string;
  order: { status: string; booked_at: string | null; cancellation_requested_at: string | null };
};

export type CreditInput = {
  accountId: string;
  order: { pickup_window_end: string | null; carrier_fault: number | boolean; customer_fault: number | boolean; shipment_fee_inr: number | null };
  nowIso: string; // snapshot clock
};

export type SlaInput = {
  accountId: string;
  plan: string; // Enterprise / Growth / Standard
  severity: "P1" | "P2" | "P3";
  createdAt: string;
  nowIso: string;
};

// Northstar agreement: no cancellation fee ever for BOOKED before pickup
function isNorthstar(accountId: string): boolean { return accountId === "ACCT-001"; }
function isLumenWorks(accountId: string): boolean { return accountId === "ACCT-002"; }

export type RuleTrace = { rule: string; source: string; detail: string };

export type CancellationResult = {
  canCancel: boolean;
  feeInr: number | null; // null if cannot cancel
  reason: string;
  trace: RuleTrace[];
  conflictNote?: string;
};

export function quoteCancellation(input: CancellationInput, nowIso: string = "2026-08-16T11:00:00+05:30"): CancellationResult {
  const trace: RuleTrace[] = [];
  const status = input.order.status;

  if (status === "DELIVERED") {
    trace.push({ rule: "DELIVERED cannot be cancelled", source: "SOP v4 §1", detail: `status=${status}` });
    return { canCancel: false, feeInr: null, reason: "Delivered orders cannot be cancelled", trace };
  }
  if (status === "PICKED_UP") {
    trace.push({ rule: "PICKED_UP: return-to-origin", source: "SOP v4 §1 / Northstar §2", detail: `status=${status}` });
    return { canCancel: false, feeInr: null, reason: "Already picked up — use return-to-origin workflow", trace };
  }
  if (status === "DRAFT") {
    trace.push({ rule: "DRAFT no fee", source: "SOP v4 §1", detail: "DRAFT" });
    return { canCancel: true, feeInr: 0, reason: "Draft orders cancel with no fee", trace };
  }
  // BOOKED (or similar)
  if (status !== "BOOKED") {
    trace.push({ rule: `Unknown status ${status} treated as not cancellable`, source: "SOP v4 §1", detail: status });
    return { canCancel: false, feeInr: null, reason: `Status ${status} cannot be cancelled`, trace };
  }

  // Northstar override
  if (isNorthstar(input.accountId)) {
    trace.push({ rule: "Northstar: BOOKED before pickup no fee regardless of elapsed time", source: "Northstar Agreement §2", detail: `account=${input.accountId}` });
    // Conflict note vs SOP default
    return {
      canCancel: true,
      feeInr: 0,
      reason: "No fee — your enterprise agreement waives cancellation fees for BOOKED shipments before pickup",
      trace,
      conflictNote: "SOP v4 would charge INR 250 after 30 minutes, but your agreement waives it",
    };
  }

  // Default SOP: fee depends on elapsed minutes since booking
  const bookedAt = input.order.booked_at ? new Date(input.order.booked_at) : null;
  const requestedAt = input.order.cancellation_requested_at ? new Date(input.order.cancellation_requested_at) : new Date(nowIso);
  if (!bookedAt) {
    trace.push({ rule: "Missing booked_at — treat as unknown, no fee quoted without facts", source: "SOP v4 §1", detail: "booked_at null" });
    return { canCancel: true, feeInr: null, reason: "Cannot determine fee — missing booking time", trace };
  }
  const elapsedMin = (requestedAt.getTime() - bookedAt.getTime()) / 60000;
  trace.push({ rule: "SOP: no fee within 30 min, INR 250 after", source: "SOP v4 §1", detail: `elapsed=${elapsedMin.toFixed(1)} min, bookedAt=${input.order.booked_at}, requestedAt=${input.order.cancellation_requested_at ?? nowIso}` });
  if (elapsedMin <= 30) {
    return { canCancel: true, feeInr: 0, reason: "Within 30 minutes of booking — no fee", trace };
  }
  return { canCancel: true, feeInr: 250, reason: "After 30 minutes — INR 250 cancellation fee applies", trace };
}

export type CreditResult = {
  eligible: boolean;
  creditInr: number | null;
  reason: string;
  trace: RuleTrace[];
  requiresManagerApproval?: boolean;
  aggregateCapNote?: string;
};

export function quoteCredit(input: CreditInput): CreditResult {
  const trace: RuleTrace[] = [];
  const isLumen = isLumenWorks(input.accountId);
  const isNorth = isNorthstar(input.accountId);

  // Check fault flags
  const carrierFault = !!input.order.carrier_fault;
  const customerFault = !!input.order.customer_fault;
  trace.push({ rule: "Fault check", source: isLumen ? "LumenWorks Agreement §3" : "SOP v4 §2", detail: `carrierFault=${carrierFault}, customerFault=${customerFault}` });

  if (customerFault) {
    trace.push({ rule: "Customer at fault — no credit", source: "SOP v4 §2", detail: "customer_fault true" });
    return { eligible: false, creditInr: null, reason: "No credit when issue is customer-caused", trace };
  }
  if (!carrierFault) {
    trace.push({ rule: "Carrier not at fault — no credit", source: "SOP v4 §2", detail: "carrier_fault false" });
    return { eligible: false, creditInr: null, reason: "No credit when carrier is not at fault", trace };
  }

  const windowEnd = input.order.pickup_window_end ? new Date(input.order.pickup_window_end) : null;
  if (!windowEnd) {
    trace.push({ rule: "Missing pickup_window_end", source: "SOP v4 §2", detail: "pickup_window_end null" });
    return { eligible: false, creditInr: null, reason: "Cannot determine delay — missing pickup window", trace };
  }
  const now = new Date(input.nowIso);
  const delayMs = now.getTime() - windowEnd.getTime();
  const delayHours = delayMs / 3600000;
  trace.push({ rule: `Delay past window end: ${delayHours.toFixed(2)}h`, source: "computed vs snapshot clock", detail: `windowEnd=${input.order.pickup_window_end}, now=${input.nowIso}` });

  // LumenWorks: fixed 4h threshold, fixed INR 300
  if (isLumen) {
    const thresholdHours = 4;
    trace.push({ rule: `LumenWorks fixed threshold ${thresholdHours}h, fixed INR 300`, source: "LumenWorks Agreement §3 (replaces SOP threshold/amount)", detail: `delay=${delayHours.toFixed(2)}h vs ${thresholdHours}h` });
    if (delayHours <= thresholdHours) {
      return { eligible: false, creditInr: null, reason: `Pickup delay ${delayHours.toFixed(1)}h does not exceed LumenWorks 4-hour threshold`, trace };
    }
    const credit = 300;
    trace.push({ rule: "Fixed credit INR 300", source: "LumenWorks §3", detail: `credit=${credit}` });
    return { eligible: true, creditInr: credit, reason: "Eligible for INR 300 service credit per your agreement", trace };
  }

  // Default: 2h threshold, lower-of INR 500 or 10%
  const thresholdHours = 2;
  trace.push({ rule: `Default threshold ${thresholdHours}h`, source: "SOP v4 §2", detail: `delay=${delayHours.toFixed(2)}h vs ${thresholdHours}h` });
  if (delayHours <= thresholdHours) {
    return { eligible: false, creditInr: null, reason: `Pickup delay ${delayHours.toFixed(1)}h does not exceed 2-hour threshold`, trace };
  }
  const fee = input.order.shipment_fee_inr ?? 0;
  const tenPct = Math.round(fee * 0.1);
  const credit = Math.min(500, tenPct);
  trace.push({ rule: "Default credit lower-of INR 500 or 10% fee", source: "SOP v4 §2", detail: `fee=${fee}, 10%=${tenPct}, credit=${credit}` });
  const requiresManagerApproval = credit > 1000;
  if (requiresManagerApproval) trace.push({ rule: "Manager approval required > INR 1000", source: "SOP v4 §3", detail: `credit=${credit}` });
  const aggregateCapNote = isNorth ? "Monthly aggregate cap INR 5,000 per Northstar Agreement §3" : undefined;
  if (aggregateCapNote) trace.push({ rule: aggregateCapNote, source: "Northstar §3", detail: "cap" });
  return {
    eligible: true,
    creditInr: credit,
    reason: `Eligible for INR ${credit} credit (lower of INR 500 or 10% of INR ${fee})`,
    trace,
    requiresManagerApproval: requiresManagerApproval || undefined,
    aggregateCapNote,
  };
}

// SLA

// Business hours: Mon-Fri 09:00-18:00 IST (Asia/Kolkata). Enterprise P1 24x7 where stated.
const BUSINESS_START_H = 9;
const BUSINESS_END_H = 18;

function toIST(date: Date): Date {
  // Convert to IST by offset — input strings like "2026-08-16 10:30" are IST wall time without tz
  // We'll treat them as IST and parse manually
  return date;
}

function parseIST(s: string): Date {
  // s like "2026-08-16 10:30" (no tz) — interpret as IST
  // Append +05:30 to get correct UTC
  if (s.includes("+") || s.endsWith("Z")) return new Date(s);
  return new Date(s.replace(" ", "T") + "+05:30");
}

function isWeekendIST(d: Date): boolean {
  // Get IST day: UTC +5:30
  const utc = d.getTime() + 5.5 * 3600000;
  const day = new Date(utc).getUTCDay();
  return day === 0 || day === 6;
}

function addBusinessHours(start: Date, hours: number): Date {
  let remaining = hours * 3600000;
  let cur = new Date(start);
  while (remaining > 0) {
    if (isWeekendIST(cur)) {
      // jump to Monday 09:00 IST
      const utc = cur.getTime() + 5.5 * 3600000;
      const d = new Date(utc);
      // advance to next Monday
      let daysToAdd = dayToMonday(d.getUTCDay());
      cur = new Date(cur.getTime() + daysToAdd * 86400000);
      // set to 09:00 IST (03:30 UTC)
      const base = new Date(cur.getTime() + 5.5 * 3600000);
      cur = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 3, 30, 0));
      continue;
    }
    const curISTHour = (cur.getTime() + 5.5 * 3600000) % 86400000 / 3600000;
    // If before business start, jump to start
    if (curISTHour < BUSINESS_START_H) {
      const base = new Date(cur.getTime() + 5.5 * 3600000);
      cur = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 3, 30, 0));
      continue;
    }
    if (curISTHour >= BUSINESS_END_H) {
      // next day 09:00
      cur = new Date(cur.getTime() + 86400000);
      const base = new Date(cur.getTime() + 5.5 * 3600000);
      cur = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 3, 30, 0));
      continue;
    }
    // Within business hours — consume until end or remaining
    const endOfDayIST = BUSINESS_END_H * 3600000;
    const msUntilEnd = endOfDayIST - curISTHour * 3600000;
    const consume = Math.min(remaining, msUntilEnd);
    cur = new Date(cur.getTime() + consume);
    remaining -= consume;
  }
  return cur;
}

function dayToMonday(dow: number): number {
  if (dow === 0) return 1; // Sun -> Mon
  if (dow === 6) return 2; // Sat -> Mon
  return 1;
}

function parseHoursTarget(s: string): { hours?: number; minutes?: number; is247?: boolean } {
  // e.g. "30 minutes, 24x7" or "2 hours" or "1 business day"
  const lower = s.toLowerCase();
  const is247 = lower.includes("24x7");
  const mMin = lower.match(/(\d+)\s*minutes?/);
  if (mMin) return { minutes: Number(mMin[1]), is247 };
  const mH = lower.match(/(\d+)\s*hours?/);
  if (mH) return { hours: Number(mH[1]), is247 };
  const mDay = lower.match(/(\d+)\s*business days?/);
  if (mDay) return { hours: Number(mDay[1]) * 9, is247: false }; // 1 business day = 9h (09-18)
  return { hours: 24 };
}

function getContractSLA(accountId: string, severity: string): string | null {
  if (accountId === "ACCT-001") {
    // Northstar
    if (severity === "P1") return "15 minutes, 24x7";
    if (severity === "P2") return "1 hour";
    if (severity === "P3") return "8 business hours";
  }
  if (accountId === "ACCT-002") {
    if (severity === "P1") return "2 business hours";
    if (severity === "P2") return "4 business hours";
    if (severity === "P3") return "2 business days";
  }
  return null;
}

function getDefaultSLA(plan: string, severity: string): string {
  // From Policy v3 §3
  if (plan === "Enterprise") {
    if (severity === "P1") return "30 minutes, 24x7";
    if (severity === "P2") return "2 hours";
    if (severity === "P3") return "1 business day";
  }
  if (plan === "Growth") {
    if (severity === "P1") return "2 business hours";
    if (severity === "P2") return "4 business hours";
    if (severity === "P3") return "2 business days";
  }
  // Standard
  if (severity === "P1") return "4 business hours";
  if (severity === "P2") return "1 business day";
  if (severity === "P3") return "2 business days";
  return "1 business day";
}

export type SlaResult = {
  target: string;
  targetSource: string;
  deadline: string;
  breached: boolean;
  remainingMs: number;
  trace: RuleTrace[];
};

export function computeSla(input: SlaInput): SlaResult {
  const trace: RuleTrace[] = [];
  const contract = getContractSLA(input.accountId, input.severity);
  const targetStr = contract ?? getDefaultSLA(input.plan, input.severity);
  const source = contract ? (input.accountId === "ACCT-001" ? "Northstar Agreement §1" : "LumenWorks Agreement §1") : `Policy v3 §3 (${input.plan} ${input.severity})`;
  trace.push({ rule: `Target ${targetStr}`, source, detail: `account=${input.accountId} plan=${input.plan} severity=${input.severity}` });

  const parsed = parseHoursTarget(targetStr);
  const created = parseIST(input.createdAt);
  const now = parseIST(input.nowIso);

  let deadline: Date;
  if (parsed.minutes) {
    // Minutes: if 24x7, wall-clock; else business. For P1 15/30 min with 24x7 -> wall
    if (parsed.is247) {
      deadline = new Date(created.getTime() + parsed.minutes * 60000);
      trace.push({ rule: `Wall-clock +${parsed.minutes}m (24x7)`, source, detail: `created=${input.createdAt} -> deadline=${deadline.toISOString()}` });
    } else {
      deadline = addBusinessHours(created, parsed.minutes / 60);
      trace.push({ rule: `Business +${parsed.minutes}m`, source, detail: `deadline=${deadline.toISOString()}` });
    }
  } else if (parsed.hours !== undefined) {
    if (parsed.is247) {
      deadline = new Date(created.getTime() + parsed.hours * 3600000);
      trace.push({ rule: `Wall-clock +${parsed.hours}h (24x7)`, source, detail: `deadline=${deadline.toISOString()}` });
    } else {
      deadline = addBusinessHours(created, parsed.hours);
      trace.push({ rule: `Business +${parsed.hours}h (Mon-Fri 09-18 IST)`, source, detail: `created=${input.createdAt} deadline=${deadline.toISOString()}` });
    }
  } else {
    deadline = new Date(created.getTime() + 24 * 3600000);
    trace.push({ rule: "Fallback +24h", source, detail: `deadline=${deadline.toISOString()}` });
  }

  const breached = now.getTime() > deadline.getTime();
  const remainingMs = deadline.getTime() - now.getTime();
  trace.push({ rule: breached ? "BREACHED" : "Within SLA", source: "snapshot clock", detail: `now=${input.nowIso} deadline=${deadline.toISOString()} breached=${breached}` });

  return { target: targetStr, targetSource: source, deadline: deadline.toISOString(), breached, remainingMs, trace };
}
