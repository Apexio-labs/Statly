import type { CustomWidget, MediaAsset, WidgetElement } from "@statly/contract";

const BOX = { opacity: 1 };

export function blankWidget(id: string): CustomWidget {
  return {
    id,
    name: "",
    description: "",
    size: { w: 6, h: 8 },
    background: { kind: "card" },
    elements: [],
  };
}

export type ElementKind = Exclude<WidgetElement["kind"], "media">;

export function newElement(kind: ElementKind, id: string): WidgetElement {
  const text = { size: 12, bold: false, align: "left" as const, color: "text" as const };
  switch (kind) {
    case "text":
      return { ...BOX, ...text, id, kind, x: 8, y: 10, w: 60, h: 16, text: "Text", bold: true };
    case "metric":
      return {
        ...BOX,
        ...text,
        id,
        kind,
        x: 8,
        y: 30,
        w: 60,
        h: 26,
        size: 22,
        bold: true,
        source: "reviews",
        range: "dashboard",
      };
    case "chart":
      return {
        ...BOX,
        id,
        kind,
        x: 6,
        y: 30,
        w: 88,
        h: 62,
        source: "timeline",
        chart: "bar",
        range: "last30",
        color: "accent",
      };
    case "progress":
      return {
        ...BOX,
        id,
        kind,
        x: 25,
        y: 20,
        w: 50,
        h: 60,
        source: "reviews",
        range: "today",
        goal: 100,
        style: "ring",
        color: "accent",
      };
    case "heatmap":
      return { ...BOX, id, kind, x: 4, y: 20, w: 92, h: 70 };
    default:
      return {
        ...BOX,
        id,
        kind: "shape",
        x: 20,
        y: 20,
        w: 40,
        h: 40,
        shape: "rectangle",
        fill: "accent",
        radius: 8,
      };
  }
}

export function newMediaElement(asset: MediaAsset, id: string): WidgetElement {
  return {
    ...BOX,
    id,
    kind: "media",
    x: 10,
    y: 10,
    w: 80,
    h: 80,
    asset,
    fit: "cover",
    radius: 4,
    loop: true,
  };
}

const MEDIA_DEFAULTS = { fit: "cover", radius: 4, loop: true } as const;

/** The values an element starts with, which a reset brings back. */
export function elementDefaults(element: WidgetElement): Partial<WidgetElement> {
  return element.kind === "media" ? MEDIA_DEFAULTS : newElement(element.kind, element.id);
}

type Template = { key: string; build: (id: string) => CustomWidget };

export const templates: Template[] = [
  {
    key: "dailyGoal",
    build: (id) => ({
      ...blankWidget(id),
      name: "Daily goal",
      size: { w: 3, h: 7 },
      elements: [
        {
          ...(newElement("text", "e1") as Extract<WidgetElement, { kind: "text" }>),
          text: "Today",
          x: 8,
          y: 7,
          w: 84,
          h: 12,
          align: "center",
        },
        { ...(newElement("progress", "e2") as WidgetElement), x: 14, y: 24, w: 72, h: 66 },
      ],
    }),
  },
  {
    key: "streak",
    build: (id) => ({
      ...blankWidget(id),
      name: "Streak",
      size: { w: 3, h: 4 },
      background: { kind: "gradient", start: "#087f8c", end: "#176bb0", angle: 135 },
      elements: [
        {
          ...(newElement("text", "e1") as Extract<WidgetElement, { kind: "text" }>),
          text: "Streak",
          color: "#ffffff",
          x: 8,
          y: 12,
          w: 84,
          h: 24,
          size: 16,
        },
        {
          ...(newElement("metric", "e2") as Extract<WidgetElement, { kind: "metric" }>),
          source: "currentStreak",
          color: "#ffffff",
          x: 8,
          y: 40,
          w: 84,
          h: 48,
          size: 40,
        },
      ],
    }),
  },
  {
    key: "weekly",
    build: (id) => ({
      ...blankWidget(id),
      name: "Last 7 days",
      size: { w: 6, h: 7 },
      elements: [
        {
          ...(newElement("text", "e1") as Extract<WidgetElement, { kind: "text" }>),
          text: "Last 7 days",
          x: 4,
          y: 6,
          w: 92,
          h: 14,
          size: 9,
        },
        {
          ...(newElement("chart", "e2") as Extract<WidgetElement, { kind: "chart" }>),
          range: "last7",
          x: 3,
          y: 22,
          w: 94,
          h: 74,
        },
      ],
    }),
  },
];
