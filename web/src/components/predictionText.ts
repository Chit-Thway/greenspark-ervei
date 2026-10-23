// Wording shared by the case page's risk card and the customer's predictions page.
import type { Prediction } from "../data/api";

export const OUTCOME_ORDER = ["any_adverse", "disconnected", "overdue_1000", "plan_broken"] as const;
export const OUTCOME_LABEL: Record<string, string> = {
  any_adverse: "Any of these harms",
  disconnected: "Disconnected for non-payment",
  overdue_1000: "Overdue debt passes $1,000",
  plan_broken: "A payment plan breaks",
};

/** A band from how the customer's chance compares with the average for that harm: 10×, 4× and 1.5× the average. */
export function band(probability: number, baseRate: number | null): { id: "very_high" | "high" | "raised" | "low"; text: string } {
  const x = baseRate ? probability / baseRate : 0;
  if (x >= 10) return { id: "very_high", text: "Very high" };
  if (x >= 4) return { id: "high", text: "High" };
  if (x >= 1.5) return { id: "raised", text: "Raised" };
  return { id: "low", text: "Low" };
}

export const percent = (p: number) => (p >= 0.1 ? `${Math.round(p * 100)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : p >= 0.001 ? `${(p * 100).toFixed(2)}%` : "under 0.1%");

/** "Riskier than 97% of customers", or "Lower risk than most customers". */
export function rank(percentile: number): string {
  return percentile >= 50 ? `Riskier than ${Math.floor(percentile)}% of customers` : "Lower risk than most customers";
}

/** A factor's value in plain words. */
export function factorValue(f: Prediction["factors"][number]): string | null {
  if (f.value === null || f.value === "") return null;
  if (f.value === "True") return "Yes";
  if (f.value === "False") return "No";
  const v = Number(f.value);
  if (!Number.isFinite(v)) return f.value;
  if (/balance|overdue$/.test(f.id)) return `$${v.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
  if (/_vs_/.test(f.id)) return `${Math.round(v * 100)}% of the comparison period`;
  if (f.id === "account_age_days") return `${(v / 365).toFixed(1)} years`;
  if (f.id === "mean_contact_sentiment_90d") return v.toFixed(2);
  return `${Math.round(v * 10) / 10}`;
}

/** Labels for "missing" inputs read better as a fact about the customer. */
export function factorLabel(f: Prediction["factors"][number]): string {
  if (f.id === "import_kwh_30d_vs_same_period_last_year_missing") return "No usage from a year earlier to compare (a newer account)";
  if (f.id === "mean_contact_sentiment_90d_missing") return "No recent contacts to judge sentiment";
  if (f.id === "import_kwh_30d_vs_prior_90d_avg_missing") return "No earlier usage to compare";
  return f.label;
}
