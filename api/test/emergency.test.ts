import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCapAu } from "../src/emergency";

// A copy of the Emergency WA feed from 24 Oct 2026: ten bushfire advices and a park closure.
const xml = readFileSync(new URL("./fixtures/capau-sample.xml", import.meta.url), "utf8");

describe("Emergency WA feed", () => {
  it("reads each alert with its level, area and link", () => {
    const alerts = parseCapAu(xml);
    expect(alerts).toHaveLength(11);
    const telfer = alerts.find((a) => a.headline === "Bushfire Advice MONITOR CONDITIONS - TELFER")!;
    expect(telfer.alertLevel).toBe("Bushfire Advice");
    expect(telfer.event).toBe("Bushfire");
    expect(telfer.web).toMatch(/^https:\/\/emergency\.wa\.gov\.au\/warnings\//);
    expect(telfer.areaDesc).toContain("Kunawarritji Track");
    expect(telfer.polygons[0]![0]).toEqual([-21.9673613067456, 123.2172041606022]);
    expect(telfer.centre![0]).toBeCloseTo(-22.13, 2);
  });

  it("gives every alert a centre, even without an outline, and leaves out cancelled ones", () => {
    const alerts = parseCapAu(xml);
    expect(alerts.every((a) => a.centre)).toBe(true);
    expect(alerts.some((a) => a.polygons.length === 0)).toBe(true);
    expect(parseCapAu(xml.replace(/<cap:msgType>Alert<\/cap:msgType>/g, "<cap:msgType>Cancel</cap:msgType>"))).toEqual([]);
  });
});
