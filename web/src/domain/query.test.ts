import { describe, expect, it } from "vitest";
import { loadDataset } from "../data/caseSource";
import { activeFilterCount, applyFilters, DEFAULT_QUERY, facetCounts, overviewCounters, paginate, sortCases } from "./query";
import { describeFollowUp } from "./format";

const data = await loadDataset();
const me = "staff-alex";
const q = (over: Partial<typeof DEFAULT_QUERY>) => ({ ...DEFAULT_QUERY, ...over });

describe("queue filters", () => {
  it("returns all 100 cases by default", () => {
    expect(applyFilters(data, DEFAULT_QUERY, me)).toHaveLength(100);
  });

  it("ORs within circumstances and ANDs across groups", () => {
    const warm = applyFilters(data, q({ circumstanceIds: ["keeping_warm_difficulty"] }), me);
    const cool = applyFilters(data, q({ circumstanceIds: ["keeping_cool_difficulty"] }), me);
    const either = applyFilters(data, q({ circumstanceIds: ["keeping_warm_difficulty", "keeping_cool_difficulty"] }), me);
    const union = new Set([...warm, ...cool].map((c) => c.id));
    expect(either.map((c) => c.id).sort()).toEqual([...union].sort());
    const both = applyFilters(data, q({ circumstanceIds: ["keeping_warm_difficulty"], status: "resolved" }), me);
    expect(both.every((c) => c.workflow.status === "resolved" && warm.includes(c))).toBe(true);
  });

  it("excludes unscored cases when a minimum score is set instead of treating them as zero", () => {
    const res = applyFilters(data, q({ minPriorityScore: 1 }), me);
    expect(res).toHaveLength(90);
    expect(res.every((c) => c.modelAssessment.priority !== null)).toBe(true);
  });

  it("searches name, case id and suburb", () => {
    const first = data.people[0]!;
    expect(applyFilters(data, q({ search: first.displayName.toUpperCase() }), me).length).toBeGreaterThan(0);
    expect(applyFilters(data, q({ search: "GS-2001" }), me).map((c) => c.id)).toContain("GS-2001");
    expect(applyFilters(data, q({ search: first.suburb }), me).length).toBeGreaterThan(0);
    expect(applyFilters(data, q({ search: "zzzz-no-match" }), me)).toHaveLength(0);
  });

  it("assigned-to-me and unassigned views use the current user", () => {
    const mine = applyFilters(data, q({ view: "mine" }), me);
    expect(mine.every((c) => c.workflow.assignedToUserId === me)).toBe(true);
    expect(applyFilters(data, q({ view: "unassigned" }), me)).toHaveLength(20);
  });

  it("assistance filters keep unknown separate from No", () => {
    const res = applyFilters(data, q({ assistanceIds: ["Q37"] }), me);
    expect(res.every((c) => c.reportedAnswers.Q37 === "Yes")).toBe(true);
    const unknown = data.cases.filter((c) => c.reportedAnswers.Q37 === null);
    expect(unknown.some((c) => res.includes(c))).toBe(false);
  });
});

describe("sorting, paging and counters", () => {
  it("sorts by priority with unscored cases last", () => {
    const sorted = sortCases(data.cases, data.people, "priority_desc");
    const scores = sorted.map((c) => c.modelAssessment.priority?.score ?? null);
    expect(scores.slice(0, 90).every((s) => s !== null)).toBe(true);
    expect(scores.slice(90).every((s) => s === null)).toBe(true);
    const asc = sortCases(data.cases, data.people, "priority_asc").map((c) => c.modelAssessment.priority?.score ?? null);
    expect(asc.slice(90).every((s) => s === null)).toBe(true);
  });

  it("paginates eight per page and clamps the page", () => {
    const p = paginate(data.cases, 99, 8);
    expect(p.pageCount).toBe(13);
    expect(p.page).toBe(13);
    expect(p.from).toBe(97);
    expect(p.to).toBe(100);
    expect(paginate([], 1, 8)).toMatchObject({ total: 0, from: 0, to: 0, pageCount: 1 });
  });

  it("global counters ignore resolved cases", () => {
    const c = overviewCounters(data.cases, me);
    const active = data.cases.filter((x) => x.workflow.status !== "resolved");
    expect(c.awaitingAssignment).toBe(active.filter((x) => !x.workflow.assignedToUserId).length);
    expect(c.myActive).toBe(active.filter((x) => x.workflow.assignedToUserId === me).length);
  });

  it("facet counts follow the other active filters", () => {
    const f = facetCounts(data, q({ status: "resolved" }), me);
    expect(f.view.all).toBe(10);
  });

  it("counts active filters for the reset control", () => {
    expect(activeFilterCount(DEFAULT_QUERY)).toBe(0);
    expect(activeFilterCount(q({ status: "new", search: "x" }))).toBe(2);
  });
});

describe("follow-up wording", () => {
  it("covers overdue, today, future, none and resolved", () => {
    expect(describeFollowUp("2026-10-14T14:00:00+08:00", false, "2026-10-16").text).toBe("2d overdue");
    expect(describeFollowUp("2026-10-16T14:00:00+08:00", false, "2026-10-16").text).toBe("Today · 2 pm");
    expect(describeFollowUp("2026-10-18T09:30:00+08:00", false, "2026-10-16").text).toBe("18 Oct · 9:30 am");
    expect(describeFollowUp(null, false, "2026-10-16").text).toBe("Not scheduled");
    expect(describeFollowUp("2026-10-14T14:00:00+08:00", true, "2026-10-16").tone).toBe("none");
  });
});
