import { describe, it, expect } from "vitest";
import { quoteCancellation, quoteCredit, computeSla } from "../src/lib/policy-engine";

const SNAP = "2026-08-16T11:00:00+05:30";

describe("quoteCancellation", () => {
  it("Northstar ORD-1001 no fee (2h after booking, contract waives)", () => {
    const r = quoteCancellation({ accountId: "ACCT-001", order: { status: "BOOKED", booked_at: "2026-08-16 09:00", cancellation_requested_at: "2026-08-16 11:00" } }, SNAP);
    expect(r.canCancel).toBe(true);
    expect(r.feeInr).toBe(0);
    expect(r.conflictNote).toMatch(/waives/i);
    expect(r.trace.some((t) => t.source.includes("Northstar"))).toBe(true);
  });
  it("LumenWorks ORD-2001 fee 250 (75 min after booking)", () => {
    const r = quoteCancellation({ accountId: "ACCT-002", order: { status: "BOOKED", booked_at: "2026-08-16 09:00", cancellation_requested_at: "2026-08-16 10:15" } }, SNAP);
    expect(r.feeInr).toBe(250);
  });
  it("Beacon ORD-3001 no fee within 30 min", () => {
    const r = quoteCancellation({ accountId: "ACCT-003", order: { status: "BOOKED", booked_at: "2026-08-16 10:25", cancellation_requested_at: "2026-08-16 10:40" } }, SNAP);
    expect(r.feeInr).toBe(0);
  });
  it("exactly 30 min no fee boundary", () => {
    const r = quoteCancellation({ accountId: "ACCT-003", order: { status: "BOOKED", booked_at: "2026-08-16 10:30", cancellation_requested_at: "2026-08-16 11:00" } }, SNAP);
    expect(r.feeInr).toBe(0);
  });
  it("31 min fee applies", () => {
    const r = quoteCancellation({ accountId: "ACCT-003", order: { status: "BOOKED", booked_at: "2026-08-16 10:29", cancellation_requested_at: "2026-08-16 11:00" } }, SNAP);
    expect(r.feeInr).toBe(250);
  });
  it("PICKED_UP cannot cancel", () => {
    const r = quoteCancellation({ accountId: "ACCT-001", order: { status: "PICKED_UP", booked_at: "2026-08-16 08:10", cancellation_requested_at: "2026-08-16 10:20" } }, SNAP);
    expect(r.canCancel).toBe(false);
    expect(r.reason).toMatch(/return-to-origin/i);
  });
  it("DELIVERED cannot cancel", () => {
    const r = quoteCancellation({ accountId: "ACCT-004", order: { status: "DELIVERED", booked_at: "2026-08-14 14:00", cancellation_requested_at: null } }, SNAP);
    expect(r.canCancel).toBe(false);
  });
});

