import type {
  Person,
  PriorityLabel,
  QueueCase,
  QueueDataset,
  QueueQuery,
  SortKey,
} from "./types";

export const DEFAULT_QUERY: QueueQuery = {
  search: "",
  view: "all",
  circumstanceIds: [],
  assistanceIds: [],
  priorityLabels: [],
  minPriorityScore: 0,
  assessmentStatus: "",
  status: "",
  assignedToUserId: "",
  sort: "priority_desc",
  page: 1,
  pageSize: 8,
};

export const PRIORITY_LABELS: PriorityLabel[] = ["urgent", "high", "moderate", "routine"];

export const ASSISTANCE_OPTIONS: { id: string; label: string; group: "current" | "history" }[] = [
  { id: "Q37", label: "Enrolled in a hardship program (at report)", group: "current" },
  { id: "Z7_8", label: "Energy-bill concession (at report)", group: "current" },
  { id: "Q36b_1", label: "Bill extension (past 12 months)", group: "history" },
  { id: "Q36b_2", label: "Reduced amount owing (past 12 months)", group: "history" },
  { id: "Q36b_3", label: "Repayment plan (past 12 months)", group: "history" },
  { id: "Q36b_4", label: "Hardship program (past 12 months)", group: "history" },
  { id: "Q36b_5", label: "Advice on reducing costs (past 12 months)", group: "history" },
  { id: "Q36b_6", label: "Help with a cheaper plan (past 12 months)", group: "history" },
  { id: "Q36b_7", label: "Concession check (past 12 months)", group: "history" },
  { id: "Q36b_8", label: "Appliance support (past 12 months)", group: "history" },
];

export type FilterGroup = "view" | "circumstances" | "assistance" | "priority" | "assessment" | "status" | "worker";

export function isResolved(c: QueueCase): boolean {
  return c.workflow.status === "resolved";
}

export function personOf(people: Person[], c: QueueCase): Person | undefined {
  return people.find((p) => p.id === c.personId);
}

function matchesSearch(c: QueueCase, person: Person | undefined, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return [c.id, c.personId, person?.displayName, person?.suburb].some((v) => v?.toLowerCase().includes(t));
}

/** One definition of every filter, used for the table, the counters and the facet counts. */
export function applyFilters(
  data: Pick<QueueDataset, "cases" | "people">,
  q: QueueQuery,
  currentUserId: string,
  omit?: FilterGroup,
): QueueCase[] {
  const people = new Map(data.people.map((p) => [p.id, p]));
  return data.cases.filter((c) => {
    if (!matchesSearch(c, people.get(c.personId), q.search)) return false;
    if (omit !== "view") {
      if (q.view === "mine" && c.workflow.assignedToUserId !== currentUserId) return false;
      if (q.view === "unassigned" && c.workflow.assignedToUserId !== null) return false;
      if (q.view === "needs_review" && c.workflow.reviewStatus !== "needs_review") return false;
    }
    if (omit !== "circumstances" && q.circumstanceIds.length > 0) {
      if (!c.circumstances.some((x) => q.circumstanceIds.includes(x.circumstanceId))) return false;
    }
    if (omit !== "assistance" && q.assistanceIds.length > 0) {
      if (!q.assistanceIds.some((id) => c.reportedAnswers[id] === "Yes")) return false;
    }
    if (omit !== "priority") {
      const p = c.modelAssessment.priority;
      if (q.priorityLabels.length > 0 && !(p && q.priorityLabels.includes(p.label))) return false;
      // A missing score never counts as zero: with a minimum set, unscored cases are excluded.
      if (q.minPriorityScore > 0 && !(p && p.score >= q.minPriorityScore)) return false;
    }
    if (omit !== "assessment" && q.assessmentStatus && c.modelAssessment.status !== q.assessmentStatus) return false;
    if (omit !== "status" && q.status && c.workflow.status !== q.status) return false;
    if (omit !== "worker" && q.assignedToUserId) {
      if (q.assignedToUserId === "__none__" ? c.workflow.assignedToUserId !== null : c.workflow.assignedToUserId !== q.assignedToUserId) return false;
    }
    return true;
  });
}

