# Build progress

| Milestone | Status |
| --- | --- |
| 1. Scope, contracts and synthetic test data | **Done**, pending teammate review of the model/profile boundary |
| 2. React layout and selected green theme | Not started |
| 3. Node API and workflow storage | Not started |
| 4. Filters, assignment and bulk actions | Not started |
| 5. Integration checks, usability and handoff | Not started |

## Milestone 1 review (16 October 2026)

- Repo was already at latest `main` (`0faf78f`).
- `node scripts/generate-synthetic-cases.mjs --check` passes: 100 people, 100 cases, 3 support areas, 9 circumstances, 11 recommendation types; 80 assigned / 20 unassigned; model 90 ready / 5 pending / 5 unavailable.
- Fixture matches the data contract: all cases at `version: 1`, four statuses (30 new, 40 in progress, 20 waiting, 10 resolved), 62 needs-review / 38 reviewed, 25 cases with notes.
- Gap found and closed: the earlier contract named the assignment, bulk, versioning and Undo behaviour but did not define it. See [workflow-contract.md](workflow-contract.md).

## Open items for teammates

- Model owner: agree identifiers, score meaning and the `getAssessments(caseIds)` shape. Until then the mock adapter is used.
- Profile owner: agree `personId` and the full-profile route (`fullProfilePath` is null in the fixture).
- Undo window (10 minutes) and the 100-item bulk limit are proposals for the team to confirm.
