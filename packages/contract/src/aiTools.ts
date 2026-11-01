import { z } from "zod";
import {
  type AiPermissionScope,
  aiHighlights,
  aiPages,
  aiSettingKeys,
  aiSettingsPatch,
} from "./ai.ts";
import { ankiViews } from "./ankiStats.ts";
import { dashboardLayout, languages, themeModes, widgetTypes } from "./dashboard.ts";
import { gridColumns, widgetSizeLimits } from "./limits.ts";
import { type MethodName, methods } from "./rpc.ts";
import {
  type CustomWidget,
  customWidget,
  metricSources,
  seriesSources,
  widgetRanges,
} from "./widget.ts";

/**
 * Tool definitions go out with every request, and local models often have room for only a few
 * thousand tokens. So they stay short: `input` is what Statly checks, and `shown` replaces it for
 * the model where the full format would be too long. `get_widget_format` explains the rest.
 */
type Tool = {
  /**
   * "read" only looks. "propose" asks for a change that a person then accepts. "guide" helps
   * around the app and changes nothing. Tools of the last kind exist only in Statly's own chat.
   */
  access: "read" | "propose" | "guide";
  description: string;
  input: z.ZodType;
  shown?: z.ZodType;
  /** The call a reading tool answers with. No other call is reachable from a tool. */
  method: MethodName | null;
  /** What a person has to allow first. Enforced in code, not by what the model is told. */
  permission?: AiPermissionScope;
};

const empty = z.object({}).strict();
const summary = z.string().min(1).max(200);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The statistics a model can ask for, and which of the fields below each one needs. */
export const aiStatistics = {
  summary: {
    method: "statistics.summary",
    needs: "range",
    about: "reviews, study time in ms, success rate, retention, active days",
  },
  categories: {
    method: "statistics.categories",
    needs: "range",
    about: "reviews split into new, reviewed, relearned, failed",
  },
  decks: { method: "statistics.deckActivity", needs: "range", about: "reviews per deck" },
  timeline: {
    method: "statistics.timeline",
    needs: "range",
    about: "reviews per day, week or month",
  },
  buttons: {
    method: "statistics.answerButtons",
    needs: "range",
    about: "presses of Again, Hard, Good, Easy",
  },
  rhythm: { method: "statistics.rhythm", needs: "range", about: "reviews per weekday and hour" },
  heatmap: {
    method: "statistics.heatmap",
    needs: "year",
    about: "reviews per day of a year, with streaks",
  },
  due: { method: "statistics.due", needs: "deck", about: "cards ready now" },
  forecast: { method: "statistics.forecast", needs: "deck", about: "cards coming due" },
  states: { method: "statistics.cardStates", needs: "deck", about: "cards per learning state" },
  anki: {
    method: "statistics.ankiView",
    needs: "view",
    about: `Anki's own statistics page, chosen with view: ${ankiViews.join(", ")}`,
  },
} as const satisfies Record<string, { method: MethodName; needs: string; about: string }>;

const statisticNames = Object.keys(aiStatistics) as [
  keyof typeof aiStatistics,
  ...(keyof typeof aiStatistics)[],
];

const statisticList = Object.entries(aiStatistics)
  .map(([name, { about }]) => `${name}: ${about}`)
  .join("; ");

/** Must stay valid: a test parses it, so the guide below cannot drift from the real format. */
export const aiWidgetExample: CustomWidget = {
  id: "study-today",
  name: "Study time today",
  description: "",
  size: { w: 4, h: 4 },
  background: { kind: "card" },
  elements: [
    {
      id: "e1",
      kind: "text",
      text: "Today",
      x: 8,
      y: 10,
      w: 84,
      h: 24,
      opacity: 1,
      size: 16,
      bold: true,
      align: "left",
      color: "muted",
    },
    {
      id: "e2",
      kind: "metric",
      source: "studyTime",
      range: "today",
      x: 8,
      y: 40,
      w: 84,
      h: 50,
      opacity: 1,
      size: 34,
      bold: true,
      align: "left",
      color: "text",
    },
  ],
};

