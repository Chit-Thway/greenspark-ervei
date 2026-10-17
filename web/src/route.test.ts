import { describe, expect, it } from "vitest";
import { caseHref, caseIdFromPath, isModifiedClick } from "./route";

describe("case routes", () => {
  it("round-trips case IDs through the path", () => {
    expect(caseHref("GS-2011")).toBe("/cases/GS-2011");
    expect(caseIdFromPath("/cases/GS-2011")).toBe("GS-2011");
    expect(caseIdFromPath("/cases/GS-2011/")).toBe("GS-2011");
    expect(caseIdFromPath(caseHref("a b/c"))).toBe("a b/c");
  });

  it("treats every other path as the queue", () => {
    for (const p of ["/", "/cases", "/cases/", "/cases/a/b", "/other/GS-1", "/cases/%E0%A4%A"]) expect(caseIdFromPath(p)).toBeNull();
  });

  it("leaves modified clicks to the browser", () => {
    const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0 };
    expect(isModifiedClick(base)).toBe(false);
    expect(isModifiedClick({ ...base, ctrlKey: true })).toBe(true);
    expect(isModifiedClick({ ...base, metaKey: true })).toBe(true);
    expect(isModifiedClick({ ...base, button: 1 })).toBe(true);
  });
});
