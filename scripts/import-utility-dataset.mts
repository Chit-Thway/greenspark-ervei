// Imports accounts from the synthetic WA utility dataset (5,150 customers, 1 Jul 2023 – 30 Jun 2025) into
// data/synthetic/utility-accounts.v1.json, which scripts/generate-synthetic-cases.mjs attaches to the fictional
// people. Run it only when the source files change; the app never needs them:
//
//   npx tsx scripts/import-utility-dataset.mts <folder with the source CSV/JSONL files> [--all]
//
// With --all it also writes every open account (4,380) to data/synthetic/utility-accounts.all.jsonl, one JSON object
// per line, for scripts/generate-all-cases.mts. That file is large and stays out of Git (see .gitignore). Reading
// every customer's daily meter reads needs a big heap: node --max-old-space-size=8192 (or NODE_OPTIONS).
//
// What it does:
//   - picks 20 customers for each of the 10 testing scenarios, each matched to what the scenario is about
//     (for example life-support customers in arrears for multiple_support_areas, prepay customers for home_comfort);
//   - shifts every date forward SHIFT_DAYS so the data ends on the app's as-of date (seasons move by ~3.5 months);
//   - turns daily meter reads into monthly usage, and joins transcripts to contacts and outage details to outages.
// Left out on purpose: the monthly panel's label_* columns and intervention outcome measurements (future outcomes
// for model training, which must not feed signals or priority), trial arms, the postcode "PLACEHOLDER" quintile and
// the empty census columns, and half-hourly reads (they only cover a few event windows in 2024).
import { closeSync, createReadStream, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { detectAccountSignals } from "../shared/src/accountSignals.ts";
import type { AccountContact, Bill, CustomerAccount, HardshipRecord, Payment, PaymentArrangement, PaymentKind, PaymentMethod } from "../shared/src/types.ts";

const src = process.argv[2];
if (!src) throw new Error("Usage: npx tsx scripts/import-utility-dataset.mts <source folder> [--all]");
const ALL = process.argv.includes("--all");
const OUT = new URL("../data/synthetic/utility-accounts.v1.json", import.meta.url);
const OUT_ALL = new URL("../data/synthetic/utility-accounts.all.jsonl", import.meta.url);
const SOURCE_END = "2025-06-30";
const AS_OF = "2026-10-16";
const DAY = 86_400_000;
const SHIFT_DAYS = Math.round((Date.parse(AS_OF) - Date.parse(SOURCE_END)) / DAY); // 473
const PER_SCENARIO = 20;
const SCENARIOS = ["new_financial", "assigned_financial", "home_comfort", "health_related", "multiple_support_areas", "historical_payment_plan", "resolved_case", "no_flagged_circumstances", "incomplete_assessment", "support_access_review"] as const;

type Row = Record<string, string>;

// ---------- reading ----------
function parseLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
async function each(name: string, fn: (r: Row) => void) {
  const path = join(src!, name);
  const input = name.endsWith(".gz") ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  let cols: string[] | null = null;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line) continue;
    const v = parseLine(line);
    if (!cols) { cols = v; continue; }
    const r: Row = {};
    cols.forEach((c, i) => { r[c] = v[i] ?? ""; });
    fn(r);
  }
}
async function all(name: string) { const rows: Row[] = []; await each(name, (r) => rows.push(r)); return rows; }
const group = (rows: Row[], key = "customer_id") => { const m = new Map<string, Row[]>(); for (const r of rows) { const k = r[key]!; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); } return m; };

