// Trains the 90-day risk model from the synthetic WA utility dataset and scores every open customer.
//
//   npx tsx scripts/train-risk-model.mts <folder with the source CSV files>
//
// Reads customer_month_panel.csv: one row per customer per month, with features known at that month end and labels
// saying what happened in the next 90 days. For each outcome it fits an L2-regularised logistic regression on months
// whose 90 days are complete (label_window_complete), holding out 20% of customers (all their months) to measure it.
// Then it scores each open customer's latest month, which has no outcome yet: that is the prediction.
// Writes data/models/risk-model.v1.json (the model and how well it did) and data/synthetic/predictions.v1.json.
//
// The dataset is synthetic, so the model mostly learns how its generator made outcomes. The measures below say how
// well it ranks customers in this data, not how it would do on real customers.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const src = process.argv[2];
if (!src) throw new Error("Usage: npx tsx scripts/train-risk-model.mts <source folder>");

/** Inputs: every panel feature, with how to read it and how to turn it into a number the model can use. */
const FEATURES: { id: string; label: string; kind: "count" | "money" | "flag" | "ratio" | "plain" | "days" }[] = [
  { id: "account_age_days", label: "Years as a customer", kind: "days" },
  { id: "balance", label: "Balance owing", kind: "money" },
  { id: "overdue", label: "Amount overdue", kind: "money" },
  { id: "days_overdue_oldest", label: "Days the oldest bill is overdue", kind: "count" },
  { id: "late_bills_last_3", label: "Late bills (last 3)", kind: "plain" },
  { id: "failed_direct_debits_90d", label: "Failed direct debits (90 days)", kind: "plain" },
  { id: "disconnection_warnings_90d", label: "Disconnection warnings (90 days)", kind: "plain" },
  { id: "extensions_this_fy", label: "Bill extensions this year", kind: "plain" },
  { id: "on_payment_plan", label: "On a payment plan", kind: "flag" },
  { id: "plans_broken_180d", label: "Payment plans broken (180 days)", kind: "plain" },
  { id: "in_hardship_program", label: "In the hardship program", kind: "flag" },
  { id: "concession_active", label: "Concession on the account", kind: "flag" },
  { id: "life_support", label: "Life support registered", kind: "flag" },
  { id: "medical_cooling_subsidy", label: "Medical cooling subsidy", kind: "flag" },
  { id: "inbound_contacts_30d", label: "Contacts from the customer (30 days)", kind: "plain" },
  { id: "payment_related_contacts_90d", label: "Payment-related contacts (90 days)", kind: "plain" },
  { id: "complaints_90d", label: "Complaints (90 days)", kind: "plain" },
  { id: "mean_contact_sentiment_90d", label: "Contact sentiment (90 days)", kind: "ratio" },
  { id: "import_kwh_30d", label: "Usage, last 30 days", kind: "count" },
  { id: "import_kwh_30d_vs_prior_90d_avg", label: "Usage vs the 3 months before", kind: "ratio" },
  { id: "import_kwh_30d_vs_same_period_last_year", label: "Usage vs a year earlier", kind: "ratio" },
  { id: "hot_days_90d", label: "Hot days (90 days)", kind: "plain" },
  { id: "near_zero_usage_days_30d", label: "Days with almost no usage (30 days)", kind: "plain" },
  { id: "disconnected_days_30d", label: "Days disconnected (30 days)", kind: "plain" },
  { id: "outage_hours_30d", label: "Outage hours (30 days)", kind: "count" },
];
/** Outcomes, with how each reads on screen. */
const OUTCOMES = [
  { id: "any_adverse", column: "label_any_adverse_next_90d", label: "Any of these harms" },
  { id: "disconnected", column: "label_disconnected_next_90d", label: "Disconnected for non-payment" },
  { id: "overdue_1000", column: "label_overdue_over_1000_next_90d", label: "Overdue debt passes $1,000" },
  { id: "plan_broken", column: "label_plan_broken_next_90d", label: "A payment plan breaks" },
] as const;

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
function csv(name: string): Record<string, string>[] {
  const lines = readFileSync(join(src!, name), "utf8").split(/\r?\n/).filter(Boolean);
  const cols = parseLine(lines[0]!);
  return lines.slice(1).map((l) => { const v = parseLine(l); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""])); });
}
const truthy = (s: string | undefined) => s === "True" || s === "1";
const open = new Set(csv("customers.csv").filter((r) => !r.account_close_date).map((r) => r.customer_id!));
const panel = csv("customer_month_panel.csv");
console.log(`Read ${panel.length} panel rows`);
const SOURCE_END = panel.reduce((m, r) => (r.month_end! > m ? r.month_end! : m), "");

