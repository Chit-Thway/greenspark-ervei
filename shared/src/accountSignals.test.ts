import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCOUNT_SIGNAL_IDS, ageOn, detectAccountSignals } from "./accountSignals";
import { toDataset, type RawFixture } from "./fixture";
import type { FlowDoc } from "./flow";

const raw: unknown = JSON.parse(readFileSync(new URL("../../data/synthetic/case-queue.v1.json", import.meta.url), "utf8"));
const data = toDataset(raw as RawFixture);
const testing = (raw as { cases: { personId: string; testing: { scenario: string } }[] }).cases;
const flow = JSON.parse(readFileSync(new URL("../../data/admin/utility_hardship_mapping.json", import.meta.url), "utf8")) as FlowDoc;

const scenarioOf = new Map(testing.map((c) => [c.personId, c.testing.scenario]));
const signalsFor = (scenario: string) =>
  data.people.filter((p) => scenarioOf.get(p.id) === scenario).map((p) => new Set(detectAccountSignals(p.account!, data.asOf).map((s) => s.id)));

describe("account signals", () => {
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

  it("gives every seeded person an account, and every scenario but the clean control at least one signal", () => {
    for (const p of data.people) {
      expect(p.account, p.id).toBeTruthy();
      const found = detectAccountSignals(p.account!, data.asOf);
      if (scenarioOf.get(p.id) === "no_flagged_circumstances") expect(found, p.id).toEqual([]);
      else expect(found.length, p.id).toBeGreaterThan(0);
    }
  });

  it("fires the signals each scenario is shaped for", () => {
    const every = (scenario: string, ids: string[]) => {
      for (const found of signalsFor(scenario)) for (const id of ids) expect(found.has(id), `${scenario} ${id}`).toBe(true);
    };
    every("new_financial", ["acct_missed_payment", "acct_repeated_late", "acct_rising_arrears", "acct_no_hardship_offer"]);
    every("assigned_financial", ["acct_payday_aligned", "acct_concession_on_file"]);
    every("multiple_support_areas", ["acct_missed_payment", "acct_many_extensions", "acct_disconnection_warning", "acct_usage_drop"]);
    every("historical_payment_plan", ["acct_broken_plan", "acct_hardship_exit", "acct_many_extensions"]);
    every("incomplete_assessment", ["acct_estimated_reads", "acct_catchup_bill", "acct_digital_disengaged"]);
    every("support_access_review", ["acct_third_party_authority", "acct_concession_lapsed", "acct_repeat_contact"]);
    expect(signalsFor("home_comfort").some((s) => s.has("acct_prepay_low_credit"))).toBe(true);
    expect(signalsFor("health_related").some((s) => s.has("acct_usage_spike"))).toBe(true);
  });

  it("works out age from the date of birth", () => {
    expect(ageOn("1960-10-16", "2026-10-16")).toBe(66);
    expect(ageOn("1960-10-17", "2026-10-16")).toBe(65);
  });
});
