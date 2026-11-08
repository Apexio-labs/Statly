import { builtinWidgets, type CustomWidget, type WidgetType } from "@statly/contract";
import { cellsToPixels } from "@statly/widget-runtime";
import {
  Brain,
  CalendarClock,
  Clock,
  GraduationCap,
  type LucideIcon,
  MousePointerClick,
  Repeat,
  Sun,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WidgetScope } from "../dashboard/widgets.tsx";
import { CustomWidgetView } from "../widgets/renderWidget.tsx";

/** Every sketch is drawn into a frame this tall; its width follows the widget's shape. */
const HEIGHT = 100;
const PAD = 10;
const TOP = 26;

type Area = { x: number; y: number; w: number; h: number };
type Sketch = (area: Area) => React.ReactNode;

/** What a twin counts: cards moved on (reviews) or every click (ratings). */
export type Measure = "reviews" | "ratings";

/**
 * The frame's width per unit of height at a widget's standard size. Very wide widgets are kept
 * from turning into a thin line, so every sketch still has room.
 */
export function pictureAspect(cells: { w: number; h: number }): number {
  const { width, height } = cellsToPixels(cells);
  return Math.min(3.2, Math.max(1.3, width / height));
}

function bars(values: number[], gap = 0.25): Sketch {
  return ({ x, y, w, h }) => {
    const step = w / values.length;
    const highest = Math.max(...values);
    return values.map((value, index) => {
      const height = (value / highest) * h;
      return (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: the picture never changes.
          key={index}
          x={x + index * step + (step * gap) / 2}
          y={y + h - height}
          width={step * (1 - gap)}
          height={height}
          rx={Math.min(2, step * 0.2)}
          opacity={0.35 + (0.65 * value) / highest}
        />
      );
    });
  };
}

/**
 * Bars with a line over them on a scale of its own, marked by ticks at the right edge, as Anki's
 * charts with a second measure draw it. Without its own values the line adds the bars up, so
 * each picture's line follows the shape of its own bars.
 */
function barsWithLine(values: number[], line?: number[], gap = 0.25): Sketch {
  const total = values.reduce((sum, value) => sum + value, 0);
  let running = 0;
  const shares =
    line ??
    values.map((value) => {
      running += value;
      return running / total;
    });
  return (area) => {
    const ticks = 6;
    const { x, y, w, h } = { ...area, w: area.w - ticks };
    const step = w / values.length;
    const highest = Math.max(...values);
    const points = shares
      .map((share, index) => `${x + index * step + step / 2},${y + h - share * (h - 3) - 1.5}`)
      .join(" ");
    return (
      <>
        {values.map((value, index) => {
          const height = (value / highest) * h * 0.82;
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: the picture never changes.
              key={index}
              x={x + index * step + (step * gap) / 2}
              y={y + h - height}
              width={step * (1 - gap)}
              height={height}
              rx={Math.min(2, step * 0.2)}
              opacity={0.22 + (0.33 * value) / highest}
            />
          );
        })}
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {[0, 0.5, 1].map((share) => (
          <rect
            key={share}
            x={x + w + 2}
            y={y + h - share * (h - 3) - 2.5}
            width={ticks - 2}
            height={2}
            rx={1}
            opacity={0.45}
          />
        ))}
      </>
    );
  };
}

/** Bars from the left with a name stub before each, like decks or categories. */
function rows(values: number[]): Sketch {
  return ({ x, y, w, h }) => {
    const row = h / values.length;
    const label = Math.min(40, w * 0.24);
    return values.map((value, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: the picture never changes.
      <g key={index}>
        <rect
          x={x}
          y={y + index * row + row * 0.3}
          width={label * 0.75}
          height={row * 0.4}
          rx={1.5}
          opacity={0.3}
        />
        <rect
          x={x + label}
          y={y + index * row + row * 0.15}
          width={((w - label) * value) / 100}
          height={row * 0.7}
          rx={2.5}
          opacity={1 - index * 0.12}
        />
      </g>
    ));
  };
}