// ---------- values ----------
const num = (s: string | undefined) => (s === undefined || s === "" ? null : Number(s));
const n = (s: string | undefined) => num(s) ?? 0;
const money = (x: number) => Math.round(x * 100) / 100;
const bool = (s: string | undefined) => s === "True" || s === "1";
/** Shifts a date or "date time" string forward SHIFT_DAYS. */
function sh(s: string | undefined): string | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + SHIFT_DAYS);
  const date = d.toISOString().slice(0, 10);
  const time = s.slice(11, 16);
  return time ? `${date} ${time}` : date;
}
const shd = (s: string | undefined) => sh(s)!;
const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const within = (date: string, days: number, end = SOURCE_END) => date.slice(0, 10) <= end && (Date.parse(end) - Date.parse(date.slice(0, 10))) / DAY <= days;
const hash = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };
const METHOD: Record<string, PaymentMethod> = { online_bpay: "bpay", direct_debit: "direct_debit", card_phone: "card", in_person: "cash_counter", centrepay: "centrepay", prepayment_topup: "prepay_topup", hugs_grant: "hugs_grant", write_off: "write_off" };
const TARIFF: Record<string, string> = { A1: "Home Plan (A1)", MIDDAY_SAVER: "Midday Saver" };

console.log(`Reading ${src}; dates shift +${SHIFT_DAYS} days so ${SOURCE_END} becomes ${AS_OF}.`);
const customers = new Map((await all("customers.csv")).map((r) => [r.customer_id!, r]));
const prefs = new Map((await all("contact_preferences.csv")).map((r) => [r.customer_id!, r]));
const postcodes = new Map((await all("postcode_context.csv")).map((r) => [r.postcode!, r]));
const panel = group(await all("customer_month_panel.csv"));
const hardship = group(await all("hardship_programs.csv"));
const arrangements = group(await all("payment_arrangements.csv"));
const disconnections = group(await all("disconnections.csv"));
const contacts = group(await all("contacts.csv"));
const selfDisc = group(await all("prepay_self_disconnections.csv"));
const transcripts = new Map<string, { speaker: "agent" | "customer"; text: string }[]>();
for (const line of readFileSync(join(src, "contact_transcripts.jsonl"), "utf8").split("\n")) {
  if (!line.trim()) continue;
  const t = JSON.parse(line) as { transcript_id: string; turns: { speaker: "agent" | "customer"; text: string }[] };
  transcripts.set(t.transcript_id, t.turns.map((x) => ({ speaker: x.speaker === "customer" ? "customer" : "agent", text: String(x.text) })));
}

// ---------- selection ----------
const end = (id: string) => panel.get(id)?.find((r) => r.month_end === SOURCE_END) ?? null;
const isOpen = (id: string) => !customers.get(id)!.account_close_date;
const postpaid = (id: string) => customers.get(id)!.prepayment_meter === "False";
const T = (id: string, k: string) => bool(end(id)?.[k]);
const F = (id: string, k: string) => n(end(id)?.[k]);
const plansOf = (id: string) => (arrangements.get(id) ?? []).filter((r) => r.type === "payment_plan");
const hasTranscript = (id: string) => (contacts.get(id) ?? []).some((c) => c.transcript_id && within(c.date!, 365));
const north = (id: string) => postcodes.get(customers.get(id)!.postcode!)?.north_of_26th_parallel === "True";
const recentSelfDisc = (id: string) => (selfDisc.get(id) ?? []).filter((r) => within(r.start_datetime!, 30)).length;
const ranked = (ids: string[], score: (id: string) => number = () => 0) => [...ids].sort((a, b) => score(b) - score(a) || hash(a) - hash(b));

