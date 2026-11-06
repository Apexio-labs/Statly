import { expect, type Page, test } from "@playwright/test";

async function chooseTheme(page: Page, name: string) {
  await page.goto("/#/settings/appearance");
  await page.getByRole("combobox", { name: "Theme" }).click();
  await page.getByRole("option", { name }).click();
}

const backgroundOf = (page: Page) =>
  page.locator("body").evaluate((body) => getComputedStyle(body).backgroundImage);

test("Frutiger Aero puts a wallpaper behind glass and draws its own icons", async ({ page }) => {
  await chooseTheme(page, "Frutiger Aero");
  expect(await backgroundOf(page)).toContain("wallpaper");
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar.getByRole("link", { name: "Settings" }).locator("img")).toBeVisible();
  const size = await sidebar.getByRole("link", { name: "Settings" }).locator("img").boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(26);

  await page.getByRole("link", { name: "Home" }).click();
  const card = page.locator("[data-widget-id] > section").first();
  await expect(card).toBeVisible();
  const glass = await card.evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(glass).toContain("rgba(255, 255, 255, 0.64)");
});

test("the red close buttons appear in Frutiger Aero, and only there", async ({ page }) => {
  await chooseTheme(page, "Frutiger Aero");
  const close = page.locator("a.statly-close");
  await expect(close).toBeVisible();
  const red = await close.evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(red).toContain("rgb(201, 32, 14)");
  await close.click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await chooseTheme(page, "Light");
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveCount(1);
});

test("the other themes keep their line icons and the black window", async ({ page }) => {
  await chooseTheme(page, "Dark");
  expect(await backgroundOf(page)).toBe("none");
  const settings = page.getByTestId("sidebar").getByRole("link", { name: "Settings" });
  await expect(settings.locator("svg")).toBeVisible();
  await expect(settings.locator("img")).toHaveCount(0);
});

test("JojoXGames gets the credit for the Frutiger Aero theme", async ({ page }) => {
  await page.goto("/#/settings/supporters");
  await expect(page.getByRole("heading", { name: "JojoXGames" })).toBeVisible();
  await expect(page.getByText(/idea for the Frutiger Aero theme/)).toBeVisible();
  await page.goto("/#/settings/support");
  await expect(page.getByText("Claude", { exact: false })).toHaveCount(0);
});

test("the wallpaper section says where the picture appears", async ({ page }) => {
  await page.goto("/#/settings/wallpaper");
  await expect(page.getByRole("link", { name: "Wallpaper", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wallpaper", exact: true })).toBeVisible();
  await expect(page.getByText(/also on Anki's deck overview/)).toBeVisible();

  await page.getByRole("searchbox", { name: "Search settings" }).fill("deck overview");
  await expect(page.getByRole("link", { name: /Wallpaper/ })).toBeVisible();
});

test("widgets wobble while editing and rest otherwise", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("[data-widget-id]").first();
  const animation = () => card.evaluate((node) => getComputedStyle(node).animationName);
  expect(await animation()).toBe("none");

  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
  await expect.poll(animation).toBe("statly-wobble");
  const placed = await card.evaluate((node) => getComputedStyle(node).transform);
  expect(placed).not.toBe("none");
});

test.describe("for someone who asked for less motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("nothing wobbles", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
    const card = page.locator("[data-widget-id]").first();
    await expect(card).toHaveClass(/statly-editing/);
    expect(await card.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  });
});
