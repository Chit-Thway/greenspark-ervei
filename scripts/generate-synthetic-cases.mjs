import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const destination = fileURLToPath(new URL('../data/synthetic/case-queue.v1.json', import.meta.url));
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const option = (name, fallback) => Number(args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const count = option('count', 100);
const seed = option('seed', 3162026);
const asOf = '2026-10-16';
assert(Number.isInteger(count) && count >= 20 && count <= 400, 'count must be an integer between 20 and 400');
assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'seed must be an unsigned 32-bit integer');

let randomState = seed;
const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
const pick = items => items[Math.floor(random() * items.length)];
const day = (date, offset) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const monthsBefore = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
const shuffle = items => { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; };
const yesNo = ['Yes', 'No'];
const field = (id, label, allowedValues, referencePeriod, sourceColumn) => ({ id, label, allowedValues, nullable: true, referencePeriod, sourceDefinition: { dataset: 'eca-household-jun-2026', variable: id, sheet: 'RAW data (Labelled)', headerCell: `${sourceColumn}1` } });

const evidenceFieldDefinitions = [
  field('Q32_1', 'Difficulty paying the electricity bill', ['Very easy', 'Quite easy', 'Quite difficult', 'Very difficult'], 'past_6_months', 'DA'),
  field('Q33a_1', 'Kept the home comfortably warm in cold weather', ['Always', 'Often', 'Sometimes', 'Rarely', 'Never'], 'past_12_months', 'DC'),
  field('Q33a_2', 'Kept the home comfortably cool in hot weather', ['Always', 'Often', 'Sometimes', 'Rarely', 'Never'], 'past_12_months', 'DD'),
  field('Q35_3', 'Avoided heating or cooling to save money', yesNo, 'past_12_months', 'DH'),
  field('Q35_4', 'Applied for government assistance with energy bills', yesNo, 'past_12_months', 'DI'),
  field('Q35_5', 'Contacted the provider about difficulty paying bills', yesNo, 'past_12_months', 'DJ'),
  field('Q35_7', 'Unable to pay an energy bill on time due to financial difficulty', yesNo, 'past_12_months', 'DL'),
  field('Q35_8', 'Unable to afford other essential expenses', yesNo, 'past_12_months', 'DM'),
  ...[
    ['Q36b_1', 'Reported a bill extension', 'DP'], ['Q36b_2', 'Reported a reduction in the amount owing', 'DQ'],
    ['Q36b_3', 'Reported a repayment plan', 'DR'], ['Q36b_4', 'Reported hardship-program enrolment', 'DS'],
    ['Q36b_5', 'Reported advice on reducing energy costs', 'DT'], ['Q36b_6', 'Reported help moving to a cheaper energy plan', 'DU'],
    ['Q36b_7', 'Reported a concession/rebate eligibility check', 'DV'], ['Q36b_8', 'Reported appliance-replacement support', 'DW'],
  ].map(([id, label, col]) => field(id, label, yesNo, 'past_12_months', col)),
  field('Q37', 'Currently enrolled in a hardship program when reported', yesNo, 'at_report', 'DZ'),
  field('Z7_4', 'Reported life-support registration', yesNo, 'at_report', 'MY'),
  field('Z7_6', 'Health condition or disability affects energy use', yesNo, 'at_report', 'NA'),
  field('Z7_8', 'Reported an energy-bill concession', yesNo, 'at_report', 'NC'),
  field('Z8a', 'Self-described financial situation', ['Doing well and feeling comfortable', 'Doing OK and making ends meet', 'Having some difficulty but just making ends meet', 'Having a lot of difficulty paying bills and covering basic living expenses'], 'at_report', 'ND'),
];

const recommendationDefinitions = [
  ['payment_options_review', 'Review payment options', 'Discuss payment options that fit the person’s current circumstances.'],
  ['payment_plan_review', 'Discuss an affordable repayment plan', 'Review a repayment plan with the person and the provider.'],
  ['bill_extension_review', 'Review a bill extension', 'Check whether an extension is available and suitable.'],
  ['hardship_assessment', 'Assess hardship assistance', 'Review current support needs and available hardship assistance.'],
  ['concession_check', 'Check concessions or rebates', 'Check eligibility rather than assuming entitlement.'],
  ['energy_cost_review', 'Review energy costs and available plans', 'Review costs and available tariffs or plans within the person’s actual provider choices.'],
  ['home_efficiency_review', 'Review home-efficiency support', 'Discuss options that could help maintain a comfortable home.'],
  ['appliance_support_review', 'Review appliance-support options', 'Check whether suitable appliance support is available.'],
  ['specialist_review', 'Arrange a specialist worker review', 'Arrange an appropriate worker review of the reported energy needs.'],
  ['account_information_check', 'Confirm relevant account information', 'Confirm relevant details with the person and provider.'],
  ['suitable_assistance_review', 'Review other suitable assistance', 'Discuss other available support appropriate to the person’s situation.'],
].map(([id, label, description]) => ({ id, label, description, requiresWorkerReview: true, provenance: 'product_proposal_informed_by_ECA_Q36b_and_approved_discussion', guaranteesEligibility: false }));

