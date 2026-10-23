import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
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
      const c = (await allCases(h)).find((x) => x.workflow.assignedToUserId !== "staff-alex")!;
      await h.call("staff-manager", "POST", "/api/cases/bulk/assignment", { assigneeUserId: "staff-alex", items: [{ caseId: c.id, expectedVersion: c.version }] });
      const a = (await allCases(h)).find((x) => x.workflow.assignedToUserId === "staff-alex" && x.workflow.notes !== undefined)!;
      await h.call("staff-alex", "POST", `/api/cases/${a.id}/notes`, { text: "Persisted note", expectedVersion: a.version });
      await h.call("staff-alex", "POST", "/api/cases", { displayName: "Persist Person", suburb: "Perth" });
      await h.stop();

      h = await start(db);
      const cases = await allCases(h);
      expect(cases).toHaveLength(201);
      expect(cases.find((x) => x.id === c.id)!.workflow.assignedToUserId).toBe("staff-alex");
      expect(cases.find((x) => x.id === a.id)!.workflow.notes.at(-1).text).toBe("Persisted note");
      await h.stop();

      // The reset command removes the database; the next start reseeds the original 200 cases.
      execFileSync("npx", ["tsx", "src/reset.ts"], { cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, GREENSPARK_DB: db }, stdio: "pipe" });
      expect(existsSync(db)).toBe(false);
      h = await start(db);
      const fresh = await allCases(h);
      expect(fresh).toHaveLength(200);
      expect(fresh.find((x) => x.id === c.id)!.workflow.assignedToUserId).toBe(c.workflow.assignedToUserId);
      await h.stop();
      expect(hash()).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("databases from before notes could be edited", () => {
  it("gain the edit columns on start and keep working", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-old-"));
    const db = join(dir, "old.sqlite");
    try {
      const old = new DatabaseSync(db);
      old.exec("CREATE TABLE notes (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, case_id TEXT NOT NULL, author_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);");
      old.close();
      const h = await start(db);
      const cases = await allCases(h);
      const c = cases.find((x) => x.workflow.notes.length > 0 && x.workflow.assignedToUserId === x.workflow.notes[0].authorUserId)!;
      const n = c.workflow.notes[0];
      const r = await h.call(n.authorUserId, "PATCH", `/api/cases/${c.id}/notes/${n.id}`, { text: "Edited after the upgrade", expectedVersion: c.version });
      expect(r.status).toBe(200);
      await h.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("databases seeded before people had accounts", () => {
  it("bring seeded people up to date with the fixture on start, leaving people added in the queue alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-acct-"));
    const db = join(dir, "acct.sqlite");
    try {
      let h = await start(db);
      await h.call("staff-manager", "POST", "/api/cases", { displayName: "Queue Person", suburb: "Perth", assigneeUserId: "staff-maya" });
      // Simulate an older database: seeded people without the account, and no accounts table rows.
      for (const r of h.store.db.prepare("SELECT id, doc FROM people WHERE is_created = 0").all() as { id: string; doc: string }[]) {
        const { account: _, signalSummary: __, ...rest } = JSON.parse(r.doc);
        h.store.db.prepare("UPDATE people SET doc = ? WHERE id = ?").run(JSON.stringify(rest), r.id);
      }
      h.store.db.exec("DELETE FROM accounts");
      // Read the row itself: the store keeps people in memory, since the app never changes them after writing.
      expect(JSON.parse((h.store.db.prepare("SELECT doc FROM people WHERE id = ?").get("demo-person-001") as { doc: string }).doc).account).toBeUndefined();
      await h.stop();

      h = await start(db);
      const people = h.store.allPeople();
      expect(people).toHaveLength(201);
      // Accounts are kept in their own table; people carry a signal summary instead, for the queue.
      expect(people.filter((p) => p.account)).toHaveLength(0);
      expect(people.filter((p) => p.signalSummary)).toHaveLength(200);
      expect((h.store.db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n).toBe(200);
      expect(h.store.getPersonWithAccount("demo-person-001")!.account?.sourceCustomerId).toMatch(/^C\d{6}$/);
      const queuePerson = people.find((p) => p.displayName === "Queue Person")!;
      expect(h.store.getPersonWithAccount(queuePerson.id)!.account).toBeUndefined();
      await h.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("databases from before every case had a worker", () => {
  it("assign every case on start: seeded ones to the fixture's worker, others in turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-assign-"));
    const db = join(dir, "assign.sqlite");
    try {
      let h = await start(db);
      await h.call("staff-alex", "POST", "/api/cases", { displayName: "Queue Person", suburb: "Perth" });
      const before = await allCases(h);
      // Simulate an older database where some cases had no worker.
      h.store.db.prepare("UPDATE cases SET assigned_to = NULL WHERE id IN ('GS-2001', 'GS-2009', 'GS-2201')").run();
      await h.stop();

      h = await start(db);
      const after = await allCases(h);
      expect(after.every((c) => c.workflow.assignedToUserId)).toBe(true);
      for (const id of ["GS-2001", "GS-2009"]) {
        const was = before.find((c) => c.id === id)!;
        const now = after.find((c) => c.id === id)!;
        expect(now.workflow.assignedToUserId).toBe(was.workflow.assignedToUserId);
        expect(now.version).toBe(was.version + 1);
      }
      expect(after.find((c) => c.id === "GS-2201")!.workflow.assignedToUserId).toMatch(/^staff-/);
      await h.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("databases from before every person had an account number", () => {
  it("number people added in the queue on start, after the highest number in use", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-acctno-"));
    const db = join(dir, "acctno.sqlite");
    try {
      let h = await start(db);
      const made = await h.call("staff-alex", "POST", "/api/cases", { displayName: "Old Queue Person", suburb: "Perth" });
      const id = made.body.person.id;
      const { accountNumber: _, ...rest } = h.store.getPerson(id)!;
      h.store.db.prepare("UPDATE people SET doc = ? WHERE id = ?").run(JSON.stringify(rest), id);
      await h.stop();

      h = await start(db);
      expect(h.store.getPerson(id)!.accountNumber).toBe("DEMO-700201");
      expect(h.store.allPeople().every((p) => p.accountNumber)).toBe(true);
      await h.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("databases seeded from an older dataset", () => {
  it("are emptied and reseeded from the new fixture on start, workflow changes included", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-reseed-"));
    const db = join(dir, "reseed.sqlite");
    try {
      let h = await start(db);
      const c = (await allCases(h))[0]!;
      await h.call("staff-manager", "POST", `/api/cases/${c.id}/notes`, { text: "Note on the old data", expectedVersion: c.version });
      await h.call("staff-alex", "POST", "/api/cases", { displayName: "Old Queue Person", suburb: "Perth" });
      h.store.db.prepare("UPDATE meta SET value = 'an-older-dataset' WHERE key = 'seeded_dataset'").run();
      await h.stop();

      h = await start(db);
      const cases = await allCases(h);
      expect(cases).toHaveLength(200);
      expect(cases.find((x) => x.id === c.id)!.workflow.notes.some((n: { text: string }) => n.text === "Note on the old data")).toBe(false);
      expect(h.store.allPeople().some((p) => p.displayName === "Old Queue Person")).toBe(false);
      await h.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
