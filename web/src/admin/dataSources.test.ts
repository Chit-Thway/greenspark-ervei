import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { signalHasData, type FlowDoc } from "@greenspark/shared";
import { DATA_SOURCE_GROUPS } from "./dataSources";

const doc = JSON.parse(readFileSync(new URL("../../../data/admin/utility_hardship_mapping.json", import.meta.url), "utf8")) as FlowDoc;
const sources = DATA_SOURCE_GROUPS.flatMap((g) => g.items);

describe("data sources", () => {
  it("only points at signals in the flowchart", () => {
    const ids = new Set(doc.signals.map((s) => s.id));
    for (const d of sources) for (const id of d.signals) expect(ids.has(id), `${d.id} -> ${id}`).toBe(true);
  });

  it("gives every signal the app has data for at least one source, and none to signals without data", () => {
    const fed = new Set(sources.flatMap((d) => d.signals));
    for (const s of doc.signals) expect(fed.has(s.id), s.id).toBe(signalHasData(s));
  });
});
