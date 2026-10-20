# Proposed case-queue data contract

Version: 1.0.0 draft. This is a development proposal for this team's interface, not an agreed prediction-model schema.

## Fixture entry point

`data/synthetic/case-queue.v1.json` is a JSON object containing:

| Key | Purpose |
| --- | --- |
| `metadata` | Synthetic classification, fixed demo date, generation seed, source-definition references and limitations |
| `users` | Fictional manager and support-worker identities for workflow testing |
| `supportAreas` | The three approved umbrella groups |
| `circumstanceDefinitions` | Child circumstances, supporting field IDs and candidate recommendation IDs |
| `evidenceFieldDefinitions` | Source survey variable IDs, answer domains, labels and reporting periods |
| `recommendationDefinitions` | Proposed staff-review actions and their labels |
| `people` | 100 fictional identities with minimal queue/overview display fields |
| `cases` | 100 queue cases, each referencing a person and optional assigned worker |

The JSON is an envelope rather than a bare array so every consumer receives the synthetic-data declaration and the shared catalogs.

## Customer contact details (fictional)

Each person also has invented contact details, shown on the case page as "Customer details". They are demo display fields, not claims about any survey source.

| Field | Notes |
| --- | --- |
| `gender` | Female, Male, Non-binary or Prefer not to say. For these invented people it follows the invented first name, apart from a few deliberate Non-binary and Prefer not to say records so every value is exercised. This is a fixture convention only: the app never infers anyone's gender from a name. |
| `preferredName` | The first name, or a short form for some people (for example Liv for Olivia). |
| `address` | `line1`, optional `line2` (for example `Unit 4`) and `postcode`; the suburb and `WA` are on the person. Street names are invented. |
| `mobile`, `phone`, `email` | May be null, which the app shows as "Not recorded". The stated contact preference always has a matching detail, and everyone has at least one way to be contacted. |
| `contactDetailsProvenance` | `fictional_demo_contact_details` |

Safety: landlines are in the `(08) 5550 xxxx` block and mobiles come from a short list of `0491 57x xxx` numbers, which Australia's communications regulator (ACMA) sets aside for fiction. Emails use `example.com`. People created in the queue start with all of these null.

## Utility accounts and account signals (fictional)

**Account number.** Every person has a fictional `accountNumber` (`DEMO-7xxxxx`), on the person rather than in `account`. It is the customer's main ID on screen: the case list, case page, tab title, links (`/accounts/DEMO-700001`), search and messages all use it. Each account has exactly one case. Case IDs (`GS-2001`) and person IDs stay as internal keys for the database, API paths and undo logs, and are not shown. People added in the queue get the next free number; on start, the server numbers any older ones that have none.

Each seeded person also has an invented electricity `account`, shown on the case page as "Utility account", "Account signals" and "Bills" (or "Prepaid top-ups").

| Field | Notes |
| --- | --- |
| `customerSince`, `dateOfBirth` | Every holder is an adult; the page shows age on the dataset's `asOf` date. |
| `plan`, `paymentMethod`, `supplyType` | Postpaid (billed every two months) or prepaid; direct debit, card, BPAY, Centrepay or cash/in person; standard or embedded network. |
| `bills` | Six bills (oldest first): period, issue and due dates, kWh and the same period last year, estimated read, amount, amount paid and the date paid in full. Prepaid accounts have none. |
| `payments`, `prepay` | Payment date, amount, method and cleared/dishonoured result. Payments pay the oldest open bill first. Prepaid accounts have top-ups and the dates the meter ran out of credit. |
| `usage` | Twelve months of kWh with the same month last year. |
| `concession`, `thirdPartyAuthority`, `lifeSupport`, `hardshipProgram`, `paymentPlan`, `extensions` | Concession status matches the case's `Z7_8` answer (active) or is lapsed/none; life support matches `Z7_4`; an active hardship program matches `Q37`. |
| `contacts`, `complaintOpen`, `disconnectionWarningAt`, `collectionsStatus`, `digital`, `returnedMail`, `accessNeeds`, `languagePreference`, `interpreterUsed` | Contact history and service flags. |

