import { expect, type Page, test } from "@playwright/test";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const sidebar = (page: Page) => page.getByTestId("sidebar");

async function newExamGoal(page: Page) {
  await page.goto("/#/goals");
  await page.getByRole("link", { name: /Pass an exam/ }).click();
  await expect(page.getByRole("heading", { name: "New exam goal" })).toBeVisible();
}

async function chooseDeck(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Decks" }).click();
  await page.getByRole("option", { name }).first().click();
  await page.keyboard.press("Escape");
}

test("study goals sit in the sidebar right above the assistant", async ({ page }) => {
  await page.goto("/");
  const goals = await sidebar(page).getByRole("link", { name: "Goals" }).boundingBox();
  const assistant = await sidebar(page)
    .getByRole("button", { name: "AI", exact: true })
    .boundingBox();
  const statistics = await sidebar(page)
    .getByRole("button", { name: "Anki statistics" })
    .boundingBox();
  expect(goals && assistant && statistics).toBeTruthy();
  expect(statistics?.y ?? 0).toBeLessThan(goals?.y ?? 0);
  expect(goals?.y ?? 0).toBeLessThan(assistant?.y ?? 0);
  await sidebar(page).getByRole("link", { name: "Goals" }).click();
  await expect(page.getByRole("heading", { name: "Study goals" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Pass an exam/ })).toBeVisible();
});

test("a ticked parent takes its subdecks along in the deck choice", async ({ page }) => {
  await newExamGoal(page);
  await page.getByRole("button", { name: "Decks" }).click();
  const list = page.getByRole("listbox", { name: "Decks" });
  await list
    .getByRole("option", { name: /Medizin/ })
    .first()
    .click();
  await list.getByRole("button", { name: "Expand Medizin" }).click();
  const anatomy = list.getByRole("option", { name: /Anatomie/ });
  await expect(anatomy).toHaveAttribute("aria-disabled", "true");
  await expect(list.getByRole("option", { name: /Sprachen/ }).first()).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Decks" })).toContainText("Medizin");
  await expect(page.getByText(/810 cards, 400 of them still to learn/)).toBeVisible();
});

test("the preview counts live while the goal is set up", async ({ page }) => {
  await newExamGoal(page);
  await expect(page.getByText("Choose decks to see your numbers.")).toBeVisible();
  await chooseDeck(page, /Sprachen/);
  const preview = page.getByRole("complementary", { name: "Preview" });
  await expect(preview.getByRole("img", { name: /of \d+ done today/ })).toBeVisible();
  await expect(page.getByText("Recommended")).toBeVisible();
});

test("the calendar sets the exam day, the buffer and days off", async ({ page }) => {
  await newExamGoal(page);
  await page.getByRole("button", { name: "Exam date, buffer and days off" }).click();
  const field = page.getByRole("textbox", { name: "Exam date" });
  await field.fill("15.01.2030");
  await page.getByRole("button", { name: "One day more" }).click();
  const sunday = page.getByRole("button", { name: "Sun", exact: true });
  await sunday.click();
  await expect(sunday).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Days off", exact: true }).click();
  await page.getByRole("button", { name: /^7 / }).first().click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: "Exam date, buffer and days off" })).toContainText(
    "January 15, 2030 · 4 days buffer",
  );
});

test("a goal goes onto the dashboard and leaves it with its deletion", async ({ page }) => {
  await newExamGoal(page);
  await chooseDeck(page, /Medizin/);
  await page.getByRole("textbox", { name: "Name" }).fill("Anatomy exam");
  await page.getByRole("button", { name: "Save and Add to Dashboard" }).click();

  const widget = page.locator('[data-widget-id^="goal-"]');
  await expect(widget).toContainText("Anatomy exam");
  await expect(widget.getByRole("img", { name: /of \d+ done today/ })).toBeVisible();

  await sidebar(page).getByRole("link", { name: "Goals" }).click();
  const card = page.locator("[data-goal]");
  await expect(card).toContainText("On the dashboard");
  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.locator('[data-widget-id^="goal-"]')).toHaveCount(0);
});

test("an archived goal waits below the running ones", async ({ page }) => {
  await newExamGoal(page);
  await chooseDeck(page, /Sprachen/);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-goal]")).toHaveCount(1);
  await page.locator("[data-goal]").getByRole("button", { name: "Archive" }).click();
  await expect(page.locator("[data-goal]")).toHaveCount(0);
  await page.getByRole("button", { name: "1 archived goal" }).click();
  await expect(page.locator("[data-goal]").getByRole("button", { name: "Restore" })).toBeVisible();
});