describe("quoteCredit", () => {
  it("LumenWorks 3h late — no credit (4h threshold)", () => {
    // window end 06:30, now 11:00 => 4.5h delay, but test 3h case: set window_end to 08:00 => 3h delay
    const r = quoteCredit({ accountId: "ACCT-002", order: { pickup_window_end: "2026-08-16 08:00", carrier_fault: 1, customer_fault: 0, shipment_fee_inr: 2400 }, nowIso: SNAP });
    // 08:00 to 11:00 = 3h, Lumen threshold 4h => not eligible
    expect(r.eligible).toBe(false);
  });
  it("LumenWorks 5h late — eligible fixed 300", () => {
    const r = quoteCredit({ accountId: "ACCT-002", order: { pickup_window_end: "2026-08-16 06:30", carrier_fault: 1, customer_fault: 0, shipment_fee_inr: 2400 }, nowIso: SNAP });
    expect(r.eligible).toBe(true);
    expect(r.creditInr).toBe(300);
  });
  it("Default 3h late — eligible lower-of (Beacon)", () => {
    const r = quoteCredit({ accountId: "ACCT-003", order: { pickup_window_end: "2026-08-16 08:00", carrier_fault: 1, customer_fault: 0, shipment_fee_inr: 2000 }, nowIso: SNAP });
    expect(r.eligible).toBe(true);
    expect(r.creditInr).toBe(200); // 10% of 2000 =200 <500
  });
  it("Default 3h late fee 8000 => credit 500 cap", () => {
    const r = quoteCredit({ accountId: "ACCT-003", order: { pickup_window_end: "2026-08-16 08:00", carrier_fault: 1, customer_fault: 0, shipment_fee_inr: 8000 }, nowIso: SNAP });
    expect(r.creditInr).toBe(500);
  });
  it("Exactly 2h delay threshold not eligible", () => {
    const r = quoteCredit({ accountId: "ACCT-003", order: { pickup_window_end: "2026-08-16 09:00", carrier_fault: 1, customer_fault: 0, shipment_fee_inr: 1000 }, nowIso: SNAP });
    // 09:00 to 11:00 =2h exactly => <= threshold => not eligible
    expect(r.eligible).toBe(false);
  });
  it("Exactly 4h Lumen not eligible", () => {
    const r = quoteCredit({ accountId: "ACCT-002", order: { pickup_window_end: "2026-08-16 07:00", carrier_fault: 1, customer_fault: 0, shipment_fee_inr: 2400 }, nowIso: SNAP });
    expect(r.eligible).toBe(false);
  });
  it("carrier not at fault => not eligible", () => {
    const r = quoteCredit({ accountId: "ACCT-003", order: { pickup_window_end: "2026-08-16 06:00", carrier_fault: 0, customer_fault: 0, shipment_fee_inr: 1000 }, nowIso: SNAP });
    expect(r.eligible).toBe(false);
  });
  it("customer at fault => not eligible", () => {
    const r = quoteCredit({ accountId: "ACCT-003", order: { pickup_window_end: "2026-08-16 06:00", carrier_fault: 1, customer_fault: 1, shipment_fee_inr: 1000 }, nowIso: SNAP });
    expect(r.eligible).toBe(false);
  });
  it("ORD-2002 Lumen fixed 300 with carrier fault, 4.5h delay", () => {
    const r = quoteCredit({ accountId: "ACCT-002", order: { pickup_window_end: "2026-08-16 06:30", carrier_fault: 1, customer_fault: 0, shipment_fee_inr: 2400 }, nowIso: SNAP });
    expect(r.eligible).toBe(true);
    expect(r.creditInr).toBe(300);
    expect(r.trace.some((t) => t.source.includes("LumenWorks"))).toBe(true);
  });
});

describe("computeSla", () => {
  it("TKT-501 Northstar P1 15m 24x7 breached (10:30 +15m =10:45, now 11:00)", () => {
    const r = computeSla({ accountId: "ACCT-001", plan: "Enterprise", severity: "P1", createdAt: "2026-08-16 10:30", nowIso: "2026-08-16 11:00" });
    expect(r.target).toContain("15");
    expect(r.breached).toBe(true);
    expect(r.targetSource).toContain("Northstar");
  });
  it("TKT-505 Axis Enterprise default P1 30m 24x7 breached (08:30 +30m=09:00, now 11:00)", () => {
    const r = computeSla({ accountId: "ACCT-004", plan: "Enterprise", severity: "P1", createdAt: "2026-08-16 08:30", nowIso: "2026-08-16 11:00" });
    expect(r.breached).toBe(true);
  });
  it("not breached just before deadline", () => {
    const r = computeSla({ accountId: "ACCT-001", plan: "Enterprise", severity: "P1", createdAt: "2026-08-16 10:50", nowIso: "2026-08-16 11:00" });
    expect(r.breached).toBe(false); // 10:50 +15 =11:05
  });
  it("business hours: Growth P1 2 business hours from Saturday", () => {
    // Create Saturday 10:00, 2 business hours should land Monday 11:00 IST
    const r = computeSla({ accountId: "ACCT-002", plan: "Growth", severity: "P1", createdAt: "2026-08-15 10:00", nowIso: "2026-08-16 11:00" });
    // Saturday + 2 business hours = Monday; so with now= Sunday? Actually 2026-08-15 is Saturday, now is Sunday 11:00
    // Deadline is Monday ~11:00, so not breached vs Sunday now
    expect(r.breached).toBe(false);
  });
  it("at snapshot instant breach edge", () => {
    const r = computeSla({ accountId: "ACCT-003", plan: "Standard", severity: "P1", createdAt: "2026-08-16 07:00", nowIso: "2026-08-16 11:00" });
    // Standard P1 = 4 business hours: 07:00+4h bus = 11:00+? Actually 07:00 before business start -> 09:00+4h=13:00 => not breached at 11:00
    expect(r.breached).toBe(false);
  });
});
