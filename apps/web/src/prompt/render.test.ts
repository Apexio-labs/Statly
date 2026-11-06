import { describe, expect, it, vi } from "vitest";
import { type PromptData, renderPrompt } from "./render.ts";

function data(overrides: Partial<PromptData> = {}): PromptData {
  return {
    token: "t",
    title: "Allow Statly to change the limit for new cards?",
    paragraphs: ["Statly only raises the limit for today.", "You can take this back."],
    details: ["Deck: Anatomy", "New cards today: 20 → 85"],
    choices: [
      { answer: "deny", label: "Don't Allow", tone: "safe" },
      { answer: "once", label: "Only This Time", tone: "plain" },
      { answer: "always", label: "Always Allow", tone: "primary" },
    ],
    theme: "light",
    accent: null,
    backdrop: null,
    ...overrides,
  };
}

function mount(prompt: PromptData, answer = vi.fn()) {
  const root = document.createElement("div");
  document.body.append(root);
  const pressEscape = renderPrompt(root, prompt, answer);
  return { root, pressEscape, answer };
}

describe("Statly's own popup", () => {
  it("shows every value as plain text, so a deck name cannot become a link", () => {
    const { root } = mount(data({ details: ['Deck: <a href="https://x">Click</a>'] }));
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain('Deck: <a href="https://x">Click</a>');
  });

  it("gives the safe answer the focus, so Enter alone allows nothing", () => {
    mount(data());
    expect((document.activeElement as HTMLElement).dataset.answer).toBe("deny");
  });

  it("answers with the button that was pressed", () => {
    const { root, answer } = mount(data());
    root.querySelector<HTMLButtonElement>('[data-answer="always"]')?.click();
    expect(answer).toHaveBeenCalledWith("always");
  });

  it("takes Escape as the safe answer", () => {
    const { pressEscape, answer } = mount(data());
    pressEscape();
    expect(answer).toHaveBeenCalledWith("deny");
  });

  it("keeps the order: the safe answer first, the strongest last", () => {
    const { root } = mount(data());
    const answers = [...root.querySelectorAll<HTMLElement>("[data-answer]")].map(
      (button) => button.dataset.answer,
    );
    expect(answers).toEqual(["deny", "once", "always"]);
  });

  it("is a dialog that names its question", () => {
    const { root } = mount(data());
    const dialog = root.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe(
      "Allow Statly to change the limit for new cards?",
    );
  });
});