const pool = [...customers.keys()].filter((id) => isOpen(id) && (!postpaid(id) || end(id)));
const rules: Record<(typeof SCENARIOS)[number], { pick: (id: string) => boolean; score?: (id: string) => number }> = {
  multiple_support_areas: { pick: (id) => postpaid(id) && customers.get(id)!.life_support === "True" && (F(id, "overdue") > 0 || F(id, "disconnection_warnings_90d") > 0 || F(id, "late_bills_last_3") >= 2), score: (id) => F(id, "overdue") },
  assigned_financial: { pick: (id) => postpaid(id) && T(id, "in_hardship_program") && T(id, "concession_active") && customers.get(id)!.life_support === "False", score: (id) => +hasTranscript(id) },
  health_related: { pick: (id) => customers.get(id)!.medical_cooling_subsidy === "True" && customers.get(id)!.life_support === "False" },
  support_access_review: {
    pick: (id) => prefs.get(id)!.interpreter_required === "True" || prefs.get(id)!.authorised_representative === "True",
    score: (id) => +(contacts.get(id) ?? []).some((c) => c.complaint_flag === "True" || c.repeat_contact_within_7d === "True"),
  },
  home_comfort: { pick: (id) => !postpaid(id), score: recentSelfDisc },
  historical_payment_plan: { pick: (id) => postpaid(id) && plansOf(id).some((p) => p.status === "broken") && T(id, "concession_active") && !T(id, "in_hardship_program") && customers.get(id)!.life_support === "False", score: (id) => +hasTranscript(id) },
  resolved_case: {
    pick: (id) => postpaid(id) && F(id, "overdue") === 0 && T(id, "concession_active") && !T(id, "in_hardship_program") && customers.get(id)!.life_support === "False"
      && ((hardship.get(id) ?? []).some((h) => h.exit_reason === "completed") || plansOf(id).some((p) => p.status === "completed")),
  },
  new_financial: {
    pick: (id) => postpaid(id) && F(id, "overdue") > 100 && F(id, "days_overdue_oldest") > 30 && !T(id, "in_hardship_program") && !T(id, "on_payment_plan") && customers.get(id)!.life_support === "False",
    // Prefer customers who are disconnected now or were referred to collections, so those signals appear too.
    score: (id) => 2 * +(disconnections.get(id) ?? []).some((d) => !d.reconnection_date) + +hasTranscript(id),
  },
  incomplete_assessment: { pick: (id) => postpaid(id) && prefs.get(id)!.online_account_active === "False" && !(contacts.get(id) ?? []).length && customers.get(id)!.life_support === "False" },
  no_flagged_circumstances: {
    pick: (id) => postpaid(id) && F(id, "overdue") === 0 && F(id, "late_bills_last_3") === 0 && F(id, "disconnection_warnings_90d") === 0 && !T(id, "concession_active")
      && customers.get(id)!.life_support === "False" && customers.get(id)!.medical_cooling_subsidy === "False" && !(arrangements.get(id) ?? []).length && !(hardship.get(id) ?? []).length
      && prefs.get(id)!.interpreter_required === "False" && prefs.get(id)!.authorised_representative === "False" && !disconnections.get(id) && !north(id)
      && !(contacts.get(id) ?? []).some((c) => c.transcript_id),
  },
};
const chosen = new Map<string, string[]>(); // scenario -> customer ids
const taken = new Set<string>();
const order: (typeof SCENARIOS)[number][] = ["multiple_support_areas", "assigned_financial", "health_related", "support_access_review", "home_comfort", "historical_payment_plan", "resolved_case", "new_financial", "incomplete_assessment", "no_flagged_circumstances"];
const candidates = new Map<string, string[]>();
for (const s of order) {
  const r = rules[s];
  const list = ranked(pool.filter((id) => !taken.has(id) && r.pick(id)), r.score);
  // The clean control is checked against the signal rules once accounts are built, so keep spares.
  const want = s === "no_flagged_circumstances" ? 120 : PER_SCENARIO;
  if (list.length < PER_SCENARIO) throw new Error(`Only ${list.length} candidates for ${s}`);
  candidates.set(s, list.slice(0, want));
  for (const id of list.slice(0, want)) taken.add(id);
}
const openIds = [...customers.keys()].filter(isOpen).sort();
const needed = new Set([...candidates.values()].flat().concat(ALL ? openIds : []));
console.log(`Selected ${needed.size} candidate customers; reading their history…`);

