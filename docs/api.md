# Node API (Milestone 3)

Express + TypeScript in `api/`, with SQLite for workflow state. It implements [workflow-contract.md](workflow-contract.md). Everything is synthetic demo data.

## Run

```sh
npm install
npm run dev:api     # http://localhost:3001 (PORT to change)
npm run reset       # delete the workflow database; the next start reseeds from the fixture
npm test            # includes the API tests
```

Needs Node.js 22 or newer. SQLite uses Node's built-in `node:sqlite`, so there is nothing native to compile. Node prints an "ExperimentalWarning: SQLite is an experimental feature" line on start; that is expected.

| Setting | Default |
| --- | --- |
| `GREENSPARK_DB` | `data/runtime/greenspark.sqlite` (git-ignored) |
| `GREENSPARK_FIXTURE` | `data/synthetic/case-queue.v1.json` |
| `PORT` | `3001` |
| `GREENSPARK_PROFILE_URL_TEMPLATE` | unset (profile link hidden); e.g. `https://profiles.example/people/{personId}` |

## Persistence and reset

- On first start the database is seeded from the fixture: people, cases, evidence, recommendations, model results and notes. Workflow changes (assignment, status, review, notes, new cases) are written to SQLite and survive restarts.
- The fixture file is never written to. A test checks its hash before and after.
- `npm run reset` removes the database file (and its `-wal`/`-shm` files). The next start reseeds the original 100 cases.
- Evidence, circumstances, recommendations and model assessments are read-only seed data. Staff workflow data is stored in separate columns and tables, as the plan requires.

## Identity (demo only)

Every `/api` route except `/api/health` needs an `X-Demo-User` header naming a fixture user, for example `staff-manager` or `staff-alex`. Anything else gets `401 unauthenticated`. The actor is always taken from this header on the server; bodies that try to supply an author or actor are rejected. This is **not** production sign-in.

## Endpoints

| Endpoint | Notes |
| --- | --- |
| `GET /api/health` | No identity needed |
| `GET /api/session` | Current user, role and demo flags |
| `GET /api/catalogs` | Support areas, circumstances, evidence fields, recommendations, assistance options |
| `GET /api/users` | All staff; `assignableUserIds` is non-empty for managers only |
| `GET /api/cases` | `search, view, circumstanceIds, assistanceIds, priorityLabels` (comma separated), `minPriorityScore, assessmentStatus, status, assignedToUserId, sort, page, pageSize`. Returns `items`, totals, global `counters` and filter `facets` |
| `GET /api/cases/ids` | Same filters, no paging: IDs of every matching case (used to drop selections that no longer match) |
| `GET /api/cases/:id/overview` | Case and person |
| `POST /api/cases` | `{personId}` or `{displayName, suburb}`; starts at version 1, unassigned, evidence unknown, model pending |
| `POST /api/cases/bulk/assignment` | Manager only. `{assigneeUserId \| null, items:[{caseId, expectedVersion}]}` |
| `POST /api/cases/bulk/status` | `{status, items}`; workers only for their own cases |
| `PATCH /api/cases/:id/status` | `{status, expectedVersion}` |
| `POST /api/cases/:id/notes` | `{text (1–500), expectedVersion}` |
| `PATCH /api/cases/:id/notes/:noteId` | `{text (1–500), expectedVersion}`: author or manager only; keeps the earlier wording as an audit record |
| `PATCH /api/cases/:id/review` | `{reviewStatus, expectedVersion}` |
| `POST /api/workflow-actions/:actionId/undo` | Assignment/status actions only |

Mutations return `{ actionId, updated: [case…], unchanged: [caseId…] }`. A change that matches the current value is reported under `unchanged` and does not bump the version.

## Errors

`{ "error": { "code", "message", "details": [{ "caseId?", "code?", "message" }] } }`

| Status | Code | When |
| --- | --- | --- |
| 401 | `unauthenticated` | Missing or unknown demo user |
| 403 | `forbidden` | Role or ownership check failed |
| 404 | `not_found` | Unknown case, action or endpoint |
| 409 | `version_conflict` | Stale `expectedVersion`; the response includes `current` |
| 409 | `undo_conflict` | Already undone, expired, wrong type, or a case changed since |
| 422 | `validation_failed` | Bad body, query, status value, duplicate IDs, unknown person, invalid assignee |
| 422 | `bulk_validation_failed` | At least one item failed; **nothing** was changed. `details` lists each failing `caseId` and reason |

For the single-case status endpoint the specific 403/404/409 is returned directly. Bulk and assignment requests collect every failing item into one 422.

## Not in this milestone

There is no production sign-in or account administration. Model results come through a replaceable adapter; see [integration.md](integration.md).
