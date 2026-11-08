/**
 * What charts can show and how series combine. Plain data without zod, so the phone card can import
 * it from `@statly/contract/charts` without bringing the whole contract along.
 */

export const seriesSources = [
  "timeline",
  "ratingTimeline",
  "answerButtons",
  "deckActivity",
  "forecast",
  "cardStates",
  "weekdays",
  "hours",
  "retentionTimeline",
  "speedTimeline",
  "timeTimeline",
  "newTimeline",
  "forgottenCards",
  "weakestDecks",
  "newCardsFrom",
  "deckStability",
  "sessionHours",
  "creationTimeline",
  "focusHours",
] as const;

/**
 * What each series runs along. Only series along the same axis can share a combined chart, and
 * series that list things of their own, such as decks, combine only with themselves.
 */
export const seriesAxisOf = {
  timeline: "days",
  ratingTimeline: "days",
  retentionTimeline: "days",
  speedTimeline: "days",
  timeTimeline: "days",
  newTimeline: "days",
  forecast: "futureDays",
  creationTimeline: "creation",
  hours: "hours",
  sessionHours: "hours",
  focusHours: "hours",
  weekdays: "weekdays",
  answerButtons: "answerButtons",
  deckActivity: "deckActivity",
  cardStates: "cardStates",
  forgottenCards: "forgottenCards",
  weakestDecks: "weakestDecks",
  newCardsFrom: "newCardsFrom",
  deckStability: "deckStability",
} as const satisfies Record<SeriesSource, string>;

/** The unit of each series. Series with the same unit share a scale in a combined chart. */
export const seriesUnitOf = {
  timeline: "count",
  ratingTimeline: "count",
  retentionTimeline: "percent",
  speedTimeline: "seconds",
  timeTimeline: "minutes",
  newTimeline: "count",
  forecast: "count",
  creationTimeline: "minutes",
  hours: "count",
  sessionHours: "count",
  focusHours: "percent",
  weekdays: "count",
  answerButtons: "count",
  deckActivity: "count",
  cardStates: "count",
  forgottenCards: "count",
  weakestDecks: "percent",
  newCardsFrom: "count",
  deckStability: "days",
} as const satisfies Record<SeriesSource, string>;
export type SeriesUnit = (typeof seriesUnitOf)[SeriesSource];

/**
 * Every chart kind, and whether it can share one plot with others in a combined chart.
 * A new chart kind is added here, and with `combinable: true` it shows up under "Combined" in the
 * editor by itself. Tests check that the dashboard and the phone card can draw every combinable kind.
 */
export const chartKindInfo = {
  bar: { combinable: true },
  line: { combinable: true },
  pie: { combinable: false },
} as const;
export type ChartKind = keyof typeof chartKindInfo;
export const chartKinds = Object.keys(chartKindInfo) as ChartKind[];
export const combinableChartKinds = ["bar", "line"] as const satisfies readonly ChartKind[];
export type CombinableChartKind = (typeof combinableChartKinds)[number];

/** Where a layer's scale goes. "none" draws its shape on a scale of its own that stays hidden. */
export const chartAxes = ["auto", "left", "right", "none"] as const;
export type ChartAxis = (typeof chartAxes)[number];
export const maxChartLayers = 6;

export type SeriesSource = (typeof seriesSources)[number];
export type SeriesAxis = (typeof seriesAxisOf)[SeriesSource];

/** The series that can share a combined chart with ``source``, itself included. */
export function combinesWith(source: SeriesSource, other: SeriesSource): boolean {
  return seriesAxisOf[source] === seriesAxisOf[other];
}
