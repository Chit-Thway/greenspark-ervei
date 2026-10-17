import { describe, expect, it } from "vitest";
import { describeFollowUp, formatDateTime } from "./format";

describe("follow-up wording", () => {
  it("covers overdue, today, future, none and resolved", () => {
    expect(describeFollowUp("2026-10-14T14:00:00+08:00", false, "2026-10-16").text).toBe("2d overdue");
    expect(describeFollowUp("2026-10-16T14:00:00+08:00", false, "2026-10-16").text).toBe("Today · 2 pm");
    expect(describeFollowUp("2026-10-18T09:30:00+08:00", false, "2026-10-16").text).toBe("18 Oct · 9:30 am");
    expect(describeFollowUp(null, false, "2026-10-16").text).toBe("Not scheduled");
    expect(describeFollowUp("2026-10-14T14:00:00+08:00", true, "2026-10-16").tone).toBe("none");
  });
});

describe("note timestamps", () => {
  it("show the year and the full time", () => {
    expect(formatDateTime("2026-10-15T11:00:00+08:00")).toBe("15 Oct 2026 · 11:00 am");
    expect(formatDateTime("2026-10-15T14:05:00+08:00")).toBe("15 Oct 2026 · 2:05 pm");
    expect(formatDateTime("2026-01-02T00:30:00+08:00")).toBe("2 Jan 2026 · 12:30 am");
    expect(formatDateTime("2026-12-31T12:00:00+08:00")).toBe("31 Dec 2026 · 12:00 pm");
  });
});
