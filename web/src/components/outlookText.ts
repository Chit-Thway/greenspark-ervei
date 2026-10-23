// Wording and colours for the weather outlook page.
import type { HazardKind } from "../data/api";

export const HAZARD_LABEL: Record<HazardKind, string> = { heat: "Extreme heat", hot: "Hot day", fire: "Fire danger", warning: "Warning" };
export const HAZARD_ICON: Record<HazardKind, string> = { heat: "🌡️", hot: "☀️", fire: "🔥", warning: "⚠️" };
export const GROUP_LABEL = { health: "Health", supply: "Supply could stop", cost: "Can't afford cooling", isolation: "Isolated" } as const;

/** Colour for a hazard severity: 0 none, 1 hot day, 3 dangerous, 4 severe. */
export function hazardColor(severity: number): string {
  return severity >= 4 ? "#ae2e24" : severity >= 3 ? "#e2683c" : severity >= 1 ? "#e0a030" : "#7a9cc6";
}

/** Background and text colour for a forecast maximum, cool blue to deep red. */
export function tempColor(max: number | null): { background: string; color: string } {
  if (max === null) return { background: "#f1f2f4", color: "#5e6c84" };
  const steps: [number, string, string][] = [[41, "#ae2e24", "#fff"], [38, "#e2683c", "#fff"], [35, "#f29d52", "#3d1d00"], [32, "#f8c88a", "#3d2400"], [28, "#fbe6c2", "#3d2a00"], [22, "#eef3f0", "#253858"]];
  const s = steps.find(([t]) => max >= t);
  return s ? { background: s[1], color: s[2] } : { background: "#e9f2ff", color: "#2458a6" };
}

export const dayName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" });
export const dayDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
