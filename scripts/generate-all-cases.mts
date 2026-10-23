// Builds the full case queue: the 200 scenario cases from data/synthetic/case-queue.v1.json, plus one case for
// every other open account in data/synthetic/utility-accounts.all.jsonl (written by
// `scripts/import-utility-dataset.mts <source folder> --all`). Writes, both ignored by Git:
//   data/synthetic/case-queue.all.json   people (without accounts) and cases, for GREENSPARK_FIXTURE
//   data/synthetic/accounts.all.jsonl    one { personId, account } per line, for GREENSPARK_ACCOUNTS
//   data/synthetic/accounts.all.jsonl.gz the same, compressed: the Docker build unpacks it, so deploys upload ~10 MB
//
//   npx tsx scripts/generate-all-cases.mts
//
// The extra customers get fictional names, contact details and dates of birth, like the scenario cases, but no
// survey answers: they never took the survey, so everything known about them comes from their account.
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { CustomerAccount, Person, QueueCase } from "../shared/src/types.ts";

const base = JSON.parse(readFileSync(new URL("../data/synthetic/case-queue.v1.json", import.meta.url), "utf8")) as {
  metadata: Record<string, unknown> & { asOf: string; limits: string[] };
  users: { id: string; role: string }[];
  evidenceFieldDefinitions: { id: string }[];
  people: Person[];
  cases: (QueueCase & Record<string, unknown>)[];
};
const asOf = base.metadata.asOf;
const lines = readFileSync(new URL("../data/synthetic/utility-accounts.all.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);

// Deterministic per-person values from a hash of the position, so re-running gives the same people.
const hash = (i: number, salt: number) => {
  let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const day = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const yearsBefore = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };

// Fictional names. Gender follows the invented first name, apart from a few deliberate Non-binary and Prefer not
// to say records, as in the scenario fixture. (Real people's gender must never be guessed from a name.)
const female = ["Abigail", "Alice", "Annabel", "Audrey", "Bella", "Bonnie", "Charlotte", "Clara", "Daisy", "Eden", "Eliza", "Emily", "Evie", "Freya", "Georgia", "Hannah", "Harper", "Imogen", "Ivy", "Jasmine", "Layla", "Lucy", "Matilda", "Maya", "Naomi", "Nina", "Phoebe", "Piper", "Rosie", "Sienna", "Stella", "Tessa", "Willow", "Yasmin", "Zara"];
const male = ["Aaron", "Adam", "Archie", "Arlo", "Austin", "Blake", "Caleb", "Charlie", "Cooper", "Darcy", "Dylan", "Eli", "Elliot", "Felix", "Flynn", "George", "Harvey", "Isaac", "Jack", "Jasper", "Kai", "Levi", "Liam", "Max", "Nate", "Owen", "Patrick", "Riley", "Sam", "Theo", "Toby", "Vincent", "Will", "Xavier", "Zac"];
const lastNames = ["Abbott", "Ashby", "Barker", "Baxter", "Bishop", "Blake", "Bradley", "Burke", "Carter", "Chambers", "Clarke", "Dawson", "Dixon", "Doyle", "Elliott", "Ellis", "Fisher", "Fleming", "Fraser", "Gibson", "Graham", "Grant", "Hamilton", "Hart", "Henderson", "Holland", "Howard", "Jensen", "Kelly", "Kennedy", "Lambert", "Lawson", "Lee", "Lyons", "Marsh", "Murray", "Nash", "Newton", "Nguyen", "O'Brien", "Owens", "Palmer", "Pearce", "Porter", "Quinn", "Reid", "Riley", "Sharp", "Simmons", "Stevens", "Stone", "Sutton", "Tan", "Taylor", "Vaughan", "Wallace", "Ward", "Watson", "Webb", "Wells", "Wood", "Wright", "Young", "Zhang"];
const firstNames = [...female, ...male];
const genderOf = new Map<string, string>([...female.map((n) => [n, "Female"] as const), ...male.map((n) => [n, "Male"] as const)]);
const taken = new Set(base.people.map((p) => p.displayName));
const names: string[] = [];
for (const first of firstNames) for (const last of lastNames) { const n = `${first} ${last}`; if (!taken.has(n)) names.push(n); }
// A fixed shuffle so neighbouring cases don't share a first name.
names.sort((a, b) => hash(names.indexOf(a), 31) - hash(names.indexOf(b), 31) || a.localeCompare(b));

const streets = ["Banksia Way", "Jarrah Road", "Grevillea Court", "Kookaburra Lane", "Wandoo Street", "Bottlebrush Avenue", "Sandpiper Drive", "Paperbark Place", "Wagtail Close", "Coastal Heath Rise", "Melaleuca Loop", "Tuart Hill Parade", "Pelican Bend", "Saltbush Grove", "Red Gum Terrace", "Wren Street"];
// Numbers set aside for fiction: ACMA reserves (08) 5550 xxxx landlines and these 0491 57x xxx mobiles; example.com is reserved.
const mobiles = ["0491 570 006", "0491 570 156", "0491 570 157", "0491 570 158", "0491 570 159", "0491 570 313", "0491 570 737", "0491 579 455"];
const households = ["1 adult", "2 adults", "1 adult, 1 child", "2 adults, 2 children", "1 adult, 2 children", "3 adults"];
const workers = base.users.filter((u) => u.role === "support_worker").map((u) => u.id);
const unknown = Object.fromEntries(base.evidenceFieldDefinitions.map((f) => [f.id, null])) as Record<string, null>;

const known = new Set(base.people.map((p) => p.account?.sourceCustomerId).filter(Boolean));
const extra = lines.map((l) => JSON.parse(l) as { customerId: string; locality: string; postcode: string; account: Omit<CustomerAccount, "dateOfBirth"> })
  .filter((x) => !known.has(x.customerId));
if (extra.length > names.length) throw new Error(`Only ${names.length} fictional names for ${extra.length} customers`);

const people: Person[] = [];
const cases: QueueCase[] = [];
const accounts = openSync(new URL("../data/synthetic/accounts.all.jsonl", import.meta.url), "w");
// The scenario people first, unchanged apart from their account moving to the accounts file.
for (const p of base.people) {
  const { account, ...rest } = p;
  people.push(rest);
  if (account) writeSync(accounts, `${JSON.stringify({ personId: p.id, account })}\n`);
}
cases.push(...base.cases);

extra.forEach((src, k) => {
  const i = base.people.length + k; // 200, 201, …
  const h = (salt: number) => hash(i, salt);
  const displayName = names[k]!;
  const [first, ...lastParts] = displayName.split(" ");
  const last = lastParts.join(" ");
  const g = h(2) % 100; // 0-6 Non-binary, 7-11 Prefer not to say, otherwise by name
  const channel = src.account.contactPreferences.preferredChannel;
  const personId = `demo-person-${String(i + 1).padStart(4, "0")}`;
  const caseId = `GS-${2001 + i}`;
  const age = 19 + h(22) % 72;
  const account: CustomerAccount = { ...src.account, dateOfBirth: day(yearsBefore(asOf, age), -(1 + h(23) % 360)) };
  people.push({
    id: personId, isSynthetic: true, displayName, suburb: src.locality, state: "WA", householdSummary: households[h(12) % households.length]!,
    contactPreference: { channel, preferredWindow: "Not recorded", provenance: "dataset_channel" },
    fullProfilePath: null,
    gender: g < 7 ? "Non-binary" : g < 12 ? "Prefer not to say" : genderOf.get(first!)!,
    preferredName: first!,
    address: { line1: `${1 + h(8) % 98} ${streets[h(9) % streets.length]}`, line2: h(10) % 10 < 3 ? `Unit ${1 + h(11) % 12}` : null, postcode: src.postcode },
    mobile: h(3) % 20 < 3 && channel !== "sms" ? null : mobiles[h(4) % mobiles.length]!,
    phone: h(5) % 4 === 0 && channel !== "phone" ? null : `(08) 5550 ${String(h(6) % 10000).padStart(4, "0")}`,
    email: h(7) % 10 === 0 && channel !== "email" ? null : `${first!.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}${i}@example.com`,
    contactDetailsProvenance: "fictional_demo_contact_details",
    accountNumber: `DEMO-${700001 + i}`,
  } as Person);
  writeSync(accounts, `${JSON.stringify({ personId, account })}\n`);
  cases.push({
    id: caseId, personId, isSynthetic: true, sourceRecordId: null, version: 1, reportedAt: null,
    // Never surveyed: every answer is unknown.
    reportedAnswers: { ...unknown }, answerAvailability: Object.fromEntries(Object.keys(unknown).map((id) => [id, "unknown"])),
    supportAreaIds: [], circumstances: [],
    assistance: { hardshipEnrolmentAtReport: null, energyBillConcessionAtReport: null, reportedHistory: [] },
    recommendations: [],
    modelAssessment: { provider: "synthetic_demo", isSimulated: true, status: "unavailable", assessedAt: null, priority: null, trend: null, explanation: "Not surveyed; priority comes from the account." },
    workflow: { status: "new", assignedToUserId: workers[k % workers.length]!, createdAt: `${asOf}T09:00:00+08:00`, updatedAt: `${asOf}T09:00:00+08:00`, followUpAt: null, reviewStatus: "needs_review", notes: [] },
    testing: { scenario: "imported_customer", notRepresentativeOfPopulation: false },
  } as QueueCase);
});
closeSync(accounts);

const out = {
  ...base,
  metadata: {
    ...base.metadata,
    datasetId: "greenspark-case-queue-all-v1",
    peopleCount: people.length, caseCount: cases.length,
    limits: [
      ...base.metadata.limits,
      `Full import: every open account in the dataset (${people.length}). The ${base.people.length} scenario cases are as in case-queue.v1.json; the other ${extra.length} have fictional names, contact details and dates of birth but no survey answers, and start as New. Accounts are in accounts.all.jsonl, not inline.`,
    ],
  },
  people, cases,
};
writeFileSync(new URL("../data/synthetic/case-queue.all.json", import.meta.url), JSON.stringify(out));
const accountsFile = new URL("../data/synthetic/accounts.all.jsonl", import.meta.url);
writeFileSync(new URL("../data/synthetic/accounts.all.jsonl.gz", import.meta.url), gzipSync(readFileSync(accountsFile)));
console.log(`Wrote ${people.length} people and ${cases.length} cases (${extra.length} new) to case-queue.all.json, and their accounts to accounts.all.jsonl.`);
