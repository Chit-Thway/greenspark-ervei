import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCOUNT_SIGNAL_IDS, ageOn, detectAccountSignals } from "./accountSignals";
import { toDataset, type RawFixture } from "./fixture";
import type { FlowDoc } from "./flow";
import type { CustomerAccount } from "./types";

const raw: unknown = JSON.parse(readFileSync(new URL("../../data/synthetic/case-queue.v1.json", import.meta.url), "utf8"));
const data = toDataset(raw as RawFixture);
const testing = (raw as { cases: { personId: string; testing: { scenario: string } }[] }).cases;
const flow = JSON.parse(readFileSync(new URL("../../data/admin/utility_hardship_mapping.json", import.meta.url), "utf8")) as FlowDoc;

const scenarioOf = new Map(testing.map((c) => [c.personId, c.testing.scenario]));
const signalsFor = (scenario: string) =>
  data.people.filter((p) => scenarioOf.get(p.id) === scenario).map((p) => new Set(detectAccountSignals(p.account!, data.asOf).map((s) => s.id)));

/** A quiet account to change one thing at a time in the rule tests. */
const asOf = "2026-10-16";
function account(patch: Partial<CustomerAccount> = {}): CustomerAccount {
  return {
    sourceCustomerId: "C1", utility: "electricity", retailer: "Synergy", region: { name: "Perth metro", climateZone: "perth", northOf26th: false },
    customerSince: "2020-01-01", dateOfBirth: "1970-01-01", supplyStatus: "connected",
    plan: { type: "postpaid", tariff: "A1", name: "Home Plan (A1)", billingCycle: "bimonthly" }, meterType: "advanced", solar: null, paymentMethod: "bpay",
    concession: { status: "none", endDate: null }, medicalCoolingSubsidy: false, thirdPartyAuthority: null, lifeSupport: false, lifeSupportSince: null, interpreterRequired: false,
    contactPreferences: { preferredChannel: "email", smsOptIn: true, emailOptIn: true, doNotCall: false, proactiveSupportConsent: "not_asked", onlineAccountActive: true },
    hardshipProgram: { status: "none", exitReason: null, assessedAt: null }, hardshipHistory: [], paymentPlan: null, paymentPlans: [], extensions: [], hugsGrants: [], interventions: [],
    bills: [], payments: [], usage: [], monthly: [], prepay: null, contacts: [], collectionEvents: [], disconnections: [], outages: [],
    communications: { lastOpenedAt: "2026-10-01", undelivered: [] },
    ...patch,
  };
}
const ids = (a: CustomerAccount) => detectAccountSignals(a, asOf).map((s) => s.id);

describe("account signals over the utility dataset", () => {
  it("uses the ids and names of account signals in the flowchart", () => {
    const flowSignals = new Map(flow.signals.map((s) => [s.id, s]));
    for (const p of data.people) {
      for (const s of detectAccountSignals(p.account!, data.asOf)) {
        expect(flowSignals.get(s.id)?.source, s.id).toBe("account");
        expect(flowSignals.get(s.id)?.name, s.id).toBe(s.name);
      }
    }
    for (const id of ACCOUNT_SIGNAL_IDS) expect(flowSignals.has(id), id).toBe(true);
  });

  it("gives every seeded person a dataset account, and leaves the clean control with no signals", () => {
    for (const p of data.people) {
      expect(p.account?.sourceCustomerId, p.id).toMatch(/^C\d{6}$/);
      if (scenarioOf.get(p.id) === "no_flagged_circumstances") expect(detectAccountSignals(p.account!, data.asOf), p.id).toEqual([]);
    }
  });

  it("fires what each scenario's customers were chosen for", () => {
    const every = (scenario: string, list: string[]) => {
      for (const found of signalsFor(scenario)) for (const id of list) expect(found.has(id), `${scenario} ${id}`).toBe(true);
    };
    every("new_financial", ["acct_missed_payment"]);
    every("assigned_financial", ["acct_concession_on_file"]);
    every("home_comfort", ["acct_prepay_low_credit"]);
    every("multiple_support_areas", ["acct_life_support", "acct_missed_payment"]);
    every("historical_payment_plan", ["acct_concession_on_file"]);
    expect(signalsFor("historical_payment_plan").some((s) => s.has("acct_broken_plan"))).toBe(true);
    expect(signalsFor("new_financial").some((s) => s.has("acct_disconnected"))).toBe(true);
  });
});

