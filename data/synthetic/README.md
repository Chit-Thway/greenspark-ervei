# Synthetic case-queue development fixture

`case-queue.v1.json` contains 100 fictional people and 100 queue cases for the approved GreenSpark interface.

This is **synthetic demo/test data**, deliberately requested for website development. It is not real customer data, an extract of source respondents, a trained prediction output or statistically representative training data. The old root-level `customers.json` was removed because it was confusing; this versioned fixture is explicitly labelled and kept separately.

The envelope includes a manager, four support workers, support/circumstance/recommendation catalogs, source-defined survey answer domains, people and queue cases. Every person and case is marked synthetic. Every model assessment is marked simulated. Names, dates, assignments, notes, recommendations and combinations of answers are fictional.

Use [the contract](../../docs/data-contract.md) for field meanings and [the implementation plan](../../docs/implementation-plan.md) for approved scope and milestones.

Generate or check with a locally installed Node.js runtime:

```sh
node scripts/generate-synthetic-cases.mjs
node scripts/generate-synthetic-cases.mjs --check
```

No npm install, network request or source-data download is needed for the generator. Ordinary app mutations should update a separate development store, not this checked-in seed file.

The seed covers all four case statuses; assigned/unassigned cases; all supported circumstances; multiple/no support areas; known and unknown answers; current versus historical assistance; overdue/future/no follow-up; notes; and ready/pending/unavailable simulated assessments.
