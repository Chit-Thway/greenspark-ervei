// Emergency WA warnings (DFES), from its public CAP-AU feed: every current bushfire, flood, storm and other warning
// in WA, each with its alert level and the area it covers. Refreshed every 5 minutes; if the feed can't be reached,
// the last good list is kept.

const FEED = "https://api.emergency.wa.gov.au/v1/capau";
const USER_AGENT = "greenspark-ervei-demo/1.0 (community support workspace)";
const REFRESH_MS = 5 * 60 * 1000;

export interface EmergencyAlert {
  id: string; headline: string; event: string; category: string;
  /** Emergency WA's level, such as Bushfire Advice, Watch and Act or Emergency Warning. */
  alertLevel: string; severity: string; sent: string | null; areaDesc: string; web: string | null;
  /** Each area's outline as [lat, lng] points; some warnings only have a centre. */
  polygons: [number, number][][]; centre: [number, number] | null;
}

const text = (xml: string, tag: string) => new RegExp(`<cap:${tag}>([\\s\\S]*?)</cap:${tag}>`).exec(xml)?.[1]?.trim() ?? "";
const points = (s: string) => s.trim().split(/\s+/).map((p) => p.split(",").map(Number) as [number, number]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));

/** The alerts in a CAP-AU feed (an EDXL distribution of CAP 1.2 alerts). Cancelled alerts are left out. */
export function parseCapAu(xml: string): EmergencyAlert[] {
  const out: EmergencyAlert[] = [];
  for (const m of xml.matchAll(/<cap:alert>([\s\S]*?)<\/cap:alert>/g)) {
    const a = m[1]!;
    if (text(a, "msgType") === "Cancel") continue;
    const polygons = [...a.matchAll(/<cap:polygon>([^<]*)<\/cap:polygon>/g)].map((p) => points(p[1]!)).filter((p) => p.length >= 3);
    const circle = /<cap:circle>([^<]*)<\/cap:circle>/.exec(a)?.[1];
    const c = circle ? points(circle.split(" ")[0]!)[0] ?? null : null;
    const centre = c ?? (polygons[0] ? [polygons[0].reduce((n, p) => n + p[0], 0) / polygons[0].length, polygons[0].reduce((n, p) => n + p[1], 0) / polygons[0].length] as [number, number] : null);
    out.push({
      id: text(a, "identifier"), headline: text(a, "headline"), event: text(a, "event"), category: text(a, "category"),
      alertLevel: text(a, "alertLevel") || text(a, "event"), severity: text(a, "severity"), sent: text(a, "sent") || null,
      areaDesc: text(a, "areaDesc").replace(/\s+/g, " "), web: text(a, "web") || null, polygons, centre,
    });
  }
  return out;
}

export class EmergencyService {
  private alerts: EmergencyAlert[] | null = null;
  private fetchedAt: string | null = null;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async refresh(): Promise<void> {
    try {
      const res = await fetch(FEED, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.alerts = parseCapAu(await res.text());
      this.fetchedAt = this.clock().toISOString();
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.warn(`Emergency WA refresh failed, keeping the last warnings: ${this.lastError}`);
    }
  }

  current() {
    return { available: this.alerts !== null, fetchedAt: this.fetchedAt, error: this.lastError, alerts: this.alerts ?? [] };
  }
}