// ---------- per-customer history (only for the candidates) ----------
const pick = async (name: string) => { const m = new Map<string, Row[]>(); await each(name, (r) => { if (!needed.has(r.customer_id!)) return; if (!m.has(r.customer_id!)) m.set(r.customer_id!, []); m.get(r.customer_id!)!.push(r); }); return m; };
const bills = await pick("bills.csv");
const payments = await pick("payments.csv");
const collections = await pick("collection_events.csv");
const interventions = await pick("interventions.csv");
const hugs = await pick("hugs_grants.csv");
const topups = await pick("prepay_topups.csv");
const prepayDaily = await pick("prepay_daily.csv");
const impacts = await pick("outage_customer_impacts.csv");
const comms = await pick("communications_log.csv.gz");
const outageEvents = new Map((await all("outage_events.csv")).map((r) => [r.outage_id!, r]));
const daily = new Map<string, Map<string, { kwh: number; exp: number; outage: number; disc: boolean }>>();
await each("consumption_daily.csv.gz", (r) => {
  if (!needed.has(r.customer_id!)) return;
  if (!daily.has(r.customer_id!)) daily.set(r.customer_id!, new Map());
  daily.get(r.customer_id!)!.set(r.date!, { kwh: n(r.import_kwh), exp: n(r.export_kwh), outage: n(r.outage_hours), disc: r.supply_status !== "connected" });
});

