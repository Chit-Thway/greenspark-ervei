import { randomUUID } from "node:crypto";
import type { CaseStatus, Person, QueueCase, ReviewStatus, StaffUser } from "@greenspark/shared";
import { ApiError, type ErrorDetail } from "./errors";
import { perthIso, type Clock } from "./clock";
import type { Store, WorkflowSnapshot } from "./store";
export { MAX_BULK_ITEMS } from "@greenspark/shared";

export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export interface Item { caseId: string; expectedVersion: number }
export interface MutationResult { actionId: string | null; updated: QueueCase[]; unchanged: string[] }

export class WorkflowService {
  constructor(private store: Store, private clock: Clock) {}

  private now() { return perthIso(this.clock()); }

  /** How a case is named to people: its account number. Case IDs are an internal key. */
  private label(caseId: string): string {
    const a = this.store.accountNumberOfCase(caseId);
    return a ? `account ${a}` : "this case";
  }

  private requireCase(id: string): QueueCase {
    const c = this.store.getCase(id);
    if (!c) throw new ApiError("not_found", "That case was not found.", [{ caseId: id, code: "not_found", message: "Unknown case" }]);
    return c;
  }

  private canEdit(actor: StaffUser, c: QueueCase): boolean {
    return actor.role === "manager" || c.workflow.assignedToUserId === actor.id;
  }

  /** Per-item checks shared by single and bulk status changes. Returns an error or null. */
  private checkEditable(actor: StaffUser, item: Item): ApiError | null {
    const c = this.store.getCase(item.caseId);
    if (!c) return new ApiError("not_found", "That case was not found.");
    if (!this.canEdit(actor, c)) return new ApiError("forbidden", `You can only change cases assigned to you (${this.label(item.caseId)}).`);
    if (c.version !== item.expectedVersion) return new ApiError("version_conflict", `The case for ${this.label(item.caseId)} changed since you loaded it.`, [], { current: c });
    return null;
  }

  private failBulk(failures: { caseId: string; error: ApiError }[]): never {
    const details: ErrorDetail[] = failures.map((f) => ({ caseId: f.caseId, accountNumber: this.store.accountNumberOfCase(f.caseId) ?? undefined, code: f.error.code, message: f.error.message }));
    throw new ApiError("bulk_validation_failed", `${failures.length} case(s) failed validation. Nothing was changed.`, details);
  }

  /** A support worker, or a validation error naming the bad value. */
  private supportWorker(userId: string) {
    const target = this.store.catalog.users.find((u) => u.id === userId);
    if (!target || target.role !== "support_worker") {
      throw new ApiError("validation_failed", "Cases can only be assigned to a support worker.", [{ code: "invalid_assignee", message: `${userId} is not a support worker` }]);
    }
    return target;
  }

  createCase(actor: StaffUser, input: { personId?: string; displayName?: string; suburb?: string; assigneeUserId?: string }): QueueCase {
    // Every case has a worker: a support worker's new case is theirs; a manager chooses one.
    let assigneeUserId: string;
    if (actor.role === "manager") {
      if (!input.assigneeUserId) throw new ApiError("validation_failed", "Choose a support worker for the new case.", [{ code: "assignee_required", message: "assigneeUserId is required" }]);
      assigneeUserId = this.supportWorker(input.assigneeUserId).id;
    } else {
      if (input.assigneeUserId && input.assigneeUserId !== actor.id) throw new ApiError("forbidden", "Support workers can only create cases for themselves.");
      assigneeUserId = actor.id;
    }
    return this.store.transaction(() => {
      const now = this.now();
      let person: Person | null;
      if (input.personId) {
        person = this.store.getPerson(input.personId);
        if (!person) throw new ApiError("validation_failed", `Person ${input.personId} was not found.`, [{ code: "unknown_person", message: "Unknown personId" }]);
        // One case per account, so the account number identifies it.
        if (this.store.getCaseForPerson(person.id)) {
          throw new ApiError("validation_failed", `Account ${person.accountNumber} already has a case.`, [{ code: "account_has_case", message: "This account already has a case" }]);
        }
      } else {
        person = {
          id: `demo-person-${String(this.store.nextPersonNumber()).padStart(3, "0")}`,
          accountNumber: this.store.nextAccountNumber(),
          displayName: input.displayName!, suburb: input.suburb!, state: "WA",
          householdSummary: "Not recorded", contactPreference: null, fullProfilePath: null,
          gender: null, preferredName: null, address: null, mobile: null, phone: null, email: null,
        };
        this.store.insertPerson(person);
      }
      const answers: Record<string, null> = {};
      const availability: Record<string, "unknown"> = {};
      for (const f of this.store.catalog.evidenceFields) { answers[f.id] = null; availability[f.id] = "unknown"; }
      const c: QueueCase = {
        id: `GS-${this.store.nextCaseNumber()}`, personId: person.id, version: 1, reportedAt: null,
        reportedAnswers: answers, answerAvailability: availability, supportAreaIds: [], circumstances: [],
        assistance: { hardshipEnrolmentAtReport: null, energyBillConcessionAtReport: null, reportedHistory: [] },
        recommendations: [],
        modelAssessment: { provider: "synthetic_demo", isSimulated: true, status: "pending", priority: null, trend: null, explanation: null },
        workflow: { status: "new", assignedToUserId: assigneeUserId, createdAt: now, updatedAt: now, followUpAt: null, reviewStatus: "needs_review", notes: [] },
      };
      this.store.insertCase(c);
      return c;
    });
  }

