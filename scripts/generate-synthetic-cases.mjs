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
    people.push(withContactDetails(basePerson, i));
    const reportedAnswers = answersFor(scenario, i), reportedAt = day(asOf, -(5 + i % 12));
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
    metadata: { schemaVersion: '1.1.0', datasetId: 'greenspark-case-queue-demo-v1', classification: 'synthetic_demo_only', isSynthetic: true, asOf, timezone: 'Australia/Perth', generatorSeed: seed, peopleCount: count, caseCount: count, sourceDefinitions: [{ id: 'eca-household-jun-2026', purpose: 'Question definitions and allowed answer domains only; respondent rows are not copied.', url: 'https://energyconsumersaustralia.com.au/our-work/surveys/energy-consumer-survey-data' }], limits: ['All identities, combinations of answers, workflow events, recommendations and model assessments are fictional.', 'Scenario balance is designed for UI coverage, not population statistics or model training.', 'Historical answers do not establish current circumstances.', 'ERA aggregates and SGSC households have not been joined to these fictional people.', 'Gender, preferred name, addresses, phone numbers and emails are invented. Gender follows the fictional first name, apart from a few deliberate Non-binary and Prefer not to say records. Phone numbers come from ranges reserved for fiction and emails use example.com, so none can reach a real person. Street names are invented and are not real addresses.'], profileContractStatus: 'proposed_shared_person_id', modelContractStatus: 'mock_adapter_only' },
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
