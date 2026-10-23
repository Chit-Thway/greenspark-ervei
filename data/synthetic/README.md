# Synthetic case-queue development fixture

`case-queue.v1.json` contains 200 fictional people and 200 queue cases for the approved GreenSpark interface.

This is **synthetic demo/test data**, deliberately requested for website development. It is not real customer data, an extract of source respondents, a trained prediction output or statistically representative training data. The old root-level `customers.json` was removed because it was confusing; this versioned fixture is explicitly labelled and kept separately.

The envelope includes a manager, four support workers, support/circumstance/recommendation catalogs, source-defined survey answer domains, people and queue cases. Every person and case is marked synthetic. Every model assessment is marked simulated. Names, dates, assignments, notes, recommendations and combinations of answers are fictional.

Use [the contract](../../docs/data-contract.md) for field meanings and [the implementation plan](../../docs/implementation-plan.md) for approved scope and milestones.

Generate or check with a locally installed Node.js runtime:

```sh
node scripts/generate-synthetic-cases.mjs
node scripts/generate-synthetic-cases.mjs --check
```

No npm install, network request or source-data download is needed for the generator. Ordinary app mutations should update a separate development store, not this checked-in seed file.

The seed covers all four case statuses; every case is assigned to one of the four support workers; all supported circumstances; multiple/no support areas; known and unknown answers; current versus historical assistance; overdue/future/no follow-up; notes; and ready/pending/unavailable simulated assessments.

Each person also has invented contact details: gender, preferred name, address (line 1, optional line 2, postcode), mobile, phone and email. They use phone ranges reserved for fiction and `example.com` emails so they cannot reach a real person, and the generator's check enforces that. See the "Customer contact details" section of [the contract](../../docs/data-contract.md).

Each person also has a utility account from a synthetic WA electricity dataset (5,150 customers): bills, payments, monthly usage, plan, payment method, concession, hardship and payment plans, HUGS grants, contacts with transcripts, collection notices, disconnections, outages and prepay data. `utility-accounts.v1.json` holds the 200 chosen accounts, 20 per testing scenario, with every date shifted forward so the data ends on the as-of date. It is written by `scripts/import-utility-dataset.mts` from the source files, which are not kept here. See the "Utility accounts and account signals" section of [the contract](../../docs/data-contract.md).

An existing local database picks up new fields for the seeded people when the server starts, so no reset is needed.
