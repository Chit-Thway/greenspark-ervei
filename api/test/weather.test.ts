import { describe, expect, it } from "vitest";
import { parseFireDanger, parseTownForecasts, parseWarning } from "../src/weather";

// Cut-down copies of the Bureau's XML, in the same shape as the real files.
const TOWNS = `<product><amoc><issue-time-utc>2026-10-23T05:00:00Z</issue-time-utc></amoc><forecast>
<area aac="WA_PW009" description="Lower West" type="public-district" parent-aac="WA_FA001"/>
<area aac="WA_PT053" description="Perth" type="location" parent-aac="WA_PW009">
  <forecast-period index="0" start-time-local="2026-10-23T13:00:00+08:00" end-time-local="2026-10-24T00:00:00+08:00"><text type="precis">Partly cloudy.</text></forecast-period>
  <forecast-period index="1" start-time-local="2026-10-24T00:00:00+08:00" end-time-local="2026-10-25T00:00:00+08:00">
    <element type="air_temperature_minimum" units="Celsius">7</element><element type="air_temperature_maximum" units="Celsius">39</element><text type="precis">Hot.</text>
  </forecast-period>
</area></forecast></product>`;

const DISTRICTS = `<product><forecast>
<area aac="WA_PW001" description="Kimberley" type="public-district" parent-aac="WA_FA001">
  <forecast-period index="1" start-time-local="2026-10-24T00:00:00+08:00"><text type="forecast">Hot.</text>
    <text type="fire_danger"><p>North Kimberley: Moderate</p><p>Dampier Derby Coast: Extreme</p></text></forecast-period>
</area></forecast></product>`;

const WARNING = `<product><amoc><expiry-time>2026-10-24T16:00:00Z</expiry-time><product-type>W</product-type></amoc>
<warning><warning-info><text type="warning_title">Severe Heatwave Warning</text></warning-info>
<area aac="WA_PW009" phase="NEW" description="Lower West" type="public-district"/>
<area aac="WA_PW010" phase="CAN" description="South West" type="public-district"/></warning></product>`;

describe("Bureau of Meteorology files", () => {
  it("reads town forecasts with their district and daily temperatures", () => {
    const t = parseTownForecasts(TOWNS);
    expect(t.issuedAt).toBe("2026-10-23T05:00:00Z");
    expect(t.districts).toEqual({ WA_PW009: "Lower West" });
    expect(t.towns.WA_PT053).toEqual({
      name: "Perth", district: "WA_PW009",
      days: [{ date: "2026-10-23", max: null, min: null, precis: "Partly cloudy." }, { date: "2026-10-24", max: 39, min: 7, precis: "Hot." }],
    });
  });

  it("keeps the highest fire danger rating in each district per day", () => {
    expect(parseFireDanger(DISTRICTS)).toEqual({ WA_PW001: [{ date: "2026-10-24", rating: "Extreme", area: "Dampier Derby Coast" }] });
  });

  it("reads a warning's title, its current districts (not cancelled ones) and expiry", () => {
    expect(parseWarning("IDW21033", WARNING)).toEqual({ id: "IDW21033", title: "Severe Heatwave Warning", districts: ["WA_PW009"], expires: "2026-10-24T16:00:00Z" });
    expect(parseWarning("IDW10100", "<product-type>F</product-type>")).toBeNull();
  });
});