test("leaving with unsaved settings asks first, whichever way", async ({ page }) => {
  await newExamGoal(page);
  await page.getByRole("textbox", { name: "Name" }).fill("Half done");
  const dialog = page.getByRole("alertdialog", { name: "Save your changes?" });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();

  await page.getByRole("link", { name: "Back to New goal" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Half done");

  await page.getByRole("button", { name: "New exam goal", exact: true }).click();
  await page.getByRole("menuitem", { name: "Study goals" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("heading", { name: "Study goals" })).toBeVisible();
});

test("a right click on a goal while the dashboard is edited still asks first", async ({ page }) => {
  await newExamGoal(page);
  await chooseDeck(page, /Sprachen/);
  await page.getByRole("button", { name: "Save and Add to Dashboard" }).click();
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Study goals" }).click();
  await page.getByRole("button", { name: /^Add / }).first().click();
  await page.locator("[data-goal-widget]").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in Goals" }).click();
  await expect(page.getByRole("alertdialog", { name: "Save your changes?" })).toBeVisible();
});

test("the widget bar offers goals while the dashboard is edited", async ({ page }) => {
  await newExamGoal(page);
  await chooseDeck(page, /Sprachen/);
  await page.getByRole("textbox", { name: "Name" }).fill("Spanish test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Study goals" }).click();
  await page.getByRole("button", { name: "Add Spanish test" }).click();
  await expect(page.locator('[data-widget-id^="goal-"]')).toContainText("Spanish test");
  await expect(page.getByRole("link", { name: "New study goal…" })).toBeVisible();
});

test("in Frutiger Aero the goals entry has its glossy icon", async ({ page }) => {
  await page.goto("/#/settings/appearance");
  await page.getByRole("combobox", { name: "Theme" }).click();
  await page.getByRole("option", { name: "Frutiger Aero" }).click();
  await expect(sidebar(page).getByRole("link", { name: "Goals" }).locator("img")).toBeVisible();
});

async function goalPage(page: Page, deck: RegExp) {
  await newExamGoal(page);
  await chooseDeck(page, deck);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("[data-goal] h3 a").click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

test("a deck in the ring opens its subdecks and the middle goes back", async ({ page }) => {
  await goalPage(page, /Medizin/);
  const medizin = page.getByRole("button", { name: /^Open Medizin: \d+ of \d+$/ });
  const [, done, target] =
    (await medizin.getAttribute("aria-label"))?.match(/(\d+) of (\d+)/) ?? [];
  await medizin.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("img", { name: `${done} of ${target} done today` })).toBeVisible();
  const back = page.getByRole("button", { name: "Back" });
  await expect(back).toBeVisible();
  await back.focus();
  await page.keyboard.press("Escape");
  await expect(back).toHaveCount(0);
  await expect(medizin).toBeVisible();

  await medizin.focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-ring-center]").click();
  await expect(medizin).toBeVisible();
});

test("a goal's page shows its numbers, its decks and the badges earned", async ({ page }) => {
  await goalPage(page, /Medizin/);
  await expect(page.getByRole("heading", { name: "Today in numbers" })).toBeVisible();
  await expect(page.locator("[data-deck-row]")).toHaveCount(3);
  await expect(page.locator('[data-badge="7"]')).toHaveAttribute("data-earned", "true");
  await expect(page.locator('[data-badge="14"]')).toHaveAttribute("data-earned", "false");
  await expect(page.getByText("Nothing stands in the way.")).toBeVisible();
  const numbers = page.locator("section", {
    has: page.getByRole("heading", { name: "Today in numbers" }),
  });
  await expect(numbers.getByText(/^≈ (\d+ h )?\d+ min \(\d+–\d+ min\)$/).first()).toBeVisible();
  await expect(numbers.getByText(/^\d+ new \(.+\) \+ \d+ reviews \(.+\)$/)).toBeVisible();
  await expect(page.locator("[data-time-left]").first()).toHaveText(/^≈ .+ to go$/);

  await page.getByRole("button", { name: "Add Timeline to Dashboard" }).click();
  await expect(page.getByRole("button", { name: "Timeline on the dashboard" })).toBeDisabled();
  await page.getByRole("link", { name: "Home" }).click();
  const widget = page.locator('[data-widget-id^="goal-"]');
  await expect(widget.getByRole("list", { name: "Days until the exam" })).toBeVisible();
});

test("meeting the day's goal is celebrated once, without confetti when motion is reduced", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (globalThis as { __mockGoalShare?: number }).__mockGoalShare = 1;
  });
  await newExamGoal(page);
  await chooseDeck(page, /Sprachen/);
  await page.getByRole("button", { name: "Save and Add to Dashboard" }).click();
  const party = page.locator("[data-celebration]");
  await expect(party).toContainText("Goal reached!");
  await expect(party).toContainText("New badge: 7 days in a row");
  await expect(party.locator(".statly-confetti").first()).toBeHidden();

  await sidebar(page).getByRole("link", { name: "Goals" }).click();
  await page.locator("[data-goal] h3 a").click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.locator("[data-celebration]")).toHaveCount(0);
});

