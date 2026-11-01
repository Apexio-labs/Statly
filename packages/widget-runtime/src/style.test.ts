import { describe, expect, it } from "vitest";
import { backgroundStyle, paintValue, progressShare } from "./style.ts";

describe("widget style", () => {
  it("resolves theme paints and keeps fixed colors", () => {
    expect(paintValue("accent")).toBe("var(--statly-accent)");
    expect(paintValue("#123456")).toBe("#123456");
  });

  it("draws gradients at the chosen angle", () => {
    const style = backgroundStyle({
      kind: "gradient",
      start: "#000000",
      end: "#ffffff",
      angle: 90,
    });
    expect(style.background).toBe("linear-gradient(90deg, #000000, #ffffff)");
  });

  it("darkens a picture with its shade", () => {
    const asset = { id: "a".repeat(64), type: "image/png" as const };
    const background = { kind: "media" as const, asset, fit: "cover" as const, shade: 0.5 };
    expect(backgroundStyle(background, "data:x").backgroundImage).toContain("rgb(0 0 0 / 50%)");
  });

  it("caps progress at the goal", () => {
    expect(progressShare(50, 100)).toBe(0.5);
    expect(progressShare(300, 100)).toBe(1);
    expect(progressShare(-3, 100)).toBe(0);
  });
});
