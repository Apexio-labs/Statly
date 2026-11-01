import { expect, type Page, test } from "@playwright/test";

const sidebar = (page: Page) => page.getByTestId("sidebar");
const handle = (page: Page) => page.getByTestId("sidebar-handle");

async function dragHandle(page: Page, dx: number) {
  const bounds = await handle(page).boundingBox();
  if (!bounds) {
    throw new Error("The handle is not visible.");
  }
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + 200;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
}

async function width(page: Page) {
  await page.waitForTimeout(400);
  return Math.round((await sidebar(page).boundingBox())?.width ?? 0);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
});

test("the sidebar can be dragged to any width and stays there", async ({ page }) => {
  await dragHandle(page, -60);
  await expect.poll(() => width(page)).toBe(200);
  await expect(page.getByRole("link", { name: "Home" })).toContainText("Home");
});

test("below 194 pixels only icons remain", async ({ page }) => {
  await dragHandle(page, -100);
  await expect.poll(() => width(page)).toBe(160);
  await expect(page.getByRole("link", { name: "Home" })).not.toContainText("Home");
});

test("the sidebar snaps to its edges", async ({ page }) => {
  await dragHandle(page, -185);
  await expect.poll(() => width(page)).toBe(64);
  await dragHandle(page, 190);
  await expect.poll(() => width(page)).toBe(260);
});

test("the handle also works by keyboard", async ({ page }) => {
  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(page)).toBe(244);
});

test("settings show their own panel and a small main menu", async ({ page }) => {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect.poll(() => width(page)).toBe(64 + 236);
  await page.getByRole("searchbox", { name: "Search settings" }).fill("wallpaper");
  await expect(page.getByRole("link", { name: "News" })).toHaveCount(0);
  await page.getByRole("link", { name: "Wallpaper" }).click();
  await expect(page.getByRole("heading", { name: "Enable custom background" })).toBeVisible();
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await expect.poll(() => width(page)).toBe(260);
});

test("the widget panel can be resized while editing", async ({ page }) => {
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
  await expect.poll(() => width(page)).toBe(64 + 260);
  await dragHandle(page, 40);
  await expect.poll(() => width(page)).toBe(64 + 300);
});