// ---------- features ----------
/** Raw value for the model: logs for skewed amounts, ratios capped, blanks become 0 with a "missing" flag. */
function raw(r: Record<string, string>): number[] {
  const x: number[] = [];
  for (const f of FEATURES) {
    const s = r[f.id] ?? "";
    if (f.kind === "flag") { x.push(truthy(s) ? 1 : 0); continue; }
    const v = s === "" ? NaN : Number(s);
    if (f.kind === "ratio") { x.push(Number.isFinite(v) ? Math.max(-5, Math.min(5, v)) : 0, Number.isFinite(v) ? 0 : 1); continue; }
    const n = Number.isFinite(v) ? Math.max(0, v) : 0;
    x.push(f.kind === "money" || f.kind === "count" ? Math.log1p(n) : f.kind === "days" ? n / 365 : n);
  }
  return x;
}
/** The model's input names: ratios have a second "missing" input. */
const INPUTS = FEATURES.flatMap((f) => (f.kind === "ratio" ? [{ id: f.id, label: f.label, missing: false }, { id: `${f.id}_missing`, label: `${f.label}: not recorded`, missing: true }] : [{ id: f.id, label: f.label, missing: false }]));

// Hold out 20% of customers (every month of theirs), chosen by a hash of the ID so the split is stable.
const hash = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };
const test = (id: string) => hash(id) % 5 === 0;
const rows = panel.filter((r) => truthy(r.label_window_complete));
const X = rows.map(raw);
const isTest = rows.map((r) => test(r.customer_id!));
const train = X.filter((_, i) => !isTest[i]);
const k = INPUTS.length;
const mean = Array.from({ length: k }, (_, j) => train.reduce((s, x) => s + x[j]!, 0) / train.length);
const sd = Array.from({ length: k }, (_, j) => Math.sqrt(train.reduce((s, x) => s + (x[j]! - mean[j]!) ** 2, 0) / train.length) || 1);
const z = (x: number[]) => x.map((v, j) => (v - mean[j]!) / sd[j]!);
const Z = X.map(z);
console.log(`Prepared ${X.length} months with ${INPUTS.length} inputs`);

// ---------- fitting ----------
const sigmoid = (t: number) => 1 / (1 + Math.exp(-t));
// The training rows as one flat typed array (inputs then a 1 for the intercept), so fitting is plain arithmetic.
const n1 = k + 1;
const trainIdx = Z.map((_, i) => i).filter((i) => !isTest[i]);
const D = new Float64Array(trainIdx.length * n1);
trainIdx.forEach((i, r) => { const zi = Z[i]!; for (let j = 0; j < k; j++) D[r * n1 + j] = zi[j]!; D[r * n1 + k] = 1; });

