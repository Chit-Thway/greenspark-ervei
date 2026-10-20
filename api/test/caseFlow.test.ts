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
    const r = await (await withFlow()).call(M, "GET", "/api/cases?circumstanceIds=estimated_catchup&pageSize=100");
    expect(r.body.total).toBeGreaterThan(0);
    for (const i of r.body.items) expect(circumstanceIds(i.case)).toContain("estimated_catchup");
    expect(r.body.facets.circumstances.estimated_catchup).toBe(r.body.total);
  });

  it("keeps the fixture's survey rules when no flow file is configured", async () => {
    h = await start();
    expect((await h.call(M, "GET", "/api/catalogs")).body.circumstanceSource).toBe("fixture");
    const c = (await h.call(M, "GET", "/api/cases/GS-2001/overview")).body.case;
    expect(circumstanceIds(c)).toContain("bill_payment_difficulty");
  });
});
