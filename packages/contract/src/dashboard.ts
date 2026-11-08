import { z } from "zod";
import { mediaAsset } from "./widget.ts";

export const maxGridRows = 8192;

type Size = {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  w: number;
  h: number;
};

const tile: Size = { minW: 2, maxW: 6, minH: 2, maxH: 8, w: 3, h: 4 };
const chart: Size = { minW: 4, maxW: 12, minH: 6, maxH: 16, w: 6, h: 8 };
const ankiChart: Size = { minW: 4, maxW: 12, minH: 8, maxH: 16, w: 6, h: 10 };

/**
 * The built-in statistics in library order, with the sizes they allow in grid cells. Widgets
 * named `rating-…` are twins that count every answer instead of reviews, see `measures`.
 */
export const builtinWidgets = {
  "review-summary": tile,
  "rating-summary": tile,
  "learned-cards": tile,
  "review-breakdown": { ...chart, minH: 8 },
  "study-time": tile,
  "success-rate": tile,
  "due-cards": tile,
  "deck-activity": chart,
  "deck-ratings": chart,
  "review-timeline": { ...chart, minH: 8, w: 8 },
  "rating-timeline": { ...chart, minH: 8, w: 8 },
  "answer-buttons": { ...chart, minW: 3 },
  "due-forecast": chart,
  "card-states": chart,
  "study-rhythm": { ...chart, minW: 6, minH: 7, w: 8 },
  "rating-rhythm": { ...chart, minW: 6, minH: 7, w: 8 },
  "review-heatmap": { ...chart, minW: 6, minH: 7, w: 12 },
  "rating-heatmap": { ...chart, minW: 6, minH: 7, w: 12 },
  "study-overview": { minW: 6, maxW: 12, minH: 7, maxH: 16, w: 12, h: 10 },
  "period-summary": { minW: 4, maxW: 12, minH: 3, maxH: 6, w: 12, h: 3 },
  "answer-mix": { minW: 3, maxW: 8, minH: 5, maxH: 10, w: 4, h: 6 },
  "answer-speed": { minW: 4, maxW: 12, minH: 5, maxH: 10, w: 8, h: 6 },
  "study-sessions": { minW: 6, maxW: 12, minH: 4, maxH: 12, w: 12, h: 5 },
  "deck-table": { minW: 6, maxW: 12, minH: 5, maxH: 16, w: 12, h: 8 },
  "forgotten-cards": { minW: 4, maxW: 12, minH: 5, maxH: 16, w: 8, h: 8 },
  "weakest-decks": { minW: 4, maxW: 12, minH: 5, maxH: 12, w: 8, h: 7 },
  "new-cards-from": { minW: 3, maxW: 12, minH: 3, maxH: 8, w: 6, h: 3 },
  "day-notes": { minW: 3, maxW: 12, minH: 3, maxH: 10, w: 6, h: 4 },
  "creation-time": { ...chart, minH: 7, w: 8 },
  "anki-today": { minW: 3, maxW: 8, minH: 6, maxH: 12, w: 4, h: 8 },
  "anki-future-due": ankiChart,
  "anki-calendar": { ...chart, minW: 6, minH: 7, w: 12 },
  "anki-reviews": { ...ankiChart, w: 8 },
  "anki-card-counts": { ...ankiChart, minH: 7, h: 8 },
  "anki-intervals": ankiChart,
  "anki-stability": ankiChart,
  "anki-difficulty": ankiChart,
  "anki-retrievability": ankiChart,
  "anki-hours": ankiChart,
  "anki-buttons": ankiChart,
  "anki-added": ankiChart,
  "anki-true-retention": { ...ankiChart, minH: 7, h: 8 },
} as const satisfies Record<string, Size>;

export type WidgetType = keyof typeof builtinWidgets;

export const widgetTypes = Object.keys(builtinWidgets) as [WidgetType, ...WidgetType[]];

