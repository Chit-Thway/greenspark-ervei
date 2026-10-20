import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyFlow, evaluateCase } from "./caseFlow";
import { toDataset, type RawFixture } from "./fixture";
import { normalizeDoc, type FlowDoc } from "./flow";
import type { Person, QueueCase } from "./types";

const raw: unknown = JSON.parse(readFileSync(new URL("../../data/synthetic/case-queue.v1.json", import.meta.url), "utf8"));
const data = toDataset(raw as RawFixture);
const scenarios = (raw as { cases: { testing: { scenario: string } }[] }).cases.map((c) => c.testing.scenario);
const realFlow = normalizeDoc(JSON.parse(readFileSync(new URL("../../data/admin/utility_hardship_mapping.json", import.meta.url), "utf8")) as FlowDoc);

// A tiny flow: one strong and two supporting account signals, and a self-report signal from the survey.
const signal = (id: string, source = "account") => ({ id, name: id, source, detect: "", example_rule: "", utilities: ["electricity"], sensitive: false, points_to: [] });
const circ = (id: string, signals: { id: string; strength: "strong" | "supporting" }[], sensitivity = "standard", utilities = ["electricity"]) =>
  ({ id, name: id, type: "life", category: "cost", description: "", utilities, sensitivity, handling: null, signals, solutions: ["help"] });
const tiny = {
  categories: [{ id: "cost", name: "Cost" }],
  signals: [signal("acct_missed_payment"), signal("acct_repeated_late"), signal("acct_partial_payments"), signal("ask_trade_offs", "self_report")],
  solutions: [{ id: "help", name: "Help", type: "", utilities: ["electricity"], provider: "Someone", how_to_access: "", contact: "", key_facts: "", source_url: null, verified: true, last_verified: null, used_for: [] }],
  circumstances: [
    circ("one_strong", [{ id: "acct_missed_payment", strength: "strong" }]),
    circ("two_supporting", [{ id: "acct_repeated_late", strength: "supporting" }, { id: "acct_partial_payments", strength: "supporting" }]),
    circ("one_supporting", [{ id: "acct_repeated_late", strength: "supporting" }]),
    circ("sensitive_supporting", [{ id: "acct_repeated_late", strength: "supporting" }, { id: "acct_partial_payments", strength: "supporting" }], "sensitive"),
    circ("sensitive_strong", [{ id: "ask_trade_offs", strength: "strong" }], "sensitive"),
    circ("water_only", [{ id: "acct_missed_payment", strength: "strong" }], "standard", ["water"]),
  ],
} as unknown as FlowDoc;

// GS-2001: an overdue account (missed payment, repeated late, partial payments) whose survey says Q35_8 = Yes.
const c = data.cases[0] as QueueCase;
const person = data.people[0] as Person;

describe("flagging circumstances with the flow's rules", () => {
  const flagged = evaluateCase(c, person, data, tiny).circumstances.map((x) => x.circumstanceId);

  it("flags on one strong signal, or two supporting ones", () => {
    expect(flagged).toContain("one_strong");
    expect(flagged).toContain("two_supporting");
    expect(flagged).not.toContain("one_supporting");
  });

  it("needs a strong signal for sensitive circumstances", () => {
    expect(flagged).not.toContain("sensitive_supporting");
    expect(flagged).toContain("sensitive_strong"); // from the survey answer Q35_8
  });

  it("ignores circumstances for other utilities", () => {
    expect(flagged).not.toContain("water_only");
  });

  it("explains each circumstance with its signals, and links the solutions", () => {
    const r = evaluateCase(c, person, data, tiny);
    const survey = r.circumstances.find((x) => x.circumstanceId === "sensitive_strong")!;
    expect(survey.signals).toEqual([expect.objectContaining({ id: "ask_trade_offs", source: "self_report", strength: "strong", evidenceFieldId: "Q35_8" })]);
    expect(survey.evidenceFieldIds).toEqual(["Q35_8"]);
    expect(r.recommendations).toEqual([expect.objectContaining({ recommendationId: "help", circumstanceIds: flagged })]);
    expect(r.supportAreaIds).toEqual(["cost"]);
  });

  it("flags nothing without signals", () => {
    const quiet = { ...c, reportedAnswers: {} } as QueueCase;
    const r = evaluateCase(quiet, { ...person, account: null }, data, tiny);
    expect(r.circumstances).toEqual([]);
    expect(r.recommendations).toEqual([]);
  });
});

describe("the real flow over the fixture", () => {
  const out = applyFlow(data, realFlow);
  const ids = (scenario: string) => out.cases.filter((_, i) => scenarios[i] === scenario).map((x) => x.circumstances.map((y) => y.circumstanceId));

  it("uses the flow's categories and circumstances as the catalogs", () => {
    expect(out.circumstanceSource).toBe("flow");
    expect(out.supportAreas.every((a) => realFlow.categories.some((cat) => cat.id === a.id))).toBe(true);
    for (const x of out.cases) {
      expect(x.supportAreaIds.length > 0).toBe(x.circumstances.length > 0);
      for (const y of x.circumstances) expect(out.circumstances.some((d) => d.id === y.circumstanceId)).toBe(true);
    }
  });

  it("leaves the clean control unflagged and flags what each scenario is shaped for", () => {
    for (const list of ids("no_flagged_circumstances")) expect(list).toEqual([]);
    for (const list of ids("new_financial")) expect(list).toEqual(expect.arrayContaining(["hardship_not_offered", "debt_spiral"]));
    for (const list of ids("historical_payment_plan")) expect(list).toContain("unaffordable_plan");
    for (const list of ids("incomplete_assessment")) expect(list).toContain("estimated_catchup");
    for (const list of ids("support_access_review")) expect(list).toContain("concession_lost");
  });
});
