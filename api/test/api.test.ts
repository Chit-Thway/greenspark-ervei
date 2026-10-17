import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allCases, start, type Harness } from "./helpers";

let h: Harness;
// Fresh in-memory database per test.
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h.stop(); });

const M = "staff-manager";

describe("identity and reads", () => {
  it("rejects missing or unknown demo users", async () => {
    expect((await h.call(null, "GET", "/api/cases")).status).toBe(401);
    expect((await h.call("someone-else", "GET", "/api/cases")).status).toBe(401);
    expect((await h.call(null, "GET", "/api/health")).status).toBe(200);
  });

  it("resolves the session from the server, not the body", async () => {
    const r = await h.call("staff-alex", "GET", "/api/session");
    expect(r.body.user).toMatchObject({ id: "staff-alex", role: "support_worker" });
    expect(r.body.demoIdentity).toBe(true);
  });

  it("serves catalogs and users", async () => {
    const c = await h.call(M, "GET", "/api/catalogs");
    expect(c.body.supportAreas).toHaveLength(3);
    expect(c.body.circumstances).toHaveLength(9);
    const u = await h.call(M, "GET", "/api/users");
    expect(u.body.assignableUserIds).toHaveLength(4);
    expect((await h.call("staff-alex", "GET", "/api/users")).body.assignableUserIds).toEqual([]);
  });

  it("lists, filters and paginates", async () => {
    const r = await h.call(M, "GET", "/api/cases");
    expect(r.body).toMatchObject({ total: 100, page: 1, pageSize: 50, pageCount: 2, from: 1, to: 50 }); // 50 per page by default
    expect(r.body.items).toHaveLength(50);
    const second = await h.call(M, "GET", "/api/cases?page=2");
    expect(second.body.items).toHaveLength(50);
    expect(second.body).toMatchObject({ from: 51, to: 100 });
    const small = await h.call(M, "GET", "/api/cases?pageSize=8"); // other sizes still work
    expect(small.body).toMatchObject({ pageSize: 8, pageCount: 13 });
    expect(small.body.items).toHaveLength(8);
    expect(r.body.counters.awaitingAssignment).toBeGreaterThan(0);
    const warm = await h.call(M, "GET", "/api/cases?circumstanceIds=keeping_warm_difficulty&pageSize=100");
    expect(warm.body.total).toBe(r.body.facets.circumstances.keeping_warm_difficulty);
    const both = await h.call(M, "GET", "/api/cases?circumstanceIds=keeping_warm_difficulty&status=resolved&pageSize=100");
    expect(both.body.items.every((i: any) => i.case.workflow.status === "resolved")).toBe(true);
    expect((await h.call(M, "GET", "/api/cases?search=GS-2001")).body.items[0].case.id).toBe("GS-2001");
  });

  it("returns matching ids across all pages for selection pruning", async () => {
    const r = await h.call(M, "GET", "/api/cases/ids?status=resolved");
    expect(r.body.ids).toHaveLength(10);
    expect((await h.call(M, "GET", "/api/cases/ids?status=bogus")).status).toBe(422);
  });

  it("validates list parameters and returns unknown cases as 404", async () => {
    expect((await h.call(M, "GET", "/api/cases?status=bogus")).status).toBe(422);
    expect((await h.call(M, "GET", "/api/cases?page=0")).status).toBe(422);
    expect((await h.call(M, "GET", "/api/cases/GS-9999/overview")).status).toBe(404);
    const ov = await h.call(M, "GET", "/api/cases/GS-2001/overview");
    expect(ov.body.case.id).toBe("GS-2001");
    expect(ov.body.person.id).toBe(ov.body.case.personId);
    expect(ov.body.person).toMatchObject({ gender: expect.any(String), preferredName: expect.any(String), address: { line1: expect.any(String), postcode: expect.stringMatching(/^\d{4}$/) } });
    expect(ov.body.person.email === null || ov.body.person.email.endsWith("@example.com")).toBe(true);
    expect(ov.body.person.mobile === null || /^0491 57\d \d{3}$/.test(ov.body.person.mobile)).toBe(true);
    expect(ov.body.person.phone === null || /^\(08\) 5550 \d{4}$/.test(ov.body.person.phone)).toBe(true);
  });
});