const heat: Sketch = ({ x, y, w, h }) => {
  const cell = Math.min(h / 7, 10);
  const columns = Math.floor(w / cell);
  const left = x + (w - columns * cell) / 2;
  const top = y + (h - cell * 7) / 2;
  const cells = [];
  for (let week = 0; week < columns; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const level = ((week * 7 + day * 3) * 2654435761) % 5;
      cells.push(
        <rect
          key={`${week}-${day}`}
          x={left + week * cell}
          y={top + day * cell}
          width={cell * 0.78}
          height={cell * 0.78}
          rx={cell * 0.2}
          opacity={0.1 + level * 0.22}
        />,
      );
    }
  }
  return cells;
};

/** A pie of filled slices, with a legend beside it when the frame is wide enough. */
const pie: Sketch = ({ x, y, w, h }) => {
  const radius = h / 2 - 4;
  const legend = w > h * 1.7;
  const cx = legend ? x + w * 0.3 : x + w / 2;
  const cy = y + h / 2;
  const shares = [0.45, 0.25, 0.18, 0.12];
  let start = -Math.PI / 2;
  const point = (at: number) => `${cx + radius * Math.cos(at)} ${cy + radius * Math.sin(at)}`;
  return (
    <>
      {shares.map((share, index) => {
        const end = start + share * 2 * Math.PI;
        const path = `M${cx} ${cy} L${point(start)} A${radius} ${radius} 0 ${
          share > 0.5 ? 1 : 0
        } 1 ${point(end)} Z`;
        start = end;
        return (
          <path
            key={share}
            d={path}
            opacity={1 - index * 0.22}
            stroke="var(--statly-card)"
            strokeWidth={1.5}
          />
        );
      })}
      {legend
        ? shares.map((share, index) => {
            const top = cy - 20 + index * 11;
            const left = cx + radius + 12;
            return (
              <g key={share} opacity={1 - index * 0.22}>
                <circle cx={left + 3} cy={top + 3} r={3} />
                <rect x={left + 10} y={top + 1} width={30 - index * 5} height={4} rx={2} />
              </g>
            );
          })
        : null}
    </>
  );
};

/** Time bars, a few in a second shade for more or less time per card than usual. */
const creationBars: Sketch = (area) => {
  const values = [5, 8, 3, 9, 6, 11, 4, 7, 10, 6];
  const step = area.w / values.length;
  const highest = Math.max(...values);
  return values.map((value, index) => {
    const height = (value / highest) * area.h;
    return (
      <rect
        // biome-ignore lint/suspicious/noArrayIndexKey: the picture never changes.
        key={index}
        x={area.x + index * step + step * 0.15}
        y={area.y + area.h - height}
        width={step * 0.7}
        height={height}
        rx={Math.min(2, step * 0.2)}
        opacity={index % 3 === 1 ? 0.4 : 0.9}
      />
    );
  });
};

/** Rounded blocks on a time line, like sessions. */
const strip: Sketch = ({ x, y, w, h }) => {
  const middle = y + h / 2;
  const blocks = [
    [0.04, 0.04, 0.3],
    [0.15, 0.03, 0.4],
    [0.28, 0.025, 0.25],
    [0.4, 0.05, 0.35],
    [0.55, 0.12, 0.6],
    [0.75, 0.1, 0.5],
  ] as const;
  return (
    <>
      <line x1={x} x2={x + w} y1={middle} y2={middle} stroke="currentColor" opacity={0.3} />
      {blocks.map(([start, width, height]) => (
        <rect
          key={start}
          x={x + start * w}
          y={middle - (height * h) / 2}
          width={width * w}
          height={height * h}
          rx={3}
          opacity={0.45 + height}
        />
      ))}
    </>
  );
};

