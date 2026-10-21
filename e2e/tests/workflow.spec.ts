import { expect, test } from "@playwright/test";
import { api, expectTotal, MANAGER, openQueue, switchUser, total } from "./helpers";

// One shared database for the run, so these steps run in order as a single story.
test.describe.serial("manager to worker workflow", () => {
  let assigned: string[] = [];

  test("manager sees all 200 demo cases with counters and filter counts", async ({ page }) => {
    await openQueue(page);
    await expectTotal(page, 200);
    await expect(page.locator("thead th")).toContainText(["", "Person / case", "Priority", "Support needs", "Assigned to", "Status / follow-up"]); // Priority comes before Support needs
    await expect(page.locator("thead th")).toHaveCount(6);
    await expect(page.getByText("View case")).toHaveCount(0); // no separate button; the name opens the case
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await expect(page.getByText("Showing 1–50 of 200 cases")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Unassigned/ })).toHaveCount(0); // every case has a worker
    await expect(page.locator(".sidebar")).toContainText("Income and work"); // support areas are the flowchart's categories
    await expect(page.locator(".sidebar")).not.toContainText("Domestic violence");
  });

  test("manager bulk-reassigns two of Sarah's cases to Alex, then Undo restores them", async ({ page }) => {
    await openQueue(page);
    await page.locator(".sidebar").getByLabel("Assigned worker").selectOption({ label: "Sarah Chen" });
    await expectTotal(page, 40);
    const boxes = page.locator("tbody tr input[type=checkbox]");
    assigned = await page.locator("tbody tr").evaluateAll((rows) => rows.slice(0, 2).map((r) => r.getAttribute("data-case-id")!));
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByLabel("Assign selected cases to").selectOption({ label: "Alex Morgan" });
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.locator(".notice-success")).toContainText("Assigned 2 cases to Alex Morgan");
    await expectTotal(page, 38);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".notice-success")).toContainText("Undone");
    await expectTotal(page, 40);

    // Assign again for the worker steps.
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByLabel("Assign selected cases to").selectOption({ label: "Alex Morgan" });
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.locator(".notice-success")).toContainText("Assigned 2 cases");
    await expectTotal(page, 38);
  });

  test("selection survives paging and drops cases that stop matching a filter", async ({ page }) => {
    await openQueue(page);
    const onPageOne = await page.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-case-id")!));
    await page.getByLabel("Select all cases on this page").check();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Page 2 of 4")).toBeVisible();
    await expect(page.locator(".bulkbar strong")).toHaveText("50 selected");
    await page.locator(".sidebar").getByLabel("Case status").selectOption("resolved");
    await expectTotal(page, 20);
    // Only selected cases that are also resolved may stay selected.
    const resolved = new Set((await api(page, MANAGER, "GET", "/api/cases/ids?status=resolved")).body.ids as string[]);
    const stillSelected = onPageOne.filter((id) => resolved.has(id)).length;
    if (stillSelected === 0) await expect(page.locator(".bulkbar")).toHaveCount(0);
    else await expect(page.locator(".bulkbar strong")).toHaveText(`${stillSelected} selected`);
  });

  test("the worker finds the assigned cases under Assigned to me and updates them", async ({ page }) => {
    await openQueue(page, "staff-alex");
    await page.getByRole("button", { name: /^Assigned to me/ }).click();
    expect(await total(page)).toBeGreaterThanOrEqual(2);
    for (const id of assigned) await expect(page.locator(`tr[data-case-id="${id}"]`)).toBeVisible(); // the two cases the manager assigned
    const first = page.locator("tbody tr").first();
    const caseId = (await first.getAttribute("data-case-id"))!; // internal key, for API calls
    const account = (await first.locator(".name-link").getAttribute("data-account-link"))!;
    const startStatus = (await first.locator(".status").innerText()).trim(); // read before leaving the queue
    await first.locator(".name-link").click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${account}$`));
    const panel = page.locator(".case-page");
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("Assigned worker")).toBeDisabled();
    await expect(panel).toContainText("Only managers can assign cases");

    await panel.getByLabel("Add a case note").fill("Called and left a message.");
    await panel.getByRole("button", { name: "Add note" }).click();
    await expect(page.locator(".notice-success")).toContainText("Note added");
    await expect(panel.locator(".notes")).toContainText("Called and left a message.");
    await expect(panel.locator(".notes li").last().locator(".sub")).toContainText(/\d{1,2} \w{3} 20\d\d · \d{1,2}:\d{2} (am|pm)/); // year and the full time
    // Who and when come first, with the note text underneath.
    const noteLine = panel.locator(".notes li").last();
    const [whoY, textY] = [(await noteLine.locator(".sub").boundingBox())!.y, (await noteLine.locator("p").boundingBox())!.y];
    expect(whoY).toBeLessThan(textY);

    // The author can correct their note; it is marked as edited and keeps its place.
    await panel.getByRole("button", { name: /^Edit note from/ }).last().click();
    await panel.getByLabel("Edit note").fill("Called and spoke to the customer.");
    await panel.getByRole("button", { name: "Save note" }).click();
    await expect(page.locator(".notice-success")).toContainText("Note updated");
    const edited = panel.locator(".notes li").last();
    await expect(edited).toContainText("Called and spoke to the customer.");
    await expect(edited).not.toContainText("left a message");
    await expect(edited.locator(".sub")).toContainText(/edited \d{1,2} \w{3} 20\d\d/);
    await panel.getByRole("button", { name: /^Edit note from/ }).last().click();
    await panel.getByRole("button", { name: "Cancel" }).click(); // cancelling changes nothing
    await expect(edited).toContainText("Called and spoke to the customer.");

    // The note box is tall, and there is no length limit: a 700-character note is saved whole.
    const box = panel.getByLabel("Add a case note");
    expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(160);
    expect(await box.getAttribute("maxlength")).toBeNull();
    await expect(panel).not.toContainText("/500");
    const longNote = `Line one.\nLine two. ${"More detail. ".repeat(50)}`.trim();
    await box.fill(longNote);
    await panel.getByRole("button", { name: "Add note" }).click();
    await expect(page.locator(".notice-success")).toContainText("Note added");
    await expect(panel.locator(".notes li").last().locator("p")).toContainText("More detail. More detail.");
    expect((await panel.locator(".notes li").last().locator("p").innerText()).length).toBeGreaterThan(600);

    const status = startStatus === "Waiting" ? "in_progress" : "waiting";
    await panel.getByLabel("Case status").selectOption(status);
    await panel.getByRole("button", { name: "Save status" }).click();
    await expect(page.locator(".notice-success")).toContainText("Status set to");

    const review = panel.getByRole("button", { name: /Mark/ });
    await review.click();
    await expect(page.locator(".notice-success")).toContainText("Marked as");

    // A stale edit: the manager adds a note behind the worker's back.
    const cur = (await api(page, MANAGER, "GET", `/api/cases/${caseId}/overview`)).body.case;
    await api(page, MANAGER, "POST", `/api/cases/${caseId}/notes`, { text: "Manager edit", expectedVersion: cur.version });
    await panel.getByLabel("Case status").selectOption(status === "waiting" ? "new" : "waiting");
    await panel.getByRole("button", { name: "Save status" }).click();
    await expect(page.locator(".notice-error")).toContainText("changed by someone else");
    await expect(panel.locator(".notes")).toContainText("Manager edit");
  });

  test("a worker's bulk update on other people's cases is refused as a whole", async ({ page }) => {
    await openQueue(page, "staff-alex");
    await page.getByLabel("Select all cases on this page").check();
    await expect(page.getByRole("button", { name: "Assign", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Update status" }).click();
    const err = page.locator(".notice-error");
    await expect(err).toContainText("No changes were made");
    await expect(err.locator("li").first()).toContainText("assigned to you");
  });

  test("there is no New case form", async ({ page }) => {
    await openQueue(page);
    await expect(page.getByRole("button", { name: /New case/ })).toHaveCount(0);
  });

  test("worker view is the same shared queue; managers cannot be impersonated by request body", async ({ page }) => {
    await openQueue(page, "staff-sarah");
    await expectTotal(page, 200);
    const cur = (await api(page, "staff-sarah", "GET", `/api/cases/${assigned[0]}/overview`)).body.case;
    const r = await api(page, "staff-sarah", "POST", "/api/cases/bulk/assignment", { assigneeUserId: "staff-sarah", items: [{ caseId: cur.id, expectedVersion: cur.version }], actorUserId: MANAGER });
    expect(r.status).toBe(422);
    const r2 = await api(page, "staff-sarah", "POST", "/api/cases/bulk/assignment", { assigneeUserId: "staff-sarah", items: [{ caseId: cur.id, expectedVersion: cur.version }] });
    expect(r2.status).toBe(403);
    await switchUser(page, "staff-manager");
  });
});
