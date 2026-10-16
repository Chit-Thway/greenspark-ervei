# Workflow contract: assignment, bulk actions, versioning and Undo

Version: 1.0.0 draft (Milestone 1). This fills the gaps in [data-contract.md](data-contract.md) that the Node API (Milestone 3) needs. It covers **this team's workflow only**; the model and profile contracts stay separate and provisional.

## In plain terms

- Every case has a **version number**. Each change to a case bumps it by 1.
- A change request says "I last saw version N". If the case is now at a different version, someone else edited it, so the server refuses (HTTP 409) instead of overwriting their work.
- **Undo** is just another change that is only allowed if nobody has touched the case since the action being undone.

## Identity and permissions

The actor always comes from the server-side session, never from the request body. In the demo, a clearly labelled `X-Demo-User` header (value must be a fixture user id) stands in for sign-in; real authentication is a separate scope decision.

| Action | Manager | Assigned worker | Other worker |
| --- | --- | --- | --- |
| Read queue, overview, catalogs | yes | yes | yes |
| Create case | yes | yes | yes |
| Assign / reassign / unassign | yes | no | no |
| Change status | yes | own cases only | no |
| Add note | yes | own cases only | no |
| Record review | yes | own cases only | no |
| Undo an action | any action | own actions only | own actions only |

A case's worker is `workflow.assignedToUserId`. Unassigned cases can only be changed by a manager (except creating them).

## Versioning

- `case.version` starts at 1 and increments on every successful workflow mutation (assignment, status, note, review, undo).
- Every mutation sends `expectedVersion` per case. Mismatch returns `409 version_conflict` with the current case so the UI can refresh.
- The fixture is never edited; versions live in the SQLite store seeded from it.

## Assignment

`POST /api/cases/bulk/assignment` (also used for a single case with one item).

```json
{ "assigneeUserId": "staff-alex", "items": [{ "caseId": "GS-2001", "expectedVersion": 1 }] }
```

- `assigneeUserId` must be an active user with role `support_worker`, or `null` to unassign.
- Assigning to the current assignee is a no-op that is reported, not an error, and does not bump the version.
- Resolved cases may be reassigned.
- Maximum 100 items per request.

## Bulk actions

Bulk requests are **all-or-nothing**. The server validates every item first (unknown id, permission, version, valid value). If any item fails, nothing changes and the response is `422 bulk_validation_failed` listing each failing `caseId` with its reason. If all pass, all are applied in one SQLite transaction.

`POST /api/cases/bulk/status` takes `{ "status": "waiting", "items": [...] }`. For a worker, every item must be one of their own cases.

Statuses are `new`, `in_progress`, `waiting`, `resolved`; any to any is allowed (including reopening). Moving to `resolved` clears the displayed follow-up; reopening without a date shows Not scheduled.

## Notes and review

- `POST /api/cases/:caseId/notes` body `{ "text": "...", "expectedVersion": n }`. Text is trimmed, 1–500 characters, append-only, never edited or deleted. Author and time are set by the server.
- `PATCH /api/cases/:caseId/review` body `{ "reviewStatus": "reviewed" | "needs_review", "expectedVersion": n }`. Staff review is of the suggestions; it does not confirm eligibility.
- Notes and review changes are **not undoable**.

## New case

`POST /api/cases` with either an existing `personId` or a minimal identity (`displayName`, `suburb`). New cases start at version 1, status `new`, unassigned, `reviewStatus: needs_review`, evidence all unknown/not recorded, and `modelAssessment.status: "pending"` with null priority. Created person ids are server-generated and stable.

## Undo

Every assignment or status mutation writes an **action log** row. A bulk request is one action covering many cases.

`POST /api/workflow-actions/:actionId/undo` is allowed only when all of these hold:

1. The action type is assignment or status (not note/review/create/undo).
2. The actor is its original author, or a manager.
3. The action is not already undone.
4. For **every** case in the action, the current version equals the version that action produced (so nothing newer happened).
5. The action is at most 10 minutes old (proposal, configurable).

Undo restores the recorded previous values, bumps each case's version, and logs a new action. An undo cannot itself be undone; the user repeats the original change instead. If any case fails the checks, the whole undo is refused with `409 undo_conflict` and the offending case ids, and nothing changes.

## Error shape

```json
{ "error": { "code": "version_conflict", "message": "…", "details": [] } }
```

Codes: `unauthenticated` 401, `forbidden` 403, `not_found` 404, `validation_failed` 422, `bulk_validation_failed` 422, `version_conflict` 409, `undo_conflict` 409.

## Storage sketch (SQLite)

| Table | Purpose |
| --- | --- |
| `cases_workflow` | case id, version, status, assignee, follow-up, review status, timestamps |
| `case_notes` | note id, case id, author, text, created time |
| `workflow_actions` | action id, type, actor, created time, undone flag |
| `workflow_action_items` | action id, case id, before values, after values, resulting version |
| `created_cases` | people/cases made through New case |

Evidence, circumstances, recommendations and model assessments are read-only seed data and are not copied into mutable tables. A reset command drops the SQLite file and reseeds from the fixture. The database lives under the git-ignored `data/runtime/`.
