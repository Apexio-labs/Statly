import { expect, test } from "@playwright/test";

const permission = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`[data-permission="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto("/#/settings/privacy");
  await expect(page.getByRole("heading", { name: "Privacy & Security", level: 2 })).toBeVisible();
});

test("the section lists what Statly may do by topic and allows nothing by itself", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { name: "Assistant", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Phone/Tablet", exact: true })).toBeVisible();
  for (const title of [
    "Assistant: deck names",
    "Assistant: cards",
    "External AI apps",
    "Phone card",
    "Sync goals through AnkiWeb",
    "Limit for new cards",
  ]) {
    await expect(page.getByRole("switch", { name: title })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  }
  await expect(page.getByText("Not allowed")).toHaveCount(6);
});

test("switching on goes through Statly's popup and switching off works right away", async ({
  page,
}) => {
  const decks = page.getByRole("switch", { name: "Assistant: deck names" });
  await decks.click();
  await expect(decks).toHaveAttribute("aria-checked", "true");
  await expect(permission(page, "ai.decks").getByText(/^Allowed since/)).toBeVisible();

  await decks.click();
  await expect(decks).toHaveAttribute("aria-checked", "false");
  await expect(permission(page, "ai.decks").getByText("Not allowed")).toBeVisible();
});

test("a no in the popup leaves everything as it was", async ({ page }) => {
  await page.evaluate(() => {
    globalThis.__mockDenyPermissions = true;
  });
  const cards = page.getByRole("switch", { name: "Assistant: cards" });
  await cards.click();
  await expect(cards).toHaveAttribute("aria-checked", "false");
  await expect(permission(page, "ai.cards").getByText("Not allowed")).toBeVisible();
});

test("the phone card is set up here and asked about before it goes", async ({ page }) => {
  const phone = page.getByRole("switch", { name: "Phone card" });
  await phone.click();
  await expect(phone).toHaveAttribute("aria-checked", "true");

  await phone.click();
  const confirm = page.getByRole("alertdialog", { name: "Remove the phone card?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(phone).toHaveAttribute("aria-checked", "false");
});

test("changes in Anki are listed and the newest can be undone", async ({ page }) => {
  const newest = page.locator('[data-change="c0ffee0000000002"]');
  await expect(newest).toContainText("Medizin: new cards today 20 → 34");
  await expect(newest).toContainText("on its own");
  await expect(page.locator('[data-change="c0ffee0000000001"]')).toContainText("undone");

  await newest.getByRole("button", { name: "Undo" }).click();
  await expect(newest).toContainText("undone");
  await expect(newest.getByRole("button", { name: "Undo" })).toHaveCount(0);
});

test("the note in Anki's study screen can be switched off", async ({ page }) => {
  await page.goto("/#/settings/general");
  const toast = page.getByRole("switch", { name: "Note when a goal is met" });
  await expect(toast).toHaveAttribute("aria-checked", "true");
  await toast.click();
  await expect(toast).toHaveAttribute("aria-checked", "false");
});
