import { describe, expect, it } from "vitest";
import type { ModelAdapter } from "../src/adapters";
import { start, TestClock } from "./helpers";

const M = "staff-manager";

describe("model adapter boundary", () => {
  it("uses the adapter for priority, filters and sorting", async () => {
    const calls: number[] = [];
    const adapter: ModelAdapter = {
      async getAssessments(ids) {
        calls.push(ids.length);
        return Object.fromEntries(ids.map((id) => [id, { provider: "test_model", isSimulated: false, status: "ready" as const, assessedAt: null, priority: { score: id === "GS-2001" ? 99 : 10, label: id === "GS-2001" ? ("urgent" as const) : ("routine" as const) }, trend: "stable" as const, explanation: "x" }]));
      },
    };
    const h = await start(":memory:", new TestClock(), { modelAdapter: adapter });
    const r = await h.call(M, "GET", "/api/cases?priorityLabels=urgent");
    expect(r.body.items.map((i: any) => i.case.id)).toEqual(["GS-2001"]);
    expect(r.body.items[0].case.modelAssessment.provider).toBe("test_model");
    expect(calls.length).toBeGreaterThan(0);
    await h.stop();
  });

  it("shows assessments as unavailable, not Routine, when the adapter fails", async () => {
    const h = await start(":memory:", new TestClock(), { modelAdapter: { getAssessments: async () => { throw new Error("model offline"); } } });
    const r = await h.call(M, "GET", "/api/cases?pageSize=100");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(100);
    for (const i of r.body.items) expect(i.case.modelAssessment).toMatchObject({ status: "unavailable", priority: null, trend: null });
    expect((await h.call(M, "GET", "/api/cases?priorityLabels=routine")).body.total).toBe(0);
    expect((await h.call(M, "GET", "/api/cases/GS-2001/overview")).body.case.modelAssessment.status).toBe("unavailable");
    await h.stop();
  });

  it("treats a missing result or a ready result without a score as unavailable", async () => {
    const adapter: ModelAdapter = {
      async getAssessments(ids) {
        return { [ids[0]!]: { provider: "t", isSimulated: false, status: "ready" as const, assessedAt: null, priority: null, trend: null, explanation: null } };
      },
    };
    const h = await start(":memory:", new TestClock(), { modelAdapter: adapter });
    const r = await h.call(M, "GET", "/api/cases?pageSize=100");
    expect(r.body.items.every((i: any) => i.case.modelAssessment.status === "unavailable" && i.case.modelAssessment.priority === null)).toBe(true);
    await h.stop();
  });

  it("keeps simulated seed assessments by default, including pending and unavailable", async () => {
    const h = await start();
    const r = await h.call(M, "GET", "/api/cases?pageSize=100");
    const by = (s: string) => r.body.items.filter((i: any) => i.case.modelAssessment.status === s).length;
    expect([by("ready"), by("pending"), by("unavailable")]).toEqual([90, 5, 5]);
    expect(r.body.items.every((i: any) => i.case.modelAssessment.isSimulated)).toBe(true);
    await h.stop();
  });

  it("applies the model adapter to mutation responses and exposes the profile template", async () => {
    const h = await start(":memory:", new TestClock(), { profileUrlTemplate: "https://profiles.example/people/{personId}" });
    expect((await h.call(M, "GET", "/api/catalogs")).body.profileUrlTemplate).toBe("https://profiles.example/people/{personId}");
    const c = (await h.call(M, "GET", "/api/cases/GS-2001/overview")).body.case;
    const r = await h.call(M, "POST", "/api/cases/bulk/assignment", { assigneeUserId: "staff-alex", items: [{ caseId: c.id, expectedVersion: c.version }] });
    expect(r.body.updated[0].modelAssessment.status).toBe("ready");
    await h.stop();
    const h2 = await start();
    expect((await h2.call(M, "GET", "/api/catalogs")).body.profileUrlTemplate).toBeNull();
    await h2.stop();
  });
});