describe("assignment", () => {
  it("lets a manager assign and the worker finds it under assigned to me", async () => {
    const cases = await allCases(h);
    const target = cases.find((c) => c.workflow.assignedToUserId === null)!;
    const r = await h.call(M, "POST", "/api/cases/bulk/assignment", { assigneeUserId: "staff-alex", items: [{ caseId: target.id, expectedVersion: target.version }] });
    expect(r.status).toBe(200);
    expect(r.body.updated[0]).toMatchObject({ id: target.id, version: target.version + 1 });
    expect(r.body.updated[0].workflow.assignedToUserId).toBe("staff-alex");
    const mine = await h.call("staff-alex", "GET", "/api/cases?view=mine&pageSize=100");
    expect(mine.body.items.map((i: any) => i.case.id)).toContain(target.id);
  });

  it("refuses workers, non-workers as assignees and unknown cases", async () => {
    const c = (await allCases(h))[0];
    const body = { assigneeUserId: "staff-alex", items: [{ caseId: c.id, expectedVersion: c.version }] };
    expect((await h.call("staff-alex", "POST", "/api/cases/bulk/assignment", body)).status).toBe(403);
    expect((await h.call(M, "POST", "/api/cases/bulk/assignment", { ...body, assigneeUserId: M })).status).toBe(422);
    expect((await h.call(M, "POST", "/api/cases/bulk/assignment", { ...body, assigneeUserId: "nobody" })).status).toBe(422);
    const r = await h.call(M, "POST", "/api/cases/bulk/assignment", { ...body, items: [{ caseId: "GS-9999", expectedVersion: 1 }] });
    expect(r.status).toBe(422);
    expect(r.body.error.details[0]).toMatchObject({ caseId: "GS-9999", code: "not_found" });
  });

  it("is all-or-nothing when one item is stale", async () => {
    const cases = (await allCases(h)).filter((c) => c.workflow.assignedToUserId === null).slice(0, 3);
    const items = cases.map((c, i) => ({ caseId: c.id, expectedVersion: i === 1 ? 99 : c.version }));
    const r = await h.call(M, "POST", "/api/cases/bulk/assignment", { assigneeUserId: "staff-sarah", items });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("bulk_validation_failed");
    expect(r.body.error.details).toEqual([expect.objectContaining({ caseId: cases[1]!.id, code: "version_conflict" })]);
    const after = await allCases(h);
    for (const c of cases) expect(after.find((a) => a.id === c.id)!.workflow.assignedToUserId).toBeNull();
  });

  it("reports an unchanged assignment without bumping the version", async () => {
    const c = (await allCases(h)).find((x) => x.workflow.assignedToUserId)!;
    const r = await h.call(M, "POST", "/api/cases/bulk/assignment", { assigneeUserId: c.workflow.assignedToUserId, items: [{ caseId: c.id, expectedVersion: c.version }] });
    expect(r.body).toMatchObject({ actionId: null, updated: [], unchanged: [c.id] });
  });

  it("can unassign and rejects duplicate ids or oversized bulk requests", async () => {
    const c = (await allCases(h)).find((x) => x.workflow.assignedToUserId)!;
    const ok = await h.call(M, "POST", "/api/cases/bulk/assignment", { assigneeUserId: null, items: [{ caseId: c.id, expectedVersion: c.version }] });
    expect(ok.body.updated[0].workflow.assignedToUserId).toBeNull();
    const dup = { caseId: c.id, expectedVersion: 1 };
    expect((await h.call(M, "POST", "/api/cases/bulk/assignment", { assigneeUserId: null, items: [dup, dup] })).status).toBe(422);
    const many = Array.from({ length: 101 }, (_, i) => ({ caseId: `GS-${i}`, expectedVersion: 1 }));
    expect((await h.call(M, "POST", "/api/cases/bulk/assignment", { assigneeUserId: null, items: many })).status).toBe(422);
  });
});