const PRIORITY_RANK: Record<PriorityLabel, number> = { urgent: 0, high: 1, moderate: 2, routine: 3 };

export function sortCases(cases: QueueCase[], people: Person[], sort: SortKey): QueueCase[] {
  const name = new Map(people.map((p) => [p.id, p.displayName]));
  const score = (c: QueueCase) => c.modelAssessment.priority?.score ?? null;
  const out = [...cases];
  const byId = (a: QueueCase, b: QueueCase) => a.id.localeCompare(b.id);
  out.sort((a, b) => {
    switch (sort) {
      case "priority_desc":
      case "priority_asc": {
        const sa = score(a), sb = score(b);
        if (sa === null && sb === null) return byId(a, b);
        if (sa === null) return 1; // unscored cases always sort last
        if (sb === null) return -1;
        return (sort === "priority_desc" ? sb - sa : sa - sb) || byId(a, b);
      }
      case "followup": {
        const fa = isResolved(a) ? null : a.workflow.followUpAt;
        const fb = isResolved(b) ? null : b.workflow.followUpAt;
        if (!fa && !fb) return byId(a, b);
        if (!fa) return 1;
        if (!fb) return -1;
        return fa.localeCompare(fb) || byId(a, b);
      }
      case "name":
        return (name.get(a.personId) ?? "").localeCompare(name.get(b.personId) ?? "") || byId(a, b);
      case "updated":
        return b.workflow.updatedAt.localeCompare(a.workflow.updatedAt) || byId(a, b);
    }
  });
  return out;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
  from: number;
  to: number;
}

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safe = Math.min(Math.max(1, page), pageCount);
  const start = (safe - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    items: slice,
    total: items.length,
    page: safe,
    pageCount,
    from: slice.length ? start + 1 : 0,
    to: start + slice.length,
  };
}

/** The three global active-case shortcuts. They ignore the table filters on purpose. */
export function overviewCounters(cases: QueueCase[], currentUserId: string) {
  const active = cases.filter((c) => !isResolved(c));
  return {
    urgent: active.filter((c) => c.modelAssessment.status === "ready" && c.modelAssessment.priority?.label === "urgent").length,
    awaitingAssignment: active.filter((c) => c.workflow.assignedToUserId === null).length,
    myActive: active.filter((c) => c.workflow.assignedToUserId === currentUserId).length,
  };
}

/** Facet counts: matches for the current query with this one filter group left out. */
export function facetCounts(data: Pick<QueueDataset, "cases" | "people">, q: QueueQuery, currentUserId: string) {
  const views = applyFilters(data, q, currentUserId, "view");
  const circ = applyFilters(data, q, currentUserId, "circumstances");
  const assist = applyFilters(data, q, currentUserId, "assistance");
  const prio = applyFilters(data, q, currentUserId, "priority");
  return {
    view: {
      all: views.length,
      mine: views.filter((c) => c.workflow.assignedToUserId === currentUserId).length,
      unassigned: views.filter((c) => c.workflow.assignedToUserId === null).length,
      needs_review: views.filter((c) => c.workflow.reviewStatus === "needs_review").length,
    },
    circumstance: (id: string) => circ.filter((c) => c.circumstances.some((x) => x.circumstanceId === id)).length,
    area: (circumstanceIds: string[]) =>
      circ.filter((c) => c.circumstances.some((x) => circumstanceIds.includes(x.circumstanceId))).length,
    assistance: (id: string) => assist.filter((c) => c.reportedAnswers[id] === "Yes").length,
    priority: (label: PriorityLabel) => prio.filter((c) => c.modelAssessment.priority?.label === label).length,
  };
}

export function activeFilterCount(q: QueueQuery): number {
  return (
    q.circumstanceIds.length + q.assistanceIds.length + q.priorityLabels.length +
    (q.minPriorityScore > 0 ? 1 : 0) + (q.assessmentStatus ? 1 : 0) + (q.status ? 1 : 0) +
    (q.assignedToUserId ? 1 : 0) + (q.view !== "all" ? 1 : 0) + (q.search.trim() ? 1 : 0)
  );
}

export { PRIORITY_RANK };
