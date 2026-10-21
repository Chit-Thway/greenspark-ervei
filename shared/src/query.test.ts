import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { toDataset, type RawFixture } from "./fixture";
import { activeFilterCount, applyFilters, DEFAULT_QUERY, facetCounts, overviewCounters, paginate, sortCases } from "./query";

const data = toDataset(JSON.parse(readFileSync(new URL("../../data/synthetic/case-queue.v1.json", import.meta.url), "utf8")) as RawFixture);
const me = "staff-alex";
const q = (over: Partial<typeof DEFAULT_QUERY>) => ({ ...DEFAULT_QUERY, ...over });

describe("queue filters", () => {
  it("returns all 200 cases by default", () => {
    expect(applyFilters(data, DEFAULT_QUERY, me)).toHaveLength(200);
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
    expect(res).toHaveLength(180);
    expect(res.every((c) => c.modelAssessment.priority !== null)).toBe(true);
  });

  it("searches name, account number and suburb, not internal case IDs", () => {
    const first = data.people[0]!;
    expect(applyFilters(data, q({ search: first.displayName.toUpperCase() }), me).length).toBeGreaterThan(0);
    expect(applyFilters(data, q({ search: first.accountNumber! }), me).map((c) => c.personId)).toEqual([first.id]);
    expect(applyFilters(data, q({ search: "GS-2001" }), me)).toHaveLength(0);
    expect(applyFilters(data, q({ search: first.suburb }), me).length).toBeGreaterThan(0);
    expect(applyFilters(data, q({ search: "zzzz-no-match" }), me)).toHaveLength(0);
  });

  it("the assigned-to-me view uses the current user, and every case has a worker", () => {
    const mine = applyFilters(data, q({ view: "mine" }), me);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.workflow.assignedToUserId === me)).toBe(true);
    expect(data.cases.every((c) => c.workflow.assignedToUserId !== null)).toBe(true);
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
    expect(scores.slice(0, 180).every((s) => s !== null)).toBe(true);
    expect(scores.slice(180).every((s) => s === null)).toBe(true);
    const asc = sortCases(data.cases, data.people, "priority_asc").map((c) => c.modelAssessment.priority?.score ?? null);
    expect(asc.slice(180).every((s) => s === null)).toBe(true);
  });

  it("shows 50 cases per page by default", () => {
    expect(DEFAULT_QUERY.pageSize).toBe(50);
    const p = paginate(data.cases, 1, DEFAULT_QUERY.pageSize);
    expect([p.items.length, p.pageCount, p.from, p.to]).toEqual([50, 4, 1, 50]);
  });

  it("paginates in other sizes and clamps the page", () => {
    const p = paginate(data.cases, 99, 8);
    expect(p.pageCount).toBe(25);
    expect(p.page).toBe(25);
    expect(p.from).toBe(193);
    expect(p.to).toBe(200);
    expect(paginate([], 1, 8)).toMatchObject({ total: 0, from: 0, to: 0, pageCount: 1 });
  });

  it("global counters ignore resolved cases", () => {
    const c = overviewCounters(data.cases, me);
    const active = data.cases.filter((x) => x.workflow.status !== "resolved");
    expect(c.urgent).toBe(active.filter((x) => x.modelAssessment.status === "ready" && x.modelAssessment.priority?.label === "urgent").length);
    expect(c.myActive).toBe(active.filter((x) => x.workflow.assignedToUserId === me).length);
  });

  it("facet counts follow the other active filters", () => {
    const f = facetCounts(data, q({ status: "resolved" }), me);
    expect(f.view.all).toBe(20);
  });

  it("counts active filters for the reset control", () => {
    expect(activeFilterCount(DEFAULT_QUERY)).toBe(0);
    expect(activeFilterCount(q({ status: "new", search: "x" }))).toBe(2);
  });
});

