/**
 * Draws Statly's own popup. It runs in a page of its own above the app, which only Python fills
 * and reads, so the app's page cannot press its buttons. Every value goes in as plain text.
 */

export type PromptTone = "safe" | "plain" | "primary" | "danger";

export type PromptData = {
  /** Proves to Python that an answer belongs to this question. */
  token: string;
  title: string;
  paragraphs: string[];
  details: string[];
  /** The first choice is the safe one: it has the focus, and Escape picks it. */
  choices: { answer: string; label: string; tone: PromptTone }[];
  theme: string;
  accent: string | null;
  /** A still picture of the app below, so the popup reads as part of the same window. */
  backdrop: string | null;
};

const BUTTON =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-control border px-3 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40";
const LOOKS: Record<PromptTone, string> = {
  safe: "border-line bg-control text-text hover:bg-hover",
  plain: "border-line bg-control text-text hover:bg-hover",
  primary: "border-transparent bg-primary text-on-primary hover:bg-primary-hover",
  danger: "border-line bg-control text-danger hover:bg-hover",
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** Returns what to call when Escape is pressed. */
export function renderPrompt(
  root: HTMLElement,
  data: PromptData,
  answer: (value: string) => void,
): () => void {
  root.replaceChildren();
  const backdrop = element("div", "fixed inset-0 bg-page");
  if (data.backdrop) {
    backdrop.style.backgroundImage = `url("${data.backdrop}")`;
    backdrop.style.backgroundSize = "100% 100%";
  }
  const shade = element("div", "fixed inset-0 grid place-items-center bg-black/60 p-4");
  const dialog = element(
    "div",
    "statly-dialog flex w-full max-w-md flex-col overflow-hidden rounded-popover bg-card text-text shadow-card",
  );
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", data.title);

  const header = element("header", "statly-dialog-header border-b border-line p-5");
  header.append(element("h2", "m-0 text-lg font-bold", data.title));

  const body = element("section", "statly-dialog-body flex flex-col gap-3 p-5");
  if (data.details.length > 0) {
    const list = element(
      "ul",
      "m-0 flex list-none flex-col gap-1 rounded-control border border-line bg-hover p-3",
    );
    for (const detail of data.details) {
      list.append(element("li", "text-[13px] font-semibold text-text", detail));
    }
    body.append(list);
  }
  for (const paragraph of data.paragraphs) {
    body.append(element("p", "m-0 text-[13px] text-muted", paragraph));
  }

  const footer = element(
    "footer",
    "statly-dialog-footer flex flex-wrap justify-end gap-2 border-t border-line p-4",
  );
  const buttons = data.choices.map((choice) => {
    const button = element("button", `${BUTTON} ${LOOKS[choice.tone]}`, choice.label);
    button.type = "button";
    button.dataset.answer = choice.answer;
    button.addEventListener("click", () => answer(choice.answer));
    footer.append(button);
    return button;
  });

  dialog.append(header, body, footer);
  shade.append(dialog);
  root.append(backdrop, shade);
  // Enter alone must never allow anything, so the safe answer starts with the focus.
  buttons[0]?.focus();
  const safe = data.choices[0]?.answer;
  return () => {
    if (safe !== undefined) {
      answer(safe);
    }
  };
}
