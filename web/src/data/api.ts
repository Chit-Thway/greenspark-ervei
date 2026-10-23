import type { FlowDoc, FlowOp, WeatherSignal } from "@greenspark/shared";
import type {
  AssessmentStatus, CaseStatus, CircumstanceDefinition, EvidenceFieldDefinition, Person, QueueCase,
  QueueQuery, RecommendationDefinition, ReviewStatus, StaffUser, SupportArea,
} from "@greenspark/shared";

export interface Catalog {
  supportAreas: SupportArea[];
  circumstances: CircumstanceDefinition[];
  evidenceFields: EvidenceFieldDefinition[];
  recommendations: RecommendationDefinition[];
  /** "flow" when circumstances and solutions come from the flowchart file. */
  circumstanceSource?: "flow" | "fixture";
  asOf: string;
  users: StaffUser[];
  assignableUserIds: string[];
}

/** `weatherSignals`: the customer's weather signals from the latest forecast (case page only). */
export interface CaseItem { case: QueueCase; person: Person | null; weatherSignals?: WeatherSignal[] }

export interface Facets {
  view: Record<"all" | "mine" | "needs_review", number>;
  circumstances: Record<string, number>;
  areas: Record<string, number>;
  assistance: Record<string, number>;
  priority: Record<string, number>;
}

export interface CaseListResponse {
  items: CaseItem[];
  total: number; page: number; pageSize: number; pageCount: number; from: number; to: number;
  counters: { urgent: number; myActive: number };
  facets: Facets;
}

export interface MutationResult { actionId: string | null; updated: QueueCase[]; unchanged: string[] }

export interface ErrorDetail { caseId?: string; accountNumber?: string; code?: string; message: string }

export class ApiClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: ErrorDetail[] = [], readonly current?: QueueCase) {
    super(message);
  }
}

export interface FlowSnapshot { doc: FlowDoc | null; hash: string; problems: string[] }
export interface FlowSaved { hash: string; previousHash: string; changed: boolean }

export interface ApiClient {
  /** The utility hardship flow behind the Flowchart page (a JSON file on the server). */
  flow(): Promise<FlowSnapshot>;
  weather?(): Promise<WeatherStatus>;
  setWeatherMode?(mode: WeatherMode): Promise<WeatherStatus>;
  flowOps(ops: FlowOp[]): Promise<FlowSaved>;
  catalog(): Promise<Catalog>;
  list(q: QueueQuery): Promise<CaseListResponse>;
  matchingIds(q: QueueQuery): Promise<string[]>;
  overview(caseId: string): Promise<CaseItem>;
  /** The case for an account number (each account has one case). */
  account(accountNumber: string): Promise<CaseItem>;
  assign(assigneeUserId: string, items: VersionedId[]): Promise<MutationResult>;
  setStatus(status: CaseStatus, items: VersionedId[]): Promise<MutationResult>;
  addNote(caseId: string, text: string, expectedVersion: number): Promise<QueueCase>;
  editNote(caseId: string, noteId: string, text: string, expectedVersion: number): Promise<QueueCase>;
  setReview(caseId: string, reviewStatus: ReviewStatus, expectedVersion: number): Promise<MutationResult>;
  undo(actionId: string): Promise<MutationResult>;
  /** AI-drafted support plan for a case (Claude or Gemini). Optional so test clients can leave it out. */
  supportPlan?(caseId: string, kind?: PlanKind): Promise<SupportPlan>;
}

export type PlanKind = "support" | "signals";
export type ContactMethod = "phone" | "sms" | "email" | "letter";
export interface PlanStep { id: string; reason: string; due?: string; method?: ContactMethod }
export interface SupportPlan { text: string; model: string; generatedAt: string; order?: PlanStep[]; interpreter?: boolean }

export type WeatherMode = "live" | "demo" | "off";
export interface WeatherStatus { mode: WeatherMode; fetchedAt: string | null; issuedAt: string | null; towns: number; warnings: string[]; error: string | null; available?: boolean }

export interface VersionedId { caseId: string; expectedVersion: number }

