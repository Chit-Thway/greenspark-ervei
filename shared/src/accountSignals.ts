// Detects the account-data signals from the hardship flowchart (data/admin/utility_hardship_mapping.json)
// in a customer's utility account (from the synthetic WA utility dataset). Ids and names match the flowchart's
// signals; each rule follows that signal's example_rule. Signals only prompt an offer of help, never a penalty,
// and a person checks them before acting. Signals the dataset holds no data for have no rule here, so the
// Flowchart page tags them "No data".
import type { Bill, CustomerAccount } from "./types";

export interface DetectedSignal { id: string; name: string; evidence: string }

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY);
const within = (date: string | null | undefined, asOf: string, days: number) => !!date && date.slice(0, 10) <= asOf && daysBetween(date, asOf) <= days;
const dollars = (n: number) => `$${n.toFixed(2)}`;
const owing = (b: Bill) => Math.round((b.amount - b.amountPaid) * 100) / 100;
const human = (s: string) => s.replace(/_/g, " ");
/** Bills for a billing period (not the opening-balance carry-over). */
const periodBills = (a: CustomerAccount) => a.bills.filter((b) => !b.openingBalance);
/** Late: paid off after the due date, or still owing once the due date has passed. */
const isLate = (b: Bill, asOf: string) => (b.paidInFullAt ? b.paidInFullAt > b.dueAt : owing(b) > 0 && b.dueAt < asOf);
const latestOverdue = (a: CustomerAccount) => a.monthly[a.monthly.length - 1] ?? null;

type Rule = [id: string, name: string, detect: (a: CustomerAccount, asOf: string) => string | null];