test("the arrow and the title lead back to the pages above", async ({ page }) => {
  await goalPage(page, /Sprachen/);
  await page.getByRole("link", { name: "Back to Study goals" }).click();
  await expect(page.getByRole("heading", { name: "Study goals" })).toBeVisible();

  await page.locator("[data-goal] h3 a").click();
  await page.getByRole("button", { name: "Sprachen", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Pages above this one" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Sprachen", "Study goals", "Statly"]);
  await expect(menu.getByRole("menuitem", { name: "Sprachen" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Statly" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("a right click on a goal on the dashboard opens it in Goals", async ({ page }) => {
  await newExamGoal(page);
  await chooseDeck(page, /Sprachen/);
  await page.getByRole("button", { name: "Save and Add to Dashboard" }).click();
  await page.locator("[data-goal-widget]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in Goals" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});

test("pointing at a deck lights it in the table and the ring", async ({ page }) => {
  await goalPage(page, /Medizin/);
  await page.locator('[data-deck-row="4"]').hover();
  await expect(page.locator('[data-slice="outer-deck-4"]')).toHaveAttribute("data-lit", "true");
  await page.locator('[data-day-kind="today"]').hover();
  await expect(page.getByText(/: \d+ cards?, today$/).first()).toBeVisible();
});

test("a goal that also sees each card again learns earlier and names late cards", async ({
  page,
}) => {
  await newExamGoal(page);
  await chooseDeck(page, /Medizin/);
  await page.getByRole("radio", { name: /review it once/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("[data-goal] h3 a").click();
  await expect(page.getByText("Learned and seen again")).toBeVisible();
  await expect(page.getByText("Waiting to come back")).toBeVisible();
  await expect(page.getByText(/\(back after about 3 days\)/)).toBeVisible();
  await expect(
    page.getByText("4 learned cards would come back only after the deadline."),
  ).toBeVisible();
  await expect(page.locator('[data-day-kind="review"]').first()).toBeAttached();
});

async function goalWithTooFewNewCards(page: Page) {
  await newExamGoal(page);
  await chooseDeck(page, /Medizin/);
  await page.getByRole("button", { name: "Exam date, buffer and days off" }).click();
  const soon = new Date(Date.now() + 6 * 86_400_000);
  const day = `${String(soon.getDate()).padStart(2, "0")}.${String(soon.getMonth() + 1).padStart(2, "0")}.${soon.getFullYear()}`;
  await page.getByRole("textbox", { name: "Exam date" }).fill(day);
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("[data-goal] h3 a").click();
  await expect(page.getByText(/shows only 20 new cards a day/)).toBeVisible();
}

test("raising today's limit asks, shows what changed and can be taken back", async ({ page }) => {
  await goalWithTooFewNewCards(page);
  await page.getByRole("button", { name: "Raise for today" }).click();

  const notice = page.getByRole("status", { name: "Statly changed this in Anki" });
  await expect(notice).toContainText(/Medizin: new cards today 20 → \d+/);
  await expect(page.getByText(/shows only 20 new cards a day/)).toHaveCount(0);

  await notice.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-change-notice]")).toContainText("Taken back");
  await expect(page.getByText(/shows only 20 new cards a day/)).toBeVisible();
});

test("a no in Statly's popup changes nothing", async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { __mockDenyPermissions?: boolean }).__mockDenyPermissions = true;
  });
  await goalWithTooFewNewCards(page);
  await page.getByRole("button", { name: "Raise for today" }).click();
  await expect(page.locator("[data-change-notice]")).toHaveCount(0);
  await expect(page.getByText(/shows only 20 new cards a day/)).toBeVisible();
});

test("the goals page says whether goals sync and leads to the switch", async ({ page }) => {
  await newExamGoal(page);
  await chooseDeck(page, /Sprachen/);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const line = page.locator("[data-goal-sync]");
  await expect(line).toContainText("Your goals stay on this computer.");
  await line.getByRole("button", { name: "Sync through AnkiWeb" }).click();
  const sync = page.getByRole("switch", { name: "Sync goals through AnkiWeb" });
  await expect(sync).toBeVisible();
  await sync.click();
  await expect(sync).toHaveAttribute("aria-checked", "true");
  await sidebar(page).getByRole("link", { name: "Goals" }).click();
  await expect(line).toContainText("Your goals sync through AnkiWeb");
});
