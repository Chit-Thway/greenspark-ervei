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

/** Signals that mean things are getting worse, shown as a rising trend. */
const WORSENING = new Set(["acct_rising_arrears", "acct_usage_drop", "acct_prepay_low_credit", "acct_disconnection_warning"]);

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
  const parts = circumstances.map((x) => {
    const d = defs.get(x.circumstanceId);
    const points = (w.type[d?.type ?? ""] ?? w.otherType) + (d?.sensitivity === "safety" ? w.safety : d?.sensitivity === "sensitive" ? w.sensitive : 0);
    return { label: d?.label ?? x.circumstanceId, points };
  });
  // A signal counts once, at its strongest link to any flagged circumstance.
  const signals = new Map<string, "strong" | "supporting">();
  for (const x of circumstances) for (const s of x.signals ?? []) if (signals.get(s.id) !== "strong") signals.set(s.id, s.strength);
  const strong = [...signals.values()].filter((s) => s === "strong").length;
  const supporting = signals.size - strong;
  const total = parts.reduce((t, p) => t + p.points, 0) + strong * w.strongSignal + supporting * w.supportingSignal;
  const score = Math.min(100, Math.round(total));
  const top = [...parts].sort((a, b) => b.points - a.points).slice(0, 3).map((p) => `${p.label} +${p.points}`);
  const explanation = circumstances.length
    ? `${circumstances.length} circumstance${circumstances.length === 1 ? "" : "s"} (${top.join(", ")}${parts.length > 3 ? ", …" : ""}) and ${signals.size} signal${signals.size === 1 ? "" : "s"} (${strong} strong +${strong * w.strongSignal}, ${supporting} supporting +${supporting * w.supportingSignal}).${score === 100 && total > 100 ? " Capped at 100." : ""}`
    : "No circumstances flagged from the account data or survey answers.";
  return {
    ...base, status: "ready", priority: { score, label: priorityLabel(score) },
    trend: [...signals.keys()].some((id) => WORSENING.has(id)) ? "rising" : "stable", explanation,
  };
}
