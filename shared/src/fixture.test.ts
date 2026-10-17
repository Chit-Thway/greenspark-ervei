import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toDataset, type RawFixture } from "./fixture";

const data = toDataset(JSON.parse(readFileSync(new URL("../../data/synthetic/case-queue.v1.json", import.meta.url), "utf8")) as RawFixture);
const female = new Set(["Olivia", "Amelia", "Isla", "Mia", "Ava", "Sophie", "Zoe", "Grace", "Lily", "Ruby", "Chloe", "Ella"]);
const male = new Set(["Noah", "Ethan", "Leo", "Lucas", "Henry", "Finn", "Oscar", "Hugo"]);

describe("fictional gender values", () => {
  it("uses Female, Male, Non-binary and Prefer not to say only", () => {
    const counts = new Map<string, number>();
    for (const p of data.people) counts.set(p.gender ?? "none", (counts.get(p.gender ?? "none") ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(["Female", "Male", "Non-binary", "Prefer not to say"]);
    expect(counts.get("Non-binary")).toBeGreaterThan(0);
    expect(counts.get("Prefer not to say")).toBeGreaterThan(0);
    expect(counts.get("Female")! + counts.get("Male")!).toBeGreaterThan(80); // most follow the name
  });

  it("follows the invented first name for Female and Male", () => {
    for (const p of data.people) {
      const first = p.displayName.split(" ")[0]!;
      if (p.gender === "Female") expect(female.has(first), `${p.displayName}`).toBe(true);
      if (p.gender === "Male") expect(male.has(first), `${p.displayName}`).toBe(true);
    }
  });
});