// ---------- building an account ----------
function build(id: string): { locality: string; postcode: string; account: Omit<CustomerAccount, "dateOfBirth"> } {
  const c = customers.get(id)!, p = prefs.get(id)!, pc = postcodes.get(c.postcode!);
  const days = daily.get(id) ?? new Map();
  const kwhBetween = (from: string, to: string) => {
    let sum = 0, count = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) { const x = days.get(d); if (x) { sum += x.kwh; count++; } }
    const span = (Date.parse(to) - Date.parse(from)) / DAY + 1;
    return count >= span * 0.95 ? Math.round(sum * 10) / 10 : null;
  };
  const months = panel.get(id) ?? [];
  const last = months.find((r) => r.month_end === SOURCE_END) ?? null;

  // Bills: amounts as given; what is still owed comes from the balance at the end, newest bills first.
  const rawBills = [...(bills.get(id) ?? [])].sort((a, b) => a.issue_date!.localeCompare(b.issue_date!));
  let balance = n(last?.balance);
  const owedByBill = new Map<string, number>();
  for (const b of [...rawBills].reverse()) {
    if (b.paid_in_full_date) continue;
    const owe = Math.min(n(b.amount_due), balance);
    owedByBill.set(b.bill_id!, owe); balance = money(balance - owe);
  }
  const billList: Bill[] = rawBills.map((b) => {
    const amount = n(b.amount_due), owe = owedByBill.get(b.bill_id!) ?? 0, opening = bool(b.opening_balance);
    const lastYearFrom = b.period_start_date ? addDays(b.period_start_date, -365) : null;
    return {
      id: b.bill_id!, periodStart: sh(b.period_start_date), periodEnd: sh(b.period_end_date), issuedAt: shd(b.issue_date), dueAt: shd(b.due_date), originalDueAt: shd(b.original_due_date),
      dueDateExtended: bool(b.due_date_extended), usageKwh: num(b.kwh),
      usageKwhLastYear: lastYearFrom && b.period_end_date ? kwhBetween(lastYearFrom, addDays(b.period_end_date, -365)) : null,
      charges: opening ? null : { usage: n(b.usage_charge), supply: n(b.supply_charge), feedInCredit: money(n(b.feed_in_credit)), concessionCredit: n(b.concession_credit), govtCredit: n(b.govt_bill_credit) },
      amount, amountPaid: b.paid_in_full_date ? amount : money(amount - owe), paidInFullAt: sh(b.paid_in_full_date), paidOnTime: bool(b.paid_on_time), finalBill: bool(b.final_bill), openingBalance: opening,
    };
  });

  // Monthly usage from daily reads, by shifted month; last year's figure only when both months are complete.
  const byMonth = new Map<string, { kwh: number; exp: number; outage: number; disc: number; days: number }>();
  for (const [d, x] of days) {
    const m = shd(d).slice(0, 7);
    const t = byMonth.get(m) ?? { kwh: 0, exp: 0, outage: 0, disc: 0, days: 0 };
    t.kwh += x.kwh; t.exp += x.exp; t.outage += x.outage; t.disc += x.disc ? 1 : 0; t.days++;
    byMonth.set(m, t);
  }
  const fullMonth = (m: string) => { const t = byMonth.get(m); const [y, mo] = m.split("-").map(Number); return t && t.days >= new Date(Date.UTC(y!, mo!, 0)).getUTCDate() - 1 ? t : null; };
  const prevYear = (m: string) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
  const usage = [...byMonth.keys()].sort().map((m) => {
    const t = byMonth.get(m)!, ly = fullMonth(m) ? fullMonth(prevYear(m)) : null;
    return { month: m, kWh: Math.round(t.kwh), kWhLastYear: ly ? Math.round(ly.kwh) : null, exportKwh: Math.round(t.exp), exportKwhLastYear: ly ? Math.round(ly.exp) : null, outageHours: Math.round(t.outage * 10) / 10, disconnectedDays: t.disc };
  });

  // Concession from the month-end panel: on the account now, recently removed, or never.
  let concession: CustomerAccount["concession"] = { status: c.concession_card === "True" ? "active" : "none", endDate: null };
  if (months.length) {
    const flags = months.map((r) => bool(r.concession_active));
    if (flags.at(-1)) concession = { status: "active", endDate: null };
    else {
      const lastTrue = flags.lastIndexOf(true);
      concession = lastTrue >= 0 && flags.length - 1 - lastTrue <= 6 ? { status: "lapsed", endDate: shd(months[lastTrue + 1]!.month_end) } : { status: "none", endDate: null };
    }
  }

  const programs: HardshipRecord[] = (hardship.get(id) ?? []).map((h) => ({
    assessedAt: shd(h.assessment_date), trigger: h.trigger!, outcome: h.assessment_outcome === "accepted" ? "accepted" : "denied", startedAt: sh(h.start_date), instalment: num(h.instalment),
    exitedAt: sh(h.exit_date), exitReason: h.exit_reason || null, debtAtEntry: num(h.debt_at_entry), writeOff: n(h.write_off),
    financialCounsellingReferral: bool(h.financial_counselling_referral), energyEfficiencyAdvice: bool(h.energy_efficiency_advice),
  })).sort((a, b) => a.assessedAt.localeCompare(b.assessedAt));
  const active = [...programs].reverse().find((h) => h.outcome === "accepted" && !h.exitedAt && h.startedAt);
  const exited = [...programs].reverse().find((h) => h.exitedAt);
  const plans: PaymentArrangement[] = (arrangements.get(id) ?? []).filter((r) => r.type === "payment_plan").map((r) => ({
    status: r.status as PaymentArrangement["status"], startedAt: shd(r.start_date), endedAt: sh(r.end_date), amount: n(r.amount), instalment: n(r.instalment), instalments: n(r.n_instalments), trigger: r.trigger!,
  })).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const disc = (disconnections.get(id) ?? []).map((d) => ({ date: shd(d.disconnection_date), overdue: n(d.overdue_at_disconnection), reconnectedAt: sh(d.reconnection_date) })).sort((a, b) => a.date.localeCompare(b.date));
  const commsRows = comms.get(id) ?? [];
  const opened = commsRows.filter((r) => r.opened_or_read === "True").map((r) => r.date!).sort().at(-1) ?? null;
  const prepayRows = (prepayDaily.get(id) ?? []).sort((a, b) => a.date!.localeCompare(b.date!));

  const account: Omit<CustomerAccount, "dateOfBirth"> = {
    sourceCustomerId: id,
    utility: "electricity",
    retailer: c.retailer!,
    region: { name: pc?.region ?? c.region!, climateZone: pc?.climate_zone ?? c.climate_zone!, northOf26th: pc?.north_of_26th_parallel === "True" },
    customerSince: shd(c.account_open_date),
    supplyStatus: disc.length && !disc.at(-1)!.reconnectedAt ? "disconnected" : "connected",
    plan: c.prepayment_meter === "True"
      ? { type: "prepaid", tariff: c.tariff!, name: `Prepay, ${TARIFF[c.tariff!] ?? c.tariff}`, billingCycle: null }
      : { type: "postpaid", tariff: c.tariff!, name: TARIFF[c.tariff!] ?? c.tariff!, billingCycle: "bimonthly" },
    meterType: c.meter_type!,
    solar: c.has_solar === "True" ? { kw: n(c.solar_kw) } : null,
    paymentMethod: METHOD[c.payment_method!] ?? "bpay",
    concession,
    medicalCoolingSubsidy: c.medical_cooling_subsidy === "True",
    thirdPartyAuthority: p.authorised_representative === "True" ? { type: "Authorised representative", name: null, since: null } : null,
    lifeSupport: c.life_support === "True",
    lifeSupportSince: sh(c.life_support_registered_date),
    interpreterRequired: p.interpreter_required === "True",
    contactPreferences: {
      preferredChannel: p.preferred_channel!, smsOptIn: bool(p.sms_opt_in), emailOptIn: bool(p.email_opt_in), doNotCall: bool(p.do_not_call),
      proactiveSupportConsent: (p.consent_proactive_support_contact as "yes" | "no" | "not_asked") ?? "not_asked", onlineAccountActive: bool(p.online_account_active),
    },
    hardshipProgram: active ? { status: "active", exitReason: null, assessedAt: active.assessedAt }
      : exited ? { status: "exited", exitReason: exited.exitReason, assessedAt: exited.assessedAt }
      : { status: "none", exitReason: null, assessedAt: programs.at(-1)?.assessedAt ?? null },
    hardshipHistory: programs,
    paymentPlan: plans.at(-1) ?? null,
    paymentPlans: plans,
    extensions: (arrangements.get(id) ?? []).filter((r) => r.type === "bill_extension").map((r) => ({ requestedAt: shd(r.start_date), amount: n(r.amount), until: sh(r.end_date) })).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),
    hugsGrants: (hugs.get(id) ?? []).map((h) => ({ appliedAt: shd(h.application_date), paidAt: sh(h.payment_date), debt: n(h.debt_at_application), amount: n(h.grant_amount), outcome: h.outcome === "approved" ? "approved" as const : "declined" as const })).sort((a, b) => a.appliedAt.localeCompare(b.appliedAt)),
    interventions: (interventions.get(id) ?? []).map((r) => ({ date: shd(r.date), type: r.intervention_type!, trigger: r.trigger!, offeredBy: r.offered_by!, accepted: r.accepted === "" ? null : r.accepted === "1", detail: r.detail || null })).sort((a, b) => a.date.localeCompare(b.date)),
    bills: billList,
    payments: (payments.get(id) ?? []).map((r): Payment => ({ date: shd(r.date), amount: n(r.amount), method: METHOD[r.method!] ?? "bpay", kind: r.kind as PaymentKind, status: r.status === "dishonoured" ? "dishonoured" : "cleared" })).sort((a, b) => a.date.localeCompare(b.date)),
    usage,
    monthly: months.map((r) => ({ date: shd(r.month_end), balance: n(r.balance), overdue: n(r.overdue), daysOverdueOldest: n(r.days_overdue_oldest), concessionActive: bool(r.concession_active) })),
    prepay: c.prepayment_meter === "True" ? {
      creditNow: money(n(prepayRows.at(-1)?.closing_credit)),
      recharges: (topups.get(id) ?? []).filter((r) => within(r.datetime!, 180)).map((r) => ({ date: shd(r.datetime), amount: n(r.amount), context: r.context! })).sort((a, b) => a.date.localeCompare(b.date)),
      selfDisconnections: (selfDisc.get(id) ?? []).filter((r) => within(r.start_datetime!, 365)).map((r) => ({ start: shd(r.start_datetime), hours: Math.round(n(r.duration_hours) * 100) / 100, hotDay: bool(r.hot_day) })).sort((a, b) => a.start.localeCompare(b.start)),
    } : null,
    contacts: (contacts.get(id) ?? []).map((r): AccountContact => ({
      id: r.contact_id!, date: shd(r.date), channel: r.channel!, direction: r.direction === "outbound" ? "outbound" : "inbound", reason: r.reason!, outcome: r.outcome!,
      sentiment: num(r.sentiment), complaint: bool(r.complaint_flag), complaintCategory: r.complaint_category || null, repeatWithin7d: bool(r.repeat_contact_within_7d), notes: r.agent_notes!,
      transcript: r.transcript_id ? transcripts.get(r.transcript_id) ?? null : null,
    })).sort((a, b) => a.date.localeCompare(b.date)),
    collectionEvents: (collections.get(id) ?? []).map((r) => ({ date: shd(r.date), action: r.action!, overdue: num(r.overdue_amount) })).sort((a, b) => a.date.localeCompare(b.date)),
    disconnections: disc,
    outages: (impacts.get(id) ?? []).map((r) => {
      const ev = outageEvents.get(r.outage_id!);
      return { start: shd(r.start_datetime), end: shd(r.end_datetime), hours: n(r.duration_hours), type: ev?.outage_type === "planned" ? "planned" as const : "unplanned" as const, cause: ev?.cause ?? "unknown", noticeDate: sh(ev?.notice_date) };
    }).sort((a, b) => a.start.localeCompare(b.start)),
    communications: {
      lastOpenedAt: sh(opened ?? undefined),
      undelivered: commsRows.filter((r) => r.delivered === "False" && within(r.date!, 365)).map((r) => ({ date: shd(r.date), channel: r.channel!, type: r.message_type! })).sort((a, b) => a.date.localeCompare(b.date)),
    },
  };
  return { locality: c.locality!, postcode: c.postcode!, account };
}

