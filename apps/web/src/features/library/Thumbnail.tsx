import type { CustomWidget, WidgetType } from "@statly/contract";
import { cellsToPixels } from "@statly/widget-runtime";
import { useEffect, useRef, useState } from "react";
import type { WidgetScope } from "../dashboard/widgets.tsx";
import { CustomWidgetView } from "../widgets/renderWidget.tsx";

const WIDTH = 200;
const HEIGHT = 92;
const BASE = HEIGHT - 8;

function Bars({ values, gap = 3 }: { values: number[]; gap?: number }) {
  const step = (WIDTH - 24) / values.length;
  const highest = Math.max(...values);
  return values.map((value, index) => {
    const height = (value / highest) * (HEIGHT - 20);
    return (
      <rect
        // biome-ignore lint/suspicious/noArrayIndexKey: the picture never changes.
        key={index}
        x={12 + index * step}
        y={BASE - height}
        width={step - gap}
        height={height}
        rx={1.5}
        fill="currentColor"
        opacity={0.35 + (0.65 * value) / highest}
      />
    );
  });
}

function Rows({ values }: { values: number[] }) {
  const row = (HEIGHT - 20) / values.length;
  return values.map((value, index) => (
    <rect
      // biome-ignore lint/suspicious/noArrayIndexKey: the picture never changes.
      key={index}
      x={20}
      y={10 + index * row}
      width={value * 1.3}
      height={row - 5}
      rx={2.5}
      fill="currentColor"
      opacity={1 - index * 0.14}
    />
  ));
}

function Heat() {
  const cells = [];
  for (let week = 0; week < 22; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const level = ((week * 7 + day * 3) * 2654435761) % 5;
      cells.push(
        <rect
          key={`${week}-${day}`}
          x={14 + week * 8}
          y={16 + day * 8}
          width={6.5}
          height={6.5}
          rx={1.5}
          fill="currentColor"
          opacity={0.1 + level * 0.22}
        />,
      );
    }
  }
  return cells;
}

function Ring() {
  const radius = 28;
  const length = 2 * Math.PI * radius;
  return [0.5, 0.3, 0.2].map((share, index, shares) => {
    const before = shares.slice(0, index).reduce((sum, value) => sum + value, 0);
    return (
      <circle
        key={share}
        cx={WIDTH / 2}
        cy={HEIGHT / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={12}
        strokeDasharray={`${share * length - 3} ${length}`}
        strokeDashoffset={-before * length}
        opacity={1 - index * 0.3}
        transform={`rotate(-90 ${WIDTH / 2} ${HEIGHT / 2})`}
      />
    );
  });
}

function BigNumber({ text }: { text: string }) {
  return (
    <text
      x={WIDTH / 2}
      y={HEIGHT / 2 + 12}
      textAnchor="middle"
      fontSize={34}
      fontWeight={700}
      fill="currentColor"
    >
      {text}
    </text>
  );
}

const PICTURES: Record<WidgetType, () => React.ReactNode> = {
  "review-summary": () => <BigNumber text="412" />,
  "rating-summary": () => <BigNumber text="556" />,
  "learned-cards": () => <BigNumber text="318" />,
  "study-time": () => <BigNumber text="1:24 h" />,
  "success-rate": () => <BigNumber text="91 %" />,
  "due-cards": () => <BigNumber text="86" />,
  "review-breakdown": () => <Rows values={[100, 74, 52, 40, 22]} />,
  "deck-activity": () => <Rows values={[100, 62, 38, 20]} />,
  "deck-ratings": () => <Rows values={[100, 70, 34, 24]} />,
  "review-timeline": () => <Bars values={[4, 6, 5, 8, 7, 9, 6, 10, 8, 11, 9, 12, 10, 13]} />,
  "rating-timeline": () => <Bars values={[6, 8, 7, 11, 9, 12, 8, 13, 11, 14, 12, 15, 13, 16]} />,
  "answer-buttons": () => <Bars values={[3, 5, 12, 4]} gap={12} />,
  "due-forecast": () => <Bars values={[12, 9, 8, 6, 5, 4, 3]} gap={8} />,
  "card-states": () => <Ring />,
  "study-rhythm": () => (
    <Bars
      values={[1, 1, 1, 2, 3, 5, 7, 9, 8, 6, 4, 4, 5, 6, 7, 9, 11, 13, 12, 9, 7, 4, 2, 1]}
      gap={2}
    />
  ),
  "rating-rhythm": () => (
    <Bars
      values={[1, 1, 1, 2, 4, 6, 9, 11, 10, 8, 5, 5, 6, 8, 9, 11, 13, 15, 14, 11, 8, 5, 2, 1]}
      gap={2}
    />
  ),
  "review-heatmap": () => <Heat />,
  "rating-heatmap": () => <Heat />,
  "anki-today": () => <BigNumber text="128" />,
  "anki-future-due": () => <Bars values={[12, 11, 9, 9, 7, 6, 6, 5, 4, 4, 3, 2]} />,
  "anki-calendar": () => <Heat />,
  "anki-reviews": () => <Bars values={[5, 8, 6, 9, 7, 11, 8, 12, 9, 13, 10, 14]} />,
  "anki-card-counts": () => <Ring />,
  "anki-intervals": () => <Bars values={[14, 11, 9, 7, 6, 5, 4, 3, 3, 2, 2, 1]} />,
  "anki-stability": () => <Bars values={[3, 9, 13, 11, 8, 6, 5, 3, 2, 2, 1, 1]} />,
  "anki-difficulty": () => <Bars values={[1, 3, 6, 10, 13, 11, 8, 5, 3, 1]} />,
  "anki-retrievability": () => <Bars values={[1, 1, 2, 2, 3, 4, 6, 8, 11, 14]} />,
  "anki-hours": () => (
    <Bars
      values={[1, 1, 1, 1, 2, 4, 6, 8, 9, 7, 5, 4, 5, 6, 7, 9, 12, 13, 12, 9, 6, 4, 2, 1]}
      gap={2}
    />
  ),
  "anki-buttons": () => <Bars values={[3, 6, 12, 5, 2, 5, 13, 6, 1, 4, 14, 7]} />,
  "anki-added": () => <Bars values={[2, 9, 1, 6, 12, 3, 5, 8, 2, 11, 4, 6]} />,
  "anki-true-retention": () => <BigNumber text="89 %" />,
};

/** A small picture of a statistic. Drawing every real chart at once would cost too much. */
export function StatisticPicture({ type }: { type: WidgetType }) {
  const Picture = PICTURES[type];
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      className="h-full w-full text-accent"
    >
      <Picture />
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
