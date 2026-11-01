import { describe, expect, it } from "vitest";
import { trailingChoices } from "./choices.ts";

describe("trailingChoices", () => {
  it("finds a numbered list after a question", () => {
    expect(
      trailingChoices("Was soll ich bauen?\n\n1. Lernzeit\n2. Karten-Status\n3. Deck-Aktivität"),
    ).toEqual([{ label: "Lernzeit" }, { label: "Karten-Status" }, { label: "Deck-Aktivität" }]);
  });

  it("finds bullets with a closing question", () => {
    const text = "Ich kann dir helfen.\n\n- Ein Widget\n- Eine Seite\n\nWas davon möchtest du?";
    expect(trailingChoices(text).map((choice) => choice.label)).toEqual([
      "Ein Widget",
      "Eine Seite",
    ]);
  });

  it("splits a label from its explanation and drops formatting", () => {
    expect(
      trailingChoices("Which one?\n- **Short** - a small tile\n- **Long** - a big chart"),
    ).toEqual([
      { label: "Short", description: "a small tile" },
      { label: "Long", description: "a big chart" },
    ]);
  });

  it("accepts a request to choose without a question mark", () => {
    expect(trailingChoices("Wähle eine Option:\n1. A\n2. B")).toHaveLength(2);
  });

  it("leaves a plain list alone", () => {
    expect(trailingChoices("Das sind deine Stapel:\n- Latein\n- Physik")).toEqual([]);
  });

  it("leaves a question without a list alone", () => {
    expect(trailingChoices("Soll ich das machen?")).toEqual([]);
  });

  it("ignores a list that continues into more text", () => {
    expect(
      trailingChoices("Was meinst du?\n- A\n- B\nDanach geht es weiter.\nUnd noch weiter."),
    ).toEqual([]);
  });

  it("ignores long lists and long items", () => {
    const many = Array.from({ length: 7 }, (_, index) => `- ${index}`).join("\n");
    expect(trailingChoices(`Welche?\n${many}`)).toEqual([]);
    expect(trailingChoices(`Welche?\n- ${"x".repeat(90)}\n- b`)).toEqual([]);
  });

  it("does not need one item alone", () => {
    expect(trailingChoices("Welche?\n- nur eine")).toEqual([]);
  });
});
