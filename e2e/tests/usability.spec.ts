import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { expectTotal, openQueue } from "./helpers";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

async function seriousViolations(page: Page) {
  await page.addScriptTag({ content: readFileSync(axePath, "utf8") });
  const result = await page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] });
    return r.violations.filter((v: { impact: string }) => v.impact === "serious" || v.impact === "critical")
      .map((v: { id: string; nodes: { target: unknown }[] }) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => JSON.stringify(n.target)).join(", ")}`);
  });
  return result as string[];
}

test.describe("states and content rules", () => {
  test("empty results, pending and unavailable model states, and unknown evidence", async ({ page }) => {
    await openQueue(page);
    await page.getByPlaceholder("Search name, case ID or suburb…").fill("zzzz-no-match");
    await expect(page.getByRole("heading", { name: "No cases match" })).toBeVisible();
    await page.getByRole("button", { name: "Reset filters" }).click();
    await expectTotal(page, 100);

    await page.locator(".sidebar").getByLabel("Assessment availability").selectOption("pending");
    await expectTotal(page, 5);
    await expect(page.locator(".badge-none").first()).toHaveText("Assessment pending");
    await expect(page.locator(".badge-routine")).toHaveCount(0);
    await page.locator(".sidebar").getByLabel("Assessment availability").selectOption("unavailable");
    await expectTotal(page, 5);
    await expect(page.locator(".badge-none").first()).toHaveText("Assessment unavailable");
    await page.getByRole("button", { name: "Reset", exact: true }).click();

    // Minimum score excludes unscored cases rather than treating them as zero.
    await page.locator(".sidebar input[type=range]").fill("1");
    await expectTotal(page, 90);
    await page.getByRole("button", { name: "Reset", exact: true }).click();

    // The highest-priority case explains why it is flagged, with staff-review suggestions and the profile link.
    await page.locator("tbody tr").first().locator(".name-btn").click();
    const panel = page.locator(".overview");
    await expect(panel).toContainText("Support areas and why");
    await expect(panel).toContainText("Suggested for staff review");
    await expect(panel).toContainText("Assistance already reported");
    await expect(panel).toContainText("simulated");
    expect(await panel.locator("a", { hasText: "Open full profile" }).getAttribute("href")).toMatch(/^https:\/\/profiles\.example\/people\/demo-person-\d+$/);
    await page.keyboard.press("Escape");

    // A case with an unknown answer shows Unknown, never No.
    await page.getByRole("combobox", { name: "Sort cases" }).selectOption("name");
    let found = false;
    for (let i = 0; i < 8 && !found; i++) {
      await page.locator("tbody tr").nth(i).locator(".name-btn").click();
      found = (await panel.locator(".answer-unknown").count()) > 0;
      if (!found) await page.keyboard.press("Escape");
    }
    expect(found).toBe(true);
    await expect(panel.locator(".answer-unknown").first()).toContainText(/Unknown|Not asked/);
  });

  test("a failed list request shows an error with retry", async ({ page }) => {
    await page.route("**/api/cases?*", (route) => route.abort());
    await page.addInitScript(() => localStorage.setItem("greenspark.demoUser", "staff-manager"));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "We couldn’t load cases" })).toBeVisible();
    await page.unroute("**/api/cases?*");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".case-table")).toBeVisible();
  });
});

test.describe("keyboard and accessibility", () => {
  test("a case can be opened, used and closed from the keyboard, restoring focus", async ({ page }) => {
    await openQueue(page);
    const nameBtn = page.locator("tbody tr").first().locator(".name-btn");
    await nameBtn.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".overview")).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.closest(".overview") !== null)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".overview")).toHaveCount(0);
    await expect(nameBtn).toBeFocused();
  });

  test("filters work with the keyboard", async ({ page }) => {
    await openQueue(page);
    const toggle = page.getByRole("button", { name: /^(Expand|Collapse) Heating, cooling/ }); // its name flips when toggled
    await expect(page.getByRole("checkbox", { name: /^Difficulty keeping warm/ })).toHaveCount(0); // areas start collapsed
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const box = page.getByRole("checkbox", { name: /^Difficulty keeping warm/ });
    await box.focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".chip")).toContainText("Difficulty keeping warm");
    await expect(page.getByRole("checkbox", { name: /^Heating, cooling/ })).toHaveJSProperty("indeterminate", true);
  });

  test("queue and overview have no serious or critical WCAG A/AA violations", async ({ page }) => {
    await openQueue(page);
    expect(await seriousViolations(page)).toEqual([]);
    await page.locator("tbody tr").first().locator(".name-btn").click();
    await expect(page.locator(".overview")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe("small screen", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("no page-level horizontal scrolling; filters behind a button; overview is usable", async ({ page }) => {
    await openQueue(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("#sidebar")).toBeHidden();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.getByRole("button", { name: "Expand Heating, cooling & home comfort" }).click();
    await page.getByRole("checkbox", { name: /^Difficulty keeping warm/ }).check();
    await expectTotal(page, 20);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.locator("tbody tr").first().locator(".name-btn").click();
    const panel = page.locator(".overview");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390.5);
    await page.getByRole("button", { name: "Close overview" }).click();
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
