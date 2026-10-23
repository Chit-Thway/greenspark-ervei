// Fetches Bureau of Meteorology forecasts and warnings for WA into a WeatherSnapshot, refreshed every hour.
//   IDW14199: 7-day town forecasts (max and min temperatures) for 116 WA towns, each with its district.
//   IDW13010: district forecasts; fire danger ratings are usually given for one day (tomorrow) only.
//   IDW2xxxx: warnings, which only exist while active. They are found by listing the Bureau's anonymous FTP
//             folder (there is no list over HTTPS), then each is fetched over HTTPS like the forecasts.
// If the Bureau can't be reached, the last good snapshot is kept, and with none the weather signals stay off.
import { connect, type Socket } from "node:net";
import { sampleWeather, type FireDangerDay, type WeatherSnapshot, type WeatherWarning } from "@greenspark/shared";

const BASE = "https://www.bom.gov.au/fwo/";
const FTP_HOST = "ftp.bom.gov.au";
const FTP_DIR = "/anon/gen/fwo/";
const USER_AGENT = "greenspark-ervei-demo/1.0 (community support workspace)";
const REFRESH_MS = 60 * 60 * 1000;

export type WeatherMode = "live" | "demo" | "off";

// Made once: building a date formatter is slow, and this runs for every case on every queue request.
const PERTH_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth" });
const perthDay = (iso: string) => PERTH_DAY.format(new Date(iso));
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? "";

async function getText(file: string): Promise<string> {
  const res = await fetch(BASE + file, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

/** Town forecasts: each town's days with max and min temperature. */
export function parseTownForecasts(xml: string): Pick<WeatherSnapshot, "towns" | "districts" | "issuedAt"> {
  const towns: WeatherSnapshot["towns"] = {};
  const districts: Record<string, string> = {};
  for (const m of xml.matchAll(/<area ([^>]*type="public-district"[^>]*)\/?>/g)) districts[attr(m[1]!, "aac")] = attr(m[1]!, "description");
  for (const m of xml.matchAll(/<area ([^>]*type="location"[^>]*)>([\s\S]*?)<\/area>/g)) {
    const days = [...m[2]!.matchAll(/<forecast-period [^>]*start-time-local="([^"]+)"[^>]*>([\s\S]*?)<\/forecast-period>/g)].map((p) => {
      const num = (type: string) => { const v = new RegExp(`type="${type}"[^>]*>(-?\\d+)<`).exec(p[2]!)?.[1]; return v === undefined ? null : Number(v); };
      return { date: p[1]!.slice(0, 10), max: num("air_temperature_maximum"), min: num("air_temperature_minimum"), precis: /type="precis">([^<]*)</.exec(p[2]!)?.[1] ?? "" };
    });
    towns[attr(m[1]!, "aac")] = { name: attr(m[1]!, "description"), district: attr(m[1]!, "parent-aac"), days };
  }
  const issued = /<issue-time-utc>([^<]+)</.exec(xml)?.[1] ?? null;
  return { towns, districts, issuedAt: issued };
}

const RATINGS = ["No Rating", "Moderate", "High", "Extreme", "Catastrophic"];

/** District forecasts: the highest fire danger rating in each district for each day, and the fire area it is in. */
export function parseFireDanger(xml: string): Record<string, FireDangerDay[]> {
  const out: Record<string, FireDangerDay[]> = {};
  for (const m of xml.matchAll(/<area ([^>]*type="public-district"[^>]*)>([\s\S]*?)<\/area>/g)) {
    const days: FireDangerDay[] = [];
    for (const p of m[2]!.matchAll(/<forecast-period [^>]*start-time-local="([^"]+)"[^>]*>([\s\S]*?)<\/forecast-period>/g)) {
      const block = /type="fire_danger">([\s\S]*?)<\/text>/.exec(p[2]!)?.[1];
      if (!block) continue;
      let best: FireDangerDay | null = null;
      for (const r of block.matchAll(/(?:<p>)?\s*([^<:]+):\s*([A-Za-z ]+?)\s*(?:<\/p>|$)/g)) {
        const rating = RATINGS.find((x) => x.toLowerCase() === r[2]!.trim().toLowerCase());
        if (rating && (!best || RATINGS.indexOf(rating) > RATINGS.indexOf(best.rating))) best = { date: p[1]!.slice(0, 10), rating, area: r[1]!.trim() };
      }
      if (best) days.push(best);
    }
    out[attr(m[1]!, "aac")] = days;
  }
  return out;
}