/** How the widget list in the editor is grouped. */
export const widgetGroups = {
  progress: [
    "period-summary",
    "review-summary",
    "rating-summary",
    "learned-cards",
    "study-time",
    "success-rate",
    "due-cards",
    "review-breakdown",
    "review-timeline",
    "rating-timeline",
    "answer-buttons",
    "answer-mix",
    "answer-speed",
  ],
  collection: [
    "deck-table",
    "forgotten-cards",
    "weakest-decks",
    "new-cards-from",
    "deck-activity",
    "deck-ratings",
    "due-forecast",
    "card-states",
  ],
  habits: [
    "study-overview",
    "study-sessions",
    "day-notes",
    "study-rhythm",
    "rating-rhythm",
    "review-heatmap",
    "rating-heatmap",
    "creation-time",
  ],
  anki: [
    "anki-today",
    "anki-future-due",
    "anki-calendar",
    "anki-reviews",
    "anki-card-counts",
    "anki-intervals",
    "anki-stability",
    "anki-difficulty",
    "anki-retrievability",
    "anki-hours",
    "anki-buttons",
    "anki-added",
    "anki-true-retention",
  ],
} as const satisfies Record<string, readonly WidgetType[]>;

export const widgetKinds: Record<
  WidgetType,
  "metric" | "chart" | "forecast" | "collection" | "heatmap" | "note"
> = {
  "study-overview": "heatmap",
  "period-summary": "metric",
  "answer-mix": "chart",
  "answer-speed": "chart",
  "study-sessions": "chart",
  "deck-table": "collection",
  "forgotten-cards": "collection",
  "weakest-decks": "chart",
  "new-cards-from": "collection",
  "day-notes": "note",
  "creation-time": "chart",
  "review-summary": "metric",
  "rating-summary": "metric",
  "learned-cards": "metric",
  "review-breakdown": "chart",
  "study-time": "metric",
  "success-rate": "metric",
  "due-cards": "metric",
  "deck-activity": "chart",
  "deck-ratings": "chart",
  "review-timeline": "chart",
  "rating-timeline": "chart",
  "answer-buttons": "chart",
  "due-forecast": "forecast",
  "card-states": "collection",
  "study-rhythm": "chart",
  "rating-rhythm": "chart",
  "review-heatmap": "heatmap",
  "rating-heatmap": "heatmap",
  "anki-today": "metric",
  "anki-future-due": "forecast",
  "anki-calendar": "heatmap",
  "anki-reviews": "chart",
  "anki-card-counts": "collection",
  "anki-intervals": "collection",
  "anki-stability": "collection",
  "anki-difficulty": "collection",
  "anki-retrievability": "collection",
  "anki-hours": "chart",
  "anki-buttons": "chart",
  "anki-added": "chart",
  "anki-true-retention": "metric",
};

/** A built-in widget, or `custom:<id>` for one the user made. */
export const dashboardWidget = z
  .object({
    id: z.string().min(1).max(64),
    type: z.string().regex(/^[a-z0-9:-]{1,60}$/),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  })
  .strict();

export const dashboardLayout = z.object({ widgets: z.array(dashboardWidget).max(100) }).strict();

export const mobilePeriods = ["today", "last7", "last30"] as const;

export const deviceMinHeight = 3;

/** Statistics that show the present moment, so a time range would mean nothing. */
export const deviceTimeless: readonly string[] = [
  "due-cards",
  "due-forecast",
  "card-states",
  "review-heatmap",
  ...widgetGroups.anki,
];

/** Whether a time range means nothing for this widget, as for a study goal, which is about today. */
export function isDeviceTimeless(type: string): boolean {
  return deviceTimeless.includes(type) || type.startsWith("goal:");
}

const deviceTiles: readonly string[] = [
  "review-summary",
  "learned-cards",
  "study-time",
  "success-rate",
  "due-cards",
];

export function defaultDevicePeriod(type: string): (typeof mobilePeriods)[number] {
  return deviceTiles.includes(type) ? "today" : type.startsWith("custom:") ? "last7" : "last30";
}

/** A widget on a phone or tablet. The time range replaces the dashboard's filter there. */
export const deviceWidget = dashboardWidget.extend({ period: z.enum(mobilePeriods) }).strict();