Each testing scenario shapes its accounts so specific account signals from the flowchart fire, for example overdue and growing arrears for `new_financial`, a broken plan for `historical_payment_plan`, estimates followed by a catch-up bill for `incomplete_assessment`. `no_flagged_circumstances` is a clean control with none. `shared/src/accountSignals.ts` detects 29 of the flow's account signals using each signal's `example_rule`, under the same id and name as the flow. Signals are display-only: they do not change circumstances, priorities or recommendations. The tariff is illustrative, not a real price. Existing databases pick up new fixture fields for seeded people on start, without a reset. The fixture schema version is 1.2.0.

## Identity and ownership

Use stable `personId` and `case.id` strings. The fixture has one case per person, but the IDs remain separate to allow multiple cases per person later.

The full-profile teammate should accept the same `personId`; the profile route is a configurable integration detail. Do not derive identity from a person's name or join unrelated source datasets on row numbers. The mock `sourceRecordId` is null because these are invented profiles, not imported survey respondents.

The manager is `staff-manager` (Taylor Brooks). Workers are `staff-alex`, `staff-sarah`, `staff-james`, and `staff-maya`. Managers allocate cases. A worker's editable set is determined by `case.workflow.assignedToUserId`, not by a model prediction or a client-supplied actor field.

## Evidence, circumstances and recommendations

Each case contains synthetic `reportedAnswers`, `reportedAt` and reference periods. Values use the source-defined answer domains, with null for unknown/not recorded/not asked. `answerAvailability` distinguishes `recorded`, `not_asked` and `unknown`; No remains a recorded answer. `Q36b_*` answers are null when the respondent did not report contacting the provider (`Q35_5`), matching the questionnaire's branching. When contact is explicitly No, those history questions are not asked; when contact itself is unknown, their availability is unknown too.

**When the server has the flowchart file (the normal setup), circumstances, support areas and recommendations are worked out from it on every request, and the precomputed values below are not used.** Each case's signals are its account signals plus survey answers that match a flow self-report signal: `Q35_8` → `ask_trade_offs`, `Q35_3` → `ask_rationing`, `Z7_4` → `ask_medical_equipment`, `Z7_6` → `ask_temperature_need`, `Z7_8` → `ask_concession_card` (see `SURVEY_SIGNALS` in `shared/src/caseFlow.ts`). Survey questions with no matching signal (`Q32_1`, `Q35_7`, `Z8a`, `Q33a_*`) don't flag anything there. A circumstance is flagged with the flow's scoring rules: at least 1 strong signal or at least 2 supporting signals; sensitive and safety circumstances need a strong signal. Only electricity entries apply. Support areas are the flow's categories, and recommendations are the flow's solutions. Each flagged circumstance carries the `signals` (id, name, source, strength, evidence) that raised it, so staff can check it. Edits on the Flowchart page change cases straight away. If the flow file is missing or invalid, the fixture's precomputed values below are used instead, and `/api/catalogs` reports `circumstanceSource: "fixture"`.

In the fixture itself, `circumstances` are precomputed demo classifications, with their supporting `evidenceFieldIds` and a clearly declared illustrative rule. They are useful for testing how the planned UI explains a flag. They are not a trained model or a universal assessment of hardship. A single low-income band, employment status, location or appliance characteristic is not used to assert a sensitive circumstance.

`supportAreaIds` are the union of matched circumstances. `recommendations` refer to the shared catalog and the particular circumstances/evidence that support offering a worker review. They do not assert eligibility or a chosen treatment. Missing answers remain visible as missing rather than being converted to No.

`assistance` distinguishes current hardship enrolment (`Q37`) and a reported concession (`Z7_8`) from historical support reported in the last twelve months (`Q36b`). A repayment plan reported in that period is not proof of a current active plan.

## Mock model adapter

Each `modelAssessment` declares `provider: "synthetic_demo"` and `isSimulated: true`.

- `status` is `ready`, `pending` or `unavailable`.
- Ready assessments have a display-only priority score/label, trend and short explanation.
- Pending/unavailable assessments have null priority/trend. Missing scores must not become Routine or zero.
- Scores and their label bands are fixture conventions for UI coverage, not calibrated probabilities, clinical urgency or a proposed model specification.
- Recommendation data is separate from model predictions, so it can originate from approved staff guidance or a future external model without changing the UI.

Proposed adapter boundary: `getAssessments(caseIds)` returns results keyed by `caseId`. The actual model owner must agree identifiers, fields, score meaning, timing and error behavior before integration. Do not send downstream outcome labels into a future prediction request.