const circumstanceDefinitions = [
  ['bill_payment_difficulty', 'Difficulty paying energy bills', 'financial_pressure', ['Q32_1'], ['payment_options_review', 'payment_plan_review', 'bill_extension_review'], 'Q32_1 is Quite difficult or Very difficult'],
  ['unable_to_pay_on_time', 'Reported inability to pay on time', 'financial_pressure', ['Q35_7'], ['hardship_assessment', 'bill_extension_review'], 'Q35_7 is Yes'],
  ['other_essentials_difficulty', 'Difficulty covering other essentials', 'financial_pressure', ['Q35_8'], ['hardship_assessment', 'concession_check'], 'Q35_8 is Yes'],
  ['reported_financial_strain', 'Reported financial strain', 'financial_pressure', ['Z8a'], ['hardship_assessment', 'concession_check'], 'Z8a reports some or a lot of difficulty'],
  ['keeping_warm_difficulty', 'Difficulty keeping warm', 'home_comfort', ['Q33a_1'], ['energy_cost_review', 'home_efficiency_review', 'appliance_support_review'], 'Q33a_1 is Rarely or Never'],
  ['keeping_cool_difficulty', 'Difficulty keeping cool', 'home_comfort', ['Q33a_2'], ['energy_cost_review', 'home_efficiency_review', 'appliance_support_review'], 'Q33a_2 is Rarely or Never'],
  ['avoiding_heating_cooling', 'Avoiding heating/cooling due to cost', 'home_comfort', ['Q35_3'], ['energy_cost_review', 'home_efficiency_review', 'appliance_support_review'], 'Q35_3 is Yes'],
  ['reported_life_support', 'Reported life-support registration', 'health_related_energy', ['Z7_4'], ['specialist_review', 'account_information_check'], 'Z7_4 is Yes'],
  ['health_affects_energy', 'Health/disability affects energy use', 'health_related_energy', ['Z7_6'], ['specialist_review', 'suitable_assistance_review'], 'Z7_6 is Yes'],
].map(([id, label, supportAreaId, evidenceFieldIds, recommendationIds, illustrativeRule]) => ({ id, label, supportAreaId, evidenceFieldIds, recommendationIds, illustrativeRule, classificationProvenance: 'illustrative_demo_grouping_not_a_prediction_model' }));

const supportAreas = [
  ['financial_pressure', 'Financial pressure'], ['home_comfort', 'Heating, cooling & home comfort'], ['health_related_energy', 'Health-related energy needs'],
].map(([id, label]) => ({ id, label, circumstanceIds: circumstanceDefinitions.filter(c => c.supportAreaId === id).map(c => c.id) }));

const users = [
  { id: 'staff-manager', displayName: 'Taylor Brooks', role: 'manager', isSynthetic: true },
  ...[['alex', 'Alex Morgan'], ['sarah', 'Sarah Chen'], ['james', 'James Wilson'], ['maya', 'Maya Patel']].map(([id, displayName]) => ({ id: `staff-${id}`, displayName, role: 'support_worker', isSynthetic: true })),
];

const firstNames = ['Olivia', 'Noah', 'Amelia', 'Ethan', 'Isla', 'Leo', 'Mia', 'Lucas', 'Ava', 'Sophie', 'Henry', 'Zoe', 'Grace', 'Finn', 'Lily', 'Ruby', 'Oscar', 'Chloe', 'Ella', 'Hugo'];
const lastNames = ['Bennett', 'Williams', 'Brooks', 'Cooper', 'Mitchell', 'Parker', 'Thompson', 'Evans', 'Harrison', 'Turner', 'Collins', 'Anderson', 'Walker', 'Roberts', 'Hayes', 'Foster', 'Phillips', 'Hughes', 'Spencer', 'Ross'];
const names = shuffle(firstNames.flatMap(first => lastNames.map(last => `${first} ${last}`)));
const suburbs = ['Midland', 'Armadale', 'Belmont', 'Fremantle', 'Gosnells', 'Joondalup', 'Rockingham', 'Victoria Park', 'Morley', 'Maylands', 'Balga', 'Cannington', 'Mandurah', 'Bayswater', 'Ellenbrook'];
// Contact details are derived from a hash of the person's position, NOT from the seeded random stream,
// so adding them leaves every other generated value unchanged.
const hash = (i, salt) => { let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
const postcodes = { Midland: '6056', Armadale: '6112', Belmont: '6104', Fremantle: '6160', Gosnells: '6110', Joondalup: '6027', Rockingham: '6168', 'Victoria Park': '6100', Morley: '6062', Maylands: '6051', Balga: '6061', Cannington: '6107', Mandurah: '6210', Bayswater: '6053', Ellenbrook: '6069' };
const genders = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];
// Fictional people only: gender follows the invented first name, except for a few deliberate Non-binary and
// Prefer not to say records so the screen is tested with every value. (Real people's gender must never be guessed from a name.)
const nameGender = { Olivia: 'Female', Noah: 'Male', Amelia: 'Female', Ethan: 'Male', Isla: 'Female', Leo: 'Male', Mia: 'Female', Lucas: 'Male', Ava: 'Female', Sophie: 'Female', Henry: 'Male', Zoe: 'Female', Grace: 'Female', Finn: 'Male', Lily: 'Female', Ruby: 'Female', Oscar: 'Male', Chloe: 'Female', Ella: 'Female', Hugo: 'Male' };
const nicknames = { Olivia: 'Liv', Amelia: 'Millie', Lucas: 'Luke', Sophie: 'Soph', Henry: 'Hal', Grace: 'Gracie', Oscar: 'Ozzie' };
const streetNames = ['Quokka Rise', 'Wattlebird Loop', 'Marri Parade', 'Banded Stilt Way', 'Zamia Court', 'Karri Bend', 'Numbat Place', 'Boobook Lane', 'Samphire Road', 'Black Cockatoo Drive', 'Balga Gully Street', 'Tuart Avenue', 'Honeyeater Close', 'Kangaroo Paw Terrace', 'Mallee Hen Crescent'];
// Numbers set aside for fiction, so they never reach a real person: the Australian regulator (ACMA) reserves
// (08) 5550 xxxx landlines and a short list of 0491 57x xxx mobiles. Emails use example.com, which is reserved.
const fictionalMobiles = ['0491 570 006', '0491 570 156', '0491 570 157', '0491 570 158', '0491 570 159', '0491 570 313', '0491 570 737', '0491 579 455'];
function withContactDetails(person, i) {
  const [first, last] = person.displayName.split(' ');
  const nickname = nicknames[first];
  const preferredName = nickname && hash(i, 1) % 3 === 0 ? nickname : first;
  const g = hash(i, 2) % 100; // 0-6 Non-binary, 7-11 Prefer not to say, otherwise by name
  const channel = person.contactPreference.channel;
  const mobile = hash(i, 3) % 20 < 3 && channel !== 'sms' ? null : fictionalMobiles[hash(i, 4) % fictionalMobiles.length];
  const phone = hash(i, 5) % 4 === 0 && channel !== 'phone' ? null : `(08) 5550 ${String(hash(i, 6) % 10000).padStart(4, '0')}`;
  const email = hash(i, 7) % 10 === 0 && channel !== 'email' ? null : `${preferredName.toLowerCase()}.${last.toLowerCase()}@example.com`;
  return {
    ...person,
    gender: g < 7 ? 'Non-binary' : g < 12 ? 'Prefer not to say' : nameGender[first],
    preferredName,
    address: { line1: `${1 + hash(i, 8) % 98} ${streetNames[hash(i, 9) % streetNames.length]}`, line2: hash(i, 10) % 10 < 3 ? `Unit ${1 + hash(i, 11) % 12}` : null, postcode: postcodes[person.suburb] },
    mobile, phone, email,
    contactDetailsProvenance: 'fictional_demo_contact_details',
  };
}

