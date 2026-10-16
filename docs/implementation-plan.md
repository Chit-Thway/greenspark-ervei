# Case queue implementation plan

Status: all five milestones are built. See [progress.md](progress.md) for what was delivered and the remaining integration gaps.

Approved scope recorded on 16 October 2026, Australia/Perth.

## Product and design agreement

Build the approved case-management workflow in React and Node.js. The design reference is the interactive case-queue prototype discussed as the Figma workflow, together with the selected first theme image: bright white surfaces, a pale mint filter sidebar, teal-green actions, readable slate text, and restrained borders. No native Figma file URL has been supplied; the existing prototype is the workflow reference.

The selected theme is preserved at [design/selected-green-theme.png](design/selected-green-theme.png). The [design reference guide](design/README.md) also includes the clickable workflow, original source fragment, queue and overview screenshots, and explicit starting theme tokens. That image preserves the visual direction. The support-area definitions below supersede the early placeholder labels shown in the image and prototype.

Keep the first screen focused on casework:

- A shared manager/support-worker workspace, with role-appropriate actions.
- A left filter sidebar, compact overview counters, and the main case table.
- Search by name, case ID and suburb; sorting; pagination; select-page and individual selection.
- The prototype's New case action, limited to a person reference/minimal queue identity and basic case fields. New evidence and model results begin as unknown/pending; full-profile editing remains with its owner.
- Single and bulk case assignment by managers.
- Assigned to me, unassigned cases, needs review and all-cases views.
- Case status updates and short case notes, consistent with the approved prototype.
- The compact right-side case overview, opened by clicking a person or row action.
- Empty results, missing answers, loading and error states.
- A clear synthetic-demo indicator during development.

Another teammate owns the prediction model. Another teammate owns the full individual card/profile experience. Their work must connect through shared IDs and adapters, without expanding this screen into a full profile application.

## Compact overview boundary

The overview contains only the context required to act from the queue:

1. Fictional display name, person/case IDs, suburb and a short household summary.
2. Assignment, case status and follow-up date.
3. Model priority/trend when available, visibly marked simulated in demo mode.
4. Support areas and their specific circumstances.
5. Supporting reported answers, source definition, reporting date and reference period.
6. Suggested support actions and worker-review state.
7. A short notes section and the queue's assignment/status actions.

Do not build a full biography, account transaction browser, document vault or separate profile page. A future full-profile link accepts the shared `personId` and is rendered only when the other teammate's route is configured. Demo contact preferences and household summaries are fictional display fields, not claims that those fields were obtained from the source survey.

## Approved support taxonomy

The chain is **support area -> circumstance -> supporting information -> suggested action**. A person may match several areas but appears once in the queue.

| Support area | Circumstance | Source-defined evidence | Candidate actions for worker review |
| --- | --- | --- | --- |
| Financial pressure | Difficulty paying energy bills | ECA `Q32_1`, payment difficulty in the past six months | Review payment options, repayment plan, or bill extension |
| Financial pressure | Reported inability to pay on time | ECA `Q35_7`, past twelve months | Assess hardship assistance; review a bill extension |
| Financial pressure | Difficulty covering other essentials | ECA `Q35_8`, past twelve months | Assess hardship assistance; check concessions |
| Financial pressure | Reported financial strain | ECA `Z8a`, self-described situation when reported | Review suitable assistance and concessions |
| Heating, cooling & home comfort | Difficulty keeping warm | ECA `Q33a_1`, past twelve months | Review energy costs, home efficiency and appliance support |
| Heating, cooling & home comfort | Difficulty keeping cool | ECA `Q33a_2`, past twelve months | Review energy costs, home efficiency and appliance support |
| Heating, cooling & home comfort | Avoiding heating/cooling due to cost | ECA `Q35_3`, past twelve months | Review affordable access to energy and suitable support |
| Health-related energy needs | Reported life-support registration | ECA `Z7_4`, explicit reported answer | Specialist worker review; confirm relevant account information |
| Health-related energy needs | Health/disability affects energy use | ECA `Z7_6`, explicit reported answer | Specialist worker review; review suitable assistance |

A difficult financial situation is not proof of income loss. None of these fields establish domestic violence, food insecurity, rent arrears, a medical diagnosis or a current heatwave. Those were earlier illustrative categories and are not included in this fixture's supported filter set.

The candidate actions are proposed product actions, informed by the support types in ECA `Q36b` and the approved discussion. They are not model outputs, automatic eligibility determinations, prescribed actions or evidence of effectiveness.

Preserve the full approved recommendation menu:

- Review payment options.
- Discuss an affordable repayment plan.
- Review a bill extension.
- Assess hardship assistance.
- Check concession/rebate eligibility.
- Review energy costs and available plans.
- Review home-efficiency support.
- Review appliance-support options.
- Arrange a specialist worker review.
- Confirm relevant account information.
- Review other suitable assistance.

## Separate filter groups

