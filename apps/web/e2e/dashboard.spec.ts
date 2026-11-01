import { expect, type Locator, type Page, test } from "@playwright/test";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const grid = (page: Page) => page.getByTestId("dashboard-grid");
const widget = (page: Page, title: string) =>
  page.locator("[data-widget-id]").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
const position = async (locator: Locator) =>
  (await locator.getAttribute("data-grid"))?.split(",").map(Number) ?? [];

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("The element is not visible.");
  }
  return bounds;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

async function dragWidget(page: Page, target: Locator, dx: number, dy: number) {
  const start = await box(target);
  const from = { x: start.x + 40, y: start.y + 60 };
  await drag(page, from, { x: from.x + dx, y: from.y + dy });
}

/** The side panel opens with an animation, and the grid is only in place after it. */
test("a tile too small for its note keeps everything inside the card", async ({ page }) => {
  const widget = page.locator('[data-widget-id^="due-cards"]');
  await widget.evaluate((element: HTMLElement) => {
    element.style.width = "130px";
    element.style.height = "120px";
  });
  const card = await box(widget.locator("section"));
  const note = widget.getByText("Ready to study now");
  const shown = await box(note);
  const room = await box(note.locator(".."));
  const hidden = shown.x >= room.x + room.width;
  expect(hidden || shown.y + shown.height <= room.y + room.height).toBe(true);
  const value = await box(widget.locator("p").first());
  expect(value.y + value.height).toBeLessThanOrEqual(card.y + card.height);
});

async function startEditing(page: Page) {
  await button(page, "Edit dashboard").click();
  await expect(page.getByRole("heading", { name: "Widgets" })).toBeVisible();
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(widget(page, "Reviews")).toBeVisible();
});

test("shows the default statistics with simulated data", async ({ page }) => {
  await expect(widget(page, "Due cards")).toContainText("4,294");
  await expect(widget(page, "Study time")).toContainText("1 h 5 min");
});

test("grid cells appear only while editing", async ({ page }) => {
  await expect(page.getByTestId("grid-cells")).toHaveCount(0);
  await startEditing(page);
  await expect(page.getByTestId("grid-cells")).toBeVisible();
  await button(page, "Cancel").click();
  await expect(page.getByTestId("grid-cells")).toHaveCount(0);
});

test("a dropped widget snaps to whole cells and stays there, leaving a gap", async ({ page }) => {
  await startEditing(page);
  const target = widget(page, "Reviews");
  const { width } = await box(target);
  const column = (width + 14) / 3;

  await dragWidget(page, target, column * 3 + 7, 45 * 10 + 9);

  const [x, y] = await position(target);
  expect(x).toBe(3);
  expect(y).toBe(10);
  await expect(widget(page, "Study time")).toHaveAttribute("data-grid", "3,0,3,4");
  await expect(widget(page, "Success rate")).toHaveAttribute("data-grid", "6,0,3,4");
});

test("a widget in the way steps aside instead of overlapping", async ({ page }) => {
  await startEditing(page);
  const moved = widget(page, "Reviews");
  const blocked = widget(page, "Study time");
  const { width } = await box(moved);
  await dragWidget(page, moved, width + 14, 0);

  const [mx, my, mw, mh] = await position(moved);
  const [bx, by, bw, bh] = await position(blocked);
  const separate =
    (mx as number) + (mw as number) <= (bx as number) ||
    (bx as number) + (bw as number) <= (mx as number) ||
    (my as number) + (mh as number) <= (by as number) ||
    (by as number) + (bh as number) <= (my as number);
  expect(separate).toBe(true);
});

test("target cells mark where a widget will land", async ({ page }) => {
  await startEditing(page);
  const target = widget(page, "Reviews");
  const start = await box(target);
  await page.mouse.move(start.x + 40, start.y + 60);
  await page.mouse.down();
  await page.mouse.move(start.x + 42, start.y + 130, { steps: 4 });
  await expect(page.getByTestId("grid-target")).toHaveAttribute("data-grid-target", "0,2,3,4");
  await page.mouse.up();
  await expect(page.getByTestId("grid-target")).toHaveCount(0);
});

test("Escape cancels a drag", async ({ page }) => {
  await startEditing(page);
  const target = widget(page, "Reviews");
  const before = await position(target);
  const start = await box(target);
  await page.mouse.move(start.x + 40, start.y + 60);
  await page.mouse.down();
  await page.mouse.move(start.x + 400, start.y + 500, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await position(target)).toEqual(before);
});

