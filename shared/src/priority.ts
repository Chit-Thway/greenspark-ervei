// Priority worked out from a case's flagged circumstances and the signals behind them (no prediction model).
// Each part adds points, so staff can see why a case scored what it did:
//   each flagged circumstance: points by its flowchart type, plus extra if it is sensitive or a safety risk;
//   each distinct signal behind them, once: more for a strong signal than a supporting one.
// The total is capped at 100 and labelled with the usual thresholds (urgent 80+, high 60+, moderate 35+).
import type { CaseCircumstance, CircumstanceDefinition, ModelAssessment, PriorityLabel } from "./types";

export const PRIORITY_PROVIDER = "flowchart_signals";

export const PRIORITY_WEIGHTS = {
  /** By circumstance type. Knock-on effects are "act the same day" in the flowchart. */
  type: { knockon: 14, life: 7, account: 6, company: 6, access: 4 } as Record<string, number>,
  otherType: 5,
  sensitive: 4,
  safety: 10,
  strongSignal: 4,
  supportingSignal: 1.5,
};

export function priorityLabel(score: number): PriorityLabel {
  return score >= 80 ? "urgent" : score >= 60 ? "high" : score >= 35 ? "moderate" : "routine";
}

/** Signals that mean things are getting worse (or about to, for weather), shown as a rising trend. */
const WORSENING = new Set(["acct_rising_arrears", "acct_usage_drop", "acct_prepay_low_credit", "acct_disconnection_warning", "wx_extreme_heat", "wx_fire_danger", "wx_warning"]);

/** Flowchart circumstance types, as the breakdown names them. */
export const CIRCUMSTANCE_TYPE_NAMES: Record<string, string> = { knockon: "Knock-on effect", life: "Life situation", account: "Bill or account issue", company: "Company practice", access: "Access barrier" };

export interface PriorityBreakdown {
  circumstances: { id: string; label: string; type: string; base: number; extra: number; extraFor: "sensitive" | "safety" | null; points: number }[];
  signals: { id: string; name: string; strength: "strong" | "supporting"; points: number; worsening: boolean }[];
  total: number; score: number; capped: boolean;
}

/** Every part of a case's priority, with its points: what the score adds up, so staff can see why. */
export function priorityBreakdown(circumstances: CaseCircumstance[], defs: Map<string, CircumstanceDefinition>): PriorityBreakdown {
  const w = PRIORITY_WEIGHTS;
  const rows = circumstances.map((x) => {
    const d = defs.get(x.circumstanceId);
    const base = w.type[d?.type ?? ""] ?? w.otherType;
    const extraFor = d?.sensitivity === "safety" ? "safety" as const : d?.sensitivity === "sensitive" ? "sensitive" as const : null;
    const extra = extraFor === "safety" ? w.safety : extraFor === "sensitive" ? w.sensitive : 0;
    return { id: x.circumstanceId, label: d?.label ?? x.circumstanceId, type: d?.type ?? "", base, extra, extraFor, points: base + extra };
  });
  // A signal counts once, at its strongest link to any flagged circumstance.
  const signals = new Map<string, { name: string; strength: "strong" | "supporting" }>();
  for (const x of circumstances) for (const s of x.signals ?? []) if (signals.get(s.id)?.strength !== "strong") signals.set(s.id, { name: s.name, strength: s.strength });
  const sig = [...signals].map(([id, s]) => ({ id, name: s.name, strength: s.strength, points: s.strength === "strong" ? w.strongSignal : w.supportingSignal, worsening: WORSENING.has(id) }));
  const total = rows.reduce((t, r) => t + r.points, 0) + sig.reduce((t, r) => t + r.points, 0);
  const score = Math.min(100, Math.round(total));
  return { circumstances: rows, signals: sig, total, score, capped: total > 100 };
}

/**
 * The priority for one case. `hasData` is false when the case has no account and no survey answers, in which
 * case there is nothing to score and the result is "unavailable" rather than a misleading zero.
 */
export function priorityFromSignals(circumstances: CaseCircumstance[], defs: Map<string, CircumstanceDefinition>, hasData: boolean): ModelAssessment {
  const base = { provider: PRIORITY_PROVIDER, isSimulated: false };
  if (!hasData) {
    return { ...base, status: "unavailable", priority: null, trend: null, explanation: "No account data or survey answers to score yet." };
  }
  const w = PRIORITY_WEIGHTS;
  const b = priorityBreakdown(circumstances, defs);
  const strong = b.signals.filter((x) => x.strength === "strong").length;
  const supporting = b.signals.length - strong;
  const score = b.score;
  const top = [...b.circumstances].sort((x, y) => y.points - x.points).slice(0, 3).map((p) => `${p.label} +${p.points}`);
  const explanation = circumstances.length
    ? `${circumstances.length} circumstance${circumstances.length === 1 ? "" : "s"} (${top.join(", ")}${b.circumstances.length > 3 ? ", …" : ""}) and ${b.signals.length} signal${b.signals.length === 1 ? "" : "s"} (${strong} strong +${strong * w.strongSignal}, ${supporting} supporting +${supporting * w.supportingSignal}).${b.capped ? " Capped at 100." : ""}`
    : "No circumstances flagged from the account data or survey answers.";
  return {
    ...base, status: "ready", priority: { score, label: priorityLabel(score) },
    trend: b.signals.some((x) => x.worsening) ? "rising" : "stable", explanation,
  };
}
