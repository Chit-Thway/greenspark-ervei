import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allCases, start, TestClock, type Harness } from "./helpers";

const SOURCE = new URL("../../data/admin/utility_hardship_mapping.json", import.meta.url);
const M = "staff-manager";
let dir: string | null = null;
let h: Harness | null = null;

async function withFlow() {
  dir = mkdtempSync(join(tmpdir(), "gs-caseflow-"));
  const file = join(dir, "flow.json");
  copyFileSync(SOURCE, file);
  h = await start(":memory:", new TestClock(), { flowFile: file });
  return h;
}
afterEach(async () => {
  await h?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
  h = null; dir = null;
});

const circumstanceIds = (c: { circumstances: { circumstanceId: string }[] }) => c.circumstances.map((x) => x.circumstanceId);

describe("cases worked out from the Admin flow", () => {
  it("serves the flow's categories, circumstances and solutions as the catalogs", async () => {
    const r = await (await withFlow()).call(M, "GET", "/api/catalogs");
    expect(r.body.circumstanceSource).toBe("flow");
    expect(r.body.circumstances.some((c: { id: string }) => c.id === "hardship_not_offered")).toBe(true);
    // Water- and telco-only entries don't apply to electricity accounts.
    expect(r.body.circumstances.some((c: { id: string }) => c.id === "hidden_leak")).toBe(false);
    expect(r.body.recommendations.find((s: { id: string }) => s.id === "payment_extension").provider).toBeTruthy();
  });

  it("flags circumstances from account signals, with the signals and solutions that explain them", async () => {
    const r = await (await withFlow()).call(M, "GET", "/api/cases/GS-2001/overview");
    const c = r.body.case;
    const x = c.circumstances.find((y: { circumstanceId: string }) => y.circumstanceId === "hardship_not_offered");
    expect(x.signals.find((s: { id: string }) => s.id === "acct_no_hardship_offer")).toMatchObject({ source: "account", strength: "strong" });
    expect(c.recommendations.length).toBeGreaterThan(0);
    for (const rec of c.recommendations) for (const id of rec.circumstanceIds) expect(circumstanceIds(c)).toContain(id);
  });

  it("changes what cases show as soon as the flow is edited", async () => {
    const harness = await withFlow();
    const before = await allCases(harness);
    const flagged = before.filter((c) => circumstanceIds(c).includes("hardship_not_offered")).length;
    expect(flagged).toBeGreaterThan(0);
    const edit = await harness.call(M, "POST", "/api/admin/flow/ops", { ops: [{ type: "removeSignalLink", signalId: "acct_no_hardship_offer", circumstanceId: "hardship_not_offered" }] });
    expect(edit.status).toBe(200);
    const after = await allCases(harness);
    // Arrears growing is only supporting for this circumstance, so on its own it no longer flags it.
    expect(after.filter((c) => circumstanceIds(c).includes("hardship_not_offered")).length).toBeLessThan(flagged);
    const one = await harness.call(M, "GET", "/api/cases/GS-2001/overview");
    expect(circumstanceIds(one.body.case)).not.toContain("hardship_not_offered");
  });

  it("filters the queue by flow circumstances", async () => {
    const r = await (await withFlow()).call(M, "GET", "/api/cases?circumstanceIds=prepay_self_disconnection&pageSize=100");
    expect(r.body.total).toBeGreaterThan(0);
    for (const i of r.body.items) expect(circumstanceIds(i.case)).toContain("prepay_self_disconnection");
    expect(r.body.facets.circumstances.prepay_self_disconnection).toBe(r.body.total);
  });

  it("keeps the fixture's survey rules when no flow file is configured", async () => {
    h = await start();
    expect((await h.call(M, "GET", "/api/catalogs")).body.circumstanceSource).toBe("fixture");
    const c = (await h.call(M, "GET", "/api/cases/GS-2001/overview")).body.case;
    expect(circumstanceIds(c)).toContain("bill_payment_difficulty");
  });
});

describe("priority from the flowchart signals", () => {
  it("replaces the fixture's invented assessments when the flowchart is in use", async () => {
    const harness = await withFlow();
    const cases = await allCases(harness);
    expect(cases.every((c) => c.modelAssessment.provider === "flowchart_signals" && c.modelAssessment.isSimulated === false)).toBe(true);
    const clean = (await harness.call(M, "GET", "/api/accounts/DEMO-700008")).body.case; // no_flagged_circumstances scenario
    expect(clean.circumstances).toEqual([]);
    expect(clean.modelAssessment.priority).toEqual({ score: 0, label: "routine" });
    const heavy = (await harness.call(M, "GET", "/api/accounts/DEMO-700005")).body.case; // multiple_support_areas scenario
    expect(heavy.modelAssessment.priority.label).toBe("urgent");
    // Sorting and the priority filter use the computed priority.
    const urgent = await harness.call(M, "GET", "/api/cases?priorityLabels=urgent&pageSize=100");
    expect(urgent.body.items.every((i: any) => i.case.modelAssessment.priority.label === "urgent")).toBe(true);
  });

  it("still lets a real model adapter supply the priority", async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-caseflow-"));
    const file = join(dir, "flow.json");
    copyFileSync(SOURCE, file);
    const adapter = { getAssessments: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { provider: "real_model", isSimulated: false, status: "ready" as const, priority: { score: 42, label: "moderate" as const }, trend: null, explanation: null }])) };
    h = await start(":memory:", new TestClock(), { flowFile: file, modelAdapter: adapter });
    const c = (await h.call(M, "GET", "/api/cases/GS-2001/overview")).body.case;
    expect(c.modelAssessment).toMatchObject({ provider: "real_model", priority: { score: 42 } });
    expect(c.circumstances.length).toBeGreaterThan(0); // circumstances still come from the flowchart
  });
});