/** Rows with a name and a few values, like a table. */
function table(columns: number): Sketch {
  return ({ x, y, w, h }) => {
    const row = h / 5;
    const cell = Math.min(20, w * 0.1);
    return Array.from({ length: 5 }, (_, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: the picture never changes.
      <g key={index} opacity={1 - index * 0.15}>
        <rect
          x={x}
          y={y + index * row + row * 0.25}
          width={w * (0.4 - index * 0.04)}
          height={row * 0.45}
          rx={2}
        />
        {Array.from({ length: columns }, (_, column) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: the picture never changes.
            key={column}
            x={x + w - (columns - column) * (cell + 8) + 8}
            y={y + index * row + row * 0.25}
            width={cell}
            height={row * 0.45}
            rx={2}
            opacity={0.55}
          />
        ))}
      </g>
    ));
  };
}

/** A row of small number tiles, each with a label below. */
const tiles: Sketch = ({ x, y, w, h }) => {
  const step = w / 5;
  const top = y + h / 2 - 14;
  return [0, 1, 2, 3, 4].map((index) => (
    <g key={index}>
      <rect x={x + index * step} y={top} width={step * 0.6} height={16} rx={3} />
      <rect x={x + index * step} y={top + 22} width={step * 0.45} height={6} rx={2} opacity={0.4} />
    </g>
  ));
};

/** A spread of answer times with a box for the usual range. */
const box: Sketch = (area) => {
  const { x, y, w, h } = area;
  return (
    <>
      {bars([1, 2, 4, 7, 10, 12, 10, 7, 5, 3, 2, 2, 1, 1], 0.2)(area)}
      <rect
        x={x + w * 0.3}
        y={y + h * 0.25}
        width={w * 0.22}
        height={h * 0.35}
        rx={5}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
      />
      <line
        x1={x + w * 0.41}
        x2={x + w * 0.41}
        y1={y + h * 0.18}
        y2={y + h * 0.67}
        stroke="currentColor"
        strokeWidth={3}
      />
    </>
  );
};

const chips: Sketch = ({ x, y, w, h }) =>
  [
    [0, 0.08, 0.34],
    [0.38, 0.08, 0.26],
    [0, 0.56, 0.24],
    [0.28, 0.56, 0.4],
  ].map(([left = 0, top = 0, width = 0]) => (
    <rect
      key={`${left}-${top}`}
      x={x + left * w}
      y={y + top * h}
      width={width * w}
      height={h * 0.34}
      rx={(h * 0.34) / 2}
      opacity={0.55}
    />
  ));

const note: Sketch = ({ x, y, w, h }) => (
  <>
    <rect x={x} y={y} width={w} height={h} rx={6} fill="none" stroke="currentColor" opacity={0.5} />
    {[0, 1, 2].map((line) => (
      <rect
        key={line}
        x={x + 10}
        y={y + 12 + line * (h - 24) * 0.4}
        width={(w - 20) * (0.8 - line * 0.22)}
        height={5}
        rx={2.5}
      />
    ))}
  </>
);

/** One number with an icon that tells what it counts, and a stub for its label. */
function metric(Icon: LucideIcon, text: string): Sketch {
  return ({ x, y, w, h }) => {
    const size = Math.min(24, h * 0.36);
    const middle = y + h * 0.45;
    const left = x + Math.max(0, (w - size - 96) / 2);
    const number = left + size + 18;
    return (
      <>
        <circle cx={left + size / 2 + 4} cy={middle} r={size / 2 + 6} opacity={0.15} />
        <Icon
          x={left + 4}
          y={middle - size / 2}
          width={size}
          height={size}
          strokeWidth={2.2}
          fill="none"
        />
        <text x={number} y={middle + size * 0.36} fontSize={size * 1.05} fontWeight={700}>
          {text}
        </text>
        <rect x={number} y={middle + size * 0.75} width={44} height={5} rx={2.5} opacity={0.3} />
      </>
    );
  };
}

/** The icon each measure carries, on its number tile and on the twin charts alike. */
export const measureIcons: Record<Measure, LucideIcon> = {
  reviews: Repeat,
  ratings: MousePointerClick,
};

type Picture = { sketch: Sketch; measure?: Measure };

