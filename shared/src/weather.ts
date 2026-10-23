// Weather signals from Bureau of Meteorology forecasts and warnings, matched to each customer's postcode.
// The api fetches the Bureau's data into a WeatherSnapshot; this file only reads it, so it works anywhere.

export interface WeatherDay { date: string; max: number | null; min: number | null; precis: string }
export interface FireDangerDay { date: string; rating: string; area: string }
export interface WeatherWarning { id: string; title: string; districts: string[]; expires: string | null }

export interface WeatherSnapshot {
  /** When the app fetched it, and when the Bureau issued the town forecast. */
  fetchedAt: string;
  issuedAt: string | null;
  /** True when this is the built-in sample, not the Bureau's live data. */
  demo: boolean;
  /** Forecast towns by Bureau area code (WA_PT…), with their district (WA_PW…). */
  towns: Record<string, { name: string; district: string; days: WeatherDay[] }>;
  districts: Record<string, string>;
  /** The highest fire danger rating in each district for each day. */
  fireDanger: Record<string, FireDangerDay[]>;
  warnings: WeatherWarning[];
}

export interface WeatherSignal { id: string; name: string; evidence: string }

export const WEATHER_SIGNAL_IDS = ["wx_extreme_heat", "wx_fire_danger", "wx_warning"];
export const WEATHER_SIGNAL_NAMES: Record<string, string> = {
  wx_extreme_heat: "Extreme heat forecast",
  wx_fire_danger: "Extreme fire danger forecast",
  wx_warning: "Weather warning for the area",
};

/**
 * Each postcode in the dataset and its nearest Bureau forecast town. Perth suburbs use the closest metro
 * forecast point. Postcodes not listed get no weather signals.
 */
export const POSTCODE_TOWN: Record<string, string> = {
  // Perth (WA_PT053)
  ...Object.fromEntries(["6000", "6004", "6008", "6009", "6010", "6021", "6050", "6054", "6061", "6062", "6064", "6100", "6107", "6108", "6109", "6151", "6152", "6155"].map((p) => [p, "WA_PT053"])),
  "6011": "WA_PT060", // Cottesloe: Swanbourne
  "6018": "WA_PT058", // Innaloo: Scarborough
  ...Object.fromEntries(["6023", "6025", "6027", "6030", "6065"].map((p) => [p, "WA_PT030"])), // Joondalup
  "6056": "WA_PT044", // Midland
  "6069": "WA_PT252", // Ellenbrook
  ...Object.fromEntries(["6110", "6111", "6112"].map((p) => [p, "WA_PT017"])), // Armadale
  ...Object.fromEntries(["6160", "6163", "6164"].map((p) => [p, "WA_PT028"])), // Fremantle
  ...Object.fromEntries(["6167", "6168", "6171"].map((p) => [p, "WA_PT055"])), // Rockingham
  "6210": "WA_PT012", // Mandurah
  "6225": "WA_PT020", // Collie
  "6230": "WA_PT003", // Bunbury
  "6258": "WA_PT040", // Manjimup
  "6280": "WA_PT004", // Busselton
  "6330": "WA_PT001", // Albany
  "6401": "WA_PT050", // Northam
  "6430": "WA_PT009", // Kalgoorlie
  "6530": "WA_PT008", // Geraldton
  "6701": "WA_PT005", // Carnarvon
  "6714": "WA_PT010", // Karratha
  "6718": "WA_PT056", // Roebourne
  "6722": "WA_PT015", // South Hedland: Port Hedland
  "6725": "WA_PT002", // Broome
  "6728": "WA_PT025", // Derby
  "6743": "WA_PT011", // Kununurra
  "6765": "WA_PT027", // Fitzroy Crossing
  "6770": "WA_PT029", // Halls Creek
};

/** Hottest forecast maximum that counts as extreme heat: higher in the north, where 40°C is routine. */
export const HEAT_THRESHOLD = { south: 38, north: 42 };
/** Fire danger ratings, lowest first. Extreme and Catastrophic raise the signal. */
export const FIRE_RATINGS = ["No Rating", "Moderate", "High", "Extreme", "Catastrophic"];
/** Warnings that matter for energy hardship; marine and sheep graziers warnings are left out. */
const RELEVANT_WARNING = /heatwave|heat|severe weather|severe thunderstorm|fire weather|bushfire|cyclone|flood|damaging wind/i;
const IRRELEVANT_WARNING = /marine|sheep|coastal waters|ocean|surf|hazardous surf/i;

export const isRelevantWarning = (title: string) => RELEVANT_WARNING.test(title) && !IRRELEVANT_WARNING.test(title);