test("resizing moves in whole cells and respects the allowed size", async ({ page }) => {
  await startEditing(page);
  const target = widget(page, "Reviews");
  const handle = await box(target.getByRole("button", { name: "Change size" }));
  const from = { x: handle.x + 10, y: handle.y + 10 };

  await drag(page, from, { x: from.x + 110, y: from.y + 48 });
  const [, , width, height] = await position(target);
  expect(width).toBe(4);
  expect(height).toBe(5);

  const grown = await box(target.getByRole("button", { name: "Change size" }));
  await drag(page, { x: grown.x + 10, y: grown.y + 10 }, { x: grown.x + 1200, y: grown.y + 700 });
  const [, , widest, tallest] = await position(target);
  expect(widest).toBe(6);
  expect(tallest).toBe(8);
});

test("arrow keys move a focused widget, with Shift they resize it", async ({ page }) => {
  await startEditing(page);
  const target = widget(page, "Due cards");
  await target.focus();
  await page.keyboard.press("ArrowDown");
  expect((await position(target))[1]).toBe(1);
  await page.keyboard.press("Shift+ArrowUp");
  expect((await position(target))[3]).toBe(3);
});

test("saving keeps the layout, cancel restores it", async ({ page }) => {
  await startEditing(page);
  const target = widget(page, "Reviews");
  await dragWidget(page, target, 0, 45 * 14);
  const moved = await position(target);
  await button(page, "Save").click();
  await expect(button(page, "Edit dashboard")).toBeVisible();
  expect(await position(target)).toEqual(moved);

  await startEditing(page);
  await widget(page, "Study time").getByRole("button", { name: "Remove from dashboard" }).click();
  await expect(widget(page, "Study time")).toHaveCount(0);
  await button(page, "Cancel").click();
  await button(page, "Discard").click();
  await expect(widget(page, "Study time")).toBeVisible();
});

test("the widget panel adds and finds statistics", async ({ page }) => {
  await startEditing(page);
  await page.getByRole("searchbox", { name: "Search widgets" }).fill("study times");
  await expect(button(page, "Add Due cards")).toHaveCount(0);
  await button(page, "Add Your study times").click();
  await expect(widget(page, "Your study times")).toBeVisible();
});

test("a dashboard file can be imported as a draft", async ({ page }) => {
  await startEditing(page);
  const content = JSON.stringify({
    format: "statly-dashboard",
    version: 4,
    layout: {
      widgets: [{ id: "only", type: "due-cards", x: 2, y: 3, w: 3, h: 4 }],
    },
  });
  await page.evaluate((file) => {
    globalThis.__mockOpenFile = file;
  }, content);
  await button(page, "Import").click();
  await expect(page.locator("[data-widget-id]")).toHaveCount(1);
  await button(page, "Cancel").click();
  await button(page, "Discard").click();
  await expect(widget(page, "Study time")).toBeVisible();
});

test("the timeline has its own range", async ({ page }) => {
  await button(page, "1 year").click();
  await expect(button(page, "1 year")).toHaveAttribute("aria-pressed", "true");
});

test("a quick choice shows in the calendar and counts after Apply", async ({ page }) => {
  const filter = page.getByRole("button", { name: "Time range" });
  await filter.click();
  await button(page, "Last 30 days").click();
  await expect(filter).not.toContainText("Last 30 days");
  await expect(page.getByRole("textbox", { name: "Start date" })).not.toHaveValue(/^$/);
  await button(page, "Apply").click();
  await expect(filter).toContainText("Last 30 days");
});

test("one click selects a day, a second click stretches the range", async ({ page }) => {
  const filter = page.getByRole("button", { name: "Time range" });
  await filter.click();
  await page.getByRole("button", { name: "Previous month" }).click();
  const month = page.getByRole("grid").first();
  await month.getByRole("button", { name: /^1 / }).first().click();
  const start = await page.getByRole("textbox", { name: "Start date" }).inputValue();
  await expect(page.getByRole("textbox", { name: "End date" })).toHaveValue(start);
  await month.getByRole("button", { name: /^15 / }).first().click();
  await expect(page.getByRole("textbox", { name: "End date" })).not.toHaveValue(start);
  await button(page, "Apply").click();
  await expect(filter).toContainText(start);
});

