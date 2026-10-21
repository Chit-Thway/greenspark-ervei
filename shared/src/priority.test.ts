import { describe, expect, it } from "vitest";
import { PRIORITY_PROVIDER, PRIORITY_WEIGHTS, priorityFromSignals, priorityLabel } from "./priority";
import type { CaseCircumstance, CircumstanceDefinition } from "./types";

const def = (id: string, type: string, sensitivity: "standard" | "sensitive" | "safety" = "standard"): [string, CircumstanceDefinition] =>
  [id, { id, label: id, supportAreaId: "cost", evidenceFieldIds: [], recommendationIds: [], illustrativeRule: "", type, sensitivity }];
const defs = new Map<string, CircumstanceDefinition>([def("spiral", "knockon"), def("job", "life"), def("illness", "life", "sensitive"), def("unsafe", "life", "safety")]);
const circ = (id: string, signals: [string, "strong" | "supporting"][]): CaseCircumstance =>
  ({ circumstanceId: id, evidenceFieldIds: [], signals: signals.map(([sid, strength]) => ({ id: sid, name: sid, source: "account", strength, evidence: "" })) });
const w = PRIORITY_WEIGHTS;

describe("priority from signals", () => {
  it("adds points per circumstance type and per distinct signal, counting each signal once at its strongest", () => {
    const a = priorityFromSignals([circ("spiral", [["arrears", "strong"], ["late", "supporting"]]), circ("job", [["late", "strong"]])], defs, true);
    // spiral (knock-on) + job (life) + two signals, both strong because "late" is strong for job.
    expect(a.priority!.score).toBe(Math.round(w.type.knockon! + w.type.life! + 2 * w.strongSignal));
    expect(a).toMatchObject({ provider: PRIORITY_PROVIDER, isSimulated: false, status: "ready" });
    expect(a.explanation).toContain("2 circumstances");
  });

  it("gives sensitive and safety circumstances extra points", () => {
    const plain = priorityFromSignals([circ("job", [["x", "strong"]])], defs, true).priority!.score;
    expect(priorityFromSignals([circ("illness", [["x", "strong"]])], defs, true).priority!.score).toBe(plain + w.sensitive);
    expect(priorityFromSignals([circ("unsafe", [["x", "strong"]])], defs, true).priority!.score).toBe(plain + w.safety);
  });

  it("caps at 100, labels with the usual thresholds, and rises when things are getting worse", () => {
    const many = Array.from({ length: 12 }, (_, i) => circ("spiral", [[`s${i}`, "strong"]]));
    const a = priorityFromSignals([...many, circ("job", [["acct_rising_arrears", "supporting"]])], defs, true);
    expect(a.priority).toEqual({ score: 100, label: "urgent" });
    expect(a.trend).toBe("rising");
    expect([priorityLabel(80), priorityLabel(79), priorityLabel(60), priorityLabel(35), priorityLabel(34)]).toEqual(["urgent", "high", "high", "moderate", "routine"]);
  });

  it("scores a case with data but nothing flagged as 0, and one with no data as unavailable", () => {
    expect(priorityFromSignals([], defs, true)).toMatchObject({ status: "ready", priority: { score: 0, label: "routine" }, trend: "stable" });
    expect(priorityFromSignals([], defs, false)).toMatchObject({ status: "unavailable", priority: null });
  });
});
