import { type DashboardWidget, gridColumns } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { X } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { WidgetBoundary } from "../WidgetCard.tsx";
import type { WidgetScope } from "../widgets.tsx";
import { canvasRows, clampSize, moveWidget, type RulesOf, resizeWidget } from "./engine.ts";

const ROW_HEIGHT = 31;
const DEFAULT_GAP = 14;
const LIFTED_SCALE = 1.02;
/** Widgets give way only once the pointer rests, so passing over them moves nothing. */
const HOLD_MS = 90;
const SETTLE_MS = 240;
const EDGE_PX = 56;
const SCROLL_STEP_PX = 12;
const CELL_RADIUS = 9;

type Props<W extends DashboardWidget> = {
  layout: { widgets: W[] };
  scope: WidgetScope;
  editing: boolean;
  rulesOf: RulesOf;
  renderWidget: (widget: W, scope: WidgetScope) => ReactNode;
  titleOf: (type: string) => string;
  onChange: (layout: { widgets: W[] }) => void;
  onRemove: (id: string) => void;
  columns?: number;
  gap?: number;
  selected?: string | null;
  onSelect?: (id: string) => void;
};

type Box = Pick<DashboardWidget, "x" | "y" | "w" | "h">;

type Operation<W> = {
  id: string;
  mode: "move" | "resize";
  pointerId: number;
  grabX: number;
  grabY: number;
  startX: number;
  startY: number;
  rows: number;
  startLayout: { widgets: W[] };
  widget: W;
  /** The cell the pointer is over, which the layout follows after a moment. */
  target: Box;
  timer: ReturnType<typeof setTimeout> | undefined;
};

function sameBox(first: Box, second: Box): boolean {
  return (
    first.x === second.x && first.y === second.y && first.w === second.w && first.h === second.h
  );
}

