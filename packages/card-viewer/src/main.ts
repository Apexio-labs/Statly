import { decode, render } from "./render.ts";

const REPAIR_NOTE = navigator.language.startsWith("de")
  ? "Diese Karte wurde verändert. Öffne Anki auf deinem Computer und synchronisiere: Sie repariert sich dann von selbst."
  : "This card was changed. Open Anki on your computer and sync: it repairs itself then.";

const root = document.getElementById("statly-root");
const data = document.getElementById("statly-data");
if (root) {
  try {
    render(root, decode(data?.textContent ?? ""));
  } catch {
    root.textContent = REPAIR_NOTE;
  }
}