// ---------- choose, check and write ----------
const scenarios: Record<string, string[]> = {};
const out: Record<string, ReturnType<typeof build>> = {};
for (const s of SCENARIOS) {
  const ids: string[] = [];
  for (const id of candidates.get(s)!) {
    if (ids.length === PER_SCENARIO) break;
    const built = build(id);
    const signals = detectAccountSignals({ ...built.account, dateOfBirth: "1970-01-01" }, AS_OF);
    if (s === "no_flagged_circumstances" ? signals.length > 0 : false) continue; // the clean control raises nothing
    ids.push(id); out[id] = built;
  }
  if (ids.length < PER_SCENARIO) throw new Error(`Only ${ids.length} usable customers for ${s}`);
  scenarios[s] = ids;
}
const data = {
  metadata: {
    datasetId: "wa-utility-synthetic-5150",
    description: "Accounts for 200 customers from a synthetic WA electricity retail dataset (5,150 customers, 1 Jul 2023 to 30 Jun 2025), 20 per testing scenario.",
    isSynthetic: true,
    sourceEnd: SOURCE_END, asOf: AS_OF, dateShiftDays: SHIFT_DAYS,
    notes: [
      `Every date is shifted forward ${SHIFT_DAYS} days so the data ends on the app's as-of date; seasons move by about 3.5 months.`,
      "Left out: label_* outcome columns, intervention outcome measurements and trial arms, the postcode PLACEHOLDER quintile, empty census columns, half-hourly reads.",
      "Source customer IDs are kept as sourceCustomerId for traceability; names, contact details, dates of birth and survey answers come from the fictional fixture.",
    ],
  },
  scenarios,
  customers: out,
};
writeFileSync(OUT, `${JSON.stringify(data, null, 1)}\n`);
console.log(`Wrote ${Object.keys(out).length} accounts to ${OUT.pathname}`);
if (ALL) {
  // Every open account, one per line, built one at a time so they never all sit in memory as accounts.
  const fd = openSync(OUT_ALL, "w");
  for (const id of openIds) writeSync(fd, `${JSON.stringify({ customerId: id, ...build(id) })}\n`);
  closeSync(fd);
  console.log(`Wrote ${openIds.length} accounts to ${OUT_ALL.pathname}`);
}
for (const s of SCENARIOS) {
  const counts = new Map<string, number>();
  for (const id of scenarios[s]!) for (const sig of detectAccountSignals({ ...out[id]!.account, dateOfBirth: "1970-01-01" }, AS_OF)) counts.set(sig.id, (counts.get(sig.id) ?? 0) + 1);
  console.log(s.padEnd(26), [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace("acct_", "")}:${v}`).join(" "));
}
