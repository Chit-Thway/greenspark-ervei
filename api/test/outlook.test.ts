import { afterEach, describe, expect, it } from "vitest";
import { sampleWeather } from "@greenspark/shared";
import { start, type Harness } from "./helpers";

let h: Harness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

describe("weather outlook", () => {
  it("lists the customers the sample heatwave puts at risk, act now first", async () => {
    const snapshot = sampleWeather("2026-10-16");
    h = await start(":memory:", undefined, { weather: { current: () => snapshot, status: () => ({ mode: "demo" }), setMode: async () => undefined } });
    const { status, body } = await h.call("staff-manager", "GET", "/api/outlook");
    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.days).toHaveLength(7);
    expect(body.totals.act).toBeGreaterThan(0);
    expect(body.customers.length).toBe(body.totals.act + body.totals.watch);
    // The funnel narrows at every stage.
    const t = body.totals;
    expect([t.covered + t.uncovered, t.covered, t.exposed, t.vulnerable, t.act + t.watch, t.act]).toEqual([...[t.covered + t.uncovered, t.covered, t.exposed, t.vulnerable, t.act + t.watch, t.act]].sort((a, b) => b - a));
    const tiers = body.customers.map((c: any) => c.tier);
    expect(tiers.indexOf("watch") === -1 || tiers.lastIndexOf("act") < tiers.indexOf("watch")).toBe(true);
    const perth = body.towns.find((t: any) => t.name === "Perth");
    expect(perth.hazards.some((x: any) => x.kind === "heat")).toBe(true);
    expect(body.towns.find((t: any) => t.name === "Broome").act).toBe(0); // the sample heatwave is in the south
  });

  it("is worked out once, and again when a case changes", async () => {
    const snapshot = sampleWeather("2026-10-16");
    h = await start(":memory:", undefined, { weather: { current: () => snapshot, status: () => ({ mode: "demo" }), setMode: async () => undefined } });
    const first = (await h.call("staff-manager", "GET", "/api/outlook")).body;
    expect((await h.call("staff-manager", "GET", "/api/outlook")).body).toEqual(first);
    const row = first.customers[0];
    const c = h.store.getCaseForPerson(row.personId)!;
    const next = c.workflow.status === "waiting" ? "in_progress" : "waiting";
    expect((await h.call("staff-manager", "POST", "/api/cases/bulk/status", { status: next, items: [{ caseId: c.id, expectedVersion: c.version }] })).status).toBe(200);
    const after = (await h.call("staff-manager", "GET", "/api/outlook")).body;
    expect(after.customers.find((x: any) => x.personId === row.personId).status).toBe(next);
  });

  it("says when there is no forecast", async () => {
    h = await start();
    const { body } = await h.call("staff-manager", "GET", "/api/outlook");
    expect(body.available).toBe(false);
  });

  it("provides every forecast-covered customer once for grouping, including daily attention and approximate locations", async () => {
    const snapshot = sampleWeather("2026-10-16");
    h = await start(":memory:", undefined, { weather: { current: () => snapshot, status: () => ({ mode: "demo" }), setMode: async () => undefined } });
    const { body } = await h.call("staff-manager", "GET", "/api/outlook");
    // Group planning covers only customers whose signals support a specific action.
    expect(body.groupCustomers.length + body.totals.unassigned).toBe(body.totals.covered);
    expect(new Set(body.groupCustomers.map((c: any) => c.personId)).size).toBe(body.groupCustomers.length);
    expect(body.groupCustomers.some((c: any) => c.tier === null)).toBe(true);
    for (const row of body.groupCustomers) {
      expect(["health", "disconnected", "supply", "bills", "coaching"]).toContain(row.group);
      expect(row.supportNeeds).toContain(row.group);
      expect(row.daily).toHaveLength(7);
      expect(row).not.toHaveProperty("account");
      if (row.location) expect(row.location).toHaveLength(2);
    }
    // The existing funnel and weekly priority list keep their contract.
    expect(body.customers).toHaveLength(body.totals.act + body.totals.watch);
  });
});
