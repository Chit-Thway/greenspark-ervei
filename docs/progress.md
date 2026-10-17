# Build progress

| Milestone | Status |
| --- | --- |
| 1. Scope, contracts and synthetic test data | **Done**, pending teammate review of the model/profile boundary |
| 2. React layout and selected green theme | **Done** (see below) |
| 3. Node API and workflow storage | **Done** (see below) |
| 4. Filters, assignment and bulk actions | **Done** (see below) |
| 5. Integration checks, usability and handoff | **Done**, pending teammate agreement on the model/profile boundaries |

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

- App shell, filter sidebar (views, support areas with parent/child checkboxes and an indeterminate state, assistance reported, simulated model priority, workflow), three overview counters, toolbar, table, pagination (originally 8 per page; now 50), minimal New case panel and the compact right overview (440 px on wide screens, a slide-over on narrower ones).
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

## Milestone 4: connected filters, assignment and bulk actions

The screen now reads and writes only through the API (`web/src/data/api.ts`); the fixture is no longer bundled into the page.

- **Queue:** search (debounced), parent/child filters, assistance, priority, workflow filters, sort and paging run on the server. Counters and filter counts come from the same server definition.
- **Assignment:** managers assign one case from the overview or many from the selection bar. The assignee list and the Assign controls are disabled for workers, and the server enforces it too.
- **Assigned to me:** workers see their cases under that view and can update status, review state and notes on them only.
- **Selection:** kept across pages (each ID remembers the version the user last saw), cleared of IDs that stop matching when filters change or after a change moves them out of view.
- **Feedback:** a message bar reports success, "already had that value", stale versions (the case is refreshed) and rejected bulk requests with each failing case listed. Nothing is changed when any case in a bulk request fails.
- **Undo:** assignment and status changes show an Undo button for 20 seconds. The server still decides whether it is allowed (10-minute window, no newer edits).
- **New case:** creates a real case through the API; it persists.
- **Checks:** a real-browser run against the live API and web servers covered manager bulk assign and Undo, selection across pages and pruning, worker "Assigned to me", notes, status and review, a stale-edit conflict, a rejected worker bulk update, new case, and persistence after reload. API tests gained the `ids` endpoint (26 total). Those browser checks are not yet a committed test; Milestone 5 turns them into one.

Known gaps: the profile link and model adapter are still placeholders (Milestone 5); Undo is offered only from the message bar, so it is gone after the message is dismissed or times out.

## Milestone 5: integration checks, usability and handoff

- **End-to-end tests** (`npm run test:e2e`, 13 tests, ~20 s): start a throwaway API and database plus the web app, then drive a real browser through the manager-to-worker story, persistence across reload, permissions, stale edits, empty/pending/unavailable/unknown states, a failed request, keyboard use, an axe accessibility scan, and a 390 px layout.
- **Fixes found by those checks:** the filter chips group had an invalid ARIA label; on phones the page scrolled sideways because visually hidden table text escaped its scroll area; and the table now becomes stacked cards below 640 px so priority, assignee and status stay visible.
- **Model boundary:** a replaceable `ModelAdapter` (default: synthetic). Adapter errors, missing results and unscored "ready" results degrade to "Assessment unavailable" instead of Routine. 5 API tests.
- **Profile boundary:** the link is driven by `GREENSPARK_PROFILE_URL_TEMPLATE` on the API; hidden when unset.
- **Docs:** [demo-script.md](demo-script.md), [integration.md](integration.md), and updated run/reset instructions in the README and [api.md](api.md).

### Remaining integration gaps

- The prediction model and the full profile are not built (other teammates). Their contracts are proposals only; see [integration.md](integration.md).
- The queue asks the model adapter about every case on each list request. Fine for 100 demo cases; a real model will need batching or caching.
- Demo identity only: no production sign-in or account administration.
- Undo is offered only in the message bar after an action.
- Automated checks cover Chromium only; no screen-reader testing was done beyond axe.
- The fixture's 25 existing notes and all workflow data are invented.

### Summary against the five milestones

1. Scope, contracts, fixture: done.
2. React layout and theme: done.
3. Node API and storage: done.
4. Filters, assignment, bulk actions: done.
5. Integration checks and handoff: done, apart from the teammate agreements above.

## Update: case details on their own page

Case details no longer open in a right-hand panel. Each case has its own address, `/cases/<caseId>`:

- Clicking a person (or **View case**) opens the page; a Ctrl/Cmd/middle click opens it in a new tab, and the address can be bookmarked or shared.
- **Back to case queue** and the browser Back button return to the queue with the same filters, search, page and selection.
- An unknown case ID shows "Case not found"; the page works as a direct link when hosted (the server falls back to the app for non-API paths).
- Keyboard: the page starts at its heading, and going back returns focus to the case you came from.
- The New case form is still a side panel; creating a case takes you to its new page.
- Browser tests grew to 15 and cover the address, Back/Forward, direct and unknown links, and open-in-new-tab.

## Update: customer contact details

Added invented gender, preferred name, address (lines 1 and 2, postcode), mobile, phone and email to every person, and a "Customer details" card on the case page. Existing generated values were not changed (the new fields come from a separate hash, not the random stream). The generator's check enforces reserved phone ranges, `example.com` emails, postcodes that match suburbs, and a contact detail for each person's stated contact preference. People added in the queue show "Not recorded". Local databases created earlier need `npm run reset` to pick the fields up.

## Update: case notes

- Note times show the year and the full time, for example "15 Oct 2026 · 11:00 am".
- Inside each note, the author and date line now comes first with the note text underneath. (The notes card itself stays in the right-hand column, below Case progress.)
- Notes can be edited: a note's author, or a manager, can change it (`PATCH /api/cases/:id/notes/:noteId`). Edited notes show "edited" with who and when, and the earlier wording is kept in a `note_edits` table for audit (not shown in the app). Databases created earlier gain the new columns automatically on start.
- Still true: notes cannot be deleted, and note changes are not undoable.

## Update: bigger note box, no length limit

The note boxes (adding and editing) are taller, and the 500-character limit is gone, along with the "0/500" counter. Line breaks in notes are now kept when shown. The only remaining cap is the request-size limit of about 100 KB (roughly 100,000 characters), which returns a clear message instead of an error.