export function queryString(q: QueueQuery, withPaging = true): string {
  const p = new URLSearchParams();
  if (q.search.trim()) p.set("search", q.search.trim());
  if (q.view !== "all") p.set("view", q.view);
  if (q.circumstanceIds.length) p.set("circumstanceIds", q.circumstanceIds.join(","));
  if (q.assistanceIds.length) p.set("assistanceIds", q.assistanceIds.join(","));
  if (q.priorityLabels.length) p.set("priorityLabels", q.priorityLabels.join(","));
  if (q.minPriorityScore > 0) p.set("minPriorityScore", String(q.minPriorityScore));
  if (q.assessmentStatus) p.set("assessmentStatus", q.assessmentStatus satisfies AssessmentStatus);
  if (q.status) p.set("status", q.status);
  if (q.assignedToUserId) p.set("assignedToUserId", q.assignedToUserId);
  if (withPaging) {
    p.set("sort", q.sort);
    p.set("page", String(q.page));
    p.set("pageSize", String(q.pageSize));
  }
  return p.toString();
}

/** HTTP implementation. `getUser` supplies the demo identity header (not real sign-in). */
export function createApiClient(getUser: () => string, base = ""): ApiClient {
  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: { "x-demo-user": getUser(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiClientError(0, "network", "Could not reach the server. Check that the API is running and try again.");
    }
    const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: ErrorDetail[]; current?: QueueCase } } | null;
    if (!res.ok) {
      const e = json?.error;
      throw new ApiClientError(res.status, e?.code ?? "unknown", e?.message ?? `Request failed (${res.status}).`, e?.details ?? [], e?.current);
    }
    return json as T;
  }
  return {
    flow: () => req("GET", "/api/admin/flow"),
    weather: () => req("GET", "/api/weather"),
    setWeatherMode: (mode) => req("POST", "/api/weather/mode", { mode }),
    flowOps: (ops) => req("POST", "/api/admin/flow/ops", { ops }),
    async catalog() {
      const [c, u] = await Promise.all([
        req<Omit<Catalog, "users" | "assignableUserIds">>("GET", "/api/catalogs"),
        req<{ users: StaffUser[]; assignableUserIds: string[] }>("GET", "/api/users"),
      ]);
      return { ...c, users: u.users, assignableUserIds: u.assignableUserIds };
    },
    list: (q) => req("GET", `/api/cases?${queryString(q)}`),
    matchingIds: async (q) => (await req<{ ids: string[] }>("GET", `/api/cases/ids?${queryString(q, false)}`)).ids,
    overview: (id) => req("GET", `/api/cases/${encodeURIComponent(id)}/overview`),
    account: (accountNumber) => req("GET", `/api/accounts/${encodeURIComponent(accountNumber)}`),
    assign: (assigneeUserId, items) => req("POST", "/api/cases/bulk/assignment", { assigneeUserId, items }),
    setStatus: (status, items) =>
      items.length === 1
        ? req("PATCH", `/api/cases/${encodeURIComponent(items[0]!.caseId)}/status`, { status, expectedVersion: items[0]!.expectedVersion })
        : req("POST", "/api/cases/bulk/status", { status, items }),
    addNote: async (id, text, expectedVersion) => (await req<{ case: QueueCase }>("POST", `/api/cases/${encodeURIComponent(id)}/notes`, { text, expectedVersion })).case,
    editNote: async (id, noteId, text, expectedVersion) => (await req<{ case: QueueCase }>("PATCH", `/api/cases/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, { text, expectedVersion })).case,
    setReview: (id, reviewStatus, expectedVersion) => req("PATCH", `/api/cases/${encodeURIComponent(id)}/review`, { reviewStatus, expectedVersion }),
    supportPlan: async (id, kind = "support") => (await req<{ plan: SupportPlan }>("GET", `/api/cases/${encodeURIComponent(id)}/plan?kind=${kind}`)).plan,
    undo: (actionId) => req("POST", `/api/workflow-actions/${encodeURIComponent(actionId)}/undo`),
  };
}
