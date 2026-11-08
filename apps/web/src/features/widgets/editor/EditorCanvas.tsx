import type { Cells, CustomWidget, WidgetElement } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import {
  boxStyle,
  cellsToPixels,
  designAspect,
  GRID_PITCH,
  isVisibleAt,
  layoutAt,
  pixelsToCells,
  sizeLimits,
} from "@statly/widget-runtime";
import { RotateCw } from "lucide-react";
import { type PointerEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { WidgetScope } from "../../dashboard/widgets.tsx";
import { ElementView } from "../ElementView.tsx";
import { WidgetFrame } from "../WidgetFrame.tsx";
import { type Guides, resizedBox, rotationAt, snapBox } from "./editorState.ts";

const STAGE_PADDING = 40;
const CELL_RADIUS = 9;
const SETTLE_MS = 180;
const MIN_ELEMENT_PERCENT = 3;
const HANDLES = ["nw", "ne", "sw", "se"] as const;
type Handle = (typeof HANDLES)[number];
type Box = Pick<WidgetElement, "x" | "y" | "w" | "h">;

const HANDLE_POSITION: Record<Handle, string> = {
  nw: "-top-1.5 -left-1.5 cursor-nwse-resize",
  ne: "-top-1.5 -right-1.5 cursor-nesw-resize",
  sw: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
  se: "-right-1.5 -bottom-1.5 cursor-nwse-resize",
};

const WIDGET_HANDLE: Record<Handle, string> = {
  nw: "top-0.5 left-0.5 rotate-180 cursor-nwse-resize",
  ne: "top-0.5 right-0.5 -rotate-90 cursor-nesw-resize",
  sw: "bottom-0.5 left-0.5 rotate-90 cursor-nesw-resize",
  se: "right-0.5 bottom-0.5 cursor-nwse-resize",
};

type Drag = {
  id: string;
  handle: Handle | "rotate" | null;
  pointerId: number;
  startX: number;
  startY: number;
  start: Box;
  moved: boolean;
};

type WidgetDrag = {
  handle: Handle;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  start: Cells;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Both sides grow alike, so the count may only change in steps of two. */
function sameOnBothSides(start: number, next: number): number {
  return start + Math.round((next - start) / 2) * 2;
}

type Props = {
  widget: CustomWidget;
  cells: Cells;
  scope: WidgetScope;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCells: (cells: Cells) => void;
  /** Called while dragging, so a drag stays one undo step. */
  onPreview: (id: string, box: Partial<Box>) => void;
  onPreviewRotation: (id: string, rotation: number) => void;
  onCommit: () => void;
};

export function EditorCanvas({
  widget,
  cells,
  scope,
  selected,
  onSelect,
  onCells,
  onPreview,
  onPreviewRotation,
  onCommit,
}: Props) {
  const { t } = useTranslation();
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const widgetDrag = useRef<WidgetDrag | null>(null);
  const patternId = useId();
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<Guides>({ x: null, y: null });
  const [resizing, setResizing] = useState(false);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const limits = sizeLimits(widget.size);
  const { width, height } = cellsToPixels(cells);
  const aspect = designAspect(widget.size);
  const [frozenFit, setFrozenFit] = useState<number | null>(null);
  const [settling, setSettling] = useState(false);

  // A cell of room around the widget. The scale waits during a drag, or the pointer would slip.
  const framed = cellsToPixels({ w: cells.w + 1, h: cells.h + 1 });
  const fit =
    frozenFit ??
    Math.max(
      0.1,
      Math.min(
        1,
        (room.width - STAGE_PADDING) / framed.width,
        (room.height - STAGE_PADDING) / framed.height,
      ),
    );
  const reachX = Math.ceil(room.width / fit / GRID_PITCH.x) + 2;
  const reachY = Math.ceil(room.height / fit / GRID_PITCH.y) + 2;

  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) {
      return;
    }
    const update = () => setRoom({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function start(event: PointerEvent<HTMLElement>, element: WidgetElement, handle: Drag["handle"]) {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(element.id);
    const { x, y, w, h } = layoutAt(element, widget.size, cells);
    drag.current = {
      id: element.id,
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: { x, y, w, h },
      moved: false,
    };
  }

  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) {
      return;
    }
    current.moved = true;
    const dx = ((event.clientX - current.startX) / (width * fit)) * 100;
    const dy = ((event.clientY - current.startY) / (height * fit)) * 100;
    const { x, y, w, h } = current.start;
    if (!current.handle) {
      const others = widget.elements
        .filter((element) => element.id !== current.id)
        .map((element) => layoutAt(element, widget.size, cells));
      const snapped = snapBox({ x: x + dx, y: y + dy, w, h }, others);
      setGuides(snapped.guides);
      onPreview(current.id, { x: snapped.x, y: snapped.y });
      return;
    }
    if (current.handle === "rotate") {
      const area = canvas.current?.getBoundingClientRect();
      if (area) {
        const center = {
          x: area.left + ((x + w / 2) / 100) * area.width,
          y: area.top + ((y + h / 2) / 100) * area.height,
        };
        const pointer = { x: event.clientX, y: event.clientY };
        onPreviewRotation(current.id, rotationAt(center, pointer, event.shiftKey));
      }
      return;
    }
    const element = widget.elements.find((item) => item.id === current.id);
    const toPercentX = 100 / width;
    const toPercentY = 100 / height;
    const next = resizedBox(
      { x: x / toPercentX, y: y / toPercentY, w: w / toPercentX, h: h / toPercentY },
      {
        x: current.handle.includes("w") ? -1 : 1,
        y: current.handle.includes("n") ? -1 : 1,
      },
      { x: (event.clientX - current.startX) / fit, y: (event.clientY - current.startY) / fit },
      element?.rotation ?? 0,
      event.altKey,
      (MIN_ELEMENT_PERCENT / 100) * Math.min(width, height),
    );
    onPreview(current.id, {
      x: next.x * toPercentX,
      y: next.y * toPercentY,
      w: next.w * toPercentX,
      h: next.h * toPercentY,
    });
  }

  function end(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    const { moved } = drag.current;
    drag.current = null;
    setGuides({ x: null, y: null });
    if (moved) {
      onCommit();
    }
  }

  function startWidgetResize(event: PointerEvent<HTMLElement>, handle: Handle) {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    widgetDrag.current = {
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      start: cells,
    };
    setFrozenFit(fit);
    setResizing(true);
  }

  /** Normally the opposite corner stays put. With Alt the center does. */
  function resizeWidget(current: WidgetDrag, fromCenter: boolean) {
    const signX = current.handle.includes("w") ? -1 : 1;
    const signY = current.handle.includes("n") ? -1 : 1;
    const pull = fromCenter ? 2 : 1;
    const startSize = cellsToPixels(current.start);
    const raw = pixelsToCells(
      startSize.width + (((current.lastX - current.startX) * signX) / fit) * pull,
      startSize.height + (((current.lastY - current.startY) * signY) / fit) * pull,
    );
    const next = {
      w: clamp(
        fromCenter ? sameOnBothSides(current.start.w, raw.w) : raw.w,
        limits.minW,
        limits.maxW,
      ),
      h: clamp(
        fromCenter ? sameOnBothSides(current.start.h, raw.h) : raw.h,
        limits.minH,
        limits.maxH,
      ),
    };
    const nextSize = cellsToPixels(next);
    setShift(
      fromCenter
        ? { x: 0, y: 0 }
        : {
            x: ((nextSize.width - startSize.width) / 2) * signX,
            y: ((nextSize.height - startSize.height) / 2) * signY,
          },
    );
    onCells(next);
  }

  const resizeRef = useRef(resizeWidget);
  resizeRef.current = resizeWidget;

  // Alt can change while the mouse rests, and that alone must already take effect.
  useEffect(() => {
    if (!resizing) {
      return;
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Alt" && widgetDrag.current) {
        resizeRef.current(widgetDrag.current, event.altKey);
      }
    }
    addEventListener("keydown", handleKey);
    addEventListener("keyup", handleKey);
    return () => {
      removeEventListener("keydown", handleKey);
      removeEventListener("keyup", handleKey);
    };
  }, [resizing]);

  function moveWidgetResize(event: PointerEvent<HTMLElement>) {
    const current = widgetDrag.current;
    if (current?.pointerId !== event.pointerId) {
      return;
    }
    current.lastX = event.clientX;
    current.lastY = event.clientY;
    resizeWidget(current, event.altKey);
  }

  function endWidgetResize(event: PointerEvent<HTMLElement>) {
    if (widgetDrag.current?.pointerId === event.pointerId) {
      widgetDrag.current = null;
      setResizing(false);
      setFrozenFit(null);
      setShift({ x: 0, y: 0 });
      setSettling(true);
      setTimeout(() => setSettling(false), SETTLE_MS);
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the page handles the keyboard for the canvas.
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on empty space deselects.
    <div
      ref={stage}
      data-testid="editor-stage"
      onClick={() => onSelect(null)}
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <div
        className="absolute top-1/2 left-1/2"
        style={{
          width,
          height,
          transform: `translate(-50%, -50%) scale(${fit}) translate(${shift.x}px, ${shift.y}px)`,
          transition: settling ? `transform ${SETTLE_MS}ms ease-out` : undefined,
        }}
      >
        <svg
          aria-hidden="true"
          data-testid="editor-cells"
          className="pointer-events-none absolute text-line"
          style={{
            left: -reachX * GRID_PITCH.x,
            top: -reachY * GRID_PITCH.y,
            width: (reachX * 2 + cells.w) * GRID_PITCH.x,
            height: (reachY * 2 + cells.h) * GRID_PITCH.y,
          }}
        >
          <defs>
            <pattern
              id={patternId}
              width={GRID_PITCH.x}
              height={GRID_PITCH.y}
              patternUnits="userSpaceOnUse"
            >
              <rect
                x={0.5}
                y={0.5}
                width={GRID_PITCH.x - GRID_PITCH.gap - 1}
                height={GRID_PITCH.y - GRID_PITCH.gap - 1}
                rx={CELL_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeDasharray="4 3"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </svg>
        <div ref={canvas} data-testid="editor-canvas" className="absolute inset-0">
          <WidgetFrame widget={widget}>
            {widget.elements.map((element) => {
              const box = layoutAt(element, widget.size, cells);
              const visible = isVisibleAt(element, cells);
              return (
                <div
                  key={element.id}
                  data-hidden-here={visible ? undefined : "true"}
                  style={boxStyle(
                    box,
                    visible ? element.opacity : element.opacity * 0.25,
                    element.rotation,
                  )}
                  className="pointer-events-none"
                >
                  <ElementView
                    element={element}
                    scope={scope}
                    frame={{
                      aspect,
                      heightPx: (height * box.h) / 100,
                      widthPx: (width * box.w) / 100,
                    }}
                  />
                </div>
              );
            })}
          </WidgetFrame>
          {guides.x !== null ? (
            <span
              data-guide="x"
              className="pointer-events-none absolute inset-y-0 w-px bg-accent"
              style={{ left: `${guides.x}%` }}
            />
          ) : null}
          {guides.y !== null ? (
            <span
              data-guide="y"
              className="pointer-events-none absolute inset-x-0 h-px bg-accent"
              style={{ top: `${guides.y}%` }}
            />
          ) : null}
          {widget.elements.map((element) => {
            const active = element.id === selected;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: arrows and Delete act on the selection.
              // biome-ignore lint/a11y/useKeyWithClickEvents: arrows and Delete act on the selection.
              <div
                key={element.id}
                data-element-id={element.id}
                style={boxStyle(layoutAt(element, widget.size, cells), 1, element.rotation)}
                onPointerDown={(event) => start(event, element, null)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onClick={(event) => event.stopPropagation()}
                className={`cursor-move touch-none ${
                  active ? "outline-2 outline-accent" : "hover:outline-1 hover:outline-accent/60"
                }`}
              >
                {active ? (
                  <span
                    data-handle="rotate"
                    title={t("editor.rotate")}
                    onPointerDown={(event) => start(event, element, "rotate")}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                    className="absolute -top-7 left-1/2 grid size-5 -translate-x-1/2 cursor-grab touch-none place-items-center rounded-full border-2 border-accent bg-card text-accent"
                  >
                    <RotateCw size={10} strokeWidth={3} />
                  </span>
                ) : null}
                {active
                  ? HANDLES.map((handle) => (
                      <span
                        key={handle}
                        data-handle={handle}
                        title={t("editor.resize")}
                        onPointerDown={(event) => start(event, element, handle)}
                        onPointerMove={move}
                        onPointerUp={end}
                        onPointerCancel={end}
                        className={`absolute size-3 rounded-full border-2 border-accent bg-card ${HANDLE_POSITION[handle]}`}
                      />
                    ))
                  : null}
              </div>
            );
          })}
          {HANDLES.map((handle) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: the size fields offer the same by keyboard.
            // biome-ignore lint/a11y/useKeyWithClickEvents: the size fields offer the same by keyboard.
            <span
              key={handle}
              data-testid={handle === "se" ? "widget-resize" : `widget-resize-${handle}`}
              title={t("editor.resizeWidget")}
              onPointerDown={(event) => startWidgetResize(event, handle)}
              onPointerMove={moveWidgetResize}
              onPointerUp={endWidgetResize}
              onPointerCancel={endWidgetResize}
              onClick={(event) => event.stopPropagation()}
              className={`absolute z-10 grid size-[22px] touch-none place-items-center rounded-[5px] bg-card/80 text-muted hover:text-text ${WIDGET_HANDLE[handle]}`}
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className="size-[15px] fill-none stroke-current stroke-[1.8]"
                strokeLinecap="round"
              >
                <path d="M5 13 13 5M9 13l4-4M13 13v-1" />
              </svg>
            </span>
          ))}
          {resizing ? (
            <span className="absolute top-1 left-1/2 z-10 -translate-x-1/2 rounded-control bg-card px-2 py-1 text-xs font-semibold whitespace-nowrap text-text shadow-card">
              {cells.w} × {cells.h}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
