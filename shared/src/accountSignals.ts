// Detects the account-data signals from the hardship flowchart (data/admin/utility_hardship_mapping.json)
// in a fictional customer account. Ids and names match the flow's signals; each rule follows that signal's
// example_rule. Signals only prompt an offer of help, never a penalty, and a person checks them before acting.
import type { Bill, CustomerAccount } from "./types";

export interface DetectedSignal { id: string; name: string; evidence: string }

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const dollars = (n: number) => `$${n.toFixed(2)}`;
const owing = (b: Bill) => Math.round((b.amount - b.amountPaid) * 100) / 100;
/** Late: paid off after the due date, or still owing once the due date has passed. */
const isLate = (b: Bill, asOf: string) => (b.paidInFullAt ? b.paidInFullAt > b.dueAt : b.dueAt < asOf);

type Rule = [id: string, name: string, detect: (a: CustomerAccount, asOf: string) => string | null];

const RULES: Rule[] = [
  ["acct_missed_payment", "Bill overdue", (a, asOf) => {
    const overdue = a.bills.filter((b) => owing(b) > 0 && b.dueAt < asOf);
    if (!overdue.length) return null;
    const oldest = overdue[0];
    return `${overdue.length} bill${overdue.length > 1 ? "s" : ""} past due; oldest due ${oldest.dueAt}, ${daysBetween(oldest.dueAt, asOf)} days ago (${dollars(overdue.reduce((s, b) => s + owing(b), 0))} owing)`;
  }],
  ["acct_repeated_late", "Repeated late payments", (a, asOf) => {
    const late = a.bills.slice(-6).filter((b) => isLate(b, asOf)).length;
    return late >= 3 ? `Late on ${late} of the last ${Math.min(6, a.bills.length)} bills` : null;
  }],
  ["acct_broken_plan", "Payment plan or extension broken", (a) =>
    a.paymentPlan?.status === "broken" ? `Payment plan started ${a.paymentPlan.startedAt} is broken` : null],
  ["acct_many_extensions", "Multiple extensions requested", (a, asOf) => {
    const n = a.extensions.filter((e) => daysBetween(e.requestedAt, asOf) <= 365).length;
    return n >= 2 ? `${n} extensions requested in the last 12 months` : null;
  }],
  ["acct_rising_arrears", "Arrears growing", (a, asOf) => {
    // Arrears carried into each bill, then what is overdue today.
    const series = a.bills.map((b, k) => a.bills.slice(0, k).reduce((s, x) => s + owedAt(a, x, b.issuedAt), 0));
    series.push(a.bills.filter((b) => b.dueAt < asOf).reduce((s, b) => s + owing(b), 0));
    const [x, y, z] = series.slice(-3);
    return series.length >= 3 && z > 0 && x < y && y < z ? `Arrears ${dollars(x)} → ${dollars(y)} → ${dollars(z)} over the last two bills` : null;
  }],
  ["acct_dishonour", "Failed payment", (a, asOf) => {
    const failed = a.payments.filter((p) => p.status === "dishonoured" && daysBetween(p.date, asOf) <= 90);
    return failed.length ? `${failed.length} dishonoured payment${failed.length > 1 ? "s" : ""} in 90 days (latest ${failed[failed.length - 1].date})` : null;
  }],
  ["acct_partial_payments", "Small or partial payments", (a) => {
    for (let k = 0; k < a.bills.length; k++) {
      const b = a.bills[k], end = a.bills[k + 1]?.issuedAt ?? "9999-12-31";
      const small = a.payments.filter((p) => p.status === "cleared" && p.date >= b.issuedAt && p.date < end && p.amount < b.amount * 0.5);
      if (small.length >= 3) return `${small.length} part-payments against the bill issued ${b.issuedAt}`;
    }
    return null;
  }],
  ["acct_payday_aligned", "Payments track a fortnightly cycle", (a) => {
    const dates = a.payments.filter((p) => p.status === "cleared").map((p) => p.date);
    let run = 1;
    for (let k = 1; k < dates.length; k++) {
      const gap = daysBetween(dates[k - 1], dates[k]);
      run = gap >= 13 && gap <= 15 ? run + 1 : 1;
      if (run >= 4) return `${run}+ payments 14 days apart, up to ${dates[k]}`;
    }
    return null;
  }],
  ["acct_usage_spike", "Usage spike", (a) => {
    const u = latestUsage(a);
    return u && u.now > u.lastYear * 1.4 ? `${u.label}: ${u.now} kWh vs ${u.lastYear} kWh a year earlier (+${Math.round((u.now / u.lastYear - 1) * 100)}%)` : null;
  }],
  ["acct_usage_drop", "Very low or falling usage", (a) => {
    const u = latestUsage(a);
    return u && u.now < u.lastYear * 0.5 ? `${u.label}: ${u.now} kWh vs ${u.lastYear} kWh a year earlier (${Math.round((u.now / u.lastYear - 1) * 100)}%)` : null;
  }],
  ["acct_prepay_low_credit", "Prepay credit running out", (a, asOf) => {
    const n = a.prepay?.zeroCreditEvents.filter((d) => daysBetween(d, asOf) <= 30).length ?? 0;
    return n >= 2 ? `Meter ran out of credit ${n} times in the last 30 days` : null;
  }],
  ["acct_estimated_reads", "Estimated reads", (a) => {
    for (let k = 1; k < a.bills.length; k++) if (a.bills[k - 1].estimatedRead && a.bills[k].estimatedRead) return `Estimated reads on consecutive bills issued ${a.bills[k - 1].issuedAt} and ${a.bills[k].issuedAt}`;
    return null;
  }],
  ["acct_catchup_bill", "Catch-up bill", (a) => {
    for (let k = 1; k < a.bills.length; k++) {
      const b = a.bills[k];
      if (b.estimatedRead || !a.bills[k - 1].estimatedRead) continue;
      const usual = a.bills.slice(0, k).filter((x) => !x.estimatedRead);
      const avg = usual.reduce((s, x) => s + x.amount, 0) / (usual.length || 1);
      if (usual.length && b.amount > avg * 2) return `Bill issued ${b.issuedAt} is ${dollars(b.amount)}, ${(b.amount / avg).toFixed(1)}× the usual ${dollars(avg)}, after estimated reads`;
    }
    return null;
  }],
  ["acct_seasonal_peak", "Seasonal bill peak", (a) => {
    if (a.bills.length < 3) return null;
    const avg = a.bills.reduce((s, b) => s + b.amount, 0) / a.bills.length;
    const peak = a.bills.reduce((m, b) => (b.amount > m.amount ? b : m));
    return peak.amount > avg * 1.6 && !a.bills.some((b) => b.estimatedRead) ? `Bill issued ${peak.issuedAt} is ${(peak.amount / avg).toFixed(1)}× the annual average` : null;
  }],
  ["acct_concession_lapsed", "Concession lapsed", (a, asOf) =>
    a.concession.status === "lapsed" && a.concession.endDate && daysBetween(a.concession.endDate, asOf) <= 90 ? `${a.concession.type} ended ${a.concession.endDate}` : null],
  ["acct_concession_on_file", "Concession card on file", (a) =>
    a.concession.status === "active" ? `${a.concession.type}, valid to ${a.concession.endDate}` : null],
  ["acct_repeat_contact", "Repeat contact", (a, asOf) => {
    const recent = a.contacts.filter((c) => daysBetween(c.date, asOf) <= 60);
    const byTopic = new Map<string, number>();
    for (const c of recent) byTopic.set(c.topic, (byTopic.get(c.topic) ?? 0) + 1);
    const top = [...byTopic].find(([, n]) => n >= 3);
    return top ? `${top[1]} contacts about "${top[0]}" in 60 days` : null;
  }],
  ["acct_complaint", "Complaint or ombudsman referral", (a) => (a.complaintOpen ? "Complaint open on the account" : null)],
  ["acct_returned_mail", "Returned mail or bounced email", (a) => (a.returnedMail ? "Mail returned to sender" : null)],
  ["acct_digital_disengaged", "Digital disengagement", (a, asOf) => {
    const seen = [a.digital.lastLoginAt, a.digital.lastEmailOpenAt].filter((d): d is string => !!d && daysBetween(d, asOf) <= 90);
    return seen.length ? null : `No logins or email opens in 90 days (last login ${a.digital.lastLoginAt ?? "never"})`;
  }],
  ["acct_interpreter", "Interpreter or language preference", (a) =>
    a.languagePreference !== "English" || a.interpreterUsed ? `Prefers ${a.languagePreference}${a.interpreterUsed ? "; interpreter used" : ""}` : null],
  ["acct_access_needs", "Accessibility need recorded", (a) => a.accessNeeds],
  ["acct_life_support", "Life support registered", (a) => (a.lifeSupport ? "Life support equipment registered on the account" : null)],
  ["acct_disconnection_warning", "Disconnection warning sent", (a, asOf) =>
    a.disconnectionWarningAt && daysBetween(a.disconnectionWarningAt, asOf) <= 30 ? `Warning sent ${a.disconnectionWarningAt}` : null],
  ["acct_collections", "Debt collection or default", (a) => (a.collectionsStatus ? `Collections status: ${a.collectionsStatus.replace(/_/g, " ")}` : null)],
  ["acct_hardship_exit", "Left hardship program early", (a) =>
    a.hardshipProgram.status === "exited" && a.hardshipProgram.exitReason !== "completed" ? `Left the hardship program: ${a.hardshipProgram.exitReason?.replace(/_/g, " ")}` : null],
  ["acct_embedded_network", "Embedded network supply", (a) => (a.supplyType === "embedded" ? "Supplied through an embedded network" : null)],
  ["acct_third_party_authority", "Third-party authority on account", (a) =>
    a.thirdPartyAuthority ? `${a.thirdPartyAuthority.type}: ${a.thirdPartyAuthority.name}, since ${a.thirdPartyAuthority.since}` : null],
  ["acct_cash_only", "Cash or in-person payments only", (a) => {
    const all = [...a.payments, ...(a.prepay?.recharges ?? [])];
    return all.length >= 3 && all.every((p) => p.method === "cash_counter") ? `All ${all.length} payments made in person` : null;
  }],
  ["acct_no_hardship_offer", "No hardship assessment offered", (a, asOf) => {
    const old = a.bills.find((b) => owing(b) > 0 && daysBetween(b.dueAt, asOf) > 60);
    return old && !a.hardshipProgram.assessmentOffered ? `Owing since ${old.dueAt} (${daysBetween(old.dueAt, asOf)} days) with no hardship assessment offered` : null;
  }],
];

