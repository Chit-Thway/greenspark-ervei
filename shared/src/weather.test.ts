import { describe, expect, it } from "vitest";
import { detectWeatherSignals, isRelevantWarning, POSTCODE_TOWN, sampleWeather, type WeatherSnapshot } from "./weather";

const today = "2026-10-23";
function snapshot(max: number | null, patch: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    fetchedAt: "2026-10-23T06:00:00Z", issuedAt: null, demo: false, districts: { WA_PW009: "Lower West", WA_PW001: "Kimberley" },
    towns: {
      WA_PT053: { name: "Perth", district: "WA_PW009", days: [{ date: "2026-10-22", max: 45, min: 20, precis: "" }, { date: "2026-10-25", max, min: 20, precis: "" }] },
      WA_PT002: { name: "Broome", district: "WA_PW001", days: [{ date: "2026-10-25", max: 40, min: 25, precis: "" }] },
    },
    fireDanger: {}, warnings: [], ...patch,
  };
}
const ids = (pc: string, w: WeatherSnapshot, north = false) => detectWeatherSignals(pc, north, w, today).map((s) => s.id);

describe("weather signals", () => {
  it("flags extreme heat from 38°C in the south and 42°C in the north, ignoring past days", () => {
    expect(ids("6000", snapshot(37))).toEqual([]); // the 45°C day was yesterday
    expect(ids("6000", snapshot(38))).toEqual(["wx_extreme_heat"]);
    expect(ids("6725", snapshot(38), true)).toEqual([]); // Broome at 40°C is below the northern threshold
  });

  it("flags Extreme or Catastrophic fire danger only", () => {
    const fire = (rating: string) => snapshot(25, { fireDanger: { WA_PW009: [{ date: "2026-10-24", rating, area: "Swan Coastal Plain" }] } });
    expect(ids("6000", fire("High"))).toEqual([]);
    expect(ids("6000", fire("Extreme"))).toEqual(["wx_fire_danger"]);
    expect(ids("6000", fire("Catastrophic"))).toEqual(["wx_fire_danger"]);
  });

  it("flags relevant warnings for the customer's district, not marine or graziers warnings", () => {
    const warn = (title: string, districts = ["WA_PW009"]) => snapshot(25, { warnings: [{ id: "X", title, districts, expires: null }] });
    expect(ids("6000", warn("Severe Heatwave Warning for Lower West"))).toEqual(["wx_warning"]);
    expect(ids("6000", warn("Warning to Sheep Graziers"))).toEqual([]);
    expect(ids("6000", warn("Severe Weather Warning", ["WA_PW010"]))).toEqual([]);
    expect(isRelevantWarning("Marine Wind Warning Summary for Western Australia")).toBe(false);
  });

  it("raises nothing without a forecast, a postcode or a known postcode", () => {
    expect(detectWeatherSignals("6000", false, null, today)).toEqual([]);
    expect(detectWeatherSignals(null, false, snapshot(40), today)).toEqual([]);
    expect(detectWeatherSignals("9999", false, snapshot(40), today)).toEqual([]);
  });

  it("maps every postcode to a forecast town, and the sample heatwave reaches Perth", () => {
    for (const town of Object.values(POSTCODE_TOWN)) expect(town).toMatch(/^WA_PT\d{3}$/);
    expect(ids("6064", sampleWeather(today))).toEqual(["wx_extreme_heat", "wx_fire_danger", "wx_warning"]);
    expect(detectWeatherSignals("6064", false, sampleWeather(today), today)[0]!.evidence).toContain("sample forecast");
  });
});