// Fictional electricity accounts, billed every two months as in WA. Like the contact details they come from
// hash(i, salt), not the seeded random stream, so every other generated value stays the same. Each testing
// scenario shapes the bills, payments and account flags so that specific account signals from the Admin flow
// (data/admin/utility_hardship_mapping.json) fire; shared/src/accountSignals.ts detects them.
const TARIFF = { centsPerKwh: 31.65, supplyCentsPerDay: 115.63, provenance: 'illustrative_tariff_not_a_quote' };
const SEASON = [1.25, 1.2, 1.05, 0.9, 0.9, 1.05, 1.1, 1.05, 0.9, 0.85, 0.95, 1.15]; // Jan..Dec usage shape
// How each of the six bills (oldest first) gets paid, per scenario. 'plan' bills are covered by plan instalments.
const BILL_OUTCOMES = [
  ['ontime', 'late', 'late', 'partial', 'unpaid', 'unpaid'], // unassigned_financial: overdue, arrears rising
  ['late', 'late', 'unpaid', 'plan', 'plan', 'plan'], // assigned_financial: now on a fortnightly hardship plan
  ['ontime', 'ontime', 'late', 'ontime', 'ontime', 'ontime'], // home_comfort (postpaid half): usage falling
  ['ontime', 'late', 'ontime', 'ontime', 'late', 'ontime'], // health_related
  ['late', 'ontime', 'late', 'partial', 'partial', 'unpaid'], // multiple_support_areas
  ['late', 'late', 'ontime', 'plan', 'partial', 'unpaid'], // historical_payment_plan: plan broken
  ['late', 'late', 'ontime', 'ontime', 'ontime', 'ontime'], // resolved_case: up to date now
  ['ontime', 'ontime', 'ontime', 'ontime', 'ontime', 'ontime'], // no_flagged_circumstances: clean control
  ['ontime', 'ontime', 'ontime', 'ontime', 'late', 'open'], // incomplete_assessment: estimates then a catch-up bill
  ['late', 'ontime', 'late', 'late', 'ontime', 'partial'], // support_access_review
];
const representatives = ['Jordan Avery', 'Casey Lin', 'Riley Nguyen', 'Morgan Doyle', 'Sam Okafor', 'Jamie Kowalski'];
const money = n => Math.round(n * 100) / 100;
const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`; // m is 1-12
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (date, n) => day(date, n);
const yearsBefore = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };

function withAccount(person, i, scenario, answers) {
  const h = salt => hash(i, salt);
  const prepaid = scenario === 2 && h(20) % 2 === 0;
  // Overdue scenarios bill a month earlier, so their latest bill is already past due on the asOf date.
  const offset = [0, 4, 5].includes(scenario) ? 1 : h(21) % 2;
  const ageYears = scenario === 3 ? 62 + h(22) % 27 : [1, 5, 6].includes(scenario) ? 25 + h(22) % 56 : 19 + h(22) % 57;
  const dateOfBirth = addDays(yearsBefore(asOf, ageYears), -(1 + h(23) % 360));
  const baseKwh = 300 + h(24) % 300; // average monthly use last year

  // Twelve months of usage ending two months before asOf (minus the billing offset). Shocks apply to the last four months.
  const months = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(Date.UTC(2026, 8 - offset - k, 1)); // 2026-09 is month index 8
    months.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  }
  const shock = (scenario === 2 && !prepaid) || scenario === 4 ? 0.42 : scenario === 3 && i % 4 === 3 ? 1.55 : 1;
  const usage = months.map(({ y, m }, k) => {
    const lastYear = Math.round(baseKwh * SEASON[m - 1] * (0.95 + (h(100 + k) % 100) / 1000));
    const noise = 0.93 + (h(120 + k) % 140) / 1000;
    return { month: monthKey(y, m), kWh: Math.round(lastYear * noise * (k >= 8 ? shock : 1)), kWhLastYear: lastYear };
  });

  const paymentMethod = prepaid ? (h(25) % 2 ? 'card' : 'cash_counter')
    : scenario === 1 ? 'centrepay' : scenario === 7 ? 'direct_debit' : scenario === 4 && h(25) % 2 === 0 ? 'cash_counter'
    : scenario === 0 && h(25) % 2 === 0 ? 'direct_debit' : ['bpay', 'card', 'direct_debit', 'bpay'][h(25) % 4];

  const bills = [], payments = [];
  if (!prepaid) {
    for (let b = 0; b < 6; b++) {
      const [first, second] = [months[b * 2], months[b * 2 + 1]];
      const periodStart = `${first.y}-${String(first.m).padStart(2, '0')}-01`;
      const periodEnd = `${second.y}-${String(second.m).padStart(2, '0')}-${daysInMonth(second.y, second.m)}`;
      const actual = usage[b * 2].kWh + usage[b * 2 + 1].kWh;
      const lastYear = usage[b * 2].kWhLastYear + usage[b * 2 + 1].kWhLastYear;
      // incomplete_assessment: two estimated reads that undershoot, then a catch-up bill for the shortfall.
      const estimated = scenario === 8 && (b === 2 || b === 3);
      const shortfall = scenario === 8 && b === 4 ? Math.round(0.75 * (usage[4].kWh + usage[5].kWh + usage[6].kWh + usage[7].kWh)) : 0;
      const kWh = estimated ? Math.round(actual * 0.25) : actual + shortfall;
      const days = (Date.parse(periodEnd) - Date.parse(periodStart)) / 86400000 + 1;
      const issuedAt = addDays(periodEnd, 5 + h(140 + b) % 5);
      bills.push({ id: `${person.id.replace('demo-person', 'demo-bill')}-${b + 1}`, periodStart, periodEnd, issuedAt, dueAt: addDays(issuedAt, 15), usageKwh: kWh, usageKwhLastYear: lastYear, estimatedRead: estimated, amount: money((kWh * TARIFF.centsPerKwh + days * TARIFF.supplyCentsPerDay) / 100) });
    }
    BILL_OUTCOMES[scenario].forEach((outcome, b) => {
      const bill = bills[b];
      const pay = (date, amount, status = 'cleared') => { if (date <= asOf) payments.push({ date, amount: money(amount), method: paymentMethod, status }); };
      if (outcome === 'ontime') pay(addDays(bill.dueAt, -(1 + h(150 + b) % 6)), bill.amount);
      if (outcome === 'late') pay(addDays(bill.dueAt, 6 + h(150 + b) % 22), bill.amount);
      if (outcome === 'partial') for (const d of [4, 18, 32]) pay(addDays(bill.issuedAt, d), bill.amount * 0.25);
      // A direct debit that bounced on the latest bill's due date.
      if (outcome === 'unpaid' && b === 5 && paymentMethod === 'direct_debit') pay(bill.dueAt, bill.amount, 'dishonoured');
    });
  }

  // Payment plans. Instalments are fortnightly, so they also show up as payments that track a pay cycle.
  let paymentPlan = null;
  if (scenario === 1 || scenario === 5) {
    const startedAt = bills[3].issuedAt;
    const owing = bills.slice(0, 3).reduce((s, b) => s + b.amount, 0);
    const instalment = money(bills.reduce((s, b) => s + b.amount, 0) / 6 / 4.36 + owing / 26);
    const count = scenario === 5 ? 3 : 99;
    for (let k = 0, d = startedAt; k < count && d <= asOf; k++, d = addDays(d, 14)) payments.push({ date: d, amount: instalment, method: scenario === 1 ? 'centrepay' : paymentMethod, status: 'cleared' });
    paymentPlan = { status: scenario === 5 ? 'broken' : 'active', startedAt, frequency: 'fortnightly', instalment };
  }
  if (scenario === 6) paymentPlan = { status: 'completed', startedAt: addDays(bills[0].issuedAt, -30), frequency: 'fortnightly', instalment: money(bills[0].amount / 4) };

  // Prepaid: small, frequent top-ups and the meter running out of credit three times in the last month.
  let prepay = null;
  if (prepaid) {
    const recharges = [];
    for (let d = addDays(asOf, -90 + h(26) % 5); d <= asOf; d = addDays(d, 6 + h(200 + recharges.length) % 4)) recharges.push({ date: d, amount: [20, 20, 25, 30, 40][h(300 + recharges.length) % 5], method: paymentMethod });
    prepay = { recharges, zeroCreditEvents: [addDays(asOf, -(3 + h(28) % 4)), addDays(asOf, -(12 + h(29) % 5)), addDays(asOf, -(24 + h(29) % 5))] };
  }

  // Allocate cleared payments to the oldest open bill first, then record when each bill was paid off.
  const owed = bills.map(b => b.amount);
  for (const p of [...payments].filter(p => p.status === 'cleared').sort((a, b) => a.date.localeCompare(b.date))) {
    let left = p.amount;
    for (let b = 0; b < bills.length && left > 0.004; b++) {
      if (owed[b] <= 0.004 || bills[b].issuedAt > p.date) continue;
      const take = Math.min(left, owed[b]);
      owed[b] = money(owed[b] - take); left = money(left - take);
      if (owed[b] <= 0.004) bills[b].paidInFullAt = p.date;
    }
  }
  bills.forEach((b, k) => { b.amountPaid = money(b.amount - owed[k]); b.paidInFullAt ??= null; });
  payments.sort((a, b) => a.date.localeCompare(b.date));

  const concessionType = ageYears >= 67 ? 'Pensioner Concession Card' : 'Health Care Card';
  const concession = answers.Z7_8 === 'Yes' ? { status: 'active', type: concessionType, endDate: addDays(asOf, 120 + h(31) % 500) }
    : scenario === 9 ? { status: 'lapsed', type: concessionType, endDate: addDays(asOf, -(20 + h(31) % 60)) }
    : { status: 'none', type: null, endDate: null };
  const authorityTypes = ['Power of attorney', 'Authorised representative', 'Financial counsellor'];
  const thirdPartyAuthority = scenario === 9 || (scenario === 3 && i % 4 === 3)
    ? { type: scenario === 3 ? 'Authorised representative' : authorityTypes[h(32) % 3], name: representatives[h(33) % representatives.length], since: addDays(asOf, -(40 + h(34) % 600)) }
    : null;
  const contactTopics = scenario === 9 ? Array.from({ length: 3 + h(35) % 2 }, (_, k) => ({ date: addDays(asOf, -(4 + k * 13 + h(160 + k) % 5)), channel: k % 2 ? 'phone' : 'email', topic: 'Billing query' })) : scenario === 4 ? [{ date: addDays(asOf, -18), channel: 'phone', topic: 'Payment extension' }] : [];
  const extensionCount = scenario === 5 ? 3 : scenario === 4 ? 2 : scenario === 9 ? 1 : 0;

  return {
    ...person,
    account: {
      accountNumber: `DEMO-${700001 + i}`,
      utility: 'electricity',
      customerSince: yearsBefore(asOf, 1 + h(37) % Math.max(1, Math.min(15, ageYears - 18))),
      dateOfBirth,
      supplyType: scenario === 2 && h(38) % 5 === 1 ? 'embedded' : 'standard',
      plan: prepaid ? { type: 'prepaid', name: 'Prepay (demo)', billingCycle: null } : { type: 'postpaid', name: 'Home Plan (demo)', billingCycle: 'bimonthly' },
      tariff: TARIFF,
      paymentMethod,
      concession,
      thirdPartyAuthority,
      lifeSupport: answers.Z7_4 === 'Yes',
      accessNeeds: scenario === 9 && h(39) % 3 === 1 ? 'Large-print bills' : scenario === 3 && i % 4 === 1 ? 'Hearing impairment: contact by SMS or email' : null,
      languagePreference: scenario === 9 && h(39) % 3 === 0 ? 'Vietnamese' : 'English',
      interpreterUsed: scenario === 9 && h(39) % 3 === 0,
      hardshipProgram: answers.Q37 === 'Yes' ? { status: 'active', exitReason: null, assessmentOffered: true }
        : scenario === 5 ? { status: 'exited', exitReason: 'missed_plan_payments', assessmentOffered: true }
        : scenario === 6 ? { status: 'exited', exitReason: 'completed', assessmentOffered: true }
        : { status: 'none', exitReason: null, assessmentOffered: false },
      paymentPlan,
      extensions: Array.from({ length: extensionCount }, (_, k) => ({ requestedAt: addDays(bills[5 - k]?.dueAt ?? asOf, -2) })),
      bills,
      payments,
      usage,
      prepay,
      contacts: contactTopics,
      complaintOpen: scenario === 9 && h(40) % 2 === 0,
      disconnectionWarningAt: (scenario === 0 && paymentMethod !== 'direct_debit') || scenario === 4 ? addDays(asOf, -(6 + h(41) % 18)) : null,
      collectionsStatus: scenario === 5 && h(42) % 2 === 0 ? 'referred_to_agency' : null,
      digital: scenario === 8 ? { lastLoginAt: h(43) % 2 ? null : addDays(asOf, -(130 + h(44) % 200)), lastEmailOpenAt: addDays(asOf, -(100 + h(45) % 100)) } : { lastLoginAt: addDays(asOf, -(1 + h(44) % 40)), lastEmailOpenAt: addDays(asOf, -(1 + h(45) % 20)) },
      returnedMail: scenario === 8 && h(46) % 2 === 0,
      provenance: 'fictional_demo_account',
    },
  };
}

const scenarioNames = ['unassigned_financial', 'assigned_financial', 'home_comfort', 'health_related', 'multiple_support_areas', 'historical_payment_plan', 'resolved_case', 'no_flagged_circumstances', 'incomplete_assessment', 'support_access_review'];
const scenarioStatuses = ['new', 'in_progress', 'new', 'in_progress', 'in_progress', 'waiting', 'resolved', 'in_progress', 'new', 'waiting'];
const assignees = [null, 'staff-alex', 'staff-sarah', 'staff-james', 'staff-maya', 'staff-alex', 'staff-sarah', 'staff-james', null, 'staff-maya'];
const q36Ids = evidenceFieldDefinitions.filter(f => f.id.startsWith('Q36b_')).map(f => f.id);

function matches(id, a) {
  switch (id) {
    case 'bill_payment_difficulty': return ['Quite difficult', 'Very difficult'].includes(a.Q32_1);
    case 'unable_to_pay_on_time': return a.Q35_7 === 'Yes';
    case 'other_essentials_difficulty': return a.Q35_8 === 'Yes';
    case 'reported_financial_strain': return typeof a.Z8a === 'string' && a.Z8a.startsWith('Having ');
    case 'keeping_warm_difficulty': return ['Rarely', 'Never'].includes(a.Q33a_1);
    case 'keeping_cool_difficulty': return ['Rarely', 'Never'].includes(a.Q33a_2);
    case 'avoiding_heating_cooling': return a.Q35_3 === 'Yes';
    case 'reported_life_support': return a.Z7_4 === 'Yes';
    case 'health_affects_energy': return a.Z7_6 === 'Yes';
    default: throw new Error(`Unknown circumstance ${id}`);
  }
}

function answersFor(scenario, i) {
  const a = Object.fromEntries(evidenceFieldDefinitions.map(f => [f.id, f.allowedValues.includes('No') ? 'No' : null]));
  Object.assign(a, { Q32_1: 'Quite easy', Q33a_1: 'Often', Q33a_2: 'Often', Z8a: 'Doing OK and making ends meet' });
  if ([0, 1, 4, 5, 6, 9].includes(scenario)) Object.assign(a, { Q32_1: pick(['Quite difficult', 'Very difficult']), Q35_7: 'Yes', Z8a: pick(evidenceFieldDefinitions.find(f => f.id === 'Z8a').allowedValues.slice(2)) });
  if ([0, 4, 9].includes(scenario)) a.Q35_8 = 'Yes';
  if ([2, 4].includes(scenario)) Object.assign(a, { Q33a_1: pick(['Rarely', 'Never']), Q33a_2: pick(['Rarely', 'Never']), Q35_3: 'Yes' });
  if ([3, 4].includes(scenario)) Object.assign(a, { Z7_4: i % 2 === 0 ? 'Yes' : 'No', Z7_6: 'Yes' });
  if ([1, 5, 6].includes(scenario)) Object.assign(a, { Q35_4: 'Yes', Q35_5: 'Yes', Q36b_1: 'Yes', Q36b_3: 'Yes', Q36b_7: 'Yes', Z7_8: 'Yes' });
  if (scenario === 1) Object.assign(a, { Q37: 'Yes', Q36b_4: 'Yes' });
  if (scenario === 5) a.Q37 = 'No'; // A past plan does not establish current hardship enrolment.
  if (scenario === 6) Object.assign(a, { Q36b_2: 'Yes', Q36b_5: 'Yes', Q36b_6: 'Yes', Q36b_8: 'Yes' });
  if (scenario === 8) { for (const key of Object.keys(a)) a[key] = null; if (i % 20 === 8) a.Q32_1 = 'Quite difficult'; }
  if (a.Q35_5 !== 'Yes') for (const id of q36Ids) a[id] = null;
  return a;
}

function build() {
  const people = [], cases = [];
  for (let i = 0; i < count; i++) {
    const n = String(i + 1).padStart(3, '0'), personId = `demo-person-${n}`, caseId = `GS-${2001 + i}`, scenario = i % 10;
    const basePerson = { id: personId, isSynthetic: true, displayName: names[i], suburb: pick(suburbs), state: 'WA', householdSummary: pick(['1 adult', '2 adults', '1 adult, 1 child', '2 adults, 2 children']), contactPreference: { channel: pick(['sms', 'phone', 'email']), preferredWindow: pick(['Mornings', 'Afternoons', 'Weekdays']), provenance: 'fictional_demo_preference' }, fullProfilePath: null };
    const reportedAnswers = answersFor(scenario, i), reportedAt = day(asOf, -(5 + i % 12));
    people.push(withAccount(withContactDetails(basePerson, i), i, scenario, reportedAnswers));
    const definitions = circumstanceDefinitions.filter(c => matches(c.id, reportedAnswers));
    const circumstances = definitions.map(c => ({ circumstanceId: c.id, evidenceFieldIds: [...c.evidenceFieldIds], provenance: 'illustrative_demo_grouping' }));
    const recommendationIds = [...new Set(definitions.flatMap(c => c.recommendationIds))];
    const recommendations = recommendationIds.map(recommendationId => ({ recommendationId, circumstanceIds: definitions.filter(c => c.recommendationIds.includes(recommendationId)).map(c => c.id), evidenceFieldIds: [...new Set(definitions.filter(c => c.recommendationIds.includes(recommendationId)).flatMap(c => c.evidenceFieldIds))], reviewStatus: i % 3 === 0 ? 'reviewed' : 'pending', reviewedByUserId: i % 3 === 0 ? (assignees[scenario] ?? 'staff-manager') : null, provenance: 'synthetic_candidate_action_for_worker_review' }));
    const modelStatus = scenario === 8 ? (i < count / 2 ? 'pending' : 'unavailable') : 'ready';
    const score = modelStatus === 'ready' ? [91, 72, 66, 51, 88, 56, 20, 18, null, 65][scenario] + Math.floor(random() * 5) - 2 : null;
    const status = scenarioStatuses[scenario];
    cases.push({
      id: caseId, personId, isSynthetic: true, sourceRecordId: null, version: 1, reportedAt,
      referencePeriods: { past_6_months: { start: monthsBefore(reportedAt, 6), end: reportedAt }, past_12_months: { start: monthsBefore(reportedAt, 12), end: reportedAt }, at_report: { date: reportedAt } },
      reportedAnswers, answerAvailability: Object.fromEntries(Object.entries(reportedAnswers).map(([id, value]) => [id, value !== null ? 'recorded' : q36Ids.includes(id) && reportedAnswers.Q35_5 === 'No' ? 'not_asked' : 'unknown'])), missingEvidenceFieldIds: Object.keys(reportedAnswers).filter(id => reportedAnswers[id] === null),
      supportAreaIds: [...new Set(definitions.map(c => c.supportAreaId))], circumstances,
      assistance: { hardshipEnrolmentAtReport: reportedAnswers.Q37, energyBillConcessionAtReport: reportedAnswers.Z7_8, reportedHistory: q36Ids.filter(id => reportedAnswers[id] === 'Yes').map(evidenceFieldId => ({ evidenceFieldId, referencePeriod: 'past_12_months' })) },
      recommendations,
      modelAssessment: { provider: 'synthetic_demo', isSimulated: true, status: modelStatus, assessedAt: modelStatus === 'ready' ? `${asOf}T09:00:00+08:00` : null, priority: score === null ? null : { score, label: score >= 80 ? 'urgent' : score >= 60 ? 'high' : score >= 35 ? 'moderate' : 'routine' }, trend: modelStatus === 'ready' ? ([0, 4].includes(scenario) ? 'rising' : 'stable') : null, explanation: modelStatus === 'ready' ? 'Invented display assessment for workflow testing; not a prediction from customer data.' : null },
      workflow: { status, assignedToUserId: assignees[scenario], createdAt: `${day(reportedAt, 1)}T09:00:00+08:00`, updatedAt: `${asOf}T10:00:00+08:00`, followUpAt: status === 'resolved' ? null : `${day(asOf, i % 4 === 0 ? -2 : 1 + i % 7)}T14:00:00+08:00`, reviewStatus: recommendations.some(r => r.reviewStatus === 'pending') || modelStatus !== 'ready' ? 'needs_review' : 'reviewed', notes: i % 4 === 1 ? [{ id: `demo-note-${n}`, text: 'Fictional check-in note: confirm current circumstances and discuss suitable support.', authorUserId: assignees[scenario] ?? 'staff-manager', createdAt: `${day(asOf, -1)}T11:00:00+08:00` }] : [] },
      testing: { scenario: scenarioNames[scenario], notRepresentativeOfPopulation: true },
    });
  }
  return {
    metadata: { schemaVersion: '1.2.0', datasetId: 'greenspark-case-queue-demo-v1', classification: 'synthetic_demo_only', isSynthetic: true, asOf, timezone: 'Australia/Perth', generatorSeed: seed, peopleCount: count, caseCount: count, sourceDefinitions: [{ id: 'eca-household-jun-2026', purpose: 'Question definitions and allowed answer domains only; respondent rows are not copied.', url: 'https://energyconsumersaustralia.com.au/our-work/surveys/energy-consumer-survey-data' }], limits: ['All identities, combinations of answers, workflow events, recommendations and model assessments are fictional.', 'Scenario balance is designed for UI coverage, not population statistics or model training.', 'Historical answers do not establish current circumstances.', 'ERA aggregates and SGSC households have not been joined to these fictional people.', 'Gender, preferred name, addresses, phone numbers and emails are invented. Gender follows the fictional first name, apart from a few deliberate Non-binary and Prefer not to say records. Phone numbers come from ranges reserved for fiction and emails use example.com, so none can reach a real person. Street names are invented and are not real addresses.', 'Utility accounts (bills, payments, usage, plans, concessions, authorities, dates of birth) are invented and shaped per testing scenario so specific account signals fire. The tariff is illustrative, not a real price.'], profileContractStatus: 'proposed_shared_person_id', modelContractStatus: 'mock_adapter_only' },
    users, supportAreas, circumstanceDefinitions, evidenceFieldDefinitions, recommendationDefinitions, people, cases,
  };
}

function validate(data) {
  assert.equal(data.metadata.classification, 'synthetic_demo_only');
  assert.equal(data.metadata.isSynthetic, true);
  assert.equal(data.people.length, data.metadata.peopleCount);
  assert.equal(data.cases.length, data.metadata.caseCount);
  assert.equal(data.people.length, data.cases.length);
  const personIds = new Set(data.people.map(p => p.id)), caseIds = new Set(data.cases.map(c => c.id));
  const userIds = new Set(data.users.map(u => u.id));
  assert.equal(personIds.size, data.people.length, 'Person IDs must be unique');
  assert.equal(caseIds.size, data.cases.length, 'Case IDs must be unique');
  assert.equal(new Set(data.people.map(p => p.displayName)).size, data.people.length, 'Fictional names must be unique');
  const fields = new Map(data.evidenceFieldDefinitions.map(f => [f.id, f]));
  const recs = new Set(data.recommendationDefinitions.map(r => r.id));
  const circumstances = new Map(data.circumstanceDefinitions.map(c => [c.id, c]));
  const statuses = new Set(['new', 'in_progress', 'waiting', 'resolved']);
  for (const p of data.people) { assert.equal(p.isSynthetic, true); assert.equal(p.fullProfilePath, null); }
  for (const p of data.people) {
    assert(genders.includes(p.gender), `${p.id} gender`);
    if (p.gender === 'Female' || p.gender === 'Male') assert.equal(p.gender, nameGender[p.displayName.split(' ')[0]], `${p.id} gender must follow the first name unless it is Non-binary or Prefer not to say`);
    assert(typeof p.preferredName === 'string' && p.preferredName.length > 0, `${p.id} preferredName`);
    assert(typeof p.address.line1 === 'string' && /^\d+ /.test(p.address.line1), `${p.id} address line 1`);
    assert(p.address.line2 === null || /^Unit \d+$/.test(p.address.line2), `${p.id} address line 2`);
    assert.equal(p.address.postcode, postcodes[p.suburb], `${p.id} postcode must match the suburb`);
    assert(p.mobile === null || fictionalMobiles.includes(p.mobile), `${p.id} mobile must be a number reserved for fiction`);
    assert(p.phone === null || /^\(08\) 5550 \d{4}$/.test(p.phone), `${p.id} phone must be in the reserved (08) 5550 block`);
    assert(p.email === null || /^[a-z]+\.[a-z]+@example\.com$/.test(p.email), `${p.id} email must use example.com`);
    assert(p.mobile || p.phone || p.email, `${p.id} needs at least one way to contact them`);
    assert.equal(p.contactDetailsProvenance, 'fictional_demo_contact_details');
    const ch = p.contactPreference.channel;
    assert(ch !== 'sms' || p.mobile, `${p.id} prefers sms but has no mobile`);
    assert(ch !== 'phone' || p.phone, `${p.id} prefers phone but has no phone number`);
    assert(ch !== 'email' || p.email, `${p.id} prefers email but has no email`);
  }
  const caseByPerson = new Map(data.cases.map(c => [c.personId, c]));
  for (const p of data.people) {
    const a = p.account, answers = caseByPerson.get(p.id).reportedAnswers;
    assert.equal(a.provenance, 'fictional_demo_account');
    assert(/^DEMO-\d{6}$/.test(a.accountNumber), `${p.id} account number must be a fictional DEMO- number`);
    assert(a.dateOfBirth < yearsBefore(data.metadata.asOf, 18), `${p.id} account holder must be an adult`);
    assert.equal(a.lifeSupport, answers.Z7_4 === 'Yes', `${p.id} life support must match the reported answer`);
    assert.equal(a.concession.status === 'active', answers.Z7_8 === 'Yes', `${p.id} active concession must match the reported answer`);
    assert.equal(a.hardshipProgram.status === 'active', answers.Q37 === 'Yes', `${p.id} hardship enrolment must match the reported answer`);
    assert.equal(a.plan.type === 'prepaid', a.prepay !== null);
    assert(a.plan.type === 'prepaid' ? a.bills.length === 0 && a.prepay.recharges.length > 0 : a.bills.length === 6, `${p.id} bills`);
    assert.equal(a.usage.length, 12);
    for (const b of a.bills) {
      assert(b.periodStart < b.periodEnd && b.periodEnd < b.issuedAt && b.issuedAt < b.dueAt, `${b.id} dates out of order`);
      assert(b.issuedAt <= data.metadata.asOf && b.amount > 0 && b.amountPaid >= 0 && b.amountPaid <= b.amount + 0.001, `${b.id} amounts`);
      assert.equal(b.paidInFullAt !== null, Math.abs(b.amount - b.amountPaid) < 0.005, `${b.id} paidInFullAt must match amountPaid`);
    }
    for (const x of a.payments) assert(x.date <= data.metadata.asOf && x.amount > 0 && ['cleared', 'dishonoured'].includes(x.status), `${p.id} payment`);
  }
  for (const c of data.cases) {
    assert(personIds.has(c.personId)); assert.equal(c.isSynthetic, true); assert.equal(c.sourceRecordId, null);
    assert(statuses.has(c.workflow.status)); assert(Number.isInteger(c.version) && c.version > 0);
    assert(c.workflow.assignedToUserId === null || data.users.some(u => u.id === c.workflow.assignedToUserId && u.role === 'support_worker'));
    assert.equal(Object.keys(c.reportedAnswers).length, fields.size);
    for (const [id, value] of Object.entries(c.reportedAnswers)) { assert(fields.has(id), `Unknown evidence field ${id}`); assert(value === null || fields.get(id).allowedValues.includes(value), `Invalid answer ${id}`); }
    assert.deepEqual(c.missingEvidenceFieldIds, Object.keys(c.reportedAnswers).filter(id => c.reportedAnswers[id] === null));
    for (const [id, value] of Object.entries(c.reportedAnswers)) assert.equal(c.answerAvailability[id], value !== null ? 'recorded' : q36Ids.includes(id) && c.reportedAnswers.Q35_5 === 'No' ? 'not_asked' : 'unknown');
    if (c.reportedAnswers.Q35_5 !== 'Yes') for (const id of q36Ids) assert.equal(c.reportedAnswers[id], null, 'Unasked support-history questions must stay null');
    const expected = data.circumstanceDefinitions.filter(d => matches(d.id, c.reportedAnswers));
    assert.deepEqual(c.circumstances.map(x => x.circumstanceId), expected.map(x => x.id));
    assert.deepEqual(c.supportAreaIds, [...new Set(expected.map(x => x.supportAreaId))]);
    for (const x of c.circumstances) { assert(circumstances.has(x.circumstanceId)); for (const id of x.evidenceFieldIds) assert(c.reportedAnswers[id] !== null); }
    assert.equal(c.assistance.hardshipEnrolmentAtReport, c.reportedAnswers.Q37);
    assert.equal(c.assistance.energyBillConcessionAtReport, c.reportedAnswers.Z7_8);
    assert.deepEqual(c.assistance.reportedHistory.map(x => x.evidenceFieldId), q36Ids.filter(id => c.reportedAnswers[id] === 'Yes'));
    assert.deepEqual(c.recommendations.map(r => r.recommendationId), [...new Set(expected.flatMap(x => x.recommendationIds))]);
    for (const r of c.recommendations) { assert(recs.has(r.recommendationId)); assert(r.circumstanceIds.length > 0); for (const id of r.circumstanceIds) assert(c.circumstances.some(x => x.circumstanceId === id)); for (const id of r.evidenceFieldIds) assert(c.reportedAnswers[id] !== null); assert(r.reviewedByUserId === null || userIds.has(r.reviewedByUserId)); }
    assert.equal(c.modelAssessment.isSimulated, true); assert.equal(c.modelAssessment.provider, 'synthetic_demo');
    assert(['ready', 'pending', 'unavailable'].includes(c.modelAssessment.status));
    if (c.modelAssessment.status !== 'ready') { assert.equal(c.modelAssessment.priority, null); assert.equal(c.modelAssessment.trend, null); }
    else { const p = c.modelAssessment.priority; assert(Number.isInteger(p.score) && p.score >= 0 && p.score <= 100); assert.equal(p.label, p.score >= 80 ? 'urgent' : p.score >= 60 ? 'high' : p.score >= 35 ? 'moderate' : 'routine'); }
    for (const note of c.workflow.notes) { assert(userIds.has(note.authorUserId)); assert(Number.isFinite(Date.parse(note.createdAt))); }
    assert(Number.isFinite(Date.parse(c.workflow.createdAt))); assert(Number.isFinite(Date.parse(c.workflow.updatedAt)));
    if (c.workflow.followUpAt !== null) assert(Number.isFinite(Date.parse(c.workflow.followUpAt)));
    if (c.workflow.status === 'resolved') assert.equal(c.workflow.followUpAt, null);
    for (const period of ['past_6_months', 'past_12_months']) { assert(c.referencePeriods[period].start < c.referencePeriods[period].end); assert.equal(c.referencePeriods[period].end, c.reportedAt); }
  }
  for (const s of statuses) assert(data.cases.some(c => c.workflow.status === s), `Missing ${s} scenario`);
  for (const x of data.circumstanceDefinitions) assert(data.cases.some(c => c.circumstances.some(s => s.circumstanceId === x.id)), `Missing ${x.id} coverage`);
  assert(data.cases.some(c => c.supportAreaIds.length === 0)); assert(data.cases.some(c => c.supportAreaIds.length > 1));
  assert(data.cases.some(c => c.workflow.assignedToUserId === null)); assert(data.cases.some(c => c.workflow.assignedToUserId === 'staff-alex'));
  assert(data.cases.some(c => c.modelAssessment.status === 'pending')); assert(data.cases.some(c => c.modelAssessment.status === 'unavailable'));
  assert(data.cases.some(c => c.assistance.reportedHistory.some(h => h.evidenceFieldId === 'Q36b_3') && c.reportedAnswers.Q37 === 'No'));
  for (const label of ['urgent', 'high', 'moderate', 'routine']) assert(data.cases.some(c => c.modelAssessment.priority?.label === label));
  return { people: data.people.length, cases: data.cases.length, supportAreas: data.supportAreas.length, circumstances: data.circumstanceDefinitions.length, recommendationTypes: data.recommendationDefinitions.length, assigned: data.cases.filter(c => c.workflow.assignedToUserId !== null).length, unassigned: data.cases.filter(c => c.workflow.assignedToUserId === null).length, modelReady: data.cases.filter(c => c.modelAssessment.status === 'ready').length, modelPending: data.cases.filter(c => c.modelAssessment.status === 'pending').length, modelUnavailable: data.cases.filter(c => c.modelAssessment.status === 'unavailable').length };
}

const dataset = checkOnly ? JSON.parse(await fs.readFile(destination, 'utf8')) : build();
const summary = validate(dataset);
if (!checkOnly) { await fs.mkdir(fileURLToPath(new URL('../data/synthetic/', import.meta.url)), { recursive: true }); await fs.writeFile(destination, `${JSON.stringify(dataset, null, 2)}\n`); }
console.log(JSON.stringify({ action: checkOnly ? 'validated' : 'generated_and_validated', ...summary }, null, 2));
