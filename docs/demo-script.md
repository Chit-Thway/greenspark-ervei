# Demo script (about 8 minutes)

Everything shown is fictional demo data. Start from a clean state:

```sh
npm install
npm run reset
npm run dev          # open http://localhost:5173
```

The header **Demo view** menu switches user. It is a labelled stand-in for sign-in.

1. **The shared queue (manager, Taylor Brooks).** 200 cases, 50 per page (four pages). Point out the three counters (all unresolved cases, not filtered), the green "Synthetic demo data" badge, and "simulated" next to every model priority.
2. **Filters.** Expand *Billing and meters*, tick *Estimated reads then catch-up bill*. The parent shows a partial state, a chip appears, counts update. Add *Status: Waiting*, then remove chips one by one. Show *Assistance reported* is separate from support areas, with "Current at report" apart from "Historical, past 12 months".
3. **Why a case is flagged.** Click a person. Their case opens on its own page (`/accounts/DEMO-…`, named by account number) showing each circumstance, the reported answer, its source question and period, then suggested staff actions labelled "for staff review". Show an *Unknown / not recorded* answer versus a recorded *No*. Show a pending model result: "Assessment pending", not Routine. Use **Back to case queue** (or the browser Back button): your filters, page and selection are still there.
4. **Bulk assignment.** Filter by **Assigned worker: Sarah Chen**, select two cases, assign to Alex Morgan. A message confirms it and offers **Undo**. Click Undo: both go back to Sarah. Assign again.
5. **Selection across pages.** Select all on page 1, go to page 2: the count stays. Change the status filter: selections that no longer match disappear.
6. **Worker view (Alex Morgan).** Switch user, open **Assigned to me**. The two cases are there. Open one: assignment is disabled ("Only managers can assign cases"). Add a note, set status to Waiting, mark reviewed.
7. **Permissions and conflicts.** As Alex, select a whole page and press *Update status*: nothing changes and the message lists every case that is not Alex's. Then, in a second browser tab as the manager, add a note to the case Alex has open, and save a status in Alex's tab: a "changed by someone else" message appears and the panel refreshes.
8. **New case.** As the manager, **+ New case** with a name, suburb and worker. It appears as pending/unknown, assigned to that worker, and stays after a reload.
9. **Persistence and reset.** Stop and restart the API: changes remain. `npm run reset` restores the original 200 cases.

If something looks off, run `npm run test:e2e`: it replays steps 1–8 in a real browser.