export function DashboardGrid<W extends DashboardWidget>({
  layout,
  scope,
  editing,
  rulesOf,
  renderWidget,
  titleOf,
  onChange,
  onRemove,
  columns = gridColumns,
  gap = DEFAULT_GAP,
  selected = null,
  onSelect,
}: Props<W>) {
  const { t } = useTranslation();
  const patternId = useId();
  const container = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const operation = useRef<Operation<W> | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const liftedAt = useRef("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [target, setTarget] = useState<Box | null>(null);
  const [gliding, setGliding] = useState(false);

  const stepY = ROW_HEIGHT + gap;
  const [width, setWidth] = useState(0);
  const step = useRef(0);

  // A panel opening beside the grid changes its width every frame. Cards follow through a CSS
  // variable, so nothing renders again and the animation stays smooth.
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) {
      return;
    }
    const measure = () => {
      step.current = (node.clientWidth + gap) / columns;
      node.style.setProperty("--grid-step", `${step.current}px`);
      if (editing) {
        setWidth(node.clientWidth);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [columns, gap, editing]);
  const usedRows = Math.max(0, ...layout.widgets.map((widget) => widget.y + widget.h));
  const rows = activeId
    ? (operation.current?.rows ?? usedRows)
    : editing
      ? canvasRows(layout.widgets)
      : usedRows;

  function commit(current: Operation<W>) {
    clearTimeout(current.timer);
    current.timer = undefined;
    const { target: box, id, startLayout } = current;
    onChange(
      current.mode === "move"
        ? moveWidget(startLayout, id, box, columns)
        : resizeWidget(startLayout, id, box, rulesOf, columns),
    );
  }

  function aimAt(current: Operation<W>, box: Box) {
    if (sameBox(current.target, box)) {
      return;
    }
    current.target = box;
    setTarget(box);
    clearTimeout(current.timer);
    current.timer = setTimeout(() => commit(current), HOLD_MS);
  }

  function followMove(current: Operation<W>, origin: DOMRect) {
    const left = pointer.current.x - current.grabX - origin.left;
    const top = pointer.current.y - current.grabY - origin.top;
    liftedAt.current = `translate3d(${left}px, ${top}px, 0) scale(${LIFTED_SCALE})`;
    const card = cards.current.get(current.id);
    if (card) {
      card.style.transform = liftedAt.current;
    }
    const { w, h } = current.widget;
    aimAt(current, {
      x: Math.max(0, Math.min(columns - w, Math.round(left / step.current))),
      y: Math.max(0, Math.min(current.rows - h, Math.round(top / stepY))),
      w,
      h,
    });
  }

  function followResize(current: Operation<W>) {
    const { widget } = current;
    const rules = rulesOf(widget.type);
    const smallest = clampSize(rules, 0, 0, columns);
    const largest = clampSize(rules, columns, 999, columns);
    const stepX = step.current;
    const startWidth = widget.w * stepX - gap;
    const startHeight = widget.h * stepY - gap;
    const pulledWidth = startWidth + pointer.current.x - current.startX;
    const pulledHeight = startHeight + pointer.current.y - current.startY;
    const widthPx = Math.max(
      smallest.w * stepX - gap,
      Math.min(largest.w * stepX - gap, pulledWidth),
    );
    const heightPx = Math.max(
      smallest.h * stepY - gap,
      Math.min(largest.h * stepY - gap, pulledHeight),
    );
    if (ghost.current) {
      ghost.current.style.width = `${widthPx}px`;
      ghost.current.style.height = `${heightPx}px`;
    }
    aimAt(current, {
      x: widget.x,
      y: widget.y,
      w: Math.round((widthPx + gap) / stepX),
      h: Math.round((heightPx + gap) / stepY),
    });
  }

  /** Near the edge of the scrolling area a drag keeps going, even if the mouse rests there. */
  function scrollAlong(node: HTMLElement) {
    const area = node.closest<HTMLElement>("[data-scroll-area]");
    if (!area) {
      return;
    }
    const bounds = area.getBoundingClientRect();
    if (pointer.current.y > bounds.bottom - EDGE_PX) {
      area.scrollTop += SCROLL_STEP_PX;
    } else if (pointer.current.y < bounds.top + EDGE_PX) {
      area.scrollTop -= SCROLL_STEP_PX;
    }
  }

  function tick() {
    const current = operation.current;
    const node = container.current;
    if (!current || !node) {
      return;
    }
    scrollAlong(node);
    if (current.mode === "move") {
      followMove(current, node.getBoundingClientRect());
    } else {
      followResize(current);
    }
    frame.current = requestAnimationFrame(tick);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!editing || event.button !== 0) {
      return;
    }
    const element = (event.target as HTMLElement).closest<HTMLDivElement>("[data-widget-id]");
    const resizing = (event.target as HTMLElement).closest("[data-resize-handle]") !== null;
    const control = (event.target as HTMLElement).closest("button, input, select, textarea, a");
    const id = element?.dataset.widgetId;
    const widget = layout.widgets.find((item) => item.id === id);
    if (!element || !id || !widget || (!resizing && control)) {
      return;
    }
    onSelect?.(id);
    const box = element.getBoundingClientRect();
    operation.current = {
      id,
      mode: resizing ? "resize" : "move",
      pointerId: event.pointerId,
      grabX: event.clientX - box.left,
      grabY: event.clientY - box.top,
      startX: event.clientX,
      startY: event.clientY,
      rows: canvasRows(layout.widgets) + 1,
      startLayout: layout,
      widget,
      target: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
      timer: undefined,
    };
    pointer.current = { x: event.clientX, y: event.clientY };
    liftedAt.current = `translate3d(${widget.x * step.current}px, ${widget.y * stepY}px, 0) scale(${LIFTED_SCALE})`;
    element.setPointerCapture(event.pointerId);
    clearTimeout(settle.current);
    setGliding(true);
    setTarget(operation.current.target);
    setActiveId(id);
    frame.current = requestAnimationFrame(tick);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (operation.current?.pointerId === event.pointerId) {
      pointer.current = { x: event.clientX, y: event.clientY };
    }
  }

  function finish(restore: boolean) {
    const current = operation.current;
    if (!current) {
      return;
    }
    cancelAnimationFrame(frame.current);
    clearTimeout(current.timer);
    if (restore) {
      onChange(current.startLayout);
    } else if (current.mode === "move") {
      followMove(current, (container.current as HTMLDivElement).getBoundingClientRect());
      commit(current);
    } else {
      followResize(current);
      commit(current);
    }
    clearTimeout(current.timer);
    operation.current = null;
    setActiveId(null);
    setTarget(null);
    settle.current = setTimeout(() => setGliding(false), SETTLE_MS);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>, restore: boolean) {
    if (operation.current?.pointerId === event.pointerId) {
      finish(restore);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, id: string) {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const widget = layout.widgets.find((item) => item.id === id);
    const step = steps[event.key];
    if (!widget || !step || event.target !== event.currentTarget) {
      return;
    }
    event.preventDefault();
    const [dx, dy] = step;
    onChange(
      event.shiftKey
        ? resizeWidget(layout, id, { w: widget.w + dx, h: widget.h + dy }, rulesOf, columns)
        : moveWidget(layout, id, { x: widget.x + dx, y: widget.y + dy }, columns),
    );
  }

  useEffect(() => {
    if (!activeId) {
      return;
    }
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        finish(true);
      }
    };
    addEventListener("keydown", cancel);
    return () => removeEventListener("keydown", cancel);
  });

  useEffect(() => () => clearTimeout(settle.current), []);

  const place = (box: Box) => ({
    transform: `translate3d(calc(var(--grid-step) * ${box.x}), ${box.y * stepY}px, 0)`,
    width: `calc(var(--grid-step) * ${box.w} - ${gap}px)`,
    height: box.h * stepY - gap,
  });

  return (
    <div
      ref={container}
      data-testid="dashboard-grid"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => handlePointerEnd(event, false)}
      onPointerCancel={(event) => handlePointerEnd(event, true)}
      className="relative"
      style={{ height: Math.max(0, rows * stepY - gap) }}
    >
      {editing && width > 0 ? (
        <svg
          aria-hidden="true"
          data-testid="grid-cells"
          className="pointer-events-none absolute top-0 left-0 text-line"
          width={width + 1}
          height={Math.max(1, rows * stepY - gap)}
        >
          <defs>
            <pattern
              id={patternId}
              width={step.current}
              height={stepY}
              patternUnits="userSpaceOnUse"
            >
              <rect
                x={0.5}
                y={0.5}
                width={step.current - gap - 1}
                height={ROW_HEIGHT - 1}
                rx={CELL_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeDasharray="4 3"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </svg>
      ) : null}
      {target ? (
        <div
          data-testid="grid-target"
          data-grid-target={`${target.x},${target.y},${target.w},${target.h}`}
          className="statly-grid-card statly-grid-target"
          style={place(target)}
        />
      ) : null}
      {layout.widgets.map((widget) => {
        const lifted = widget.id === activeId && operation.current?.mode === "move";
        const box = place(widget);
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: focusable only while editing.
          <div
            key={widget.id}
            ref={(element) => {
              if (element) {
                cards.current.set(widget.id, element);
              } else {
                cards.current.delete(widget.id);
              }
            }}
            data-widget-id={widget.id}
            data-grid={`${widget.x},${widget.y},${widget.w},${widget.h}`}
            data-selected={selected === widget.id ? "true" : undefined}
            tabIndex={editing ? 0 : undefined}
            onKeyDown={editing ? (event) => handleKeyDown(event, widget.id) : undefined}
            className={`statly-grid-card ${editing ? "statly-editing" : ""} ${
              lifted ? "statly-lifted" : gliding ? "statly-gliding" : ""
            }`}
            style={lifted ? { ...box, transform: liftedAt.current } : box}
          >
            <WidgetBoundary title={titleOf(widget.type)} message={t("dashboard.error")}>
              {renderWidget(widget, scope)}
            </WidgetBoundary>
            {editing ? (
              <>
                <button
                  type="button"
                  aria-label={t("dashboard.remove")}
                  onClick={() => onRemove(widget.id)}
                  className="absolute top-1.5 right-1.5 z-10 grid size-5 cursor-pointer place-items-center rounded-full border border-line bg-page text-muted hover:bg-hover hover:text-text"
                >
                  <X size={11} />
                </button>
                <button
                  type="button"
                  data-resize-handle
                  aria-label={t("dashboard.resize")}
                  className="absolute right-1 bottom-1 z-10 grid size-[22px] cursor-nwse-resize touch-none place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-hover hover:text-text"
                >
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    className="size-[15px] fill-none stroke-current stroke-[1.8]"
                    strokeLinecap="round"
                  >
                    <path d="M5 13 13 5M9 13l4-4M13 13v-1" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>
        );
      })}
      {activeId && operation.current?.mode === "resize" ? (
        <div
          ref={ghost}
          data-testid="grid-ghost"
          className="statly-grid-card statly-grid-ghost"
          style={place(operation.current.widget)}
        />
      ) : null}
    </div>
  );
}