describe("status, notes and review permissions", () => {
  it("lets the assigned worker change their own case only", async () => {
    const cases = await allCases(h);
    const own = cases.find((c) => c.workflow.assignedToUserId === "staff-alex" && c.workflow.status !== "waiting")!;
    const other = cases.find((c) => c.workflow.assignedToUserId === "staff-sarah")!;
    const ok = await h.call("staff-alex", "PATCH", `/api/cases/${own.id}/status`, { status: "waiting", expectedVersion: own.version });
    expect(ok.status).toBe(200);
    expect(ok.body.updated[0].workflow.status).toBe("waiting");
    const no = await h.call("staff-alex", "PATCH", `/api/cases/${other.id}/status`, { status: "waiting", expectedVersion: other.version });
    expect(no.status).toBe(403);
    const unassigned = cases.find((c) => c.workflow.assignedToUserId === null)!;
    expect((await h.call("staff-alex", "PATCH", `/api/cases/${unassigned.id}/status`, { status: "waiting", expectedVersion: unassigned.version })).status).toBe(403);
  });

  it("allows reopening a resolved case and any status move for a manager", async () => {
    const c = (await allCases(h)).find((x) => x.workflow.status === "resolved")!;
    const r = await h.call(M, "PATCH", `/api/cases/${c.id}/status`, { status: "in_progress", expectedVersion: c.version });
    expect(r.body.updated[0].workflow.status).toBe("in_progress");
  });

  it("rejects invalid statuses, unknown cases and stale versions with the current case", async () => {
    const c = (await allCases(h))[0];
    expect((await h.call(M, "PATCH", `/api/cases/${c.id}/status`, { status: "done", expectedVersion: c.version })).status).toBe(422);
    expect((await h.call(M, "PATCH", "/api/cases/GS-9999/status", { status: "new", expectedVersion: 1 })).status).toBe(404);
    const other = c.workflow.status === "waiting" ? "new" : "waiting";
    const stale = await h.call(M, "PATCH", `/api/cases/${c.id}/status`, { status: other, expectedVersion: c.version + 5 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "version_conflict", current: { id: c.id, version: c.version } });
  });

  it("bulk status is atomic and enforces ownership for workers", async () => {
    const cases = await allCases(h);
    const own = cases.filter((c) => c.workflow.assignedToUserId === "staff-alex").slice(0, 2);
    const foreign = cases.find((c) => c.workflow.assignedToUserId === "staff-maya")!;
    const mixed = await h.call("staff-alex", "POST", "/api/cases/bulk/status", {
      status: "waiting", items: [...own, foreign].map((c) => ({ caseId: c.id, expectedVersion: c.version })),
    });
    expect(mixed.status).toBe(422);
    expect(mixed.body.error.details).toEqual([expect.objectContaining({ caseId: foreign.id, code: "forbidden" })]);
    const after = await allCases(h);
    for (const c of own) expect(after.find((a) => a.id === c.id)!.version).toBe(c.version);
    const good = await h.call("staff-alex", "POST", "/api/cases/bulk/status", { status: "waiting", items: own.map((c) => ({ caseId: c.id, expectedVersion: c.version })) });
    expect(good.status).toBe(200);
  });

  it("adds trimmed notes as the server-resolved user and bumps the version", async () => {
    const c = (await allCases(h)).find((x) => x.workflow.assignedToUserId === "staff-alex")!;
    const r = await h.call("staff-alex", "POST", `/api/cases/${c.id}/notes`, { text: "  Called and left a message.  ", expectedVersion: c.version, authorUserId: "staff-manager" });
    expect(r.status).toBe(422); // unknown body keys, such as a client-supplied author, are rejected
    const ok = await h.call("staff-alex", "POST", `/api/cases/${c.id}/notes`, { text: "  Called and left a message.  ", expectedVersion: c.version });
    expect(ok.status).toBe(201);
    const notes = ok.body.case.workflow.notes;
    expect(notes.at(-1)).toMatchObject({ text: "Called and left a message.", authorUserId: "staff-alex" });
    expect(ok.body.case.version).toBe(c.version + 1);
    expect((await h.call("staff-alex", "POST", `/api/cases/${c.id}/notes`, { text: "   ", expectedVersion: ok.body.case.version })).status).toBe(422);
    expect((await h.call("staff-alex", "POST", `/api/cases/${c.id}/notes`, { text: "x".repeat(501), expectedVersion: ok.body.case.version })).status).toBe(422);
    expect((await h.call("staff-sarah", "POST", `/api/cases/${c.id}/notes`, { text: "Not mine", expectedVersion: ok.body.case.version })).status).toBe(403);
  });

  it("records review state for the assigned worker and manager only", async () => {
    const c = (await allCases(h)).find((x) => x.workflow.assignedToUserId === "staff-alex" && x.workflow.reviewStatus === "needs_review")!;
    expect((await h.call("staff-sarah", "PATCH", `/api/cases/${c.id}/review`, { reviewStatus: "reviewed", expectedVersion: c.version })).status).toBe(403);
    const r = await h.call("staff-alex", "PATCH", `/api/cases/${c.id}/review`, { reviewStatus: "reviewed", expectedVersion: c.version });
    expect(r.body.updated[0].workflow.reviewStatus).toBe("reviewed");
    const again = await h.call("staff-alex", "PATCH", `/api/cases/${c.id}/review`, { reviewStatus: "reviewed", expectedVersion: r.body.updated[0].version });
    expect(again.body.unchanged).toEqual([c.id]);
  });
});