## Proposed API surface for later implementation

| Endpoint | Intended behavior |
| --- | --- |
| `GET /api/session` | Resolve the current demo/authenticated user and role |
| `GET /api/catalogs` | Support-area, circumstance, evidence and recommendation definitions |
| `GET /api/users` | Assignment targets available to the current user |
| `GET /api/cases` | Filtered/sorted/paginated queue, total and matching filter/overview counts |
| `GET /api/cases/:caseId/overview` | Minimal person, evidence, recommendations, assignment, status and notes |
| `POST /api/cases` | Minimal new queue case, using an existing person reference or the agreed minimal identity contract; evidence/model results start unknown/pending |
| `POST /api/cases/bulk/assignment` | Manager-only assignment of explicit case IDs, validated atomically |
| `POST /api/cases/bulk/status` | Manager or assigned-worker status updates, validated atomically |
| `PATCH /api/cases/:caseId/status` | Single-case status update |
| `POST /api/cases/:caseId/notes` | Add a short note as the server-resolved user |
| `PATCH /api/cases/:caseId/review` | Record worker review of supported suggestions |
| `POST /api/workflow-actions/:actionId/undo` | Reverse an assignment/status action only if no newer case version conflicts |

Use the same endpoints for one or many assignments rather than implementing two permission paths. Actor identity comes from the server session. A local demo role switch is explicitly labelled and is not production authentication. Mutations carry the last-known case version so stale updates can be reported rather than silently overwriting another worker.

The queue's case statuses are `new`, `in_progress`, `waiting` and `resolved`. The MVP permits moving between these valid statuses, including reopening a resolved case; it should not invent an approval process or extra transition restrictions. A resolved case displays no outstanding follow-up. A reopened case with no follow-up date displays Not scheduled rather than inventing a date.

Proposed list query fields are `search`, `view`, `circumstanceIds`, `assistanceIds`, `priorityLabels`, `minPriorityScore`, `assessmentStatus`, `status`, `assignedToUserId`, `sort`, `page` and `pageSize`. Use explicit IDs from the catalogs, default to 50 cases per page, and use one definition of each filter in the mock and live data adapters.

The overview counters are global active-case shortcuts: Urgent cases counts ready urgent assessments on unresolved cases; My active cases counts unresolved cases assigned to the current user. Every case has an assigned worker, so there is no unassigned count. Label their global scope if needed so users do not mistake them for filtered table totals. The table's result total and pagination reflect the active query. All cases initially includes all statuses, so all 100 fixture cases are accessible.

## Source definitions inspected

The fixture uses only public question definitions and categorical answer domains. No raw source files are copied into the repo.

- Energy Consumers Australia, June 2026 labelled household data: `RAW data (Labelled)` and `Variable labels` sheets. Verified variables: `Q32_1`, `Q33a_1`, `Q33a_2`, `Q35_3`, `Q35_4`, `Q35_5`, `Q35_7`, `Q35_8`, `Q36b_1` through `Q36b_8`, `Q37`, `Z7_4`, `Z7_6`, `Z7_8`, `Z8a`.
- [Survey download page](https://energyconsumersaustralia.com.au/our-work/surveys/energy-consumer-survey-data).
- [Matching questionnaire](https://energyconsumersaustralia.com.au/sites/default/files/2026-07/web-doc-consumer-energy-report-card-jun-2026-questionnaire.pdf), especially printed pages 11, 12 and 32.
- ERA retailer statistics are aggregate context, not individual case evidence.
- SGSC coded household attributes remain deferred until their column mapping is available; this fixture does not invent their meanings or join them onto ECA respondents.

## Reproduction and checking

```sh
node scripts/generate-synthetic-cases.mjs
node scripts/generate-synthetic-cases.mjs --check
```

The default produces exactly 100 people and cases with a fixed seed and demo date. `--count=200 --seed=17` can generate another deliberately synthetic test set, between 20 and 400 unique fictional names. Keep the default checked-in fixture at 100 records unless the team intentionally changes it.

The validator checks IDs, references, assignments, source-defined answer values, questionnaire branching, evidence/circumstance consistency, model null handling, recommendation references, dates and required scenario coverage. It does not establish model validity or population representativeness.
