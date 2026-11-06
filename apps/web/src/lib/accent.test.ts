import { describe, expect, it } from "vitest";
import { ACCENT_TOKENS, accentPalette, applyAccent } from "./accent.ts";

const HEX = /^#[0-9a-f]{6}$/;

describe("accentPalette", () => {
  it("fills every accent token with a plain hex color, which charts can add alpha to", () => {
    for (const dark of [false, true]) {
      const palette = accentPalette("#c2185b", dark);
      expect(Object.keys(palette).sort()).toEqual([...ACCENT_TOKENS].sort());
      for (const value of Object.values(palette)) {
        expect(value).toMatch(HEX);
      }
    }
  });

  it("keeps the chosen color as the accent and the strongest step of charts", () => {
    const palette = accentPalette("#c2185b", false);
    expect(palette["--statly-accent"]).toBe("#c2185b");
    expect(palette["--statly-sequence-4"]).toBe("#c2185b");
  });

  it("puts readable text on bright buttons", () => {
    expect(accentPalette("#ffe066", false)["--statly-on-primary"]).toBe("#11182f");
    expect(accentPalette("#1d3a8a", false)["--statly-on-primary"]).toBe("#ffffff");
  });
});

describe("applyAccent", () => {
  it("sets the tokens and removes them again", () => {
    const root = document.createElement("div");
    applyAccent(root, "#c2185b", true);
    expect(root.style.getPropertyValue("--statly-accent")).toBe("#c2185b");
    applyAccent(root, null, true);
    expect(root.style.getPropertyValue("--statly-accent")).toBe("");
  });
});