describe("new case", () => {
  it("creates a minimal case with unknown evidence and a pending model", async () => {
    const r = await h.call("staff-alex", "POST", "/api/cases", { displayName: "  Jordan Test ", suburb: "Perth" });
    expect(r.status).toBe(201);
    const c = r.body.case;
    expect(c).toMatchObject({ version: 1, supportAreaIds: [] });
    expect(c.workflow).toMatchObject({ status: "new", assignedToUserId: null, reviewStatus: "needs_review" });
    expect(c.modelAssessment).toMatchObject({ status: "pending", priority: null, isSimulated: true });
    expect(Object.values(c.reportedAnswers).every((v) => v === null)).toBe(true);
    expect(Object.values(c.answerAvailability).every((v) => v === "unknown")).toBe(true);
    expect(r.body.person).toMatchObject({ displayName: "Jordan Test", suburb: "Perth" });
    expect(r.body.person).toMatchObject({ gender: null, preferredName: null, address: null, mobile: null, phone: null, email: null }); // not recorded
    expect((await h.call(M, "GET", "/api/cases")).body.total).toBe(101);
  });

  it("accepts an existing person and rejects unknown people or empty input", async () => {
    const person = (await h.call(M, "GET", "/api/cases/GS-2001/overview")).body.person.id;
    const ok = await h.call(M, "POST", "/api/cases", { personId: person });
    expect(ok.status).toBe(201);
    expect(ok.body.case.personId).toBe(person);
    expect((await h.call(M, "POST", "/api/cases", { personId: "demo-person-999" })).status).toBe(422);
    expect((await h.call(M, "POST", "/api/cases", { displayName: "", suburb: "" })).status).toBe(422);
    expect((await h.call(M, "POST", "/api/cases", {})).status).toBe(422);
  });
});

