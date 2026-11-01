import { describe, expect, it } from "vitest";
import { resolveLanguage, resources } from "./index.ts";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" && child !== null
      ? keys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("locales", () => {
  it("defines the same keys in every language", () => {
    const expected = keys(resources.en.translation).sort();
    for (const { translation } of Object.values(resources)) {
      expect(keys(translation).sort()).toEqual(expected);
    }
  });

  it("maps Anki's language codes to supported languages", () => {
    expect(resolveLanguage("de_DE")).toBe("de");
    expect(resolveLanguage("pt-BR")).toBe("en");
  });
});
