import { cellsToPixels } from "@statly/widget-runtime";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** Room around the widget inside the preview. */
const INSET = 16;
/** How fast the preview glides along a wide widget, in pixels per second. */
const GLIDE_SPEED = 45;
/** How long the glide rests at either end before it turns. */
const EDGE_REST_MS = 900;
/** How long the glide waits after the person scrolled by hand. */
const RESUME_AFTER_MS = 3000;
/** How long the glide waits after the preview opened. */
const START_AFTER_MS = 700;

/**
 * Moves `scroller` back and forth along its width, turning at either end. Scrolling by hand
 * pauses it, and it picks up again from wherever the person left it. Reduced motion turns it off.
 */
export function useGlide(scroller: React.RefObject<HTMLElement | null>, active: boolean) {
  const [gliding, setGliding] = useState(false);
  useEffect(() => {
    const node = scroller.current;
    if (!node || !active || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let frame = 0;
    let last = 0;
    let direction = 1;
    let position = node.scrollLeft;
    let pausedUntil = performance.now() + START_AFTER_MS;

    function step(now: number) {
      frame = requestAnimationFrame(step);
      const elapsed = last ? Math.min(now - last, 64) : 0;
      last = now;
      if (!node || now < pausedUntil) {
        setGliding(false);
        return;
      }
      const room = node.scrollWidth - node.clientWidth;
      if (room <= 1) {
        return;
      }
      setGliding(true);
      position += (direction * GLIDE_SPEED * elapsed) / 1000;
      if (position >= room || position <= 0) {
        position = Math.max(0, Math.min(room, position));
        direction = -direction;
        pausedUntil = now + EDGE_REST_MS;
      }
      node.scrollLeft = position;
    }

    // Only the person's own input pauses the glide, never the scroll events it causes itself.
    // Moving the pointer counts too: hover boxes need the widget to hold still.
    function pause() {
      pausedUntil = performance.now() + RESUME_AFTER_MS;
    }
    // While paused, the glide picks up from wherever the person scrolled to.
    function follow() {
      if (node && performance.now() < pausedUntil) {
        position = node.scrollLeft;
      }
    }
    const inputs = ["wheel", "pointerdown", "pointermove", "touchstart", "keydown"] as const;
    for (const input of inputs) {
      node.addEventListener(input, pause, { passive: true });
    }
    node.addEventListener("scroll", follow, { passive: true });
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      for (const input of inputs) {
        node.removeEventListener(input, pause);
      }
      node.removeEventListener("scroll", follow);
    };
  }, [scroller, active]);
  return gliding;
}

/**
 * A widget at its real standard size inside a preview that keeps one size. A widget taller than
 * the preview shrinks until it fits; one wider than it can be scrolled sideways, and glides along
 * by itself so the rest is not missed.
 */
export function RealSizePreview({
  cells,
  height,
  children,
}: {
  cells: { w: number; h: number };
  height: number;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = scroller.current;
    if (!node) {
      return;
    }
    const sizes = new ResizeObserver(() => setWidth(node.clientWidth));
    sizes.observe(node);
    return () => sizes.disconnect();
  }, []);
  const natural = cellsToPixels(cells);
  const scale = Math.min(1, (height - 2 * INSET) / natural.height);
  const shown = { width: natural.width * scale, height: natural.height * scale };
  const wide = width > 0 && shown.width > width - 2 * INSET;
  const gliding = useGlide(scroller, wide);
  return (
    <div
      ref={scroller}
      data-real-size={`${cells.w}x${cells.h}`}
      data-wide={wide ? "" : undefined}
      data-gliding={gliding ? "" : undefined}
      className={`statly-real-size flex overflow-x-auto overflow-y-hidden outline-none ${
        wide ? "justify-start" : "justify-center"
      }`}
      style={{
        height,
        padding: INSET,
        alignItems: "center",
        ...(wide
          ? {
              maskImage:
                "linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent)",
            }
          : {}),
      }}
    >
      <div className="relative shrink-0" style={shown}>
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            ...natural,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            // A widget gliding under a resting pointer would open one hover box after another.
            pointerEvents: gliding ? "none" : undefined,
          }}
        >
          {children}
        </div>
      </div>
      {/* Keeps the padding on the right once the widget is scrolled to its end. */}
      {wide ? <div aria-hidden="true" className="shrink-0" style={{ width: INSET }} /> : null}
    </div>
  );
}
