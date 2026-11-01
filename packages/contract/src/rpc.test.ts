import { describe, expect, it } from "vitest";
import { z } from "zod";
import { aiTools, aiWidgetExample } from "./aiTools.ts";
import { hostInfo, methods } from "./rpc.ts";
import { customWidget } from "./widget.ts";

describe("contract", () => {
  it("rejects unknown keys so Python and TypeScript cannot drift silently", () => {
    expect(() => methods["system.ping"].params.parse({ nonce: "a", extra: 1 })).toThrow();
  });

  it("requires every host info field", () => {
    expect(() => hostInfo.parse({ statlyVersion: "1" })).toThrow();
  });
});

describe("AI tools", () => {
  it("shows the model a widget example that really is a widget", () => {
    expect(customWidget.parse(aiWidgetExample)).toEqual(aiWidgetExample);
  });

  it("stays small enough for local models", () => {
    const shown = Object.values(aiTools).map((tool) =>
      JSON.stringify(z.toJSONSchema(tool.shown ?? tool.input)).concat(tool.description),
    );
    expect(shown.join("").length).toBeLessThan(7000);
  });
});
