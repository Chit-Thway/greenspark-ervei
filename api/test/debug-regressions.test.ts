import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allCases, start, type Harness } from "./helpers";

let h: Harness;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h.stop(); });

describe("debug audit: known workflow regressions", () => {
  // Expected-failure tests describe the required behavior, and fail if the bug is fixed
  // without converting the test to an ordinary it(). Each test uses a fresh database.
  it.fails("reopening a resolved case must not revive its old follow-up date", async () => {
    const c = (await allCases(h)).find((c) => c.workflow.status !== "resolved" && c.workflow.followUpAt)!;
    const resolved = await h.call("staff-manager", "PATCH", `/api/cases/${c.id}/status`, {
      status: "resolved", expectedVersion: c.version,
    });
    expect(resolved.status).toBe(200);
    const reopened = await h.call("staff-manager", "PATCH", `/api/cases/${c.id}/status`, {
      status: "in_progress", expectedVersion: resolved.body.updated[0].version,
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.updated[0].workflow.followUpAt).toBeNull();
  });
});
