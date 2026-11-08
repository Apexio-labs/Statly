import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Tip as RichTipData, readTip } from "./tip.ts";

/**
 * Anki's web engine draws every `title` as its own dark system box, which looks like Anki and not
 * like Statly. This layer takes over all of them: while the mouse rests on an element with a
 * `title` (or a `data-tooltip`, for SVG parts that cannot carry one), the attribute is parked so
 * the system box never opens, and a Statly box shows the same text. Leaving puts it back, so
 * screen readers and tests still find the title.
 */

const PARKED = "data-statly-title";
/** About as long as the system box waits, so the page does not flicker while the mouse passes. */
const SHOW_DELAY = 500;
/** Moving on to the next element soon after shows its box at once, like the system box does. */
const WARM_FOR = 400;
const GAP = 16;
const EDGE = 8;

type Tip = { text: string; x: number; y: number };

function tipText(element: Element): string {
  return (element.getAttribute(PARKED) ?? element.getAttribute("data-tooltip") ?? "").trim();
}

/** Marks a label this layer lent an icon button, so only that one is taken back. */
const LENT = "data-statly-lent-label";

function park(element: Element) {
  const title = element.getAttribute("title");
  if (title === null) {
    return;
  }
  element.setAttribute(PARKED, title);
  element.removeAttribute("title");
  // For a button without text the title is its name. It keeps that name while the mouse rests.
  const named =
    element.hasAttribute("aria-label") ||
    element.hasAttribute("aria-labelledby") ||
    (element.textContent ?? "").trim() !== "";
  if (element.hasAttribute(LENT)) {
    element.setAttribute("aria-label", title);
  } else if (!named) {
    element.setAttribute("aria-label", title);
    element.setAttribute(LENT, "");
  }
}

function unpark(element: Element) {
  const parked = element.getAttribute(PARKED);
  if (parked === null) {
    return;
  }
  element.removeAttribute(PARKED);
  if (element.hasAttribute(LENT)) {
    element.removeAttribute(LENT);
    element.removeAttribute("aria-label");
  }
  // React may have written a new title in the meantime. That one is newer and stays.
  if (!element.hasAttribute("title")) {
    element.setAttribute("title", parked);
  }
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let host: Element | null = null;
    let timer = 0;
    let visible = false;
    let shownUntil = 0;
    let pointer = { x: 0, y: 0 };
    // React writes a changed title straight back, which would open the system box after all.
    const watcher = new MutationObserver(() => {
      if (host?.hasAttribute("title")) {
        park(host);
        setTip((current) => (current && host ? { ...current, text: tipText(host) } : current));
      }
    });

    const hide = () => {
      window.clearTimeout(timer);
      if (visible) {
        shownUntil = performance.now() + WARM_FOR;
      }
      visible = false;
      setTip(null);
    };

    const release = () => {
      hide();
      watcher.disconnect();
      if (host) {
        unpark(host);
      }
      host = null;
    };

    const show = () => {
      if (!host?.isConnected) {
        release();
        return;
      }
      const text = tipText(host);
      visible = text !== "";
      setTip(visible ? { text, x: pointer.x, y: pointer.y } : null);
    };

    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const next = target?.closest(`[title], [${PARKED}], [data-tooltip]`) ?? null;
      pointer = { x: event.clientX, y: event.clientY };
      if (next === host) {
        return;
      }
      const warm = visible || performance.now() < shownUntil;
      release();
      if (!next) {
        return;
      }
      host = next;
      park(host);
      watcher.observe(host, { attributes: true, attributeFilter: ["title"] });
      if (warm) {
        show();
      } else {
        timer = window.setTimeout(show, SHOW_DELAY);
      }
    };

    // Until the box shows, it opens where the mouse is then, not where it entered.
    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };

    const leavePage = (event: PointerEvent) => {
      if (!event.relatedTarget) {
        release();
      }
    };

    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointermove", move, { capture: true, passive: true });
    document.addEventListener("pointerout", leavePage, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("blur", release);
    return () => {
      release();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerout", leavePage, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("wheel", hide, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  // Below and to the right of the pointer, and above it or further left near the window's edge.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || !tip) {
      return;
    }
    const { width, height } = element.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(tip.x, window.innerWidth - width - EDGE));
    const below = tip.y + GAP;
    const top = below + height + EDGE <= window.innerHeight ? below : tip.y - GAP / 2 - height;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(EDGE, top)}px`;
    element.style.visibility = "visible";
  }, [tip]);

  if (!tip) {
    return null;
  }
  const rich = readTip(tip.text);
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className="statly-tooltip statly-fade-in"
      style={{ left: tip.x, top: tip.y + GAP, visibility: "hidden" }}
    >
      {rich ? <RichContent tip={rich} /> : tip.text}
    </div>,
    document.body,
  );
}

function RichContent({ tip }: { tip: RichTipData }) {
  return (
    <>
      {tip.title ? <div className="statly-tip-title">{tip.title}</div> : null}
      {(tip.rows ?? []).map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their place.
        <div key={index} className="statly-tip-row">
          {row.color ? <i style={{ background: row.color }} /> : null}
          <span>{row.label}</span>
          {row.value === undefined ? null : <b>{row.value}</b>}
        </div>
      ))}
      {(tip.lines ?? []).map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond their place.
        <div key={index} className="statly-tip-line">
          {line}
        </div>
      ))}
    </>
  );
}