/** What was still owed on bill x on a given date, from cleared payments allocated oldest bill first. */
function owedAt(a: CustomerAccount, x: Bill, date: string): number {
  let paid = 0;
  const open = a.bills.map((b) => b.amount);
  for (const p of a.payments.filter((p) => p.status === "cleared" && p.date < date)) {
    let left = p.amount;
    for (let k = 0; k < a.bills.length && left > 0; k++) {
      if (a.bills[k].issuedAt > p.date || open[k] <= 0) continue;
      const take = Math.min(left, open[k]);
      open[k] -= take; left -= take;
      if (a.bills[k] === x) paid += take;
    }
  }
  return Math.max(0, Math.round((x.amount - paid) * 100) / 100);
}

/** Latest bill's usage (or the latest two months for prepaid) against the same period a year earlier. */
function latestUsage(a: CustomerAccount): { label: string; now: number; lastYear: number } | null {
  const b = a.bills[a.bills.length - 1];
  if (b) return { label: `Bill for ${b.periodStart} to ${b.periodEnd}`, now: b.usageKwh, lastYear: b.usageKwhLastYear };
  const last = a.usage.slice(-2);
  if (last.length < 2) return null;
  return { label: `${last[0].month} to ${last[1].month}`, now: last[0].kWh + last[1].kWh, lastYear: last[0].kWhLastYear + last[1].kWhLastYear };
}

export const ACCOUNT_SIGNAL_IDS = RULES.map(([id]) => id);

export function detectAccountSignals(account: CustomerAccount, asOf: string): DetectedSignal[] {
  return RULES.flatMap(([id, name, detect]) => {
    const evidence = detect(account, asOf);
    return evidence ? [{ id, name, evidence }] : [];
  });
}

/** Whole years between dateOfBirth and asOf. */
export function ageOn(dateOfBirth: string, asOf: string): number {
  const [y, m, d] = dateOfBirth.split("-").map(Number);
  const [ay, am, ad] = asOf.split("-").map(Number);
  return ay - y - (am < m || (am === m && ad < d) ? 1 : 0);
}