const PICTURES: Record<WidgetType, Picture> = {
  "review-summary": { sketch: metric(Repeat, "412") },
  "rating-summary": { sketch: metric(MousePointerClick, "556") },
  "learned-cards": { sketch: metric(GraduationCap, "318") },
  "study-time": { sketch: metric(Clock, "1:24 h") },
  "success-rate": { sketch: metric(ThumbsUp, "91 %") },
  "due-cards": { sketch: metric(CalendarClock, "86") },
  "review-breakdown": { sketch: rows([100, 74, 52, 40, 22]) },
  "deck-activity": { sketch: rows([100, 62, 38, 20]), measure: "reviews" },
  "deck-ratings": { sketch: rows([100, 70, 34, 24]), measure: "ratings" },
  "review-timeline": {
    sketch: bars([4, 6, 5, 8, 7, 9, 6, 10, 8, 11, 9, 12, 10, 13]),
    measure: "reviews",
  },
  "rating-timeline": {
    sketch: bars([6, 8, 7, 11, 9, 12, 8, 13, 11, 14, 12, 15, 13, 16]),
    measure: "ratings",
  },
  "answer-buttons": { sketch: bars([3, 5, 12, 4], 0.45) },
  "due-forecast": { sketch: bars([12, 9, 8, 6, 5, 4, 3], 0.35) },
  "card-states": { sketch: rows([100, 64, 34, 14]) },
  "study-rhythm": {
    sketch: bars([1, 1, 1, 2, 3, 5, 7, 9, 8, 6, 4, 4, 5, 6, 7, 9, 11, 13, 12, 9, 7, 4, 2, 1], 0.3),
    measure: "reviews",
  },
  "rating-rhythm": {
    sketch: bars(
      [1, 1, 1, 2, 4, 6, 9, 11, 10, 8, 5, 5, 6, 8, 9, 11, 13, 15, 14, 11, 8, 5, 2, 1],
      0.3,
    ),
    measure: "ratings",
  },
  "review-heatmap": { sketch: heat, measure: "reviews" },
  "rating-heatmap": { sketch: heat, measure: "ratings" },
  "study-overview": { sketch: heat },
  "period-summary": { sketch: tiles },
  "answer-mix": { sketch: rows([100, 70, 40, 20]) },
  "answer-speed": { sketch: box },
  "study-sessions": { sketch: strip },
  "deck-table": { sketch: table(3) },
  "forgotten-cards": { sketch: table(2) },
  "weakest-decks": { sketch: rows([60, 66, 72, 80, 88]) },
  "new-cards-from": { sketch: chips },
  "day-notes": { sketch: note },
  "creation-time": { sketch: creationBars },
  "anki-today": { sketch: metric(Sun, "128") },
  "anki-future-due": { sketch: barsWithLine([9, 13, 6, 11, 5, 10, 7, 4, 9, 3, 7, 5]) },
  "anki-calendar": { sketch: heat },
  "anki-reviews": { sketch: barsWithLine([5, 8, 6, 9, 7, 11, 8, 12, 9, 13, 10, 14]) },
  "anki-card-counts": { sketch: pie },
  "anki-intervals": { sketch: barsWithLine([14, 11, 9, 7, 6, 5, 4, 3, 3, 2, 2, 1]) },
  "anki-stability": { sketch: barsWithLine([3, 9, 13, 11, 8, 6, 5, 3, 2, 2, 1, 1]) },
  "anki-difficulty": { sketch: barsWithLine([1, 3, 6, 10, 13, 11, 8, 5, 3, 1]) },
  "anki-retrievability": { sketch: barsWithLine([1, 1, 2, 2, 3, 4, 6, 8, 11, 14]) },
  "anki-hours": {
    // The share of correct answers stays high over the day and dips late at night.
    sketch: barsWithLine(
      [1, 1, 1, 1, 2, 4, 6, 8, 9, 7, 5, 4, 5, 6, 7, 9, 12, 13, 12, 9, 6, 4, 2, 1],
      [
        0.62, 0.6, 0.58, 0.6, 0.78, 0.86, 0.9, 0.92, 0.91, 0.9, 0.92, 0.9, 0.89, 0.9, 0.91, 0.9,
        0.88, 0.87, 0.86, 0.85, 0.83, 0.8, 0.74, 0.68,
      ],
      0.3,
    ),
  },
  "anki-buttons": { sketch: bars([3, 6, 12, 5, 2, 5, 13, 6, 1, 4, 14, 7]) },
  "anki-added": { sketch: barsWithLine([2, 9, 1, 6, 12, 3, 5, 8, 2, 11, 4, 6]) },
  "anki-true-retention": { sketch: metric(Brain, "89 %") },
};

