// One-off: adds the Bureau of Meteorology weather signals to the flowchart file and links them to circumstances.
// Safe to run again: signals and links that already exist are left as they are, and other edits are kept.
// Usage: npx tsx scripts/add-weather-signals.mts [path]  (default: data/admin/utility_hardship_mapping.json;
// on Fly, the live copy is /data/utility_hardship_mapping.json)
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeDoc, type FlowDoc } from "../shared/src/flow";

const path = process.argv[2] ?? new URL("../data/admin/utility_hardship_mapping.json", import.meta.url);
const doc = JSON.parse(readFileSync(path, "utf8")) as FlowDoc;

const signals = [
  {
    id: "wx_extreme_heat", name: "Extreme heat forecast", source: "weather",
    detect: "Bureau of Meteorology forecast maximum of 38°C or more (42°C north of the 26th parallel) at the customer's nearest forecast town in the next 7 days.",
    example_rule: "max(forecast_max_7d) >= 38",
  },
  {
    id: "wx_fire_danger", name: "Extreme fire danger forecast", source: "weather",
    detect: "Bureau of Meteorology fire danger rating of Extreme or Catastrophic in the customer's forecast district (the free forecast usually rates tomorrow only).",
    example_rule: "fire_danger_next in (Extreme, Catastrophic)",
  },
  {
    id: "wx_warning", name: "Weather warning for the area", source: "weather",
    detect: "An active Bureau of Meteorology warning (heatwave, severe weather, fire weather, cyclone or flood) for the customer's forecast district.",
    example_rule: "active_warning(district)",
  },
];
const links: [signal: string, circumstance: string, strength: "strong" | "supporting"][] = [
  ["wx_extreme_heat", "heat_cold", "strong"],
  ["wx_extreme_heat", "temperature_medical", "supporting"],
  ["wx_extreme_heat", "life_support_equipment", "supporting"],
  ["wx_extreme_heat", "rationing", "supporting"],
  ["wx_extreme_heat", "prepay_self_disconnection", "supporting"],
  // A forecast is a risk, not an event: fire danger alone never flags a disaster (it needs a second signal,
  // such as the customer reporting one or outage history), and warnings never point to disaster or outages.
  ["wx_fire_danger", "disaster", "supporting"],
  ["wx_warning", "heat_cold", "supporting"],
];

for (const s of signals) {
  if (doc.signals.some((x) => x.id === s.id)) continue;
  doc.signals.push({ ...s, utilities: ["electricity", "gas", "water", "telco"], sensitive: false, points_to: [] });
}
for (const [signal, circumstance, strength] of links) {
  const c = doc.circumstances.find((x) => x.id === circumstance);
  if (!c) throw new Error(`No circumstance ${circumstance}`);
  if (!c.signals.some((l) => l.id === signal)) c.signals.push({ id: signal, strength });
}
normalizeDoc(doc);
writeFileSync(path, JSON.stringify(doc, null, 2), "utf8");
console.log(doc.meta.counts);
