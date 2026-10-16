import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURE_PATH } from "../src/config";
import { allCases, start } from "./helpers";

const hash = () => createHash("sha256").update(readFileSync(FIXTURE_PATH)).digest("hex");

describe("persistence and reset", () => {
  it("keeps workflow changes across restarts, never edits the fixture, and reseeds after reset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-"));
    const db = join(dir, "run", "demo.sqlite");
    const before = hash();
    try {
      let h = await start(db);
      const c = (await allCases(h)).find((x) => x.workflow.assignedToUserId === null)!;
      await h.call("staff-manager", "POST", "/api/cases/bulk/assignment", { assigneeUserId: "staff-alex", items: [{ caseId: c.id, expectedVersion: c.version }] });
      const a = (await allCases(h)).find((x) => x.workflow.assignedToUserId === "staff-alex" && x.workflow.notes !== undefined)!;
      await h.call("staff-alex", "POST", `/api/cases/${a.id}/notes`, { text: "Persisted note", expectedVersion: a.version });
      await h.call("staff-alex", "POST", "/api/cases", { displayName: "Persist Person", suburb: "Perth" });
      await h.stop();

      h = await start(db);
      const cases = await allCases(h);
      expect(cases).toHaveLength(101);
      expect(cases.find((x) => x.id === c.id)!.workflow.assignedToUserId).toBe("staff-alex");
      expect(cases.find((x) => x.id === a.id)!.workflow.notes.at(-1).text).toBe("Persisted note");
      await h.stop();

      // The reset command removes the database; the next start reseeds the original 100 cases.
      execFileSync("npx", ["tsx", "src/reset.ts"], { cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, GREENSPARK_DB: db }, stdio: "pipe" });
      expect(existsSync(db)).toBe(false);
      h = await start(db);
      const fresh = await allCases(h);
      expect(fresh).toHaveLength(100);
      expect(fresh.find((x) => x.id === c.id)!.workflow.assignedToUserId).toBeNull();
      await h.stop();
      expect(hash()).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