/** Layouts a user arranged by hand. Without one, a device follows the desktop automatically. */
export const deviceLayout = z
  .object({
    widgets: z.array(deviceWidget).max(100),
    /** Desktop widgets this layout has seen, so new ones can join and deleted ones can leave. */
    known: z.array(z.string().max(64)).max(200),
  })
  .strict();

export const deviceLayouts = z
  .object({ tablet: deviceLayout.nullable(), phone: deviceLayout.nullable() })
  .strict();

/** What a device shows right now, computed or arranged. */
export const resolvedDevice = z
  .object({ widgets: z.array(deviceWidget), automatic: z.boolean() })
  .strict();

export type DeviceWidget = z.output<typeof deviceWidget>;
export type DeviceLayout = z.output<typeof deviceLayout>;
export type DeviceLayouts = z.output<typeof deviceLayouts>;
export type ResolvedDevice = z.output<typeof resolvedDevice>;

export type SizeRules = Pick<Size, "minW" | "maxW" | "minH" | "maxH"> & { w: number; h: number };

export type DashboardWidget = z.output<typeof dashboardWidget>;
export type DashboardLayout = z.output<typeof dashboardLayout>;

export const dashboardFileFormat = "statly-dashboard";
export const dashboardFileVersion = 4;

/** A shared dashboard file. */
export const dashboardFile = z
  .object({
    format: z.literal(dashboardFileFormat),
    version: z.literal(dashboardFileVersion),
    layout: dashboardLayout,
  })
  .strict();

export const defaultLayout: DashboardLayout = {
  widgets: [
    { id: "review-summary-1", type: "review-summary", x: 0, y: 0, w: 3, h: 4 },
    { id: "study-time-1", type: "study-time", x: 3, y: 0, w: 3, h: 4 },
    { id: "success-rate-1", type: "success-rate", x: 6, y: 0, w: 3, h: 4 },
    { id: "due-cards-1", type: "due-cards", x: 9, y: 0, w: 3, h: 4 },
    { id: "answer-buttons-1", type: "answer-buttons", x: 0, y: 4, w: 4, h: 8 },
    { id: "review-timeline-1", type: "review-timeline", x: 4, y: 4, w: 8, h: 8 },
  ],
};

export const themeModes = ["system", "light", "dark", "frutiger-aero"] as const;
export const languages = ["auto", "en", "de"] as const;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const counterColors = z.object({ new: color, learning: color, due: color }).strict();

export const shortcutActions = [
  "dashboard",
  "library",
  "settings",
  "ankiStatistics",
  "appearance",
  "wallpaper",
  "editDashboard",
  "createWidget",
  "importDashboard",
  "assistant",
  "nextTheme",
  "fullscreen",
] as const;
export type ShortcutAction = (typeof shortcutActions)[number];

export const WALLPAPER_HISTORY = 8;

/**
 * The picture behind all of Statly. "aero" is the sky of the Frutiger Aero theme, "image" a file of
 * the user's, which may also be a video. Without one, a theme shows its own background.
 */
export const wallpaper = z
  .object({
    enabled: z.boolean(),
    source: z.enum(["none", "image", "aero"]),
    asset: mediaAsset.nullable(),
    /** Whether Anki's deck overview shows it too. */
    deckOverview: z.boolean(),
    /** Only means something for a video or a GIF. */
    loop: z.boolean(),
    /** Files used before, newest first. Older ones are deleted beyond this limit. */
    history: z.array(mediaAsset).max(WALLPAPER_HISTORY),
    blur: z.number().int().min(0).max(20),
    overlay: z.number().int().min(0).max(70),
    position: z.enum(["center", "top", "bottom"]),
    textColor: z.enum(["dark", "light"]),
  })
  .strict();

export const userRoles = [
  "student",
  "educator",
  "medical_student",
  "law_student",
  "programmer",
  "language_learner",
  "other",
] as const;

export const discoverySources = [
  "ankiweb",
  "recommendation",
  "social_media",
  "web_search",
  "website",
  "other",
] as const;

