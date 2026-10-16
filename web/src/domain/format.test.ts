import { describe, expect, it } from "vitest";
import { describeFollowUp } from "./format";

describe("follow-up wording", () => {
  it("covers overdue, today, future, none and resolved", () => {
    expect(describeFollowUp("2026-10-14T14:00:00+08:00", false, "2026-10-16").text).toBe("2d overdue");
    expect(describeFollowUp("2026-10-16T14:00:00+08:00", false, "2026-10-16").text).toBe("Today · 2 pm");
    expect(describeFollowUp("2026-10-18T09:30:00+08:00", false, "2026-10-16").text).toBe("18 Oct · 9:30 am");
    expect(describeFollowUp(null, false, "2026-10-16").text).toBe("Not scheduled");
    expect(describeFollowUp("2026-10-14T14:00:00+08:00", true, "2026-10-16").tone).toBe("none");
  });
});
