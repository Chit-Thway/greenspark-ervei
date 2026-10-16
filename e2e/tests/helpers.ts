import { expect, type Page } from "@playwright/test";

export const MANAGER = "staff-manager";

export async function openQueue(page: Page, user = MANAGER) {
  await page.addInitScript((u) => localStorage.setItem("greenspark.demoUser", u), user);
  await page.goto("/");
  await expect(page.locator(".case-table")).toBeVisible();
}

export async function total(page: Page): Promise<number> {
  return Number(await page.locator("#list-title .pill").innerText());
}

export async function expectTotal(page: Page, n: number) {
  await expect(page.locator("#list-title .pill")).toHaveText(String(n));
}

export async function switchUser(page: Page, id: string) {
  await page.getByLabel("Demo user (not real sign-in)").selectOption(id);
  await expect(page.locator(".case-table")).toBeVisible();
}

/** Calls the API directly as a demo user (for setting up conflicts). */
export async function api(page: Page, user: string, method: "GET" | "POST" | "PATCH", path: string, data?: unknown) {
  const res = await page.request.fetch(path, { method, headers: { "x-demo-user": user }, data });
  return { status: res.status(), body: await res.json() };
}