test("theme and language can be changed", async ({ page }) => {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Appearance" }).click();
  await page.getByRole("combobox", { name: "Theme" }).click();
  await page.getByRole("option", { name: "Frutiger Aero" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "frutiger-aero");

  await page.getByRole("link", { name: "General" }).click();
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Deutsch" }).click();
  await expect(page.getByRole("heading", { name: "Allgemein", exact: true })).toBeVisible();
});

test("the sponsor notice cannot be missed in settings", async ({ page }) => {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Oldschool Timeless" }).click();
  await expect(page.getByText("Sponsored by Oldschool Timeless", { exact: true })).toBeVisible();
});

test("a shortcut can be recorded, and conflicts are reported", async ({ page }) => {
  await page.goto("/#/settings/shortcuts");
  const field = page.getByRole("button", { name: "Open Widget Library" });
  await field.click();
  await page.keyboard.press("Control+Alt+L");
  await expect(field).toHaveText(/Ctrl\+Alt\+L|⌃⌥L/);

  await field.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Q" : "Control+Q");
  await expect(page.getByRole("status")).toContainText("Already used by Quit");
});

test("the library shows all statistics and adds or removes them", async ({ page }) => {
  await page.getByRole("link", { name: "Widget Library" }).click();
  await page.getByRole("tab", { name: /^Progress/ }).click();
  await expect(page.locator("[data-library-card]")).toHaveCount(7);
  await page.getByRole("tab", { name: /^All/ }).click();

  await page.getByRole("button", { name: "Add Your study times", exact: true }).click();
  await page.getByRole("button", { name: "Remove Your study times", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Your study times", exact: true }),
  ).toBeVisible();
});

test("Anki's statistics have their own group and reach the dashboard", async ({ page }) => {
  await page.getByRole("link", { name: "Widget Library" }).click();
  await page.getByRole("tab", { name: /Anki statistics/ }).click();
  await expect(page.locator("[data-library-card]")).toHaveCount(13);

  await page.locator('[data-library-card="anki-reviews"] button').last().click();
  await page.locator('[data-library-card="anki-stability"] button').last().click();
  await page.getByRole("link", { name: "Home" }).click();

  const reviews = page.locator('[data-widget-id^="anki-reviews"]');
  await expect(reviews.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(reviews.getByText("Total")).toBeVisible();
  await reviews.getByRole("button", { name: "3 months" }).click();
  await expect(reviews.getByRole("button", { name: "3 months" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await reviews.getByRole("button", { name: "Show time" }).click();
  await expect(reviews.getByRole("button", { name: "Show time" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-widget-id^="anki-stability"]')).toContainText("needs FSRS");
});

test("the library finds tiles by filter and search", async ({ page }) => {
  await page.getByRole("link", { name: "Widget Library" }).click();
  await page.getByRole("tab", { name: /^Habits/ }).click();
  await expect(page.locator("[data-library-card]")).toHaveCount(2);
  await page.getByRole("tab", { name: /^Templates/ }).click();
  await expect(page.locator("[data-library-template]")).toHaveCount(3);
  await expect(page.locator("[data-library-card]")).toHaveCount(0);

  await page.getByRole("tab", { name: /^All/ }).click();
  await page.getByRole("searchbox", { name: "Search widgets and templates" }).fill("heatmap");
  await expect(page.locator("[data-library-card]")).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search widgets and templates" }).fill("zzz");
  await expect(page.getByText("Nothing matches this search.")).toBeVisible();
});

test("favorites are found in the library and in the dashboard panel", async ({ page }) => {
  await page.getByRole("link", { name: "Widget Library" }).click();
  await page.getByRole("button", { name: "Add Due cards to favorites" }).click();
  await page.getByRole("tab", { name: /^Favorites/ }).click();
  await expect(page.locator("[data-library-card]")).toHaveCount(1);

  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("link", { name: "Widget Library" }).click();
  await page.getByRole("button", { name: "Remove Due cards from favorites" }).first().click();
  await expect(page.getByRole("tab", { name: /^Favorites/ })).toContainText("0");
});

test("a tile opens a live preview", async ({ page }) => {
  await page.getByRole("link", { name: "Widget Library" }).click();
  await page.getByRole("button", { name: "Due cards", exact: true }).click();
  await expect(page.getByRole("region", { name: "Preview" })).toContainText("4,294");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a template opens in the editor", async ({ page }) => {
  await page.getByRole("link", { name: "Widget Library" }).click();
  await page.getByRole("button", { name: "Streak", exact: true }).click();
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Streak");
});

test("first start walks through setup and needs the license accepted", async ({ page }) => {
  await page.goto("/?welcome");
  const next = page.getByRole("button", { name: "Next" });
  await expect(next).toBeDisabled();
  await page.getByRole("checkbox").check();
  await next.click();
  await page.getByRole("button", { name: "Deutsch" }).click();
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByRole("button", { name: "Medizinstudent:in" }).click();
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByRole("button", { name: "Websuche" }).click();
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByRole("button", { name: "Frutiger Aero" }).click();
  await page.getByRole("button", { name: "Statly starten" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "frutiger-aero");
});

test("the rating request appears when it is due and can be answered", async ({ page }) => {
  await page.goto("/?rating");
  await expect(page.getByRole("dialog", { name: "Enjoying Statly?" })).toBeVisible();
  await page.getByRole("button", { name: "Maybe later" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the phone card asks before it touches anything", async ({ page }) => {
  await page.goto("/#/settings/mobile");
  await page.getByRole("button", { name: "Set up dashboard card" }).click();
  await expect(page.getByText("Anki makes a backup of your collection first.")).toBeVisible();
  await page.getByRole("button", { name: "Set up now" }).click();
  await expect(page.getByText("Your dashboard card is active")).toBeVisible();
  await page.getByRole("button", { name: "Remove dashboard card" }).click();
  await page.getByRole("button", { name: "Remove for good" }).click();
  await expect(page.getByText("Dashboard card is off")).toBeVisible();
});

const aiPanel = (page: import("@playwright/test").Page) => page.getByTestId("ai-panel");

async function setUpAi(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await aiPanel(page)
    .getByRole("radio", { name: /Anthropic/ })
    .click();
  await aiPanel(page).getByRole("textbox", { name: "API key" }).fill("sk-test-123456789");
  await aiPanel(page).getByRole("button", { name: "Save" }).click();
  await aiPanel(page).getByRole("button", { name: "Understood" }).click();
  await aiPanel(page).getByRole("button", { name: "Chat", exact: true }).click();
}

test("a dashboard background can be chosen per device", async ({ page }) => {
  await page.goto("/#/settings/dashboard");
  const phone = page.locator('[data-background="phone"]');
  await phone.getByRole("button", { name: "Choose picture" }).click();
  await expect(phone.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(
    page.locator('[data-background="desktop"]').getByRole("button", { name: "Remove" }),
  ).toHaveCount(0);
  await phone.getByRole("button", { name: "Remove" }).click();
  await expect(phone.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("Statly can be set to open in full screen", async ({ page }) => {
  await page.goto("/#/settings/general");
  const toggle = page.getByRole("switch", { name: "Open in full screen" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("the settings list and the page share one background", async ({ page }) => {
  await page.goto("/#/settings/general");
  const color = (selector: string) =>
    page.locator(selector).evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(await color('[data-rail="settings"]')).toBe(await color("main"));
});

test("the AI panel slides in and out instead of popping", async ({ page }) => {
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const slot = page.getByTestId("ai-panel-slot");
  await expect.poll(async () => (await slot.boundingBox())?.width ?? 0).toBeGreaterThan(300);
  await aiPanel(page).getByRole("button", { name: "Close the AI panel" }).click();
  await expect(aiPanel(page)).toHaveCount(0);
});

test("the AI opens as a third block and starts with its settings", async ({ page }) => {
  const before = await page.locator("main").boundingBox();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(aiPanel(page)).toBeVisible();
  await expect(aiPanel(page).getByRole("radiogroup", { name: "Service" })).toBeVisible();
  await expect
    .poll(async () => (await page.locator("main").boundingBox())?.width ?? 0)
    .toBeLessThan((before?.width ?? 0) - 300);
  await expect
    .poll(async () => {
      const after = await page.locator("main").boundingBox();
      const panel = await aiPanel(page).boundingBox();
      return (panel?.x ?? 0) - ((after?.x ?? 0) + (after?.width ?? 0));
    })
    .toBeGreaterThan(0);

  await aiPanel(page).getByRole("button", { name: "Close the AI panel" }).click();
  await expect(aiPanel(page)).toHaveCount(0);
});

test("a saved API key disappears from the page for good", async ({ page }) => {
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await aiPanel(page)
    .getByRole("radio", { name: /Anthropic/ })
    .click();
  const field = aiPanel(page).getByRole("textbox", { name: "API key" });
  await expect(field).toHaveAttribute("type", "password");
  await field.fill("sk-secret-123456789");
  await aiPanel(page).getByRole("button", { name: "Save" }).click();

  await expect(aiPanel(page).getByText("Encrypted in your system's keychain")).toBeVisible();
  await expect(field).toHaveCount(0);
  expect(await page.content()).not.toContain("sk-secret-123456789");
  await aiPanel(page).getByRole("button", { name: "Delete" }).click();
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("");
});

async function openKeyLock(page: import("@playwright/test").Page) {
  await aiPanel(page).getByRole("button", { name: "AI settings" }).click();
  await aiPanel(page).getByRole("button", { name: "Advanced" }).click();
}

async function setKeyPassword(page: import("@playwright/test").Page, password: string) {
  await aiPanel(page).getByRole("switch", { name: "Extra password for your keys" }).click();
  await aiPanel(page).getByRole("textbox", { name: "New password", exact: true }).fill(password);
  await aiPanel(page).getByRole("textbox", { name: "Repeat new password" }).fill(password);
  await aiPanel(page).getByRole("button", { name: "Set password" }).click();
  await expect(aiPanel(page).getByRole("button", { name: "Lock now" })).toBeVisible();
}

test("an extra password locks saved keys until it is entered again", async ({ page }) => {
  await setUpAi(page);
  await openKeyLock(page);
  await setKeyPassword(page, "correct horse");
  await expect(aiPanel(page).getByText("locked with your password")).toBeVisible();
  expect(await page.content()).not.toContain("correct horse");

  await aiPanel(page).getByRole("button", { name: "Lock now" }).click();
  await aiPanel(page).getByRole("button", { name: "Chat", exact: true }).click();
  await expect(aiPanel(page).getByText("Your keys are locked")).toBeVisible();
  await expect(aiPanel(page).getByRole("textbox", { name: "Ask about your learning" })).toHaveCount(
    0,
  );

  const field = aiPanel(page).getByRole("textbox", { name: "Password" });
  await field.fill("not the password");
  await aiPanel(page).getByRole("button", { name: "Unlock" }).click();
  await expect(aiPanel(page).getByRole("alert")).toHaveText("That password isn't right.");
  await expect(field).toHaveValue("");

  await field.fill("correct horse");
  await aiPanel(page).getByRole("button", { name: "Unlock" }).click();
  await expect(
    aiPanel(page).getByRole("textbox", { name: "Ask about your learning" }),
  ).toBeVisible();
});

test("a new key password has to be long enough and typed twice", async ({ page }) => {
  await setUpAi(page);
  await openKeyLock(page);
  await aiPanel(page).getByRole("switch", { name: "Extra password for your keys" }).click();
  await expect(aiPanel(page).getByText("nobody can get your keys back")).toBeVisible();
  const save = aiPanel(page).getByRole("button", { name: "Set password" });
  await aiPanel(page).getByRole("textbox", { name: "New password", exact: true }).fill("short");
  await expect(aiPanel(page).getByText("Use at least 8 characters.")).toBeVisible();
  await expect(save).toBeDisabled();
  await aiPanel(page)
    .getByRole("textbox", { name: "New password", exact: true })
    .fill("long enough");
  await aiPanel(page).getByRole("textbox", { name: "Repeat new password" }).fill("different");
  await expect(aiPanel(page).getByText("The passwords don't match.")).toBeVisible();
  await expect(save).toBeDisabled();
  await aiPanel(page).getByRole("textbox", { name: "Repeat new password" }).fill("long enough");
  await expect(save).toBeEnabled();
});

test("a key password can be changed and removed again", async ({ page }) => {
  await setUpAi(page);
  await openKeyLock(page);
  await setKeyPassword(page, "correct horse");

  await aiPanel(page).getByRole("button", { name: "Change password" }).click();
  await aiPanel(page).getByRole("textbox", { name: "Current password" }).fill("wrong one");
  await aiPanel(page)
    .getByRole("textbox", { name: "New password", exact: true })
    .fill("battery staple");
  await aiPanel(page).getByRole("textbox", { name: "Repeat new password" }).fill("battery staple");
  await aiPanel(page).getByRole("button", { name: "Change password" }).click();
  await expect(aiPanel(page).getByRole("alert")).toHaveText("That password isn't right.");
  await aiPanel(page).getByRole("textbox", { name: "Current password" }).fill("correct horse");
  await aiPanel(page).getByRole("button", { name: "Change password" }).click();
  await expect(aiPanel(page).getByRole("button", { name: "Lock now" })).toBeVisible();

  await aiPanel(page).getByRole("switch", { name: "Extra password for your keys" }).click();
  await aiPanel(page).getByRole("textbox", { name: "Current password" }).fill("battery staple");
  await aiPanel(page).getByRole("button", { name: "Remove password" }).click();
  await expect(
    aiPanel(page).getByRole("switch", { name: "Extra password for your keys" }),
  ).not.toBeChecked();
  await expect(aiPanel(page).getByText("Encrypted in your system's keychain")).toBeVisible();
});

test("a forgotten key password can be given up deliberately", async ({ page }) => {
  await setUpAi(page);
  await openKeyLock(page);
  await setKeyPassword(page, "correct horse");
  await aiPanel(page).getByRole("button", { name: "Lock now" }).click();
  await aiPanel(page).getByRole("button", { name: "Chat", exact: true }).click();

  await aiPanel(page).getByRole("button", { name: "Forgot your password?" }).click();
  await aiPanel(page).getByRole("button", { name: "Cancel" }).click();
  await expect(aiPanel(page).getByText("Your keys are locked")).toBeVisible();

  await aiPanel(page).getByRole("button", { name: "Forgot your password?" }).click();
  await aiPanel(page).getByRole("button", { name: "Delete keys and password" }).click();
  await expect(aiPanel(page).getByText("Your keys are locked")).toHaveCount(0);
  await aiPanel(page).getByRole("button", { name: "AI settings" }).click();
  await expect(aiPanel(page).getByRole("textbox", { name: "API key" })).toBeVisible();
});

test("local models keep working while keys are locked", async ({ page }) => {
  await setUpAi(page);
  await openKeyLock(page);
  await setKeyPassword(page, "correct horse");
  await aiPanel(page).getByRole("button", { name: "Lock now" }).click();
  await aiPanel(page)
    .getByRole("radio", { name: /LM Studio/ })
    .click();
  await aiPanel(page).getByRole("button", { name: "Chat", exact: true }).click();
  await expect(aiPanel(page).getByText("Your keys are locked")).toHaveCount(0);
});

test("cloud services explain what gets sent, local ones do not need to", async ({ page }) => {
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await aiPanel(page)
    .getByRole("radio", { name: /^OpenAI/ })
    .click();
  await expect(aiPanel(page).getByText("What gets sent to this service")).toBeVisible();
  await aiPanel(page)
    .getByRole("radio", { name: /LM Studio/ })
    .click();
  await expect(aiPanel(page).getByText("What gets sent to this service")).toHaveCount(0);
  await expect(aiPanel(page).getByRole("textbox", { name: "API key" })).toHaveCount(0);
  await expect(aiPanel(page).getByRole("textbox", { name: "Address" })).toHaveValue(
    "http://127.0.0.1:1234/v1",
  );
});

test("the chat answers and shows which data it used", async ({ page }) => {
  await setUpAi(page);
  await aiPanel(page)
    .getByRole("button", { name: /day before yesterday/ })
    .click();
  await expect(aiPanel(page).getByTestId("ai-answer")).toContainText("1 h 24 min");
  await expect(aiPanel(page).locator("strong")).toHaveText("1 h 24 min");
  await expect(aiPanel(page).getByText("Used 2 statistics")).toBeVisible();
  await expect(aiPanel(page).getByRole("button", { name: "Leave a review" })).toBeVisible();

  await aiPanel(page).getByRole("button", { name: "New chat" }).click();
  await expect(aiPanel(page).getByTestId("ai-answer")).toHaveCount(0);
});

test("a suggested widget is built step by step in the editor", async ({ page }) => {
  await setUpAi(page);
  const field = aiPanel(page).getByRole("textbox", { name: "Ask about your learning" });
  await field.fill("Create a widget for today");
  await field.press("Enter");

  const guide = page.getByTestId("editor-guide");
  await expect(guide).toContainText("Step 1 of 4");
  await expect(page.locator("[data-element-id]")).toHaveCount(0);
  await guide.getByRole("button", { name: "Next" }).click();
  await expect(guide).toContainText("A text");
  await expect(page.locator("[data-element-id]")).toHaveCount(1);
  await guide.getByRole("button", { name: "Next" }).click();
  await expect(guide).toContainText("A metric");
  await guide.getByRole("button", { name: "Next" }).click();
  await expect(guide).toContainText("That's it!");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-custom-widget="Study time"]')).toBeVisible();
  await expect(aiPanel(page).locator('[data-proposal="applied"]')).toBeVisible();

  await aiPanel(page).getByRole("button", { name: "Changes" }).click();
  await aiPanel(page).getByRole("button", { name: "Undo" }).click();
  await expect(aiPanel(page).getByText("Undone.")).toBeVisible();
  await expect(page.locator('[data-custom-widget="Study time"]')).toHaveCount(0);
});

test("the AI asks before it reads cards", async ({ page }) => {
  await setUpAi(page);
  const field = aiPanel(page).getByRole("textbox", { name: "Ask about your learning" });
  await field.fill("Which deck is this card in?");
  await field.press("Enter");

  const request = aiPanel(page).getByRole("alertdialog", { name: "Allow reading your cards?" });
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: "Always allow" }).click();
  await expect(aiPanel(page).getByTestId("ai-answer")).toContainText("Spanish deck");

  await aiPanel(page).getByRole("button", { name: "AI settings" }).click();
  await aiPanel(page).getByRole("button", { name: "Advanced" }).click();
  const toggle = aiPanel(page).getByRole("switch", { name: "Read cards" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("the AI offers choices when it has a question", async ({ page }) => {
  await setUpAi(page);
  const field = aiPanel(page).getByRole("textbox", { name: "Ask about your learning" });
  await field.fill("Please choose for me");
  await field.press("Enter");
  await expect(aiPanel(page).getByText("Which range do you mean?")).toBeVisible();
  await aiPanel(page)
    .getByRole("button", { name: /^This week/ })
    .click();
  await expect(aiPanel(page).getByText("This week", { exact: true })).toBeVisible();
  await expect(aiPanel(page).getByTestId("ai-answer")).toContainText("1 h 24 min");
});

test("options written as plain text still become buttons", async ({ page }) => {
  await setUpAi(page);
  const field = aiPanel(page).getByRole("textbox", { name: "Ask about your learning" });
  await field.fill("Give me some options");
  await field.press("Enter");
  await aiPanel(page).getByRole("button", { name: "Deck activity" }).click();
  await expect(aiPanel(page).getByText("You studied")).toBeVisible();
  await expect(aiPanel(page).getByRole("button", { name: "Study time" })).toHaveCount(0);
});

test("waiting shows changing words", async ({ page }) => {
  await setUpAi(page);
  const field = aiPanel(page).getByRole("textbox", { name: "Ask about your learning" });
  await field.fill("A slow question");
  await field.press("Enter");
  const line = aiPanel(page).getByTestId("working-word");
  await expect(line).toHaveText(/\S/);
  const first = await line.textContent();
  await expect(line).not.toHaveText(first ?? "", { timeout: 2500 });
  await expect(aiPanel(page).getByRole("status")).toHaveText("Working on your answer");
});

test("earlier chats can be reopened and deleted", async ({ page }) => {
  await setUpAi(page);
  const field = aiPanel(page).getByRole("textbox", { name: "Ask about your learning" });
  await field.fill("How much yesterday?");
  await field.press("Enter");
  await expect(aiPanel(page).getByTestId("ai-answer")).toContainText("1 h 24 min");
  await aiPanel(page).getByRole("button", { name: "New chat" }).click();
  await expect(aiPanel(page).getByTestId("ai-answer")).toHaveCount(0);

  await aiPanel(page).getByRole("button", { name: "Earlier chats" }).click();
  await aiPanel(page)
    .getByRole("button", { name: /How much yesterday/ })
    .first()
    .click();
  await expect(aiPanel(page).getByTestId("ai-answer")).toContainText("1 h 24 min");

  await aiPanel(page).getByRole("button", { name: "Earlier chats" }).click();
  await aiPanel(page)
    .getByRole("button", { name: /^Delete/ })
    .click();
  await expect(aiPanel(page).getByText("Your earlier chats will show up here.")).toBeVisible();
});

test("cloud services are marked as beta", async ({ page }) => {
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(aiPanel(page).getByRole("radio", { name: /Anthropic/ })).toContainText("Beta");
  await expect(aiPanel(page).getByRole("radio", { name: /LM Studio/ })).not.toContainText("Beta");
});

test("automatic mode is hidden, off and needs a confirmed warning", async ({ page }) => {
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(aiPanel(page).getByRole("switch", { name: "Automatic mode" })).toHaveCount(0);
  await aiPanel(page).getByRole("button", { name: "Advanced" }).click();

  const toggle = aiPanel(page).getByRole("switch", { name: "Automatic mode" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  const warning = aiPanel(page).getByRole("alertdialog", { name: "Security warning" });
  await expect(warning).toContainText("without asking you");
  await expect(warning.getByRole("button", { name: "Turn on anyway" })).toBeDisabled();
  await warning.getByRole("checkbox").check();
  await warning.getByRole("button", { name: "Turn on anyway" }).click();

  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(aiPanel(page).getByText("Automatic mode is on")).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("external apps stay off until allowed and show their code only once", async ({ page }) => {
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await aiPanel(page).getByRole("button", { name: "Advanced" }).click();
  await aiPanel(page).getByRole("switch", { name: "Allow external AI apps" }).click();
  await aiPanel(page).getByRole("button", { name: "Create connection code" }).click();
  const code = aiPanel(page).getByRole("textbox", { name: "Connection code" });
  await expect(code).toHaveValue("statly1.52741.mock-code");

  await aiPanel(page).getByRole("button", { name: "Close the AI panel" }).click();
  await expect(aiPanel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await aiPanel(page).getByRole("button", { name: "AI settings" }).click();
  await aiPanel(page).getByRole("button", { name: "Advanced" }).click();
  await expect(code).toHaveCount(0);
  await expect(aiPanel(page).getByRole("button", { name: "Create new code" })).toBeVisible();
});
