import { expect, type Page, test } from "@playwright/test";

// Wobbling cards never hold still, and Playwright waits for that before it clicks.
test.use({ contextOptions: { reducedMotion: "reduce" } });

const widget = (page: Page, title: string) =>
  page.locator("[data-widget-id]").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });

function isoDay(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?insights");
  await expect(widget(page, "Study overview")).toBeVisible();
});

test("the closer looks show their simulated data", async ({ page }) => {
  await expect(widget(page, "Study overview")).toContainText("4,294");
  await expect(widget(page, "Decks")).toContainText("Terminologie");
  await expect(widget(page, "Forgotten most")).toContainText("M. iliocostalis cervicis Ursprung");
  await expect(widget(page, "Answers")).toContainText("Learning steps");
  await expect(widget(page, "Weakest decks")).toContainText("Dickdarm");
  await expect(widget(page, "New cards from")).toContainText("Ovar und Tube");
  await expect(widget(page, "Range at a glance")).toContainText("Focus");
});

test("a day in the calendar shows its numbers in a structured hover box", async ({ page }) => {
  const day = widget(page, "Study overview").locator(`rect[data-date="${isoDay(-3)}"]`);
  await day.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip.locator(".statly-tip-title")).toBeVisible();
  await expect(tooltip.locator(".statly-tip-row")).toHaveCount(6);
  await expect(tooltip).toContainText("Retention");
});

test("clicking a day in the calendar shows that day everywhere", async ({ page }) => {
  const date = isoDay(-3);
  await widget(page, "Study overview").locator(`rect[data-date="${date}"]`).click();
  const [year, month, day] = date.split("-");
  await expect(page.getByRole("button", { name: "Time range" })).toContainText(
    `${day}.${month}.${year}`,
  );
});

test("the overview's calendar switches between its views", async ({ page }) => {
  const overview = widget(page, "Study overview");
  const pace = overview.getByRole("button", { name: "Pace", exact: true });
  await pace.click();
  await expect(pace).toHaveAttribute("aria-pressed", "true");
  await expect(overview.getByRole("button", { name: "Reviews", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("the deck table sorts by a column and opens subdecks", async ({ page }) => {
  const decks = widget(page, "Decks");
  await decks.getByRole("button", { name: "Show subdecks" }).click();
  await expect(decks).toContainText("Rücken");
  const time = decks.getByRole("button", { name: "Time", exact: true });
  await time.click();
  await time.click();
  const first = decks.locator("[data-tooltip]").first();
  await expect(first).toContainText("Biologie");
});

test("a day note is saved and stays on this computer", async ({ page }) => {
  const notes = widget(page, "Day notes");
  const field = notes.getByRole("textbox");
  // Quiet until something changed: no button, and the privacy hint only in the hover box.
  await expect(notes.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(notes).not.toContainText("never syncs");
  await expect(field).toHaveAttribute("title", /never syncs/);
  await field.fill("Exam review, stayed up late.");
  await notes.getByRole("button", { name: "Save" }).click();
  await expect(notes.getByRole("button", { name: "Saved" })).toBeVisible();
  await expect(field).toBeFocused();
  await expect(notes.getByRole("button", { name: /Save/ })).toHaveCount(0, { timeout: 4000 });
});
