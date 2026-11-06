import "../index.css";
import "../aero.css";
import { applyAccent } from "../lib/accent.ts";
import { type PromptData, renderPrompt } from "./render.ts";

declare global {
  var __statlyPrompt: { show: (data: PromptData) => void; clear: () => void } | undefined;
}

const PREFIX = "statlyPrompt:";
const root = document.getElementById("prompt") as HTMLElement;
let onEscape: (() => void) | null = null;

function answer(token: string, value: string) {
  onEscape = null;
  globalThis.pycmd?.(`${PREFIX}${token}:${value}`);
}

globalThis.__statlyPrompt = {
  show(data) {
    const html = document.documentElement;
    html.dataset.theme = data.theme;
    applyAccent(html, data.accent, data.theme === "dark");
    onEscape = renderPrompt(root, data, (value) => answer(data.token, value));
  },
  clear() {
    onEscape = null;
    root.replaceChildren();
  },
};

addEventListener("keydown", (event) => {
  if (event.key === "Escape" && onEscape) {
    event.preventDefault();
    onEscape();
  }
});