const RULES: Rule[] = [
  ["acct_missed_payment", "Bill overdue", (a, asOf) => {
    const overdue = a.bills.filter((b) => owing(b) > 0 && b.dueAt < asOf);
    if (!overdue.length) return null;
    const oldest = overdue[0]!;
    const total = latestOverdue(a)?.overdue || overdue.reduce((s, b) => s + owing(b), 0);
    return `${overdue.length} bill${overdue.length > 1 ? "s" : ""} past due; oldest due ${oldest.dueAt}, ${daysBetween(oldest.dueAt, asOf)} days ago (${dollars(total)} overdue)`;
  }],
  ["acct_repeated_late", "Repeated late payments", (a, asOf) => {
    const last6 = periodBills(a).filter((b) => b.issuedAt <= asOf).slice(-6);
    const late = last6.filter((b) => isLate(b, asOf)).length;
    return late >= 3 ? `Late on ${late} of the last ${last6.length} bills` : null;
  }],
  ["acct_broken_plan", "Payment plan or extension broken", (a, asOf) => {
    const p = a.paymentPlan;
    return p?.status === "broken" && within(p.endedAt ?? p.startedAt, asOf, 365) ? `Payment plan started ${p.startedAt} (${p.instalments} instalments of ${dollars(p.instalment)}) was broken` : null;
  }],
  ["acct_many_extensions", "Multiple extensions requested", (a, asOf) => {
    const n = a.extensions.filter((e) => within(e.requestedAt, asOf, 365)).length;
    return n >= 2 ? `${n} bill extensions in the last 12 months` : null;
  }],
  ["acct_rising_arrears", "Arrears growing", (a) => {
    // Overdue at month end, two months apart (bills are every two months).
    const m = a.monthly.slice(-5);
    if (m.length < 5) return null;
    const [x, , y, , z] = m as [typeof m[0], unknown, typeof m[0], unknown, typeof m[0]];
    return z.overdue > 0 && x.overdue < y.overdue && y.overdue < z.overdue
      ? `Overdue ${dollars(x.overdue)} (${x.date}) → ${dollars(y.overdue)} (${y.date}) → ${dollars(z.overdue)} (${z.date})` : null;
  }],
  ["acct_dishonour", "Failed payment", (a, asOf) => {
    const failed = a.payments.filter((p) => p.status === "dishonoured" && within(p.date, asOf, 90));
    return failed.length ? `${failed.length} dishonoured payment${failed.length > 1 ? "s" : ""} in 90 days (latest ${failed[failed.length - 1]!.date})` : null;
  }],
  ["acct_partial_payments", "Small or partial payments", (a, asOf) => {
    const bills = periodBills(a);
    for (let k = bills.length - 1; k >= 0; k--) {
      const b = bills[k]!, end = bills[k + 1]?.issuedAt ?? "9999-12-31";
      if (!within(b.issuedAt, asOf, 365) || b.amount <= 0) continue;
      const small = a.payments.filter((p) => p.status === "cleared" && p.kind !== "hugs_grant" && p.kind !== "debt_write_off" && p.date >= b.issuedAt && p.date < end && p.amount < b.amount * 0.5);
      if (small.length >= 3) return `${small.length} part-payments against the ${dollars(b.amount)} bill issued ${b.issuedAt}`;
    }
    return null;
  }],
  ["acct_payday_aligned", "Payments track a fortnightly cycle", (a, asOf) => {
    const dates = [
      ...a.payments.filter((p) => p.status === "cleared" && p.kind !== "hugs_grant" && p.kind !== "debt_write_off").map((p) => p.date),
      ...(a.prepay?.recharges.filter((r) => r.context === "payday").map((r) => r.date.slice(0, 10)) ?? []),
    ].filter((d) => within(d, asOf, 180)).sort();
    let run = 1;
    for (let k = 1; k < dates.length; k++) {
      const gap = daysBetween(dates[k - 1]!, dates[k]!);
      if (gap === 0) continue;
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
    return u && a.supplyStatus === "connected" && u.now < u.lastYear * 0.5 ? `${u.label}: ${u.now} kWh vs ${u.lastYear} kWh a year earlier (${Math.round((u.now / u.lastYear - 1) * 100)}%)` : null;
  }],
  ["acct_prepay_low_credit", "Prepay credit running out", (a, asOf) => {
    const recent = a.prepay?.selfDisconnections.filter((d) => within(d.start, asOf, 30)) ?? [];
    return recent.length >= 2 ? `Meter ran out of credit ${recent.length} times in the last 30 days (${recent.reduce((s, d) => s + d.hours, 0).toFixed(1)} hours without power)` : null;
  }],
  ["acct_seasonal_peak", "Seasonal bill peak", (a, asOf) => {
    const year = periodBills(a).filter((b) => b.charges && within(b.issuedAt, asOf, 365));
    if (year.length < 4) return null;
    const cost = (b: Bill) => b.charges!.usage + b.charges!.supply;
    const avg = year.reduce((s, b) => s + cost(b), 0) / year.length;
    const peak = year.reduce((m, b) => (cost(b) > cost(m) ? b : m));
    return avg > 0 && cost(peak) > avg * 1.6 ? `Bill issued ${peak.issuedAt} was ${dollars(cost(peak))} before credits, ${(cost(peak) / avg).toFixed(1)}× the 12-month average` : null;
  }],
  ["acct_concession_lapsed", "Concession lapsed", (a, asOf) =>
    a.concession.status === "lapsed" && within(a.concession.endDate, asOf, 90) ? `Concession no longer on the account since ${a.concession.endDate}` : null],
  ["acct_concession_on_file", "Concession card on file", (a) => (a.concession.status === "active" ? "Concession card on the account" : null)],
  ["acct_repeat_contact", "Repeat contact", (a, asOf) => {
    const byReason = new Map<string, number>();
    for (const c of a.contacts.filter((c) => c.direction === "inbound" && within(c.date, asOf, 60))) byReason.set(c.reason, (byReason.get(c.reason) ?? 0) + 1);
    const top = [...byReason].find(([, n]) => n >= 3);
    return top ? `${top[1]} contacts about "${human(top[0])}" in 60 days` : null;
  }],
  ["acct_complaint", "Complaint or ombudsman referral", (a, asOf) => {
    const open = a.contacts.filter((c) => (c.complaint || c.outcome === "referred_to_ombudsman") && within(c.date, asOf, 90) && !["resolved", "resolved_first_contact"].includes(c.outcome));
    const last = open[open.length - 1];
    return last ? `${human(last.complaintCategory ?? "")} complaint on ${last.date}, ${human(last.outcome)}`.trim() : null;
  }],
  ["acct_returned_mail", "Returned mail or bounced email", (a, asOf) => {
    const bounced = a.communications.undelivered.filter((u) => within(u.date, asOf, 90));
    const last = bounced[bounced.length - 1];
    return last ? `${bounced.length} message${bounced.length > 1 ? "s" : ""} not delivered in 90 days (latest ${last.channel}, ${last.date})` : null;
  }],
  ["acct_digital_disengaged", "Digital disengagement", (a, asOf) =>
    !a.contactPreferences.onlineAccountActive && !within(a.communications.lastOpenedAt, asOf, 90)
      ? `No online account, and no messages opened in 90 days (last opened ${a.communications.lastOpenedAt ?? "never"})` : null],
  ["acct_interpreter", "Interpreter or language preference", (a) => (a.interpreterRequired ? "Interpreter required" : null)],
  ["acct_life_support", "Life support registered", (a) => (a.lifeSupport ? `Life support registered${a.lifeSupportSince ? ` since ${a.lifeSupportSince}` : ""}` : null)],
  ["acct_disconnection_warning", "Disconnection warning sent", (a, asOf) => {
    const w = a.collectionEvents.filter((e) => e.action === "disconnection_warning" && within(e.date, asOf, 30));
    const last = w[w.length - 1];
    return last ? `Warning sent ${last.date}${last.overdue ? ` with ${dollars(last.overdue)} overdue` : ""}` : null;
  }],
  ["acct_disconnected", "Disconnected or restricted", (a) => {
    if (a.supplyStatus !== "disconnected") return null;
    const d = a.disconnections[a.disconnections.length - 1];
    return d ? `Disconnected for non-payment on ${d.date} with ${dollars(d.overdue)} overdue; not reconnected` : "Supply disconnected";
  }],
  ["acct_collections", "Debt collection or default", (a, asOf) => {
    const r = a.collectionEvents.filter((e) => e.action === "referred_to_debt_collection_agency" && within(e.date, asOf, 365));
    const last = r[r.length - 1];
    return last && (latestOverdue(a)?.overdue ?? 0) > 0 ? `Referred to a debt collection agency on ${last.date}` : null;
  }],
  ["acct_hardship_exit", "Left hardship program early", (a, asOf) => {
    const last = a.hardshipHistory.filter((h) => h.exitedAt).at(-1);
    return last && last.exitReason !== "completed" && within(last.exitedAt, asOf, 365) && a.hardshipProgram.status !== "active"
      ? `Left the hardship program on ${last.exitedAt}: ${human(last.exitReason ?? "")}` : null;
  }],
  ["acct_third_party_authority", "Third-party authority on account", (a) =>
    a.thirdPartyAuthority ? `${a.thirdPartyAuthority.type}${a.thirdPartyAuthority.name ? `: ${a.thirdPartyAuthority.name}` : ""} on the account` : null],
  ["acct_cash_only", "Cash or in-person payments only", (a) => {
    const paid = a.payments.filter((p) => p.status === "cleared" && p.kind !== "hugs_grant" && p.kind !== "debt_write_off");
    return paid.length >= 3 && paid.every((p) => p.method === "cash_counter") ? `All ${paid.length} payments made in person` : null;
  }],
  ["acct_no_hardship_offer", "No hardship assessment offered", (a, asOf) => {
    const old = a.bills.find((b) => owing(b) > 0 && daysBetween(b.dueAt, asOf) > 60);
    const offered = a.hardshipHistory.some((h) => within(h.assessedAt, asOf, 365))
      || a.contacts.some((c) => ["hardship_assessment", "hardship_assessment_offered"].includes(c.outcome) && within(c.date, asOf, 365));
    return old && !offered ? `Overdue since ${old.dueAt} (${daysBetween(old.dueAt, asOf)} days) with no hardship assessment in the last 12 months` : null;
  }],
  ["acct_outage_history", "Outage history", (a, asOf) => {
    const year = a.outages.filter((o) => within(o.start, asOf, 365));
    const longest = year.reduce((m, o) => Math.max(m, o.hours), 0);
    return year.length >= 3 || longest > 12 ? `${year.length} outage${year.length === 1 ? "" : "s"} in 12 months, longest ${longest.toFixed(1)} hours` : null;
  }],
  ["acct_remote_area", "Remote or regional supply area", (a) => (a.region.northOf26th ? `Supplied in ${a.region.name}, north of the 26th parallel` : null)],
  ["acct_unanswered_outreach", "Outreach unanswered", (a, asOf) => {
    const missed = a.contacts.filter((c) => c.direction === "outbound" && c.outcome === "no_answer" && within(c.date, asOf, 180));
    return missed.length >= 3 ? `${missed.length} outbound calls not answered in 6 months (latest ${missed[missed.length - 1]!.date})` : null;
  }],
  ["acct_solar_export_zero", "Solar export dropped", (a) => {
    if (!a.solar) return null;
    const m = a.usage.filter((u) => u.exportKwhLastYear !== null && u.disconnectedDays === 0).at(-2); // last complete month
    return m && m.exportKwhLastYear! > 5 && m.exportKwh < m.exportKwhLastYear! * 0.2
      ? `${m.month}: exported ${m.exportKwh} kWh vs ${m.exportKwhLastYear} kWh a year earlier (${a.solar.kw} kW system)` : null;
  }],
  ["acct_move", "Recent move", (a, asOf) => (within(a.customerSince, asOf, 60) ? `Account opened ${a.customerSince}` : null)],
  ["acct_bill_up_flat_usage", "Bill up, usage flat", (a, asOf) => {
    const bills = periodBills(a).filter((b) => b.charges && b.usageKwh !== null && b.issuedAt <= asOf);
    const latest = bills.at(-1);
    if (!latest?.periodStart) return null;
    const target = Date.parse(latest.periodStart) - 365 * DAY;
    const prior = bills.find((b) => b.periodStart && Math.abs(Date.parse(b.periodStart) - target) <= 20 * DAY);
    if (!prior || !prior.usageKwh) return null;
    const cost = (b: Bill) => b.charges!.usage + b.charges!.supply;
    const usageChange = latest.usageKwh! / prior.usageKwh - 1;
    return cost(latest) > cost(prior) * 1.2 && Math.abs(usageChange) <= 0.05
      ? `Bill issued ${latest.issuedAt}: ${dollars(cost(latest))} before credits vs ${dollars(cost(prior))} a year earlier, with usage ${usageChange >= 0 ? "+" : ""}${Math.round(usageChange * 100)}%` : null;
  }],
];

/** Latest bill's usage (or the latest two months for prepaid) against the same period a year earlier. */
function latestUsage(a: CustomerAccount): { label: string; now: number; lastYear: number } | null {
  const b = periodBills(a).filter((x) => x.usageKwh !== null && x.usageKwhLastYear).at(-1);
  if (b && a.plan.type === "postpaid") return { label: `Bill for ${b.periodStart} to ${b.periodEnd}`, now: b.usageKwh!, lastYear: b.usageKwhLastYear! };
  const last = a.usage.filter((u) => u.kWhLastYear).slice(-3, -1); // two complete months
  if (last.length < 2) return null;
  const now = Math.round(last[0]!.kWh + last[1]!.kWh), lastYear = Math.round(last[0]!.kWhLastYear! + last[1]!.kWhLastYear!);
  return lastYear ? { label: `${last[0]!.month} to ${last[1]!.month}`, now, lastYear } : null;
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
  return ay! - y! - (am! < m! || (am === m && ad! < d!) ? 1 : 0);
}