  assign(actor: StaffUser, assigneeUserId: string, items: Item[]): MutationResult {
    if (actor.role !== "manager") throw new ApiError("forbidden", "Only managers can assign cases.");
    this.supportWorker(assigneeUserId);
    return this.applyBulk("assignment", actor, items, { assignedToUserId: assigneeUserId }, (c) => c.workflow.assignedToUserId === assigneeUserId, false);
  }

  setStatus(actor: StaffUser, status: CaseStatus, items: Item[], bulk: boolean): MutationResult {
    return this.applyBulk("status", actor, items, { status }, (c) => c.workflow.status === status, !bulk);
  }

  private applyBulk(
    type: "assignment" | "status", actor: StaffUser, items: Item[],
    patch: { status?: CaseStatus; assignedToUserId?: string | null },
    isNoop: (c: QueueCase) => boolean, single: boolean,
  ): MutationResult {
    return this.store.transaction(() => {
      const failures: { caseId: string; error: ApiError }[] = [];
      for (const item of items) {
        // Assignment is manager-only (checked by the caller); status needs manager or assignee.
        const err = type === "status" ? this.checkEditable(actor, item) : this.checkVersion(item);
        if (err) failures.push({ caseId: item.caseId, error: err });
      }
      if (failures.length) {
        if (single) throw failures[0]!.error; // one case: report the specific 404/403/409
        this.failBulk(failures);
      }
      const now = this.now();
      const logItems: { caseId: string; before: WorkflowSnapshot; after: WorkflowSnapshot; resultingVersion: number }[] = [];
      const unchanged: string[] = [];
      for (const item of items) {
        const c = this.store.getCase(item.caseId)!;
        if (isNoop(c)) { unchanged.push(c.id); continue; }
        const before = { status: c.workflow.status, assignedToUserId: c.workflow.assignedToUserId, followUpAt: c.workflow.followUpAt };
        const after = { ...before, ...patch };
        // A normal reopen starts unscheduled, including cases resolved before this fix.
        // Undo restores the complete previous snapshot instead of taking this path.
        if (patch.status && (patch.status === "resolved" || c.workflow.status === "resolved")) after.followUpAt = null;
        const resultingVersion = this.store.updateWorkflow(c.id, after, now);
        logItems.push({ caseId: c.id, before, after, resultingVersion });
      }
      let actionId: string | null = null;
      if (logItems.length) {
        actionId = `act-${randomUUID()}`;
        this.store.logAction(actionId, type, actor.id, now, logItems);
      }
      return { actionId, updated: logItems.map((i) => this.store.getCase(i.caseId)!), unchanged };
    });
  }

  private checkVersion(item: Item): ApiError | null {
    const c = this.store.getCase(item.caseId);
    if (!c) return new ApiError("not_found", "That case was not found.");
    if (c.version !== item.expectedVersion) return new ApiError("version_conflict", `The case for ${this.label(item.caseId)} changed since you loaded it.`, [], { current: c });
    return null;
  }