/** L2 logistic regression by Newton's method (iteratively reweighted least squares). */
function fit(y: number[], lambda = 1): { w: number[]; b: number } {
  const yt = trainIdx.map((i) => y[i]!);
  const beta = new Float64Array(n1);
  beta[k] = Math.log((yt.reduce((s, v) => s + v, 0) + 1) / (yt.length - yt.reduce((s, v) => s + v, 0) + 1));
  for (let it = 0; it < 30; it++) {
    const g = new Float64Array(n1), H = new Float64Array(n1 * n1);
    for (let r = 0; r < yt.length; r++) {
      const o = r * n1;
      let t = 0;
      for (let j = 0; j < n1; j++) t += D[o + j]! * beta[j]!;
      const p = 1 / (1 + Math.exp(-t)), e = p - yt[r]!, s = p * (1 - p);
      for (let a = 0; a < n1; a++) {
        const xa = D[o + a]!;
        g[a]! += e * xa;
        const sx = s * xa;
        for (let c = 0; c <= a; c++) H[a * n1 + c]! += sx * D[o + c]!;
      }
    }
    for (let a = 0; a < k; a++) { g[a]! += lambda * beta[a]!; H[a * n1 + a]! += lambda; }
    const A = Array.from({ length: n1 }, (_, a) => Array.from({ length: n1 }, (_, c) => H[Math.max(a, c) * n1 + Math.min(a, c)]!));
    const step = solve(A, [...g]);
    // Halve the step until the penalised loss goes down, so rare outcomes can't make it overshoot.
    const before = loss(beta, yt, lambda);
    let scale = 1, next = beta;
    for (; scale > 1e-4; scale /= 2) {
      next = beta.map((v, j) => v - scale * step[j]!);
      if (loss(next, yt, lambda) <= before) break;
    }
    const moved = Math.max(...step.map((v) => Math.abs(v * scale)));
    beta.set(next);
    if (process.env.DEBUG) console.log(`  iteration ${it + 1}, step ${moved.toExponential(1)}, loss ${loss(beta, yt, lambda).toFixed(2)}`);
    if (moved < 1e-6 || scale <= 1e-4) break;
  }
  return { w: [...beta.slice(0, k)], b: beta[k]! };
}
/** Negative log-likelihood plus the L2 penalty (the intercept is not penalised). */
function loss(beta: Float64Array, yt: number[], lambda: number): number {
  let total = 0;
  for (let r = 0; r < yt.length; r++) {
    const o = r * n1;
    let t = 0;
    for (let j = 0; j < n1; j++) t += D[o + j]! * beta[j]!;
    // log(1 + e^t) - y t, written to stay finite for large |t|
    total += (t > 0 ? t + Math.log1p(Math.exp(-t)) : Math.log1p(Math.exp(t))) - yt[r]! * t;
  }
  for (let j = 0; j < k; j++) total += (lambda / 2) * beta[j]! ** 2;
  return total;
}
function solve(A: number[][], v: number[]): number[] {
  const n = v.length, M = A.map((row, i) => [...row, v[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r]![c]! / M[c]![c]!; for (let j = c; j <= n; j++) M[r]![j]! -= f * M[c]![j]!; }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

// ---------- measuring, on held-out customers ----------
function auc(scores: number[], y: number[]): number {
  const order = scores.map((s, i) => [s, y[i]!] as const).sort((a, b) => a[0] - b[0]);
  let rank = 0, pos = 0, sum = 0;
  for (let i = 0; i < order.length;) {
    let j = i; while (j < order.length && order[j]![0] === order[i]![0]) j++;
    const avg = (i + 1 + j) / 2;
    for (let t = i; t < j; t++) if (order[t]![1]) { sum += avg; pos++; }
    rank = j; i = j;
  }
  const neg = rank - pos;
  return pos && neg ? (sum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

const model: Record<string, unknown> = {};
const fitted: Record<string, { w: number[]; b: number }> = {};
for (const o of OUTCOMES) {
  const y = rows.map((r) => (truthy(r[o.column]) ? 1 : 0));
  const m = fit(y);
  fitted[o.id] = m;
  const ti = y.map((_, i) => i).filter((i) => isTest[i]);
  const p = ti.map((i) => sigmoid(Z[i]!.reduce((s, v, j) => s + v * m.w[j]!, m.b)));
  const yt = ti.map((i) => y[i]!);
  const base = yt.reduce((s, v) => s + v, 0) / yt.length;
  // How many of the real cases fall in the 5% and 10% the model ranks riskiest.
  const sorted = p.map((v, i) => [v, yt[i]!] as const).sort((a, b) => b[0] - a[0]);
  const top = (share: number) => { const n = Math.max(1, Math.round(sorted.length * share)); const hits = sorted.slice(0, n).reduce((s, v) => s + v[1], 0); return { share, precision: round(hits / n), recall: round(hits / Math.max(1, yt.reduce((s, v) => s + v, 0))) }; };
  // Calibration: predicted against actual rates in ten groups of equal size.
  const groups = Array.from({ length: 10 }, (_, g) => sorted.slice(Math.floor((g * sorted.length) / 10), Math.floor(((g + 1) * sorted.length) / 10)))
    .map((s) => ({ predicted: round(s.reduce((a, v) => a + v[0], 0) / s.length, 4), actual: round(s.reduce((a, v) => a + v[1], 0) / s.length, 4) }));
  model[o.id] = {
    label: o.label, column: o.column, intercept: round(m.b, 5), weights: Object.fromEntries(INPUTS.map((f, j) => [f.id, round(m.w[j]!, 5)])),
    test: { months: yt.length, positives: yt.reduce((s, v) => s + v, 0), baseRate: round(base, 4), auc: round(auc(p, yt)), top5: top(0.05), top10: top(0.1), calibration: groups },
  };
  console.log(`${o.id.padEnd(13)} AUC ${round(auc(p, yt))}  base ${(base * 100).toFixed(2)}%  top 5%: precision ${(top(0.05).precision * 100).toFixed(1)}%, catches ${(top(0.05).recall * 100).toFixed(0)}% of cases`);
}

// ---------- scoring each open customer's latest month ----------
const latest = new Map<string, Record<string, string>>();
for (const r of panel) if (open.has(r.customer_id!) && (!latest.has(r.customer_id!) || r.month_end! > latest.get(r.customer_id!)!.month_end!)) latest.set(r.customer_id!, r);
const scored = [...latest].map(([id, r]) => {
  const x = raw(r), zx = z(x);
  const out: Record<string, number> = {};
  for (const o of OUTCOMES) { const m = fitted[o.id]!; out[o.id] = sigmoid(zx.reduce((s, v, j) => s + v * m.w[j]!, m.b)); }
  // What pushed "any harm" up the most: each input's contribution against an average customer.
  const m = fitted.any_adverse!;
  const factors = INPUTS.map((f, j) => ({ f, j, c: m.w[j]! * zx[j]! })).filter((t) => t.c > 0.05).sort((a, b) => b.c - a.c).slice(0, 3)
    .map(({ f, j, c }) => ({ id: f.id, label: f.label, value: f.missing ? null : r[f.id.replace(/_missing$/, "")] ?? null, weight: round(c, 2) }));
  void x;
  return { id, monthEnd: r.month_end!, p: out, factors };
});
// Where each customer sits among all open customers, for "Top 5%" style wording.
const percentiles: Record<string, Map<string, number>> = {};
for (const o of OUTCOMES) {
  // The share of customers with a lower chance (as shown, to 4 places), so customers tied at ~0 aren't ranked apart.
  const shown = (c: (typeof scored)[number]) => round(c.p[o.id]!, 4);
  const values = scored.map(shown).sort((a, b) => a - b);
  const below = (v: number) => { let lo = 0, hi = values.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid]! < v) lo = mid + 1; else hi = mid; } return lo; };
  percentiles[o.id] = new Map(scored.map((c) => [c.id, Math.round((below(shown(c)) / values.length) * 1000) / 10]));
}
const predictions = Object.fromEntries(scored.map((c) => [c.id, {
  sourceMonthEnd: c.monthEnd,
  outcomes: Object.fromEntries(OUTCOMES.map((o) => [o.id, { probability: round(c.p[o.id]!, 4), percentile: percentiles[o.id]!.get(c.id)! }])),
  factors: c.factors,
}]));

mkdirSync(new URL("../data/models/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/models/risk-model.v1.json", import.meta.url), `${JSON.stringify({
  id: "risk-90d-v1", type: "L2 logistic regression (one per outcome)", trainedOn: "customer_month_panel.csv, months with a complete 90-day outcome window",
  sourceEnd: SOURCE_END, horizonDays: 90, trainingMonths: train.length, testMonths: X.length - train.length, heldOut: "20% of customers (all their months), by a hash of the customer ID",
  inputs: INPUTS.map((f, j) => ({ ...f, mean: round(mean[j]!, 5), sd: round(sd[j]!, 5) })), features: FEATURES, outcomes: model,
  caveat: "Trained and tested on a synthetic dataset: these measures show how well the model ranks customers in this data, not how it would do on real customers.",
}, null, 1)}\n`);
writeFileSync(new URL("../data/synthetic/predictions.v1.json", import.meta.url), JSON.stringify({ modelId: "risk-90d-v1", sourceEnd: SOURCE_END, horizonDays: 90, customers: predictions }));
console.log(`Scored ${scored.length} open customers at ${SOURCE_END}.`);