export function measureOf(type: WidgetType): Measure | undefined {
  return PICTURES[type].measure;
}

/**
 * A quiet sketch of a statistic inside a frame shaped like the widget at its standard size, with
 * a title stub like a real widget. Drawing every real chart at once would cost too much.
 */
export function StatisticPicture({ type }: { type: WidgetType }) {
  const { sketch, measure } = PICTURES[type];
  const width = Math.round(HEIGHT * pictureAspect(builtinWidgets[type]));
  const Badge = measure ? measureIcons[measure] : null;
  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      aria-hidden="true"
      className="statly-tile-sketch block h-full w-full"
    >
      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={HEIGHT - 1}
        rx={8}
        fill="var(--statly-card)"
        stroke="var(--statly-border)"
        vectorEffect="non-scaling-stroke"
      />
      <g
        fill="currentColor"
        className="text-muted transition-colors duration-150 group-hover/tile:text-accent"
      >
        <rect
          x={PAD}
          y={PAD + 1}
          width={Math.min(52, width * 0.3)}
          height={5}
          rx={2.5}
          opacity={0.35}
        />
        {Badge ? (
          <g>
            <circle cx={width - PAD - 9} cy={PAD + 5} r={10.5} opacity={0.2} />
            <Badge
              x={width - PAD - 16}
              y={PAD - 2}
              width={14}
              height={14}
              strokeWidth={2.4}
              fill="none"
            />
          </g>
        ) : null}
        {sketch({ x: PAD, y: TOP, w: width - 2 * PAD, h: HEIGHT - TOP - PAD })}
      </g>
    </svg>
  );
}

/** A tiny dashboard row of twelve columns with the part a widget fills. */
export function Footprint({ columns }: { columns: number }) {
  const filled = Math.max(1, Math.min(12, columns));
  return (
    <svg
      width={20}
      height={10}
      viewBox="0 0 20 10"
      aria-hidden="true"
      className="statly-footprint shrink-0"
    >
      <rect
        x={0.5}
        y={0.5}
        width={19}
        height={9}
        rx={2}
        fill="none"
        stroke="currentColor"
        opacity={0.5}
      />
      <rect x={2} y={2} width={(16 * filled) / 12} height={6} rx={1} fill="currentColor" />
    </svg>
  );
}

function useFirstVisible<T extends Element>() {
  const node = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const current = node.current;
    if (!current) {
      return;
    }
    const sizes = new ResizeObserver(() => setWidth(current.clientWidth));
    const seen = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        seen.disconnect();
      }
    });
    sizes.observe(current);
    seen.observe(current);
    return () => {
      sizes.disconnect();
      seen.disconnect();
    };
  }, []);
  return { node, visible, width };
}

/** A real widget, shrunk to fit. It is drawn once it scrolls into view. */
export function WidgetPicture({
  widget,
  scope,
  height,
}: {
  widget: CustomWidget;
  scope: WidgetScope | null;
  height: number;
}) {
  const { node, visible, width } = useFirstVisible<HTMLDivElement>();
  const size = cellsToPixels(widget.size);
  const scale = width ? Math.min(1, (width - 16) / size.width, (height - 16) / size.height) : 0;
  return (
    <div ref={node} className="relative h-full w-full overflow-hidden">
      {visible && scope && scale ? (
        <div
          className="pointer-events-none absolute top-1/2 left-1/2"
          style={{
            width: size.width,
            height: size.height,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          <CustomWidgetView widget={widget} scope={scope} cells={widget.size} />
        </div>
      ) : null}
    </div>
  );
}