describe("account signal rules", () => {
  it("flags a disconnected supply", () => {
    expect(ids(account({ supplyStatus: "disconnected", disconnections: [{ date: "2026-09-01", overdue: 400, reconnectedAt: null }] }))).toContain("acct_disconnected");
  });

  it("flags 3+ outages, or one over 12 hours, in 12 months", () => {
    const o = (start: string, hours: number) => ({ start, end: start, hours, type: "unplanned" as const, cause: "storm", noticeDate: null });
    expect(ids(account({ outages: [o("2026-03-01", 2), o("2026-05-01", 2)] }))).not.toContain("acct_outage_history");
    expect(ids(account({ outages: [o("2026-03-01", 2), o("2026-05-01", 2), o("2026-07-01", 2)] }))).toContain("acct_outage_history");
    expect(ids(account({ outages: [o("2026-07-01", 13)] }))).toContain("acct_outage_history");
    expect(ids(account({ outages: [o("2025-01-01", 30)] }))).not.toContain("acct_outage_history"); // over a year ago
  });

  it("flags remote supply north of the 26th parallel", () => {
    expect(ids(account({ region: { name: "Kimberley", climateZone: "north", northOf26th: true } }))).toContain("acct_remote_area");
  });

  it("flags 3+ unanswered outbound calls in 6 months", () => {
    const call = (date: string) => ({ id: date, date, channel: "outbound_call", direction: "outbound" as const, reason: "overdue_reminder_call", outcome: "no_answer", sentiment: null, complaint: false, complaintCategory: null, repeatWithin7d: false, notes: "", transcript: null });
    expect(ids(account({ contacts: [call("2026-07-01"), call("2026-08-01")] }))).not.toContain("acct_unanswered_outreach");
    expect(ids(account({ contacts: [call("2026-07-01"), call("2026-08-01"), call("2026-09-01")] }))).toContain("acct_unanswered_outreach");
  });

  it("flags solar export falling below 20% of the same month last year", () => {
    const m = (month: string, exportKwh: number) => ({ month, kWh: 300, kWhLastYear: 300, exportKwh, exportKwhLastYear: 200, outageHours: 0, disconnectedDays: 0 });
    expect(ids(account({ solar: { kw: 6.6 }, usage: [m("2026-09", 20), m("2026-10", 5)] }))).toContain("acct_solar_export_zero");
    expect(ids(account({ solar: { kw: 6.6 }, usage: [m("2026-09", 150), m("2026-10", 5)] }))).not.toContain("acct_solar_export_zero");
  });

  it("flags a recent move, and a bill up 20% on flat usage", () => {
    expect(ids(account({ customerSince: "2026-09-01" }))).toContain("acct_move");
    const bill = (start: string, kWh: number, usage: number) => ({
      id: start, periodStart: start, periodEnd: start, issuedAt: start, dueAt: start, originalDueAt: start, dueDateExtended: false, usageKwh: kWh, usageKwhLastYear: null,
      charges: { usage, supply: 80, feedInCredit: 0, concessionCredit: 0, govtCredit: 0 }, amount: 0, amountPaid: 0, paidInFullAt: start, paidOnTime: true, finalBill: false, openingBalance: false,
    });
    expect(ids(account({ bills: [bill("2025-08-01", 500, 150), bill("2026-08-01", 510, 230)] }))).toContain("acct_bill_up_flat_usage");
    expect(ids(account({ bills: [bill("2025-08-01", 500, 150), bill("2026-08-01", 650, 230)] }))).not.toContain("acct_bill_up_flat_usage");
  });

  it("raises nothing for a quiet account", () => {
    expect(ids(account())).toEqual([]);
  });

  it("works out age from the date of birth", () => {
    expect(ageOn("1960-10-16", "2026-10-16")).toBe(66);
    expect(ageOn("1960-10-17", "2026-10-16")).toBe(65);
  });
});