/** Handed out on request, so most conversations never pay for it. */
export const aiWidgetGuide = `A widget is data, never code: {id (a-z, 0-9, hyphen), name, description, size, background, elements}.
size: {w, h} in grid cells, w ${widgetSizeLimits.minW}-${widgetSizeLimits.maxW}, h ${widgetSizeLimits.minH}-${widgetSizeLimits.maxH}.
background: {kind:"card"}, {kind:"color",color} or {kind:"gradient",start,end,angle}.
Every element has id, kind, x, y, w, h in percent of the widget, and opacity from 0 to 1.
Paint is text, muted, accent, card or #rrggbb.
text: text, size (percent of the widget's height), bold, align (left, center, right), color (paint).
metric: source, range, size, bold, align, color.
chart: source (series), chart (bar, line), range, color.
progress: source, range, goal (number), style (ring, bar), color.
heatmap: nothing else.
shape: shape (rectangle, ellipse), fill (paint), radius.
source: ${metricSources.join(", ")}.
series: ${seriesSources.join(", ")}.
range: ${widgetRanges.join(", ")}. Use dashboard to follow the dashboard's filter.
Example: ${JSON.stringify(aiWidgetExample)}`;

function reading(method: MethodName, description: string, permission?: AiPermissionScope): Tool {
  const tool: Tool = { access: "read", description, input: methods[method].params, method };
  return permission ? { ...tool, permission } : tool;
}

/** Everything an AI can do, in the chat and through external apps. Nothing here reads a card. */
export const aiTools: Record<string, Tool> = {
  get_today: reading(
    "statistics.today",
    "Today in the user's Anki calendar and the first review date. Call before working out dates.",
  ),
  list_decks: reading("statistics.decks", "All decks with their ids.", "decks"),
  get_statistic: {
    access: "read",
    description: `Read a statistic. ${statisticList}. summary to rhythm need start and end (YYYY-MM-DD, both included). heatmap takes year (null is this year). deckId null means all decks.`,
    input: z
      .object({
        name: z.enum(statisticNames),
        start: isoDate.optional(),
        end: isoDate.optional(),
        year: z.number().int().nullable().optional(),
        deckId: z.number().int().nullable().optional(),
        view: z.enum(ankiViews).optional(),
      })
      .strict(),
    method: null,
  },
  find_cards: reading(
    "cards.find",
    "Find cards with Anki's search, for example deck:Spanish or a word on the card. Needs the person's permission, which the app asks for by itself.",
    "cards",
  ),
  get_card: reading(
    "cards.get",
    "One card's fields, tags, deck, state and recent reviews. Needs the person's permission.",
    "cards",
  ),
  get_dashboard: reading("dashboard.get", "The widgets on the dashboard and where they sit."),
  list_custom_widgets: reading("widgets.list", "The widgets the user made, in full."),
  get_settings: {
    access: "read",
    description: "The appearance settings you may suggest changes to.",
    input: empty,
    method: null,
  },
  get_widget_format: {
    access: "read",
    description: "How a widget is built. Call this before propose_widget.",
    input: empty,
    method: null,
  },
  open_page: {
    access: "guide",
    description: `Open a page of Statly for the person. highlight points at a setting on it: ${aiHighlights.join(", ")}.`,
    input: z
      .object({
        page: z.enum(Object.keys(aiPages) as [keyof typeof aiPages, ...(keyof typeof aiPages)[]]),
        highlight: z.enum(aiHighlights).optional(),
      })
      .strict(),
    method: null,
  },
  ask_user: {
    access: "guide",
    description:
      "Ask the person something with 2 to 5 short options, shown as buttons. Use this instead of writing choices or a question with likely answers into your text.",
    input: z
      .object({
        question: z.string().min(1).max(300),
        options: z
          .array(
            z
              .object({
                label: z.string().min(1).max(80),
                description: z.string().max(160).optional(),
              })
              .strict(),
          )
          .min(2)
          .max(5),
      })
      .strict(),
    method: null,
  },
  propose_widget: {
    access: "propose",
    description:
      "Suggest a new custom widget, or a change to one by reusing its id. addToDashboard also places it.",
    input: z.object({ widget: customWidget, addToDashboard: z.boolean(), summary }).strict(),
    shown: z.object({ widget: z.object({}), addToDashboard: z.boolean(), summary }).strict(),
    method: null,
  },
  propose_dashboard: {
    access: "propose",
    description: `Suggest a new dashboard: layout {widgets:[{id,type,x,y,w,h}]}, ${gridColumns} columns. Types: ${widgetTypes.join(", ")}, or custom:<id>.`,
    input: z.object({ layout: dashboardLayout, summary }).strict(),
    shown: z.object({ layout: z.object({}), summary }).strict(),
    method: null,
  },
  propose_settings: {
    access: "propose",
    description: `Suggest settings: patch with ${aiSettingKeys.join(", ")}. theme: ${themeModes.join(", ")}. language: ${languages.join(", ")}.`,
    input: z.object({ patch: aiSettingsPatch, summary }).strict(),
    shown: z.object({ patch: z.object({}), summary }).strict(),
    method: null,
  },
};
