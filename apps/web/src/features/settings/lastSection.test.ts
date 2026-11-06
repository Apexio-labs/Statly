import { afterEach, describe, expect, it } from "vitest";
import { forgetSection, REMEMBER_MS, recentSection, rememberSection } from "./lastSection.ts";

describe("the last settings section", () => {
  afterEach(forgetSection);

  it("is kept for three minutes after leaving", () => {
    rememberSection("wallpaper", 240, 1000);
    expect(recentSection(1000 + REMEMBER_MS - 1)).toEqual({
      section: "wallpaper",
      scroll: 240,
      at: 1000,
    });
    expect(recentSection(1000 + REMEMBER_MS)).toBeNull();
  });

  it("starts the three minutes again with every visit", () => {
    rememberSection("wallpaper", 0, 1000);
    rememberSection("shortcuts", 0, 1000 + REMEMBER_MS - 10);
    expect(recentSection(1000 + REMEMBER_MS + 10)?.section).toBe("shortcuts");
  });

  it("is empty before anyone opened the settings", () => {
    expect(recentSection()).toBeNull();
  });
});
