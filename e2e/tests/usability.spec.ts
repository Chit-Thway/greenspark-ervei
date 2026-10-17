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
    await page.locator("tbody tr").first().locator(".name-link").click();
    const panel = page.locator(".case-page");
    await expect(panel).toContainText("Support areas and why");
    await expect(panel).toContainText("Suggested for staff review");
    await expect(panel).toContainText("Assistance already reported");
    await expect(panel).toContainText("simulated");
    expect(await panel.locator("a", { hasText: "Open full profile" }).getAttribute("href")).toMatch(/^https:\/\/profiles\.example\/people\/demo-person-\d+$/);
    await page.getByRole("link", { name: /Back to case queue/ }).click();
    await expect(page.locator(".case-table")).toBeVisible();

    // A case with an unknown answer shows Unknown, never No.
    await page.getByRole("combobox", { name: "Sort cases" }).selectOption("name");
    let found = false;
    for (let i = 0; i < 8 && !found; i++) {
      await page.locator("tbody tr").nth(i).locator(".name-link").click();
      await expect(panel).toBeVisible();
      found = (await panel.locator(".answer-unknown").count()) > 0;
      if (!found) {
        await page.getByRole("link", { name: /Back to case queue/ }).click();
        await expect(page.locator(".case-table")).toBeVisible();
      }
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

test.describe("case pages", () => {
  test("each case has its own address; Back returns to the same queue view; unknown cases are explained", async ({ page }) => {
    await openQueue(page);
    await page.getByPlaceholder("Search name, case ID or suburb…").fill("a");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/Page 2 of/)).toBeVisible();
    const row = page.locator("tbody tr").nth(1);
    const id = (await row.getAttribute("data-case-id"))!;
    await row.locator(".name-link").click();
    await expect(page).toHaveURL(new RegExp(`/cases/${id}$`));
    await expect(page.locator(".case-page")).toContainText(id);
    await expect(page.locator("#queue")).not.toContainText("Support areas Filters"); // no sidebar on a case page
    await expect(page.locator("#sidebar")).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(/Page 2 of/)).toBeVisible(); // same page of results
    await expect(page.getByPlaceholder("Search name, case ID or suburb…")).toHaveValue("a");
    await page.goForward();
    await expect(page.locator(".case-page")).toBeVisible();

    // The address works directly (a bookmark or a shared link) and for unknown cases.
    await page.goto(`/cases/${id}`);
    await expect(page.locator("#case-title")).toBeVisible();
    await expect(page.locator(".case-page")).toContainText(id);
    await page.goto("/cases/GS-9999");
    await expect(page.getByRole("heading", { name: "Case not found" })).toBeVisible();
    await page.getByRole("link", { name: /Back to case queue/ }).click();
    await expect(page.locator(".case-table")).toBeVisible();
  });

  test("a modified click leaves the browser to open the case in a new tab", async ({ page, context }) => {
    await openQueue(page);
    const link = page.locator("tbody tr").first().locator(".name-link");
    const href = await link.getAttribute("href");
    const [popup] = await Promise.all([context.waitForEvent("page"), link.click({ modifiers: ["Control"] })]);
    await popup.waitForURL(/\/cases\/GS-\d+$/);
    expect(new URL(popup.url()).pathname).toBe(href);
    await expect(popup.locator(".case-page")).toBeVisible();
    await expect(page.locator(".case-table")).toBeVisible(); // this tab stayed on the queue
  });
});

test.describe("keyboard and accessibility", () => {
  test("a case page can be opened and left from the keyboard, restoring focus", async ({ page }) => {
    await openQueue(page);
    const nameLink = page.locator("tbody tr").first().locator(".name-link");
    await nameLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".case-page")).toBeVisible();
    await expect(page).toHaveURL(/\/cases\/GS-\d+$/);
    await expect(page.locator("#case-title")).toBeFocused(); // a new page starts at its heading
    const back = page.getByRole("link", { name: /Back to case queue/ });
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".case-page")).toHaveCount(0);
    await expect(nameLink).toBeFocused();
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

  test("queue and case page have no serious or critical WCAG A/AA violations", async ({ page }) => {
    await openQueue(page);
    expect(await seriousViolations(page)).toEqual([]);
    await page.locator("tbody tr").first().locator(".name-link").click();
    await expect(page.locator(".case-page")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe("small screen", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("no page-level horizontal scrolling; filters behind a button; the case page is usable", async ({ page }) => {
    await openQueue(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("#sidebar")).toBeHidden();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.getByRole("button", { name: "Expand Heating, cooling & home comfort" }).click();
    await page.getByRole("checkbox", { name: /^Difficulty keeping warm/ }).check();
    await expectTotal(page, 20);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.locator("tbody tr").first().locator(".name-link").click();
    const panel = page.locator(".case-page");
    await expect(panel).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("link", { name: /Back to case queue/ }).click();
    await expect(panel).toHaveCount(0);
    await expectTotal(page, 20); // the filter is still applied
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
