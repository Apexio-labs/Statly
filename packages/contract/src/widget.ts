import { z } from "zod";

/** Everything a custom widget can show. Widgets are data, never code. */

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const cellCount = z.number().int().min(1).max(16);

/** A theme color that follows the active theme, or a fixed color. */
export const paint = z.union([z.enum(["text", "muted", "accent", "card"]), color]);

export const metricSources = [
  "reviews",
  "ratings",
  "studyTime",
  "successRate",
  "retention",
  "activeDays",
  "dueCards",
  "currentStreak",
  "longestStreak",
  "dailyAverage",
] as const;

export const seriesSources = [
  "timeline",
  "ratingTimeline",
  "answerButtons",
  "deckActivity",
  "forecast",
  "cardStates",
  "weekdays",
  "hours",
] as const;

/** "dashboard" follows the filters above the dashboard. */
export const widgetRanges = ["dashboard", "today", "last7", "last30", "lastYear"] as const;

/** Anki's browser engine plays no H.264, so every video is stored as WebM. */
export const mediaTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/webm",
] as const;

export const mediaAsset = z
  .object({ id: z.string().regex(/^[0-9a-f]{64}$/), type: z.enum(mediaTypes) })
  .strict();

/** Position and size in percent of the widget, so a widget scales with its grid size. */
const position = {
  x: z.number().min(-100).max(200),
  y: z.number().min(-100).max(200),
  w: z.number().min(1).max(300),
  h: z.number().min(1).max(300),
};

/** An arrangement the user made for one widget size. The closest arrangement applies. */
export const sizeLayout = z.object({ cellsW: cellCount, cellsH: cellCount, ...position }).strict();

const box = {
  id: z.string().min(1).max(40),
  ...position,
  opacity: z.number().min(0).max(1),
  /** Clockwise, in degrees, around the element's center. */
  rotation: z.number().min(-360).max(360).optional(),
  /** The element appears only from this widget size on, in grid cells. */
  showFrom: z.object({ w: cellCount, h: cellCount }).strict().optional(),
  layouts: z.array(sizeLayout).max(8).optional(),
};

const textStyle = {
  /** In percent of the widget's height. */
  size: z.number().min(2).max(100),
  bold: z.boolean(),
  align: z.enum(["left", "center", "right"]),
  color: paint,
};

export const textElement = z
  .object({ ...box, ...textStyle, kind: z.literal("text"), text: z.string().max(500) })
  .strict();

export const metricElement = z
  .object({
    ...box,
    ...textStyle,
    kind: z.literal("metric"),
    source: z.enum(metricSources),
    range: z.enum(widgetRanges),
  })
  .strict();

export const chartElement = z
  .object({
    ...box,
    kind: z.literal("chart"),
    source: z.enum(seriesSources),
    chart: z.enum(["bar", "line"]),
    range: z.enum(widgetRanges),
    color: paint,
  })
  .strict();

export const progressElement = z
  .object({
    ...box,
    kind: z.literal("progress"),
    source: z.enum(metricSources),
    range: z.enum(widgetRanges),
    goal: z.number().positive().max(1_000_000),
    style: z.enum(["ring", "bar"]),
    color: paint,
  })
  .strict();

export const heatmapElement = z.object({ ...box, kind: z.literal("heatmap") }).strict();

export const mediaElement = z
  .object({
    ...box,
    kind: z.literal("media"),
    asset: mediaAsset,
    fit: z.enum(["cover", "contain"]),
    radius: z.number().min(0).max(50),
    loop: z.boolean().optional(),
  })
  .strict();

export const shapeElement = z
  .object({
    ...box,
    kind: z.literal("shape"),
    shape: z.enum(["rectangle", "ellipse"]),
    fill: paint,
    radius: z.number().min(0).max(50),
  })
  .strict();

export const widgetElement = z.discriminatedUnion("kind", [
  textElement,
  metricElement,
  chartElement,
  progressElement,
  heatmapElement,
  mediaElement,
  shapeElement,
]);

export const widgetBackground = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("card") }).strict(),
  z.object({ kind: z.literal("color"), color }).strict(),
  z
    .object({
      kind: z.literal("gradient"),
      start: color,
      end: color,
      angle: z.number().min(0).max(360),
    })
    .strict(),
  z
    .object({
      kind: z.literal("media"),
      asset: mediaAsset,
      fit: z.enum(["cover", "contain"]),
      /** Darkens the picture so text on it stays readable, from 0 to 1. */
      shade: z.number().min(0).max(1),
      loop: z.boolean().optional(),
    })
    .strict(),
]);

export const customWidget = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    name: z.string().min(1).max(80),
    description: z.string().max(200),
    size: z
      .object({
        w: z.number().int().min(2).max(12),
        h: z.number().int().min(2).max(16),
        minW: z.number().int().min(2).max(12).optional(),
        maxW: z.number().int().min(2).max(12).optional(),
        minH: z.number().int().min(2).max(16).optional(),
        maxH: z.number().int().min(2).max(16).optional(),
      })
      .strict(),
    background: widgetBackground,
    elements: z.array(widgetElement).max(40),
  })
  .strict();

export type CustomWidget = z.output<typeof customWidget>;
export type WidgetElement = z.output<typeof widgetElement>;
export type WidgetBackground = z.output<typeof widgetBackground>;
export type Paint = z.output<typeof paint>;
export type MetricSource = (typeof metricSources)[number];
export type SeriesSource = (typeof seriesSources)[number];
export type WidgetRange = (typeof widgetRanges)[number];
export type MediaAsset = z.output<typeof mediaAsset>;
export type SizeLayout = z.output<typeof sizeLayout>;
export type Cells = { w: number; h: number };

export const customWidgetPrefix = "custom:";
