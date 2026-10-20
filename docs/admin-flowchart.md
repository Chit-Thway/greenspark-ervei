# Admin flowchart

`/admin` shows the utility-hardship mapping as a three-column flowchart: **Signals → Circumstances → Solutions**. The JSON file is the single source of truth: the page reads it from the API, and every edit is written back to it.

File: `data/admin/utility_hardship_mapping.json` (override with `GREENSPARK_FLOW_FILE`).

## Using it

- **Select a box** to trace its path (everything connected stays bright) and open its details on the right (a bottom sheet on small screens).
- **Search**, filter by utility, show/hide all links, or show strong signals only. Solid lines are strong links, dashed are supporting.
- **Edit** a box (Edit button), **delete** it (with a confirm), or **add** one with the "+ Add" button above each column. The short ID is made from the name and can't change later.
- **Links**: in the details panel, add a link with the picker, change its strength, or remove it. Do it from either end; the other end follows.
- **Settings** edits the overview text, scoring rules, guardrails, categories and circumstance types.
- **Undo** reverses your most recent change (this browser session only). **Download JSON** saves a copy.
- The status pill says when changes are saved. If a save is refused (for example another person changed the same thing) the page reloads the file as it now is.

## How it keeps the file tidy

- Each circumstance holds the real links (`signals` with strength, and `solutions`). `points_to`, `used_for` and `meta.counts` are rebuilt from them on every save, in a stable order, so diffs stay small.
- IDs must be lower-case letters, numbers and underscores and unique across all three kinds. Web addresses must be `http://` or `https://`. A category or circumstance type that is still in use can't be deleted.
- If you edit the file by hand, the page picks the change up on the next load or when the browser window regains focus. If the file is invalid, the page shows what is wrong, turns editing off and never overwrites it.
- Writes are atomic (temporary file, then rename) and queued, so simultaneous edits don't lose each other.

## Under the hood

Edits are small operations (`updateEntity`, `setLink`, `deleteEntity`, …) defined in `shared/src/flow.ts` and applied by both the browser (instantly) and the server (the real write). The API is in [api.md](api.md). There is no sign-in: any demo user can edit.
