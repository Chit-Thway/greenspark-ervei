import { MAX_BULK_ITEMS } from "@greenspark/shared";

/** Add visible cases without exceeding the API's atomic-action limit. */
export function addSelection(current: ReadonlyMap<string, number>, items: { caseId: string; expectedVersion: number }[]) {
  const selected = new Map(current);
  let limited = false;
  for (const item of items) {
    if (!selected.has(item.caseId) && selected.size >= MAX_BULK_ITEMS) {
      limited = true;
      continue;
    }
    selected.set(item.caseId, item.expectedVersion);
  }
  return { selected, limited };
}