  addNote(actor: StaffUser, caseId: string, text: string, expectedVersion: number): QueueCase {
    return this.store.transaction(() => {
      this.requireCase(caseId);
      const err = this.checkEditable(actor, { caseId, expectedVersion });
      if (err) throw err;
      const now = this.now();
      this.store.addNote({ id: `note-${randomUUID()}`, caseId, authorUserId: actor.id, text, createdAt: now });
      this.store.updateWorkflow(caseId, {}, now);
      return this.store.getCase(caseId)!;
    });
  }

  /** Authors can edit their own notes and managers any note; both need to be allowed to change the case. */
  editNote(actor: StaffUser, caseId: string, noteId: string, text: string, expectedVersion: number): QueueCase {
    return this.store.transaction(() => {
      this.requireCase(caseId);
      const err = this.checkEditable(actor, { caseId, expectedVersion });
      if (err) throw err;
      const note = this.store.getNote(caseId, noteId);
      if (!note) throw new ApiError("not_found", `That note was not found on ${this.label(caseId)}.`);
      if (actor.role !== "manager" && note.authorUserId !== actor.id) throw new ApiError("forbidden", "You can only edit your own notes.");
      if (note.text === text) return this.store.getCase(caseId)!; // nothing changed, so no new version
      const now = this.now();
      this.store.updateNote(noteId, text, actor.id, now);
      this.store.updateWorkflow(caseId, {}, now);
      return this.store.getCase(caseId)!;
    });
  }

  setReview(actor: StaffUser, caseId: string, reviewStatus: ReviewStatus, expectedVersion: number): MutationResult {
    return this.store.transaction(() => {
      this.requireCase(caseId);
      const err = this.checkEditable(actor, { caseId, expectedVersion });
      if (err) throw err;
      const c = this.store.getCase(caseId)!;
      if (c.workflow.reviewStatus === reviewStatus) return { actionId: null, updated: [], unchanged: [caseId] };
      this.store.updateWorkflow(caseId, { reviewStatus }, this.now());
      return { actionId: null, updated: [this.store.getCase(caseId)!], unchanged: [] };
    });
  }

  undo(actor: StaffUser, actionId: string): MutationResult {
    return this.store.transaction(() => {
      const action = this.store.getAction(actionId);
      if (!action) throw new ApiError("not_found", `Action ${actionId} was not found.`);
      if (actor.role !== "manager" && action.actorId !== actor.id) throw new ApiError("forbidden", "You can only undo your own actions.");
      const refuse = (message: string, details: ErrorDetail[] = []) => { throw new ApiError("undo_conflict", message, details); };
      if (action.type !== "assignment" && action.type !== "status") refuse("Only assignment and status changes can be undone.");
      if (action.undoneAt) refuse("This action was already undone.");
      if (this.clock().getTime() - new Date(action.createdAt).getTime() > UNDO_WINDOW_MS) refuse("The Undo window has passed.");
      const stale: ErrorDetail[] = [];
      for (const i of action.items) {
        const c = this.store.getCase(i.caseId);
        if (!c || c.version !== i.resultingVersion) stale.push({ caseId: i.caseId, code: "version_conflict", message: "Changed since the action" });
      }
      if (stale.length) refuse("Some cases changed after this action, so it cannot be undone. Nothing was changed.", stale);
      // Assignments made before every case had a worker could otherwise put a case back to no one.
      if (action.items.some((i) => "assignedToUserId" in i.before && i.before.assignedToUserId === null)) {
        refuse("Undoing this would leave a case without a worker. Reassign it instead.");
      }

      const now = this.now();
      const logItems = action.items.map((i) => {
        const resultingVersion = this.store.updateWorkflow(i.caseId, i.before, now);
        return { caseId: i.caseId, before: i.after, after: i.before, resultingVersion };
      });
      this.store.markUndone(actionId, actor.id, now);
      const undoId = `act-${randomUUID()}`;
      this.store.logAction(undoId, "undo", actor.id, now, logItems);
      return { actionId: undoId, updated: logItems.map((i) => this.store.getCase(i.caseId)!), unchanged: [] };
    });
  }
}
