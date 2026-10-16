# Integration boundaries and open agreements

This team's screen works without the prediction model and without the full profile. Both connect through small, replaceable boundaries. **Nothing here is agreed with the model or profile owners yet.**

## Shared identity

- `personId` (for example `demo-person-011`) identifies a person; `caseId` (for example `GS-2011`) identifies a queue case. Both are stable strings; never derive them from a name.
- One person can have several cases later. New cases made in the queue get server-generated IDs.
- `sourceRecordId` is null for demo people; no survey respondent IDs are copied.

## Model adapter (prediction model owner)

Code: `api/src/adapters.ts`.

```ts
interface ModelAdapter {
  getAssessments(caseIds: string[]): Promise<Record<string, ModelAssessment | undefined>>;
}
```

- The default `SyntheticModelAdapter` returns the invented assessments stored with the seed. Every one is marked `isSimulated: true` and the UI labels them "simulated".
- The queue asks the adapter for every case on each list request, because priority filters and sorting need all scores.
- **Failure behaviour (tested):** if the adapter throws, or omits a case, or returns "ready" without a score, the case shows **Assessment unavailable** with no priority. A missing score is never shown as Routine or zero, and `minPriorityScore` excludes unscored cases.
- To connect the real model: implement `ModelAdapter` and pass it to `createApp(store, { modelAdapter })` in `api/src/server.ts`.

To agree with the model owner: case/person identifiers sent, score range and label bands (the demo uses urgent/high/moderate/routine from fixture conventions, not calibrated), trend values, refresh timing, caching for 100+ cases per request, and error behaviour. Do not send downstream outcome labels into a prediction request.

## Full profile link (profile owner)

Set `GREENSPARK_PROFILE_URL_TEMPLATE` when starting the API, for example `https://profiles.example/people/{personId}`. The overview then shows "Open full profile" and opens it in a new tab. Unset, the link is hidden. The queue never builds profile content itself.

To agree with the profile owner: the route shape, whether it needs sign-in hand-off, and whether it should also receive `caseId`.

## Identity and sign-in

The demo uses an `X-Demo-User` header, validated against fixture users on the server. A real sign-in must supply the same two facts: who the user is and whether they are a manager or support worker. Replace `actorOf` in `api/src/app.ts`.

## Items still to confirm as a team

- Undo window (10 minutes) and bulk limit (100 cases).
- Whether any signed-in user may create a case.
- Whether workers should see all cases (current) or only unassigned plus their own.
- Priority labels and thresholds, once the model owner defines them.
