import { expect, type Locator, type Page, test } from "@playwright/test";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const canvas = (page: Page) => page.getByTestId("editor-canvas");
const element = (page: Page, id: string) => page.locator(`[data-element-id="${id}"]`);

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
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#/library/widgets/new");
  await expect(canvas(page)).toBeVisible();
});

test("blocks land on the canvas and show real values", async ({ page }) => {
  await button(page, "Metric").click();
  await expect(canvas(page)).toContainText("412");
  await page.getByRole("combobox", { name: "Shows" }).click();
  await page.getByRole("option", { name: "Due cards" }).click();
  await expect(canvas(page)).toContainText("4,294");
});

test("elements can be dragged and resized", async ({ page }) => {
  await button(page, "Text").click();
  const target = element(page, "e1");
  const before = await box(target);

  await drag(page, { x: before.x + 30, y: before.y + 20 }, { x: before.x + 70, y: before.y + 65 });
  const moved = await box(target);
  expect(moved.x).toBeGreaterThan(before.x + 20);
  expect(moved.y).toBeGreaterThan(before.y + 20);

  const handle = await box(target.locator('[data-handle="se"]'));
  await drag(page, { x: handle.x + 6, y: handle.y + 6 }, { x: handle.x + 56, y: handle.y + 36 });
  const resized = await box(target);
  expect(resized.width).toBeGreaterThan(moved.width + 30);
});

test("a guide line appears when an element lines up with the center", async ({ page }) => {
  await button(page, "Shape").click();
  const target = element(page, "e1");
  const before = await box(target);
  const area = await box(canvas(page));
  const centerOffset = area.x + area.width / 2 - (before.x + before.width / 2);

  await page.mouse.move(before.x + 20, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 20 + centerOffset, before.y + 20, { steps: 8 });
  await expect(page.locator('[data-guide="x"]')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('[data-guide="x"]')).toHaveCount(0);
});

test("one drag is one undo step", async ({ page }) => {
  await button(page, "Text").click();
  const target = element(page, "e1");
  const before = await box(target);
  await drag(page, { x: before.x + 30, y: before.y + 20 }, { x: before.x + 90, y: before.y + 60 });

  await button(page, "Undo").click();
  await expect(target).toBeVisible();
  const undone = await box(target);
  expect(Math.round(undone.x)).toBe(Math.round(before.x));

  await button(page, "Redo").click();
  expect((await box(target)).x).toBeGreaterThan(before.x + 30);
});

test("the keyboard moves, duplicates and deletes the selection", async ({ page }) => {
  await button(page, "Shape").click();
  const target = element(page, "e1");
  const before = await box(target);
  await page.keyboard.press("ArrowRight");
  expect((await box(target)).x).toBeGreaterThan(before.x);

  await page.keyboard.press("Delete");
  await expect(target).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(target).toBeVisible();
});

test("a background can be set", async ({ page }) => {
  await page.getByRole("combobox", { name: "Background" }).click();
  await page.getByRole("option", { name: "Gradient" }).click();
  await expect(canvas(page).locator("section")).toHaveCSS("background-image", /linear-gradient/);
});

test("a template fills the canvas", async ({ page }) => {
  await button(page, "Streak").click();
  await expect(canvas(page)).toContainText("Streak");
  await expect(canvas(page)).toContainText("12");
});

test("saving needs a name", async ({ page }) => {
  await button(page, "Text").click();
  await button(page, "Save").click();
  await expect(page.getByRole("alert")).toContainText("name");
});

