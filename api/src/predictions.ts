// The 90-day risk model's scores (data/synthetic/predictions.v1.json) and its model card (data/models/risk-model.v1.json),
// both written by scripts/train-risk-model.mts. Read once at start; the server never retrains.
import { existsSync, readFileSync } from "node:fs";

export interface OutcomeScore { probability: number; percentile: number }
export interface CustomerPrediction {
  sourceMonthEnd: string;
  outcomes: Record<string, OutcomeScore>;
  factors: { id: string; label: string; value: string | null; weight: number }[];
}
export interface ModelCard {
  id: string; type: string; horizonDays: number; sourceEnd: string; trainingMonths: number; testMonths: number; heldOut: string; caveat: string;
  inputs: { id: string; label: string; missing: boolean }[];
  outcomes: Record<string, {
    label: string; intercept: number; weights: Record<string, number>;
    test: { months: number; positives: number; baseRate: number; auc: number; top5: { precision: number; recall: number }; top10: { precision: number; recall: number }; calibration: { predicted: number; actual: number }[] };
  }>;
}

export interface Predictions {
  model: ModelCard;
  /** By the dataset's customer ID (account.sourceCustomerId). */
  byCustomer: Map<string, CustomerPrediction>;
}

/** Loads both files, or returns null when either is missing (predictions then stay off). */
export function loadPredictions(modelPath: string, predictionsPath: string): Predictions | null {
  if (!existsSync(modelPath) || !existsSync(predictionsPath)) return null;
  const model = JSON.parse(readFileSync(modelPath, "utf8")) as ModelCard;
  const scores = JSON.parse(readFileSync(predictionsPath, "utf8")) as { customers: Record<string, CustomerPrediction> };
  return { model, byCustomer: new Map(Object.entries(scores.customers)) };
}
