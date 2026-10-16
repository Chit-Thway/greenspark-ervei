import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allCases, start, type Harness } from "./helpers";

let h: Harness;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h.stop(); });

describe("workflow follow-up regressions (#3)", () => {
  it("reopening a resolved case must not revive its old follow-up date", async () => {
    const c = (await allCases(h)).find((c) => c.workflow.status !== "resolved" && c.workflow.followUpAt)!;
    const resolved = await h.call("staff-manager", "PATCH", `/api/cases/${c.id}/status`, {
      status: "resolved", expectedVersion: c.version,
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.updated[0].workflow.followUpAt).toBeNull();
    const reopened = await h.call("staff-manager", "PATCH", `/api/cases/${c.id}/status`, {
      status: "in_progress", expectedVersion: resolved.body.updated[0].version,
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.updated[0].workflow.followUpAt).toBeNull();
  });

  it("Undo of resolution restores the original date, but a normal reopen does not", async () => {
    const c = (await allCases(h)).find((c) => c.workflow.status !== "resolved" && c.workflow.followUpAt)!;
    const resolved = await h.call("staff-manager", "PATCH", `/api/cases/${c.id}/status`, {
      status: "resolved", expectedVersion: c.version,
    });
    const undone = await h.call("staff-manager", "POST", `/api/workflow-actions/${resolved.body.actionId}/undo`);
    expect(undone.status).toBe(200);
    expect(undone.body.updated[0].workflow).toMatchObject({ status: c.workflow.status, followUpAt: c.workflow.followUpAt });
    expect(undone.body.updated[0].version).toBe(c.version + 2);
  });

  it("clears dates on reopening cases resolved by an older version of the app", async () => {
    const c = (await allCases(h)).find((c) => c.workflow.status !== "resolved" && c.workflow.followUpAt)!;
    h.store.db.prepare("UPDATE cases SET status = 'resolved' WHERE id = ?").run(c.id);
    const reopened = await h.call("staff-manager", "PATCH", `/api/cases/${c.id}/status`, {
      status: "in_progress", expectedVersion: c.version,
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.updated[0].workflow.followUpAt).toBeNull();
  });

  it("bulk resolution and Undo restore each case's own follow-up", async () => {
    const cases = (await allCases(h)).filter((c) => c.workflow.status !== "resolved" && c.workflow.followUpAt).slice(0, 2);
    const resolved = await h.call("staff-manager", "POST", "/api/cases/bulk/status", {
      status: "resolved", items: cases.map((c) => ({ caseId: c.id, expectedVersion: c.version })),
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.updated.every((c: any) => c.workflow.followUpAt === null)).toBe(true);
    const undone = await h.call("staff-manager", "POST", `/api/workflow-actions/${resolved.body.actionId}/undo`);
    expect(undone.status).toBe(200);
    for (const original of cases) {
      const restored = undone.body.updated.find((c: any) => c.id === original.id);
      expect(restored.workflow).toMatchObject({ status: original.workflow.status, followUpAt: original.workflow.followUpAt });
    }
  });

  it("still supports Undo of older action logs without a followUpAt field", async () => {
    const c = (await allCases(h)).find((c) => c.workflow.assignedToUserId === null && c.workflow.followUpAt)!;
    const assigned = await h.call("staff-manager", "POST", "/api/cases/bulk/assignment", {
      assigneeUserId: "staff-alex", items: [{ caseId: c.id, expectedVersion: c.version }],
    });
    const action = h.store.getAction(assigned.body.actionId)!;
    const item = action.items[0]!;
    const { followUpAt: _before, ...before } = item.before;
    const { followUpAt: _after, ...after } = item.after;
    h.store.db.prepare("UPDATE workflow_action_items SET before_doc = ?, after_doc = ? WHERE action_id = ?")
      .run(JSON.stringify(before), JSON.stringify(after), action.id);
    const undone = await h.call("staff-manager", "POST", `/api/workflow-actions/${action.id}/undo`);
    expect(undone.status).toBe(200);
    expect(undone.body.updated[0].workflow).toMatchObject({ assignedToUserId: null, followUpAt: c.workflow.followUpAt });
  });
});