test("a saved widget goes onto the dashboard and can be edited and deleted", async ({ page }) => {
  await button(page, "Streak").click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("My streak");
  await button(page, "Save").click();

  const card = page.locator('[data-custom-widget="My streak"]');
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Add My streak", exact: true }).click();

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByTestId("dashboard-grid")).toContainText("Streak");

  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
  await page.getByRole("button", { name: /^Custom widgets/ }).click();
  await expect(page.getByRole("button", { name: "Add My streak" })).toBeVisible();
  await button(page, "Cancel").click();

  await page.getByRole("link", { name: "Widget Library" }).click();
  await card.getByRole("button", { name: "My streak", exact: true }).click();
  await page.getByRole("button", { name: "Edit widget" }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("My streak");
  await button(page, "Cancel").click();

  await card.getByRole("button", { name: "My streak", exact: true }).click();
  await page.getByRole("button", { name: "Delete widget" }).click();
  await page.getByRole("button", { name: "Really delete?" }).click();
  await expect(card).toHaveCount(0);

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByTestId("dashboard-grid")).not.toContainText("Streak");
});

test("the widget itself can be dragged larger over the grid cells", async ({ page }) => {
  await expect(page.getByTestId("editor-cells")).toBeVisible();
  const before = await box(canvas(page));
  const handle = await box(page.getByTestId("widget-resize"));
  await drag(page, { x: handle.x + 10, y: handle.y + 10 }, { x: handle.x + 130, y: handle.y + 60 });
  const after = await box(canvas(page));
  expect(after.width).toBeGreaterThan(before.width + 40);
  await expect(page.getByTestId("current-size")).toContainText("×");
  await expect(page.getByTestId("size-note")).toBeVisible();

  await button(page, "Make this the standard size").click();
  await expect(page.getByTestId("size-note")).toHaveCount(0);
});

test("a new widget opens centered at six by eight cells", async ({ page }) => {
  await expect(page.getByTestId("current-size")).toContainText("6 × 8");
  const stage = await box(page.getByTestId("editor-stage"));
  const area = await box(canvas(page));
  expect(Math.abs(area.x + area.width / 2 - (stage.x + stage.width / 2))).toBeLessThan(2);
  expect(Math.abs(area.y + area.height / 2 - (stage.y + stage.height / 2))).toBeLessThan(2);
});

test("the widget returns to the center after a resize", async ({ page }) => {
  const stage = await box(page.getByTestId("editor-stage"));
  const handle = await box(page.getByTestId("widget-resize-nw"));
  await drag(page, { x: handle.x + 10, y: handle.y + 10 }, { x: handle.x - 120, y: handle.y - 50 });
  await expect(page.getByTestId("current-size")).toContainText(/7 × 9|8 × 9/);
  await expect
    .poll(async () => {
      const area = await box(canvas(page));
      return Math.abs(area.x + area.width / 2 - (stage.x + stage.width / 2));
    })
    .toBeLessThan(2);
});

test("with Alt the widget grows on both sides alike", async ({ page }) => {
  const handle = await box(page.getByTestId("widget-resize"));
  const before = await box(canvas(page));
  await page.mouse.move(handle.x + 10, handle.y + 10);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(handle.x + 120, handle.y + 10, { steps: 8 });
  const during = await box(canvas(page));
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect(page.getByTestId("current-size")).toContainText("8 × 8");
  expect(Math.abs(during.x + during.width / 2 - (before.x + before.width / 2))).toBeLessThan(2);
});

test("minimum and maximum limit how far the widget can be dragged", async ({ page }) => {
  await page.getByRole("spinbutton", { name: "Max. width" }).fill("8");
  await page.getByRole("spinbutton", { name: "Max. height" }).fill("10");
  const handle = await box(page.getByTestId("widget-resize"));
  await drag(
    page,
    { x: handle.x + 10, y: handle.y + 10 },
    { x: handle.x + 900, y: handle.y + 800 },
  );
  await expect(page.getByTestId("current-size")).toContainText("8 × 10");
});

test("an element can wait until the widget is large enough", async ({ page }) => {
  await button(page, "Metric").click();
  await page.getByRole("switch", { name: "Show only from a size" }).click();
  await page.getByRole("spinbutton", { name: "Height in cells" }).fill("6");
  await page.getByRole("heading", { name: "Metric" }).click();
  await page.keyboard.press("Escape");
  await button(page, "Show smallest size").click();
  await expect(canvas(page).locator('[data-hidden-here="true"]')).toHaveCount(1);
  await button(page, "Show standard size").click();
  await expect(canvas(page).locator('[data-hidden-here="true"]')).toHaveCount(0);
});

