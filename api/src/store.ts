import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { toDataset, type CaseNote, type Person, type QueueCase, type QueueDataset, type RawFixture } from "@greenspark/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, doc TEXT NOT NULL, is_created INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cases (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, person_id TEXT NOT NULL,
  static_doc TEXT NOT NULL, is_created INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL, status TEXT NOT NULL, assigned_to TEXT, follow_up_at TEXT,
  review_status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, case_id TEXT NOT NULL, author_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_actions (id TEXT PRIMARY KEY, type TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, undone_at TEXT, undone_by TEXT);
CREATE TABLE IF NOT EXISTS workflow_action_items (action_id TEXT NOT NULL, case_id TEXT NOT NULL, before_doc TEXT NOT NULL, after_doc TEXT NOT NULL, resulting_version INTEGER NOT NULL, PRIMARY KEY (action_id, case_id));
`;

type Row = Record<string, string | number | null>;

export interface WorkflowSnapshot {
  status: string;
  assignedToUserId: string | null;
  // Optional for action logs written before follow-up dates were included.
  followUpAt?: string | null;
}

export class Store {
  readonly db: DatabaseSync;
  readonly catalog: QueueDataset; // read-only fixture data: catalogs, users

  constructor(dbPath: string, fixturePath: string) {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as RawFixture;
    this.catalog = toDataset(raw);
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    if (!this.getMeta("seeded_dataset")) this.seed(raw);
  }

  close() { this.db.close(); }

  getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as Row | undefined;
    return r ? (r.value as string) : null;
  }

  private seed(raw: RawFixture) {
    this.transaction(() => {
      const addPerson = this.db.prepare("INSERT INTO people (id, doc) VALUES (?, ?)");
      for (const p of raw.people) addPerson.run(p.id, JSON.stringify(p));
      const addCase = this.db.prepare(
        "INSERT INTO cases (id, person_id, static_doc, version, status, assigned_to, follow_up_at, review_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      );
      const addNote = this.db.prepare("INSERT INTO notes (id, case_id, author_id, text, created_at) VALUES (?,?,?,?,?)");
      for (const c of raw.cases) {
        const { version, workflow, ...rest } = c;
        addCase.run(c.id, c.personId, JSON.stringify(rest), version, workflow.status, workflow.assignedToUserId, workflow.followUpAt, workflow.reviewStatus, workflow.createdAt, workflow.updatedAt);
        for (const n of workflow.notes) addNote.run(n.id, c.id, n.authorUserId, n.text, n.createdAt);
      }
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('seeded_dataset', ?)").run(raw.metadata.datasetId);
    });
  }

  /** Runs fn in one SQLite transaction; any throw rolls everything back. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private assemble(row: Row, notes: CaseNote[]): QueueCase {
    const rest = JSON.parse(row.static_doc as string) as Omit<QueueCase, "version" | "workflow">;
    return {
      ...rest,
      version: row.version as number,
      workflow: {
        status: row.status as QueueCase["workflow"]["status"],
        assignedToUserId: row.assigned_to as string | null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        followUpAt: row.follow_up_at as string | null,
        reviewStatus: row.review_status as QueueCase["workflow"]["reviewStatus"],
        notes,
      },
    };
  }

  private notesByCase(caseId?: string): Map<string, CaseNote[]> {
    const rows = (caseId
      ? this.db.prepare("SELECT * FROM notes WHERE case_id = ? ORDER BY seq").all(caseId)
      : this.db.prepare("SELECT * FROM notes ORDER BY seq").all()) as Row[];
    const m = new Map<string, CaseNote[]>();
    for (const r of rows) {
      const list = m.get(r.case_id as string) ?? [];
      list.push({ id: r.id as string, text: r.text as string, authorUserId: r.author_id as string, createdAt: r.created_at as string });
      m.set(r.case_id as string, list);
    }
    return m;
  }

  allCases(): QueueCase[] {
    const notes = this.notesByCase();
    return (this.db.prepare("SELECT * FROM cases ORDER BY seq").all() as Row[]).map((r) => this.assemble(r, notes.get(r.id as string) ?? []));
  }

  getCase(id: string): QueueCase | null {
    const r = this.db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as Row | undefined;
    return r ? this.assemble(r, this.notesByCase(id).get(id) ?? []) : null;
  }

  allPeople(): Person[] {
    return (this.db.prepare("SELECT doc FROM people ORDER BY seq").all() as Row[]).map((r) => JSON.parse(r.doc as string) as Person);
  }

  getPerson(id: string): Person | null {
    const r = this.db.prepare("SELECT doc FROM people WHERE id = ?").get(id) as Row | undefined;
    return r ? (JSON.parse(r.doc as string) as Person) : null;
  }

  dataset(): QueueDataset {
    return { ...this.catalog, people: this.allPeople(), cases: this.allCases() };
  }

  nextCaseNumber(): number {
    const r = this.db.prepare("SELECT MAX(CAST(SUBSTR(id, 4) AS INTEGER)) AS n FROM cases").get() as Row;
    return ((r.n as number | null) ?? 2000) + 1;
  }

  nextPersonNumber(): number {
    const r = this.db.prepare("SELECT MAX(CAST(SUBSTR(id, 13) AS INTEGER)) AS n FROM people").get() as Row;
    return ((r.n as number | null) ?? 0) + 1;
  }

  insertPerson(p: Person) {
    this.db.prepare("INSERT INTO people (id, doc, is_created) VALUES (?, ?, 1)").run(p.id, JSON.stringify(p));
  }

  insertCase(c: QueueCase) {
    const { version, workflow, ...rest } = c;
    this.db.prepare(
      "INSERT INTO cases (id, person_id, static_doc, is_created, version, status, assigned_to, follow_up_at, review_status, created_at, updated_at) VALUES (?,?,?,1,?,?,?,?,?,?,?)",
    ).run(c.id, c.personId, JSON.stringify(rest), version, workflow.status, workflow.assignedToUserId, workflow.followUpAt, workflow.reviewStatus, workflow.createdAt, workflow.updatedAt);
  }

  /** Applies a status/assignment change and bumps the version. Returns the new version. */
  updateWorkflow(caseId: string, patch: { status?: string; assignedToUserId?: string | null; reviewStatus?: string; followUpAt?: string | null }, updatedAt: string): number {
    const cur = this.db.prepare("SELECT version, status, assigned_to, review_status, follow_up_at FROM cases WHERE id = ?").get(caseId) as Row;
    const version = (cur.version as number) + 1;
    this.db.prepare("UPDATE cases SET version = ?, status = ?, assigned_to = ?, review_status = ?, follow_up_at = ?, updated_at = ? WHERE id = ?").run(
      version,
      patch.status ?? (cur.status as string),
      patch.assignedToUserId === undefined ? (cur.assigned_to as string | null) : patch.assignedToUserId,
      patch.reviewStatus ?? (cur.review_status as string),
      patch.followUpAt === undefined ? (cur.follow_up_at as string | null) : patch.followUpAt,
      updatedAt,
      caseId,
    );
    return version;
  }

  addNote(n: CaseNote & { caseId: string }) {
    this.db.prepare("INSERT INTO notes (id, case_id, author_id, text, created_at) VALUES (?,?,?,?,?)").run(n.id, n.caseId, n.authorUserId, n.text, n.createdAt);
  }

  noteCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM notes").get() as Row).n as number;
  }

  logAction(id: string, type: string, actorId: string, createdAt: string, items: { caseId: string; before: WorkflowSnapshot; after: WorkflowSnapshot; resultingVersion: number }[]) {
    this.db.prepare("INSERT INTO workflow_actions (id, type, actor_id, created_at) VALUES (?,?,?,?)").run(id, type, actorId, createdAt);
    const add = this.db.prepare("INSERT INTO workflow_action_items (action_id, case_id, before_doc, after_doc, resulting_version) VALUES (?,?,?,?,?)");
    for (const i of items) add.run(id, i.caseId, JSON.stringify(i.before), JSON.stringify(i.after), i.resultingVersion);
  }

  getAction(id: string) {
    const a = this.db.prepare("SELECT * FROM workflow_actions WHERE id = ?").get(id) as Row | undefined;
    if (!a) return null;
    const items = (this.db.prepare("SELECT * FROM workflow_action_items WHERE action_id = ?").all(id) as Row[]).map((r) => ({
      caseId: r.case_id as string,
      before: JSON.parse(r.before_doc as string) as WorkflowSnapshot,
      after: JSON.parse(r.after_doc as string) as WorkflowSnapshot,
      resultingVersion: r.resulting_version as number,
    }));
    return {
      id: a.id as string, type: a.type as string, actorId: a.actor_id as string, createdAt: a.created_at as string,
      undoneAt: a.undone_at as string | null, items,
    };
  }

  markUndone(id: string, by: string, at: string) {
    this.db.prepare("UPDATE workflow_actions SET undone_at = ?, undone_by = ? WHERE id = ?").run(at, by, id);
  }
}
