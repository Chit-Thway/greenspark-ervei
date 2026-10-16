# Build progress

| Milestone | Status |
| --- | --- |
| 1. Scope, contracts and synthetic test data | **Done**, pending teammate review of the model/profile boundary |
| 2. React layout and selected green theme | **Done** (see below) |
| 3. Node API and workflow storage | **Done** (see below) |
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

## Milestone 2: React layout and green theme

Built in `web/` (React 19, TypeScript, Vite; npm workspace at the repo root).

- App shell, filter sidebar (views, support areas with parent/child checkboxes and an indeterminate state, assistance reported, simulated model priority, workflow), three overview counters, toolbar, table, pagination (8 per page), minimal New case panel and the compact right overview (440 px on wide screens, a slide-over on narrower ones).
- The three support areas and nine circumstances come from the JSON catalogs; the old placeholder categories are gone.
- Only `web/src/data/caseSource.ts` imports the fixture. Milestone 3 swaps it for API calls.
- Filter, sort, paging, counters and follow-up wording are pure functions in `web/src/domain/` with 12 unit tests.
- Small screens: filters sit behind a Filters button. Panels close with Escape and return focus to where you were.
- Checked in a real browser at 1440 px and 390 px with no console errors.

Deliberately not done yet (Milestones 3–4): assignment, bulk assign/status, status changes, notes, review and Undo. Those controls are visible but disabled. The New case form adds an in-memory case only.

Known limit: the fixture is bundled into the page, so the build is over 500 kB until the API replaces it.

## Milestone 3: Node API and workflow storage

Built in `api/` (Express 5, TypeScript, zod, `node:sqlite`). Shared filter/sort/paging logic moved to `shared/` so the web app and the API use one definition of every filter. See [api.md](api.md).

- All endpoints in the data contract, plus `/api/health`.
- Roles enforced on the server: only managers assign; workers change status, notes and review on their own cases only; the actor comes from the server-side demo identity, never the request body.
- Per-case versions, atomic bulk requests and guarded Undo as in [workflow-contract.md](workflow-contract.md).
- SQLite persists across restarts; `npm run reset` restores the 100-case demo; the fixture file is never modified.
- 25 API tests (permissions, stale versions, atomic bulk, undo conflicts and expiry, new case, persistence, reset, fixture unchanged). `npm test` runs shared, web and API tests; `npm run typecheck` covers all three.

Choices to confirm: errors for bulk requests are always `422 bulk_validation_failed` with per-item reasons (including permission and stale-version failures); reviews and notes bump the version but are not logged as undoable actions; any signed-in user can create a case.