/** The dashboard's time ranges. Named ones move with the days, a custom one stays put. */
export const dashboardRangePresets = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "lastYear",
  "all",
  "custom",
] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** What the dashboard showed last, so it opens the same way next time. */
export const dashboardFilter = z
  .object({
    preset: z.enum(dashboardRangePresets),
    custom: z.object({ start: day, end: day }).strict().nullable(),
    /** A deck's id, or "all". */
    deck: z.string().max(40),
  })
  .strict();

export const settings = z
  .object({
    theme: z.enum(themeModes),
    language: z.enum(languages),
    sidebarWidth: z.number().int().min(64).max(260),
    widgetRailWidth: z.number().int().min(180).max(340),
    aiPanelWidth: z.number().int().min(300).max(640),
    openFullscreen: z.boolean(),
    /** A picture behind the dashboard, chosen per device. */
    dashboardBackgrounds: z
      .object({
        desktop: mediaAsset.nullable(),
        tablet: mediaAsset.nullable(),
        phone: mediaAsset.nullable(),
      })
      .strict(),
    /** Statistics, custom widgets and templates marked with a star in the library. */
    favoriteWidgets: z.array(z.string().max(80)).max(300),
    counterColorsEnabled: z.boolean(),
    counterColors: z.object({ light: counterColors, dark: counterColors }).strict(),
    /** Replaces the theme's accent everywhere, charts included. Null keeps the theme's own. */
    accentColor: color.nullable(),
    wallpaper,
    deckHeatmap: z.boolean(),
    brandAnimation: z.boolean(),
    /** A short note in Anki's reviewer the moment a study goal's day is met. */
    goalToast: z.boolean(),
    shortcuts: z
      .object({
        dashboard: z.string().max(40),
        settings: z.string().max(40),
        library: z.string().max(40),
        ankiStatistics: z.string().max(40),
        appearance: z.string().max(40),
        wallpaper: z.string().max(40),
        editDashboard: z.string().max(40),
        createWidget: z.string().max(40),
        importDashboard: z.string().max(40),
        assistant: z.string().max(40),
        nextTheme: z.string().max(40),
        fullscreen: z.string().max(40),
      })
      .strict(),
    onboardingDone: z.boolean(),
    mobileSync: z.boolean(),
    dashboardFilter,
    /** Stays on this device. Nothing here is sent anywhere. */
    onboardingAnswers: z
      .object({
        role: z.enum(userRoles).nullable(),
        discovery: z.enum(discoverySources).nullable(),
      })
      .strict(),
  })
  .strict();

export const settingsPatch = settings.partial().strict();

export type Settings = z.output<typeof settings>;
export type ThemeMode = (typeof themeModes)[number];

export const defaultCounterColors: Settings["counterColors"] = {
  light: { new: "#0071D3", learning: "#E60012", due: "#00AA00" },
  dark: { new: "#4FACFE", learning: "#FF6B6B", due: "#63D471" },
};

export const defaultWallpaper: Settings["wallpaper"] = {
  enabled: false,
  source: "none",
  asset: null,
  deckOverview: true,
  loop: true,
  history: [],
  blur: 0,
  overlay: 0,
  position: "center",
  textColor: "dark",
};

export const defaultSettings: Settings = {
  theme: "system",
  language: "auto",
  sidebarWidth: 260,
  widgetRailWidth: 260,
  aiPanelWidth: 380,
  openFullscreen: false,
  dashboardBackgrounds: { desktop: null, tablet: null, phone: null },
  favoriteWidgets: [],
  counterColorsEnabled: false,
  counterColors: defaultCounterColors,
  accentColor: null,
  wallpaper: defaultWallpaper,
  deckHeatmap: false,
  brandAnimation: true,
  goalToast: true,
  shortcuts: {
    dashboard: "Ctrl+Alt+D",
    library: "",
    settings: "",
    ankiStatistics: "",
    appearance: "",
    wallpaper: "",
    editDashboard: "",
    createWidget: "",
    importDashboard: "",
    assistant: "",
    nextTheme: "",
    fullscreen: "",
  },
  onboardingDone: false,
  mobileSync: false,
  dashboardFilter: { preset: "today", custom: null, deck: "all" },
  onboardingAnswers: { role: null, discovery: null },
};
