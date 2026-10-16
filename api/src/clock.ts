export type Clock = () => Date;

/** ISO string in Australia/Perth wall time (UTC+8, no daylight saving), matching the fixture. */
export function perthIso(d: Date): string {
  return new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 19) + "+08:00";
}
