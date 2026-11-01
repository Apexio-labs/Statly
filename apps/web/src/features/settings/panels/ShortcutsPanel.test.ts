import { describe, expect, it } from "vitest";
import { displayKeys, keysFromEvent } from "./ShortcutsPanel.tsx";

const none = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

describe("keysFromEvent", () => {
  it("writes combinations the way Qt reads them", () => {
    const event = { ...none, key: "d", code: "KeyD", ctrlKey: true, altKey: true };
    expect(keysFromEvent(event, false)).toBe("Ctrl+Alt+D");
  });

  it("follows Qt's Mac names: command is Ctrl, control is Meta", () => {
    expect(keysFromEvent({ ...none, key: "k", code: "KeyK", metaKey: true }, true)).toBe("Ctrl+K");
    expect(keysFromEvent({ ...none, key: "k", code: "KeyK", ctrlKey: true }, true)).toBe("Meta+K");
  });

  it("uses the physical key when Alt changes the character", () => {
    expect(keysFromEvent({ ...none, key: "∂", code: "KeyD", altKey: true }, true)).toBe("Alt+D");
  });

  it("waits while only a modifier is held", () => {
    expect(keysFromEvent({ ...none, key: "Shift", code: "ShiftLeft", shiftKey: true })).toBeNull();
  });

  it("keeps named keys", () => {
    expect(keysFromEvent({ ...none, key: "F5", code: "F5" })).toBe("F5");
  });
});

describe("displayKeys", () => {
  it("uses Mac symbols on a Mac", () => {
    expect(displayKeys("Ctrl+Alt+D", true)).toBe("⌘⌥D");
    expect(displayKeys("Meta+Shift+K", true)).toBe("⌃⇧K");
  });

  it("keeps the words elsewhere", () => {
    expect(displayKeys("Ctrl+Alt+D", false)).toBe("Ctrl+Alt+D");
  });
});