test("a range can be dragged across the calendar", async ({ page }) => {
  const filter = page.getByRole("button", { name: "Time range" });
  await filter.click();
  await page.getByRole("button", { name: "Previous month" }).click();
  const month = page.getByRole("grid").first();
  const from = await box(month.getByRole("button", { name: /^3 / }).first());
  const to = await box(month.getByRole("button", { name: /^18 / }).first());
  await drag(page, { x: from.x + 8, y: from.y + 8 }, { x: to.x + 8, y: to.y + 8 });
  const start = await page.getByRole("textbox", { name: "Start date" }).inputValue();
  const end = await page.getByRole("textbox", { name: "End date" }).inputValue();
  expect(start.slice(0, 2)).toBe("03");
  expect(end.slice(0, 2)).toBe("18");
});

test("the selected day stays readable", async ({ page }) => {
  await page.getByRole("button", { name: "Time range" }).click();
  const today = page.locator('[aria-current="date"]').first();
  const colors = await today.evaluate((node) => {
    const style = getComputedStyle(node);
    return { text: style.color, background: style.backgroundColor };
  });
  expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors.text).not.toBe(colors.background);
});

test("typed dates get their dots and wrong ones are explained", async ({ page }) => {
  await page.getByRole("button", { name: "Time range" }).click();
  const start = page.getByRole("textbox", { name: "Start date" });
  await start.fill("01022026");
  await expect(start).toHaveValue("01.02.2026");
  await start.fill("31022026");
  await start.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("decks are a searchable tree, not a list of long names", async ({ page }) => {
  const picker = page.getByRole("button", { name: "Deck", exact: true });
  await picker.click();
  await expect(page.getByRole("option", { name: "Sprachen" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Spanisch" })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand Sprachen" }).click();
  await page.getByRole("option", { name: "Spanisch" }).click();
  await expect(picker).toContainText("Spanisch");
  await expect(picker).not.toContainText("::");

  await picker.click();
  await expect(page.getByRole("option", { name: "Spanisch" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search decks" }).fill("span");
  await expect(page.getByRole("listbox")).toContainText("Sprachen");
  await page.getByRole("searchbox", { name: "Search decks" }).press("Enter");
  await expect(picker).toContainText("Spanisch");
});

test("a narrow window shows the phone layout", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(grid(page)).toBeVisible();
  await expect(widget(page, "Reviews")).toHaveAttribute("data-grid", "0,0,2,4");
  await expect(widget(page, "Reviews over time")).toHaveAttribute("data-grid", /^0,\d+,4,8$/);
});

test("neighbors wait until the pointer rests, instead of dancing along", async ({ page }) => {
  await startEditing(page);
  const moved = widget(page, "Reviews");
  const neighbor = widget(page, "Study time");
  const before = await neighbor.getAttribute("data-grid");
  const start = await box(moved);
  await page.mouse.move(start.x + 40, start.y + 60);
  await page.mouse.down();
  await page.mouse.move(start.x + 240, start.y + 60);
  await expect(neighbor).toHaveAttribute("data-grid", before ?? "");
  await page.waitForTimeout(150);
  await expect(neighbor).not.toHaveAttribute("data-grid", before ?? "");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(neighbor).toHaveAttribute("data-grid", before ?? "");
});

test("a resized widget keeps its content sharp and only changes in whole cells", async ({
  page,
}) => {
  await startEditing(page);
  const target = widget(page, "Reviews");
  const handle = await box(target.getByRole("button", { name: "Change size" }));
  await page.mouse.move(handle.x + 10, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 60, handle.y + 30, { steps: 4 });
  await expect(page.getByTestId("grid-ghost")).toBeVisible();
  const transform = await target.evaluate((node) => getComputedStyle(node).transform);
  expect(transform).not.toContain("0.9");
  await page.mouse.up();
  await expect(page.getByTestId("grid-ghost")).toHaveCount(0);
});

const deviceTile = (page: Page, type: string) =>
  page.getByTestId("device-frame").locator(`[data-widget-id^="${type}"]`);

test("the phone preview scrolls without a bar of its own", async ({ page }) => {
  await startEditing(page);
  await page.getByRole("radio", { name: "Phone" }).click();
  const area = page.getByTestId("device-frame").locator("[data-scroll-area]");
  await expect(area).toHaveCSS("scrollbar-width", "none");
  await expect(area).toHaveCSS("overflow-y", "auto");
});

test("the dashboard works itself out for phones", async ({ page }) => {
  await startEditing(page);
  await page.getByRole("radio", { name: "Phone" }).click();
  await expect(page.getByTestId("device-frame")).toHaveAttribute("data-device", "phone");
  await expect(page.getByText("Worked out from your desktop dashboard")).toBeVisible();
  await expect(page.getByTestId("device-frame").locator("[data-widget-id]")).toHaveCount(6);
  await expect(deviceTile(page, "review-summary")).toContainText("412");
  await expect(deviceTile(page, "review-summary")).toHaveAttribute("data-grid", "0,0,2,4");
  await expect(deviceTile(page, "review-timeline")).toHaveAttribute("data-grid", /^0,\d+,4,8$/);
});

test("a phone can be arranged by hand and goes back to following the desktop", async ({ page }) => {
  await startEditing(page);
  await page.getByRole("radio", { name: "Phone" }).click();
  await deviceTile(page, "review-summary").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("You arranged this device yourself")).toBeVisible();
  await expect(deviceTile(page, "review-summary")).toHaveAttribute("data-grid", "0,1,2,4");

  await button(page, "Save").click();
  await button(page, "Not now").click();
  await startEditing(page);
  await page.getByRole("radio", { name: "Phone" }).click();
  await expect(deviceTile(page, "review-summary")).toHaveAttribute("data-grid", "0,1,2,4");

  await button(page, "Follow the desktop again").click();
  await expect(deviceTile(page, "review-summary")).toHaveAttribute("data-grid", "0,0,2,4");
  await button(page, "Cancel").click();
});

test("each device gets its own time range", async ({ page }) => {
  await startEditing(page);
  await page.getByRole("radio", { name: "Tablet" }).click();
  await expect(page.getByTestId("device-frame")).toHaveAttribute("data-device", "tablet");
  const tile = deviceTile(page, "review-summary");
  const bounds = await box(tile);
  await page.mouse.click(bounds.x + 30, bounds.y + 30);
  await button(page, "Last 7 days").click();
  await expect(tile).toContainText("Last 7 days");
  await button(page, "Cancel").click();
});

test("statistics added on a phone stay on the phone", async ({ page }) => {
  await startEditing(page);
  await page.getByRole("radio", { name: "Phone" }).click();
  await button(page, "Add Your study times").click();
  await expect(deviceTile(page, "study-rhythm")).toHaveCount(1);
  await page.getByRole("radio", { name: "Desktop" }).click();
  await button(page, "Not now").click();
  await expect(widget(page, "Your study times")).toHaveCount(0);
  await button(page, "Cancel").click();
});

test("leaving an edited dashboard asks first", async ({ page }) => {
  await startEditing(page);
  await widget(page, "Study time").getByRole("button", { name: "Remove from dashboard" }).click();
  await page.getByRole("link", { name: "Widget Library" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Save your changes?" });
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(widget(page, "Study time")).toHaveCount(0);

  await button(page, "Cancel").click();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(widget(page, "Study time")).toBeVisible();
});

test("an unchanged dashboard closes without asking", async ({ page }) => {
  await startEditing(page);
  await button(page, "Cancel").click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(button(page, "Edit dashboard")).toBeVisible();
});

test("a link to the same page still asks before edits are lost", async ({ page }) => {
  await startEditing(page);
  await widget(page, "Study time").getByRole("button", { name: "Remove from dashboard" }).click();
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("alertdialog", { name: "Save your changes?" })).toBeVisible();
});

test("header buttons always end with the main action", async ({ page }) => {
  await startEditing(page);
  const save = await box(button(page, "Save"));
  const cancel = await box(button(page, "Cancel"));
  expect(save.x).toBeGreaterThan(cancel.x);
});

test("leaving the phone view offers to set up the card once", async ({ page }) => {
  await startEditing(page);
  await page.getByRole("radio", { name: "Phone" }).click();
  await expect(page.getByTestId("device-frame")).toBeVisible();
  await page.getByRole("radio", { name: "Desktop" }).click();
  const offer = page.getByRole("alertdialog", { name: "Show this on your phone too?" });
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.getByTestId("device-frame")).toHaveCount(0);

  await page.getByRole("radio", { name: "Phone" }).click();
  await page.getByRole("radio", { name: "Desktop" }).click();
  await expect(offer).toHaveCount(0);
});

test("setting up the card from the phone view really sets it up", async ({ page }) => {
  await startEditing(page);
  await page.getByRole("radio", { name: "Tablet" }).click();
  await button(page, "Save").click();
  await button(page, "Set up the card").click();
  await page.goto("/#/settings/mobile");
  await expect(page.getByText("Your dashboard card is active")).toBeVisible();
});
