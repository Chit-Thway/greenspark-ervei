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
    const tiers = body.customers.map((c: any) => c.tier);
    expect(tiers.indexOf("watch") === -1 || tiers.lastIndexOf("act") < tiers.indexOf("watch")).toBe(true);
    const perth = body.towns.find((t: any) => t.name === "Perth");
    expect(perth.hazards.some((x: any) => x.kind === "heat")).toBe(true);
    expect(body.towns.find((t: any) => t.name === "Broome").act).toBe(0); // the sample heatwave is in the south
  });

  it("says when there is no forecast", async () => {
    h = await start();
    const { body } = await h.call("staff-manager", "GET", "/api/outlook");
    expect(body.available).toBe(false);
  });
});
