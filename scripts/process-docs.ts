import fs from "node:fs";
import path from "node:path";

type Chunk = {
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

// We produce chunks manually from extracted text, with trust metadata per spec:
// Tier 1: signed agreements (ACCT-001, ACCT-002)
// Tier 2: current policy/SOP (v3, SOP v4)
// Tier 3: current product docs
// Tier 4: historical tickets — stored separately, not in doc_chunks
// Deprecated: v2

const chunks: Chunk[] = [
  // Policy v3
  { id: "doc-01-sec1", doc_id: "01_Support_Policy_v3_CURRENT", title: "Support Policy v3", section: "1 Scope and source precedence", content: "This policy defines default support severity and response targets. A signed customer agreement may override these defaults. When sources conflict, use the signed customer agreement first, then the current support policy, then current product documentation. Historical tickets and internal notes are context only and may contain incorrect past guidance.", authority_tier: 2, status: "current", account_scope: null, effective_date: "2026-05-01" },
  { id: "doc-01-sec2", doc_id: "01_Support_Policy_v3_CURRENT", title: "Support Policy v3", section: "2 Severity definitions", content: "P1 - Critical: Complete production outage preventing all shipment creation for a customer, confirmed security incident or suspected credential exposure, or another event causing immediate material business risk with no workaround. P2 - High: Major feature unavailable or materially degraded for a customer, but core operations remain possible or a workaround exists. P3 - Normal: Minor defect, how-to question, configuration request, or issue with limited operational impact.", authority_tier: 2, status: "current", account_scope: null, effective_date: "2026-05-01" },
  { id: "doc-01-sec3", doc_id: "01_Support_Policy_v3_CURRENT", title: "Support Policy v3", section: "3 Default first-response targets", content: "Plan P1 P2 P3. Enterprise 30 minutes, 24x7; 2 hours; 1 business day. Growth 2 business hours; 4 business hours; 2 business days. Standard 4 business hours; 1 business day; 2 business days. Business hours are Monday to Friday 09:00-18:00 IST.", authority_tier: 2, status: "current", account_scope: null, effective_date: "2026-05-01" },
  { id: "doc-01-sec4", doc_id: "01_Support_Policy_v3_CURRENT", title: "Support Policy v3", section: "4 Escalation", content: "P1 incidents should be escalated immediately. If a breach is imminent or occurred, or when customer impact is severe, escalate to the support team. Tickets requiring human judgment or exceptions should be escalated.", authority_tier: 2, status: "current", account_scope: null, effective_date: "2026-05-01" },

  // SOP v4
  { id: "doc-03-sec1", doc_id: "03_Cancellation_and_Service_Credit_SOP_v4", title: "Cancellation & Service Credit SOP v4", section: "1 Order cancellation", content: "DRAFT: May be cancelled with no fee. BOOKED, not yet PICKED_UP: May be cancelled. No fee within 30 minutes of booking. After 30 minutes, charge INR 250 unless a customer agreement explicitly waives the cancellation fee. PICKED_UP: Do not cancel. Use the return-to-origin workflow if the customer wants the parcel returned. DELIVERED: Cannot be cancelled.", authority_tier: 2, status: "current", account_scope: null, effective_date: "2026-06-15" },
  { id: "doc-03-sec2", doc_id: "03_Cancellation_and_Service_Credit_SOP_v4", title: "Cancellation & Service Credit SOP v4", section: "2 Failed-pickup service credits", content: "Under the default policy, a customer is eligible for a service credit when the pickup is more than 2 hours past the end of the scheduled pickup window, the carrier is at fault, and there is no customer-caused issue. The default credit is the lower of INR 500 or 10% of the shipment fee. A signed customer agreement may replace the default delay threshold, credit amount, or cap.", authority_tier: 2, status: "current", account_scope: null, effective_date: "2026-06-15" },
  { id: "doc-03-sec3", doc_id: "03_Cancellation_and_Service_Credit_SOP_v4", title: "Cancellation & Service Credit SOP v4", section: "3 Approval and uncertainty", content: "Any individual credit above INR 1,000 requires manager approval. Do not promise a credit when carrier fault, pickup timing, or customer fault is unknown. When data conflicts, identify the conflict and request verification before a state-changing action.", authority_tier: 2, status: "current", account_scope: null, effective_date: "2026-06-15" },

  // Product guide
  { id: "doc-04-sec1", doc_id: "04_Product_Operations_Guide_and_Known_Issues", title: "Product Operations Guide", section: "1 Plan capabilities", content: "Bulk Upload: Available on Growth and Enterprise. Supported file size is up to 5,000 rows per CSV. Standard: Bulk Upload is not included. Shipment status: BOOKED means the shipment is created but ParcelPilot has not yet received a pickup confirmation. PICKED_UP means carrier pickup has been confirmed.", authority_tier: 3, status: "current", account_scope: null, effective_date: "2026-08-14" },
  { id: "doc-04-sec2", doc_id: "04_Product_Operations_Guide_and_Known_Issues", title: "Product Operations Guide", section: "2 KI-208 Bulk Upload failures", content: "KI-208 - Bulk Upload failures on large CSVs. Opened: 10 August 2026. Status: Investigating. Some Growth and Enterprise customers experience intermittent failures on CSV uploads above approximately 3,000 rows, even though the supported product limit remains 5,000 rows. Workaround: split the upload into files below 3,000 rows. Individual shipment creation is unaffected.", authority_tier: 3, status: "current", account_scope: null, effective_date: "2026-08-14" },
  { id: "doc-04-sec3", doc_id: "04_Product_Operations_Guide_and_Known_Issues", title: "Product Operations Guide", section: "2 KI-211 SwiftShip webhook delay", content: "KI-211 - SwiftShip pickup webhook delay. Opened: 12 August 2026. Status: Monitoring. SwiftShip pickup confirmation webhooks can arrive up to 20 minutes late. A parcel may physically be collected while ParcelPilot still shows BOOKED. Before telling a customer that a pickup did not occur, verify the carrier status or wait through the known delay window.", authority_tier: 3, status: "current", account_scope: null, effective_date: "2026-08-14" },
  { id: "doc-04-sec4", doc_id: "04_Product_Operations_Guide_and_Known_Issues", title: "Product Operations Guide", section: "3 KI-176 Resolved", content: "KI-176 - Address validation: Resolved 18 July 2026. Do not use this resolved issue to explain new incidents unless evidence specifically matches it.", authority_tier: 3, status: "current", account_scope: null, effective_date: "2026-08-14" },

  // Northstar agreement
  { id: "doc-05-sec1", doc_id: "05_Northstar_Logistics_Enterprise_Agreement", title: "Northstar Logistics Enterprise Agreement", section: "1 Support terms", content: "For Northstar Logistics (ACCT-001), the following first-response targets replace ParcelPilot's standard support-policy targets: P1: 15 minutes, 24x7; P2: 1 hour; P3: 8 business hours.", authority_tier: 1, status: "current", account_scope: "ACCT-001", effective_date: "2026-01-01" },
  { id: "doc-05-sec2", doc_id: "05_Northstar_Logistics_Enterprise_Agreement", title: "Northstar Logistics Enterprise Agreement", section: "2 Shipment cancellation", content: "Northstar may cancel any BOOKED shipment before pickup with no cancellation fee, regardless of how long ago the shipment was booked. Once a shipment is PICKED_UP, the standard return-to-origin process applies.", authority_tier: 1, status: "current", account_scope: "ACCT-001", effective_date: "2026-01-01" },
  { id: "doc-05-sec3", doc_id: "05_Northstar_Logistics_Enterprise_Agreement", title: "Northstar Logistics Enterprise Agreement", section: "3 Service credits", content: "Monthly aggregate service credits are capped at INR 5,000. Unless this agreement states otherwise, the current ParcelPilot service-credit SOP applies.", authority_tier: 1, status: "current", account_scope: "ACCT-001", effective_date: "2026-01-01" },

  // LumenWorks agreement
  { id: "doc-06-sec1", doc_id: "06_LumenWorks_Service_Agreement", title: "LumenWorks Service Agreement", section: "1 Support terms", content: "LumenWorks (ACCT-002) Growth plan. P1: 2 business hours; P2: 4 business hours; P3: 2 business days. No weekend or after-hours support coverage.", authority_tier: 1, status: "current", account_scope: "ACCT-002", effective_date: "2026-03-01" },
  { id: "doc-06-sec2", doc_id: "06_LumenWorks_Service_Agreement", title: "LumenWorks Service Agreement", section: "2 Cancellation terms", content: "No special cancellation-fee waiver applies. Use the current ParcelPilot Cancellation & Service Credit SOP.", authority_tier: 1, status: "current", account_scope: "ACCT-002", effective_date: "2026-03-01" },
  { id: "doc-06-sec3", doc_id: "06_LumenWorks_Service_Agreement", title: "LumenWorks Service Agreement", section: "3 Failed-pickup credits", content: "If a pickup is more than 4 hours past the end of the scheduled pickup window, the carrier is at fault, and the customer is not at fault, LumenWorks receives a fixed INR 300 service credit. This clause replaces the default failed-pickup credit amount and timing threshold in the SOP.", authority_tier: 1, status: "current", account_scope: "ACCT-002", effective_date: "2026-03-01" },

  // Deprecated v2 (excluded from default retrieval)
  { id: "doc-02-sec1", doc_id: "02_Support_Policy_v2_DEPRECATED", title: "Support Policy v2 (DEPRECATED)", section: "Response targets", content: "Plan P1 P2 P3. Enterprise 1 hour; 4 hours; 2 business days. Growth 4 business hours; 1 business day; 3 business days. Standard 8 business hours; 2 business days; 3 business days. Note: This file is intentionally retained for historical reference and must not be used as current policy.", authority_tier: 2, status: "deprecated", account_scope: null, effective_date: "2025-01-01" },
];

const outDir = path.join("data", "corpus");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "chunks.json"), JSON.stringify(chunks, null, 2));
console.log(`Wrote ${chunks.length} chunks to data/corpus/chunks.json`);