describe("undo", () => {
  async function assignOne() {
    const c = (await allCases(h)).find((x) => x.workflow.assignedToUserId === null)!;
    const r = await h.call(M, "POST", "/api/cases/bulk/assignment", { assigneeUserId: "staff-maya", items: [{ caseId: c.id, expectedVersion: c.version }] });
    return { c, actionId: r.body.actionId as string, version: r.body.updated[0].version as number };
  }

  it("restores the previous assignment and bumps the version", async () => {
    const { c, actionId, version } = await assignOne();
    const u = await h.call(M, "POST", `/api/workflow-actions/${actionId}/undo`);
    expect(u.status).toBe(200);
    expect(u.body.updated[0].workflow.assignedToUserId).toBeNull();
    expect(u.body.updated[0].version).toBe(version + 1);
    expect(c.id).toBe(u.body.updated[0].id);
  });

  it("cannot be undone twice or undo an undo", async () => {
    const { actionId } = await assignOne();
    const u = await h.call(M, "POST", `/api/workflow-actions/${actionId}/undo`);
    expect((await h.call(M, "POST", `/api/workflow-actions/${actionId}/undo`)).body.error.code).toBe("undo_conflict");
    expect((await h.call(M, "POST", `/api/workflow-actions/${u.body.actionId}/undo`)).body.error.code).toBe("undo_conflict");
  });

  it("refuses when a newer edit exists, changing nothing", async () => {
    const { c, actionId, version } = await assignOne();
    await h.call(M, "PATCH", `/api/cases/${c.id}/status`, { status: "waiting", expectedVersion: version });
    const u = await h.call(M, "POST", `/api/workflow-actions/${actionId}/undo`);
    expect(u.status).toBe(409);
    expect(u.body.error).toMatchObject({ code: "undo_conflict", details: [expect.objectContaining({ caseId: c.id })] });
    expect((await h.call(M, "GET", `/api/cases/${c.id}/overview`)).body.case.workflow.assignedToUserId).toBe("staff-maya");
  });

  it("is all-or-nothing for a bulk action", async () => {
    const cases = (await allCases(h)).filter((x) => x.workflow.assignedToUserId === null).slice(0, 2);
    const r = await h.call(M, "POST", "/api/cases/bulk/assignment", { assigneeUserId: "staff-james", items: cases.map((c) => ({ caseId: c.id, expectedVersion: c.version })) });
    await h.call(M, "PATCH", `/api/cases/${cases[1]!.id}/status`, { status: "waiting", expectedVersion: r.body.updated[1].version });
    expect((await h.call(M, "POST", `/api/workflow-actions/${r.body.actionId}/undo`)).status).toBe(409);
    expect((await h.call(M, "GET", `/api/cases/${cases[0]!.id}/overview`)).body.case.workflow.assignedToUserId).toBe("staff-james");
  });

  it("expires after the window and respects who may undo", async () => {
    const own = (await allCases(h)).find((x) => x.workflow.assignedToUserId === "staff-alex" && x.workflow.status !== "waiting")!;
    const s = await h.call("staff-alex", "PATCH", `/api/cases/${own.id}/status`, { status: "waiting", expectedVersion: own.version });
    expect((await h.call("staff-sarah", "POST", `/api/workflow-actions/${s.body.actionId}/undo`)).status).toBe(403);
    h.clock.advance(11 * 60 * 1000);
    const late = await h.call("staff-alex", "POST", `/api/workflow-actions/${s.body.actionId}/undo`);
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/window/);
    expect((await h.call(M, "POST", "/api/workflow-actions/act-missing/undo")).status).toBe(404);
  });

  it("lets a worker undo their own recent status change", async () => {
    const own = (await allCases(h)).find((x) => x.workflow.assignedToUserId === "staff-alex" && x.workflow.status !== "waiting")!;
    const s = await h.call("staff-alex", "PATCH", `/api/cases/${own.id}/status`, { status: "waiting", expectedVersion: own.version });
    const u = await h.call("staff-alex", "POST", `/api/workflow-actions/${s.body.actionId}/undo`);
    expect(u.body.updated[0].workflow.status).toBe(own.workflow.status);
  });
});
