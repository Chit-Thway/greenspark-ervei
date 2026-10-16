import type { ModelAssessment, QueueCase } from "@greenspark/shared";
import type { Store } from "./store";

/**
 * Integration boundary for the teammate-owned prediction model.
 * Proposed contract (not agreed with the model owner): given case IDs, return an assessment per case ID.
 * Results are display-only. Do not send downstream outcome labels into a model request.
 */
export interface ModelAdapter {
  getAssessments(caseIds: string[]): Promise<Record<string, ModelAssessment | undefined>>;
}

/** Default adapter: the invented assessments stored with the synthetic seed. */
export class SyntheticModelAdapter implements ModelAdapter {
  constructor(private store: Store) {}
  async getAssessments(caseIds: string[]) {
    const out: Record<string, ModelAssessment | undefined> = {};
    for (const id of caseIds) out[id] = this.store.getCase(id)?.modelAssessment;
    return out;
  }
}

const UNAVAILABLE: ModelAssessment = {
  provider: "unknown", isSimulated: true, status: "unavailable", priority: null, trend: null, explanation: null,
};

function usable(a: ModelAssessment | undefined): ModelAssessment {
  if (!a) return UNAVAILABLE; // a missing result is "unavailable", never Routine or zero
  if (a.status === "ready" && !a.priority) return { ...UNAVAILABLE, provider: a.provider, isSimulated: a.isSimulated };
  if (a.status !== "ready") return { ...a, priority: null, trend: null };
  return a;
}

/** Overlays model results onto cases. Any adapter failure degrades to "unavailable" instead of failing the queue. */
export async function withAssessments(adapter: ModelAdapter, cases: QueueCase[]): Promise<QueueCase[]> {
  let results: Record<string, ModelAssessment | undefined> = {};
  try {
    results = await adapter.getAssessments(cases.map((c) => c.id));
  } catch (e) {
    console.error("Model adapter failed; showing assessments as unavailable.", e instanceof Error ? e.message : e);
  }
  return cases.map((c) => ({ ...c, modelAssessment: usable(results[c.id]) }));
}