/** One warning: its title, the districts it covers now (not cancelled ones) and when it expires. */
export function parseWarning(id: string, xml: string): WeatherWarning | null {
  if (!/<product-type>W<\/product-type>/.test(xml)) return null;
  const title = /type="warning_title">([^<]*)</.exec(xml)?.[1]?.trim();
  if (!title) return null;
  const districts = [...xml.matchAll(/<area ([^>]*type="public-district"[^>]*)\/?>/g)].map((m) => m[1]!).filter((a) => attr(a, "phase") !== "CAN").map((a) => attr(a, "aac"));
  return { id, title, districts: [...new Set(districts)], expires: /<expiry-time>([^<]+)</.exec(xml)?.[1] ?? null };
}

/** Lists the anonymous FTP folder (passive mode, no library needed) and returns the file names. */
function ftpList(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const control = connect(21, FTP_HOST);
    let buffer = "";
    let listing = "";
    let step = 0;
    const timer = setTimeout(() => fail(new Error("FTP timed out")), 30_000);
    const done = (v: string[]) => { clearTimeout(timer); control.end(); resolve(v); };
    function fail(e: Error) { clearTimeout(timer); control.destroy(); reject(e); }
    control.setEncoding("utf8");
    control.on("error", fail);
    control.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\r\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        const code = Number(line.slice(0, 3));
        if (line[3] === "-" || !code) continue;
        if (code >= 400) return fail(new Error(`FTP: ${line}`));
        if (step === 0 && code === 220) { control.write("USER anonymous\r\n"); step = 1; }
        else if (step === 1 && (code === 331 || code === 230)) { if (code === 331) control.write("PASS guest\r\n"); step = 2; if (code === 230) control.write("PASV\r\n"), (step = 3); }
        else if (step === 2 && code === 230) { control.write("PASV\r\n"); step = 3; }
        else if (step === 3 && code === 227) {
          const n = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(line)!.slice(1).map(Number);
          const data: Socket = connect(n[4]! * 256 + n[5]!, n.slice(0, 4).join("."));
          data.setEncoding("utf8");
          data.on("data", (d: string) => { listing += d; });
          data.on("error", fail);
          data.on("close", () => { if (step === 5) done(parse()); else step = 4.5; });
          control.write(`NLST ${FTP_DIR}\r\n`);
          step = 4;
        } else if ((step === 4 || step === 4.5) && code === 226) { if (step === 4.5) done(parse()); else step = 5; }
      }
    });
    const parse = () => listing.split(/\r?\n/).map((l) => l.trim().split("/").pop()!).filter(Boolean);
  });
}

async function fetchLive(now: Date): Promise<WeatherSnapshot> {
  const [town, district, files] = await Promise.all([getText("IDW14199.xml"), getText("IDW13010.xml"), ftpList().catch(() => [] as string[])]);
  const ids = [...new Set(files.filter((f) => /^IDW2\d+\.xml$/.test(f)).map((f) => f.replace(".xml", "")))];
  const warnings = (await Promise.all(ids.map(async (id) => parseWarning(id, await getText(`${id}.xml`).catch(() => ""))))).filter((w): w is WeatherWarning => !!w);
  return { ...parseTownForecasts(town), fireDanger: parseFireDanger(district), warnings, fetchedAt: now.toISOString(), demo: false };
}

export class WeatherService {
  private snapshot: WeatherSnapshot | null = null;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private modeNow: WeatherMode, private readonly clock: () => Date = () => new Date()) {}

  get mode(): WeatherMode { return this.modeNow; }

  /** Loads the first snapshot and refreshes it every hour. */
  start(): void {
    if (this.modeNow === "off") return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Switches between the sample, the Bureau's live data and off. Resolves once the new forecast is loaded. */
  async setMode(mode: WeatherMode): Promise<void> {
    this.stop();
    this.modeNow = mode;
    this.snapshot = null;
    this.lastError = null;
    if (mode === "off") return;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  async refresh(): Promise<void> {
    const now = this.clock();
    const mode = this.modeNow;
    if (mode === "off") return;
    if (mode === "demo") { this.snapshot = sampleWeather(perthDay(now.toISOString()), now); return; }
    try {
      const live = await fetchLive(now);
      if (this.modeNow !== mode) return; // switched while fetching
      this.snapshot = live;
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.warn(`Weather refresh failed, keeping the last forecast: ${this.lastError}`);
    }
  }

  current(): WeatherSnapshot | null {
    if (this.mode === "demo" && this.snapshot && perthDay(this.snapshot.fetchedAt) !== perthDay(this.clock().toISOString())) void this.refresh();
    return this.snapshot;
  }

  status() {
    const s = this.snapshot;
    return { mode: this.mode, fetchedAt: s?.fetchedAt ?? null, issuedAt: s?.issuedAt ?? null, towns: s ? Object.keys(s.towns).length : 0, warnings: s?.warnings.map((w) => w.title) ?? [], error: this.lastError };
  }
}