- **Support areas:** expandable parent/child checkboxes from the taxonomy above.
- **Assistance reported:** current hardship enrolment (`Q37`), reported concession (`Z7_8`), and historical support such as an extension or repayment plan (`Q36b`). A historical repayment plan is not labelled as a current plan.
- **Model priority:** optional priority label/score, trend and assessment availability; demo values are visibly simulated.
- **Workflow:** assigned to me, assigned worker, unassigned, case status, follow-up timing and review state.

Proposed filter semantics: selecting a parent selects its child circumstances; matches are OR within the circumstance group and AND across independent groups. Parent checkboxes show an indeterminate state for partial selection. Unknown evidence is distinct from No. Filter chips expose active choices and allow individual removal. Counts and pagination follow the same filter definition. Selection applies to the current page when using the table header; selected IDs may be retained across pages, and filter changes remove selected IDs that no longer match.

These semantics are design decisions, not a prediction algorithm.

## Technical approach

- **Web:** React, TypeScript and Vite; semantic components and CSS design tokens for the selected green theme.
- **API:** Node.js, TypeScript and Express, with request validation and server-side workflow permissions.
- **Development data:** the versioned JSON fixture below, behind a repository/data-access interface.
- **Workflow storage:** SQLite for assignments, statuses, notes and review updates when the Node milestone is implemented. Seed it from the fixture; keep the checked-in fixture immutable during normal app use. A reset command restores the demo.
- **Integration:** separate adapters for imported source evidence, external model results and the full-profile route. The UI should not import the fixture directly in individual components.
- **Versions:** select and pin compatible package versions and a supported Node.js LTS release at application setup. Do not rely on globally installed packages.

Official references: [React](https://react.dev/learn), [Vite](https://vite.dev/guide/), [Express](https://expressjs.com/en/starter/basic-routing/).

## Five milestones

### 1. Scope, contracts and synthetic test data

Deliver the written scope, selected theme, support/evidence/action mapping, a proposed case/model/profile contract and 100 clearly fictional people with one queue case each. Include known and missing answers, all workflow states and simulated assessment states. Validate counts, IDs, cross-references, source-defined answer values and intended scenario coverage.

Completion: the fixture is reproducible and documented, and the proposed shared-ID/model contract is ready for the two teammates to review. The external integration contract remains provisional until agreed with them.

### 2. React layout and selected green theme

Create the app shell, filter sidebar, overview counters, toolbar, table, pagination, minimal New case panel and compact right overview with the approved proportions and green visual direction. Include responsive filter access and keyboard-operable panels. Use the fixture through a single data adapter.

Completion: the first screen and right overview visually match the approved workflow; placeholder categories from the original image have been replaced with the approved taxonomy.

### 3. Node API and workflow storage

Add the case-list/overview read endpoints, taxonomy/user reads, validated workflow mutations and SQLite seeding/reset. Keep source evidence separate from staff workflow updates and simulated model results. Establish a clearly labelled demo identity mechanism for development; full production sign-in/account administration is a separate scope decision.

Completion: reads and mutations work independently of the React screen, persist across restarts, reject unknown IDs/invalid status values and enforce manager versus assigned-worker permissions on the server.

### 4. Connect filters, assignment and bulk actions

Wire search, parent/child filters, priority/assistance/workflow filters, counts, sort and pagination. Connect minimal case creation, single and bulk manager assignment, own-case status/notes, worker review, and assigned-to-me updates. Preserve selection deliberately and show actionable success/error feedback. Bulk requests are validated as a whole before changes are applied. Preserve Undo for reversible assignment/status changes, subject to version checks so it cannot overwrite a newer edit.

Completion: a manager can assign cases, the relevant worker can find them in assigned to me, and both single and bulk actions update the queue and overview consistently. Workers can read the shared queue and update their own assigned cases; they cannot assign cases or modify someone else's case through the API.

### 5. Integration checks, usability and handoff

Verify the end-to-end manager-to-worker flow, persistence/reset, combined filters, bulk permissions, unknown evidence, model pending/unavailable states, keyboard use and small-screen layout. Confirm the shared IDs and adapter boundaries with the model and profile teammates. Write run/reset instructions and a concise demo script.

Completion: the agreed queue workflow is usable with all 100 demo people, focused automated workflow/API checks pass, and external integrations can be connected through the agreed adapters. Delivering the prediction model or detailed profiles is not a completion requirement for this team's screen.

## Test-data coverage and limits

Use [../data/synthetic/case-queue.v1.json](../data/synthetic/case-queue.v1.json). The seed is reproducible and deliberately covers scenarios, rather than matching source-population percentages.

The fixture includes assigned/unassigned cases, all four case statuses, every supported circumstance, multiple-area cases, no-flag cases, unknown answers, current versus historical assistance, overdue/future/no follow-up, notes, reviewed/pending recommendations, and simulated model ready/pending/unavailable states.

All names, combinations of answers, dates, workflow records and model scores are invented. No respondent row or source person identifier is copied. ERA aggregates and SGSC households are not joined to survey respondents. The removed root-level placeholder is not restored.

## Work completed now

- Recorded the scope, design and approved recommendations.
- Prepared the proposed contract and reproducible fixture.
- Preserved the selected green theme as a design reference.

The React app, Node API and SQLite storage were built in milestones 2–5; see [progress.md](progress.md).
