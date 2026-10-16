const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function clock(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

export function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export interface FollowUp {
  text: string;
  tone: "overdue" | "today" | "future" | "none";
}

/** Follow-up wording relative to the fixed demo date. Resolved cases show no outstanding follow-up. */
export function describeFollowUp(followUpAt: string | null, resolved: boolean, asOf: string): FollowUp {
  if (resolved) return { text: "No follow-up needed", tone: "none" };
  if (!followUpAt) return { text: "Not scheduled", tone: "none" };
  const diff = dayNumber(followUpAt) - dayNumber(asOf);
  if (diff < 0) return { text: `${-diff}d overdue`, tone: "overdue" };
  if (diff === 0) return { text: `Today · ${clock(followUpAt)}`, tone: "today" };
  return { text: `${shortDate(followUpAt)} · ${clock(followUpAt)}`, tone: "future" };
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export function shortName(name: string): string {
  const [first, ...rest] = name.split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1]![0]}.` : first!;
}

export function formatDateTime(iso: string): string {
  return `${shortDate(iso)} · ${clock(iso)}`;
}

export const STATUS_LABELS = {
  new: "New",
  in_progress: "In progress",
  waiting: "Waiting",
  resolved: "Resolved",
} as const;

export const PRIORITY_TEXT = { urgent: "Urgent", high: "High", moderate: "Moderate", routine: "Routine" } as const;

export const PERIOD_TEXT = {
  past_6_months: "past 6 months",
  past_12_months: "past 12 months",
  at_report: "at time of report",
} as const;