test("moving an element at another size leaves the standard arrangement alone", async ({
  page,
}) => {
  await button(page, "Text").click();
  const target = element(page, "e1");
  await page.keyboard.press("Escape");
  await button(page, "Show largest size").click();
  const large = await box(target);
  await drag(page, { x: large.x + 20, y: large.y + 10 }, { x: large.x + 220, y: large.y + 110 });
  const moved = await box(target);
  expect(moved.x).toBeGreaterThan(large.x + 100);

  await page.keyboard.press("Escape");
  await button(page, "Show standard size").click();
  const standard = await box(target);
  await button(page, "Show largest size").click();
  expect((await box(target)).x).toBeGreaterThan(standard.x + 50);
});

test("Backspace over a field resets it instead of deleting the element", async ({ page }) => {
  await button(page, "Metric").click();
  const size = page.getByRole("slider", { name: "Text size" });
  await size.fill("50");
  await expect(size).toHaveValue("50");

  await size.hover();
  await page.keyboard.press("Backspace");

  await expect(size).toHaveValue("22");
  await expect(element(page, "e1")).toBeVisible();
});

test("an element can be turned with its handle and in the panel", async ({ page }) => {
  await button(page, "Text").click();
  const target = element(page, "e1");
  const handle = await box(target.locator('[data-handle="rotate"]'));
  const area = await box(target);
  await drag(
    page,
    { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    { x: area.x + area.width + 120, y: area.y + area.height / 2 },
  );
  const slider = page.getByRole("slider", { name: "Rotation" });
  await expect(slider).not.toHaveValue("0");
  await expect(target).toHaveCSS("transform", /matrix/);

  await slider.fill("90");
  await slider.hover();
  await page.keyboard.press("Backspace");
  await expect(slider).toHaveValue("0");
});

test("the size note floats, so nothing shifts when it appears", async ({ page }) => {
  const before = await box(page.getByTestId("editor-stage"));
  const handle = await box(page.getByTestId("widget-resize"));
  await drag(page, { x: handle.x + 10, y: handle.y + 10 }, { x: handle.x + 130, y: handle.y + 60 });
  await expect(page.getByTestId("size-note")).toBeVisible();
  const after = await box(page.getByTestId("editor-stage"));
  expect(after.y).toBe(before.y);
  expect(after.height).toBe(before.height);
});

test("unsaved work asks before leaving, and saved work does not", async ({ page }) => {
  await button(page, "Text").click();
  await page.getByRole("link", { name: "Home" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Save your changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(canvas(page)).toBeVisible();

  await button(page, "Cancel").click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("name");
  await expect(canvas(page)).toBeVisible();

  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Kept");
  await page.getByRole("link", { name: "Home" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("dashboard-grid")).toBeVisible();
  await page.getByRole("link", { name: "Widget Library" }).click();
  await expect(page.locator('[data-custom-widget="Kept"]')).toBeVisible();
});

test("the arrow back and the title menu ask first as well", async ({ page }) => {
  await button(page, "Text").click();
  const dialog = page.getByRole("alertdialog", { name: "Save your changes?" });
  await page.getByRole("link", { name: "Back to Widget Library" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(canvas(page)).toBeVisible();

  await page.getByRole("button", { name: "New widget", exact: true }).click();
  await page.getByRole("menuitem", { name: "Statly" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("dashboard-grid")).toBeVisible();
});

test("an untouched editor can simply be left", async ({ page }) => {
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-grid")).toBeVisible();
});

test("work can be thrown away on purpose", async ({ page }) => {
  await button(page, "Text").click();
  await button(page, "Cancel").click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator("[data-library-card]").first()).toBeVisible();
});

test("the device buttons show the size a widget gets there", async ({ page }) => {
  await button(page, "Phone").click();
  await expect(page.getByTestId("current-size")).toContainText("4 × 8");
  await button(page, "Tablet").click();
  await expect(page.getByTestId("current-size")).toContainText("4 × 8");
});