/** The weather signals for one customer, looking ahead from `today` (YYYY-MM-DD, Perth). */
export function detectWeatherSignals(postcode: string | null | undefined, northOf26th: boolean, w: WeatherSnapshot | null, today: string): WeatherSignal[] {
  if (!w || !postcode) return [];
  const townId = POSTCODE_TOWN[postcode];
  const town = townId ? w.towns[townId] : undefined;
  if (!town) return [];
  const district = town.district;
  const districtName = w.districts[district] ?? district;
  const sample = w.demo ? " (sample forecast)" : "";
  const out: WeatherSignal[] = [];

  const limit = northOf26th ? HEAT_THRESHOLD.north : HEAT_THRESHOLD.south;
  const hot = town.days.filter((d) => d.date >= today && d.max !== null && d.max >= limit);
  if (hot.length) {
    const peak = hot.reduce((a, b) => (b.max! > a.max! ? b : a));
    out.push({
      id: "wx_extreme_heat", name: WEATHER_SIGNAL_NAMES.wx_extreme_heat!,
      evidence: `Forecast ${peak.max}°C at ${town.name} on ${peak.date}${hot.length > 1 ? `; ${hot.length} days at ${limit}°C or more in the next week` : ""}${sample}`,
    });
  }

  const fire = (w.fireDanger[district] ?? []).filter((d) => d.date >= today && FIRE_RATINGS.indexOf(d.rating) >= FIRE_RATINGS.indexOf("Extreme"));
  if (fire.length) {
    const worst = fire.reduce((a, b) => (FIRE_RATINGS.indexOf(b.rating) > FIRE_RATINGS.indexOf(a.rating) ? b : a));
    out.push({ id: "wx_fire_danger", name: WEATHER_SIGNAL_NAMES.wx_fire_danger!, evidence: `${worst.rating} fire danger in ${worst.area} (${districtName}) on ${worst.date}${sample}` });
  }

  const warning = w.warnings.find((x) => x.districts.includes(district) && isRelevantWarning(x.title));
  if (warning) {
    out.push({ id: "wx_warning", name: WEATHER_SIGNAL_NAMES.wx_warning!, evidence: `${warning.title} (${districtName})${warning.expires ? `, until ${warning.expires.slice(0, 10)}` : ""}${sample}` });
  }
  return out;
}

/** A sample snapshot for demos: a heatwave in the Perth and South West districts over the next few days. */
export function sampleWeather(today: string, now = new Date()): WeatherSnapshot {
  const day = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const hotDistricts = new Set(["WA_PW009", "WA_PW010", "WA_PW014"]);
  const towns: WeatherSnapshot["towns"] = {};
  for (const id of new Set(Object.values(POSTCODE_TOWN))) {
    const district = TOWN_DISTRICT[id] ?? "WA_PW009";
    const north = district === "WA_PW001" || district === "WA_PW002";
    towns[id] = {
      name: TOWN_NAME[id] ?? id, district,
      days: Array.from({ length: 7 }, (_, n) => {
        const heat = hotDistricts.has(district) && n >= 1 && n <= 3 ? [39, 41, 40][n - 1]! : north ? 37 : 27;
        return { date: day(n), max: heat, min: heat - 14, precis: heat >= 38 ? "Hot and sunny." : "Mostly sunny." };
      }),
    };
  }
  const fireDanger: WeatherSnapshot["fireDanger"] = {};
  for (const d of hotDistricts) fireDanger[d] = [0, 1, 2, 3].map((n) => ({ date: day(n), rating: n === 2 ? "Extreme" : "High", area: d === "WA_PW009" ? "Swan Coastal Plain" : DISTRICTS[d]! }));
  return {
    fetchedAt: now.toISOString(), issuedAt: now.toISOString(), demo: true, towns, districts: DISTRICTS, fireDanger,
    warnings: [{ id: "SAMPLE", title: "Severe Heatwave Warning for Lower West, South West and Central Wheat Belt", districts: [...hotDistricts], expires: `${day(4)}T00:00:00Z` }],
  };
}

const DISTRICTS: Record<string, string> = {
  WA_PW001: "Kimberley", WA_PW002: "Pilbara", WA_PW003: "Gascoyne", WA_PW004: "Goldfields", WA_PW005: "Eucla", WA_PW006: "North Interior",
  WA_PW007: "South Interior", WA_PW008: "Central West", WA_PW009: "Lower West", WA_PW010: "South West", WA_PW011: "South Coastal",
  WA_PW012: "South East Coastal", WA_PW013: "Great Southern", WA_PW014: "Central Wheat Belt",
};
const TOWN_NAME: Record<string, string> = {
  WA_PT053: "Perth", WA_PT060: "Swanbourne", WA_PT058: "Scarborough", WA_PT030: "Joondalup", WA_PT044: "Midland", WA_PT252: "Ellenbrook", WA_PT017: "Armadale",
  WA_PT028: "Fremantle", WA_PT055: "Rockingham", WA_PT012: "Mandurah", WA_PT020: "Collie", WA_PT003: "Bunbury", WA_PT040: "Manjimup", WA_PT004: "Busselton",
  WA_PT001: "Albany", WA_PT050: "Northam", WA_PT009: "Kalgoorlie", WA_PT008: "Geraldton", WA_PT005: "Carnarvon", WA_PT010: "Karratha", WA_PT056: "Roebourne",
  WA_PT015: "Port Hedland", WA_PT002: "Broome", WA_PT025: "Derby", WA_PT011: "Kununurra", WA_PT027: "Fitzroy Crossing", WA_PT029: "Halls Creek MO",
};
const TOWN_DISTRICT: Record<string, string> = {
  WA_PT053: "WA_PW009", WA_PT060: "WA_PW009", WA_PT058: "WA_PW009", WA_PT030: "WA_PW009", WA_PT044: "WA_PW009", WA_PT252: "WA_PW009", WA_PT017: "WA_PW009",
  WA_PT028: "WA_PW009", WA_PT055: "WA_PW009", WA_PT012: "WA_PW009", WA_PT020: "WA_PW010", WA_PT003: "WA_PW010", WA_PT040: "WA_PW010", WA_PT004: "WA_PW010",
  WA_PT001: "WA_PW011", WA_PT050: "WA_PW014", WA_PT009: "WA_PW004", WA_PT008: "WA_PW008", WA_PT005: "WA_PW003", WA_PT010: "WA_PW002", WA_PT056: "WA_PW002",
  WA_PT015: "WA_PW002", WA_PT002: "WA_PW001", WA_PT025: "WA_PW001", WA_PT011: "WA_PW001", WA_PT027: "WA_PW001", WA_PT029: "WA_PW001",
};
