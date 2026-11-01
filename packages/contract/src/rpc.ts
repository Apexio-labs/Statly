import { z } from "zod";
import {
  aiChange,
  aiChatList,
  aiConfigure,
  aiConversation,
  aiHighlights,
  aiKeyPassword,
  aiModels,
  aiPermissionScopes,
  aiStatus,
} from "./ai.ts";
import { ankiViewParams, ankiViewResult } from "./ankiStats.ts";
import {
  dashboardLayout,
  deviceLayouts,
  deviceWidget,
  resolvedDevice,
  settings,
  settingsPatch,
  shortcutActions,
} from "./dashboard.ts";
import { customWidget, mediaTypes } from "./widget.ts";

const empty = z.object({}).strict();

export const hostInfo = z
  .object({
    statlyVersion: z.string(),
    ankiVersion: z.string(),
    nightMode: z.boolean(),
    language: z.string(),
  })
  .strict();

export const collectionSummary = z
  .object({
    cards: z.number().int().nonnegative(),
    reviews: z.number().int().nonnegative(),
  })
  .strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();
const deckScope = z.number().int().nullable();

/** A range of Anki days, both ends included, optionally limited to a deck and its subdecks. */
const rangeParams = z.object({ start: isoDate, end: isoDate, deckId: deckScope }).strict();
const deckParams = z.object({ deckId: deckScope }).strict();

export const reviewSummary = z
  .object({
    reviews: count,
    studyTimeMs: count,
    /** Share of all answers rated Hard or better, from 0 to 1. Null without reviews. */
    successRate: z.number().nullable(),
    /** Same share, limited to cards in review with an interval of at least one day. */
    retention: z.number().nullable(),
    activeDays: count,
  })
  .strict();

export const reviewCategories = z
  .object({
    total: count,
    failed: count,
    new: count,
    reviewed: count,
    relearned: count,
    longInterval: count,
    suspended: count,
    buried: count,
  })
  .strict();

export const deckActivity = z.array(
  z
    .object({
      /** Null for cards that have since been deleted. */
      deckId: z.number().int().nullable(),
      name: z.string().nullable(),
      reviews: count,
    })
    .strict(),
);

export const reviewTimeline = z
  .object({
    granularity: z.enum(["day", "week", "month"]),
    items: z.array(
      z
        .object({ date: isoDate, reviews: count, runningAverage: z.number().nonnegative() })
        .strict(),
    ),
  })
  .strict();

export const answerButtons = z
  .object({ again: count, hard: count, good: count, easy: count })
  .strict();

export const studyRhythm = z
  .object({
    /** Monday first. */
    weekdays: z.array(count).length(7),
    hours: z.array(count).length(24),
  })
  .strict();

export const reviewHeatmap = z
  .object({
    year: z.number().int(),
    firstYear: z.number().int(),
    lastYear: z.number().int(),
    today: isoDate,
    days: z.array(z.object({ date: isoDate, reviews: count }).strict()),
    totalReviews: count,
    dailyAverage: z.number().nonnegative(),
    /** Share of days with at least one review, from 0 to 1. */
    daysLearned: z.number().nonnegative(),
    longestStreak: count,
    currentStreak: count,
  })
  .strict();

export const dueForecast = z.array(z.object({ date: isoDate, cards: count }).strict());

export const cardStates = z
  .object({
    new: count,
    learning: count,
    review: count,
    suspended: count,
    buried: count,
    other: count,
  })
  .strict();

/** The chosen wallpaper as a data URL, or null if there is none. */
export const wallpaperPreview = z.object({ image: z.string().nullable() }).strict();

export const mobileStatus = z
  .object({ enabled: z.boolean(), updated: z.string().nullable() })
  .strict();

const mobileFact = z.object({ label: z.string(), value: z.string() }).strict();

const mobileTile = z
  .object({
    kind: z.literal("tile"),
    label: z.string(),
    value: z.string(),
    note: z.string(),
    /** The same number for other time ranges, shown when someone taps the tile. */
    facts: z.array(mobileFact),
  })
  .strict();

const mobileBars = z
  .object({
    kind: z.literal("bars"),
    label: z.string(),
    note: z.string(),
    horizontal: z.boolean(),
    bars: z.array(z.object({ label: z.string(), value: count }).strict()),
    /** Summary lines for the closer look. */
    facts: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
  })
  .strict();

const mobileHeatmap = z
  .object({
    kind: z.literal("heatmap"),
    label: z.string(),
    note: z.string(),
    /** One level from 0 to 4 per day, Monday first, in whole weeks. */
    levels: z.array(z.number().int().min(0).max(4)),
    facts: z.array(mobileFact),
  })
  .strict();

/** What Python worked out for one element, because a card cannot ask for anything. */
const mobileElementValue = z
  .object({
    text: z.string().optional(),
    share: z.number().optional(),
    bars: z.array(z.object({ label: z.string(), value: count }).strict()).optional(),
    levels: z.array(z.number().int().min(0).max(4)).optional(),
  })
  .strict();

const mobileCustom = z
  .object({
    kind: z.literal("custom"),
    label: z.string(),
    widget: customWidget,
    values: z.record(z.string(), mobileElementValue),
    /** Shrunken pictures as data addresses, by asset id. Videos do not fit into a card. */
    media: z.record(z.string(), z.string()),
  })
  .strict();

const mobileBlock = z.discriminatedUnion("kind", [
  mobileTile,
  mobileBars,
  mobileHeatmap,
  mobileCustom,
]);

const mobilePlaced = z
  .object({
    block: z.string(),
    x: count,
    y: count,
    w: count,
    h: count,
  })
  .strict();

/** What the card draws. The desktop preview draws the same data with the same code. */
export const mobileSnapshot = z
  .object({
    title: z.string(),
    updated: z.string(),
    hint: z.string(),
    /** Each block once, because phone and tablet mostly show the same ones. */
    blocks: z.record(z.string(), mobileBlock),
    tablet: z.array(mobilePlaced),
    phone: z.array(mobilePlaced),
    /** Shrunken pictures behind the dashboard, as data addresses. */
    backgrounds: z.object({ tablet: z.string().nullable(), phone: z.string().nullable() }).strict(),
    /** Words the card needs, because it has no access to the app's translations. */
    words: z
      .object({
        back: z.string(),
        total: z.string(),
        average: z.string(),
        best: z.string(),
        share: z.string(),
        comparedTo: z.string(),
        videoHere: z.string(),
      })
      .strict(),
  })
  .strict();

export type MobileSnapshot = z.output<typeof mobileSnapshot>;

export const deckList = z.array(z.object({ id: z.number().int(), name: z.string() }).strict());

/** Every call the web app can make to Python. Add new calls here first. */
export const methods = {
  "system.ping": {
    params: z.object({ nonce: z.string().max(64) }).strict(),
    result: z.object({ nonce: z.string() }).strict(),
  },
  "system.info": {
    params: empty,
    result: hostInfo,
  },
  "system.collectionSummary": {
    params: empty,
    result: collectionSummary,
  },
  "system.openExternal": {
    params: z.object({ url: z.string().max(2048) }).strict(),
    result: z.null(),
  },
  "system.openAnkiStatistics": { params: empty, result: z.null() },
  "system.saveFile": {
    params: z.object({ name: z.string().max(100), content: z.string() }).strict(),
    result: z.object({ saved: z.boolean() }).strict(),
  },
  "system.openFile": {
    params: empty,
    result: z.object({ content: z.string().nullable() }).strict(),
  },
  /** While set, closing the window asks first. The text arrives translated. */
  "system.setUnsaved": {
    params: z.object({ message: z.string().max(200).nullable() }).strict(),
    result: z.null(),
  },
  "system.addon": {
    params: empty,
    result: z.object({ autoUpdate: z.boolean() }).strict(),
  },
  "system.setAutoUpdate": {
    params: z.object({ enabled: z.boolean() }).strict(),
    result: z.null(),
  },
  "system.uninstall": {
    params: empty,
    result: z.object({ uninstalled: z.boolean() }).strict(),
  },
  "statistics.today": {
    params: empty,
    result: z.object({ date: isoDate, firstReview: isoDate.nullable() }).strict(),
  },
  "statistics.decks": { params: empty, result: deckList },
  "statistics.summary": { params: rangeParams, result: reviewSummary },
  "statistics.categories": { params: rangeParams, result: reviewCategories },
  "statistics.deckActivity": { params: rangeParams, result: deckActivity },
  "statistics.timeline": { params: rangeParams, result: reviewTimeline },
  "statistics.answerButtons": { params: rangeParams, result: answerButtons },
  "statistics.rhythm": { params: rangeParams, result: studyRhythm },
  "statistics.heatmap": {
    params: z.object({ year: z.number().int().nullable(), deckId: deckScope }).strict(),
    result: reviewHeatmap,
  },
  "statistics.due": { params: deckParams, result: z.object({ cards: count }).strict() },
  "statistics.forecast": { params: deckParams, result: dueForecast },
  "statistics.cardStates": { params: deckParams, result: cardStates },
  "statistics.ankiView": { params: ankiViewParams, result: ankiViewResult },
  "dashboard.get": { params: empty, result: dashboardLayout },
  "dashboard.save": {
    params: z.object({ layout: dashboardLayout, devices: deviceLayouts.optional() }).strict(),
    result: z.null(),
  },
  /** What tablet and phone show for this layout, so an unsaved draft can be previewed. */
  "dashboard.devices": {
    params: z.object({ layout: dashboardLayout, devices: deviceLayouts.optional() }).strict(),
    result: z.object({ tablet: resolvedDevice, phone: resolvedDevice }).strict(),
  },
  "dashboard.storedDevices": { params: empty, result: deviceLayouts },
  "dashboard.chooseBackground": {
    params: z.object({ device: z.enum(["desktop", "tablet", "phone"]) }).strict(),
    result: settings,
  },
  "dashboard.removeBackground": {
    params: z.object({ device: z.enum(["desktop", "tablet", "phone"]) }).strict(),
    result: settings,
  },
  "dashboard.reset": { params: empty, result: dashboardLayout },
  "settings.get": { params: empty, result: settings },
  "settings.update": { params: settingsPatch, result: settings },
  "feedback.visit": {
    params: empty,
    result: z.object({ askRating: z.boolean() }).strict(),
  },
  "feedback.answer": {
    params: z.object({ choice: z.enum(["rate", "later", "never"]) }).strict(),
    result: z.null(),
  },
  "widgets.list": { params: empty, result: z.array(customWidget) },
  "widgets.save": { params: z.object({ widget: customWidget }).strict(), result: customWidget },
  "widgets.delete": { params: z.object({ id: z.string().max(40) }).strict(), result: z.null() },
  "widgets.addMedia": {
    params: empty,
    result: z
      .object({
        asset: z
          .object({ id: z.string(), type: z.enum(mediaTypes) })
          .strict()
          .nullable(),
      })
      .strict(),
  },
  "widgets.setGifLoop": {
    params: z.object({ id: z.string().max(64), loop: z.boolean() }).strict(),
    result: z.object({ id: z.string(), type: z.enum(mediaTypes) }).strict(),
  },
  "widgets.media": {
    params: z.object({ id: z.string().max(64) }).strict(),
    result: z.object({ url: z.string().nullable() }).strict(),
  },
  "widgets.export": {
    params: z.object({ id: z.string().max(40) }).strict(),
    result: z.object({ saved: z.boolean() }).strict(),
  },
  "widgets.import": {
    params: empty,
    result: z.object({ widget: customWidget.nullable() }).strict(),
  },
  /** Read only, and reachable by an AI only with the person's permission. */
  "cards.find": {
    params: z
      .object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(25) })
      .strict(),
    result: z.array(
      z
        .object({
          cardId: z.number().int(),
          deck: z.string(),
          front: z.string(),
          lastReview: isoDate.nullable(),
        })
        .strict(),
    ),
  },
  "cards.get": {
    params: z.object({ cardId: z.number().int() }).strict(),
    result: z
      .object({
        cardId: z.number().int(),
        deck: z.string(),
        fields: z.record(z.string(), z.string()),
        tags: z.array(z.string()),
        state: z.enum(["new", "learning", "review", "suspended", "buried"]),
        intervalDays: z.number().int(),
        reviews: count,
        lapses: count,
        lastReview: isoDate.nullable(),
        recent: z.array(z.object({ date: isoDate, answer: z.number().int() }).strict()),
      })
      .strict(),
  },
  "mobile.status": { params: empty, result: mobileStatus },
  "mobile.enable": { params: empty, result: mobileStatus },
  "mobile.disable": { params: empty, result: mobileStatus },
  "mobile.refresh": { params: empty, result: mobileStatus },
  "mobile.preview": {
    params: z.object({ tablet: z.array(deviceWidget), phone: z.array(deviceWidget) }).strict(),
    result: mobileSnapshot,
  },
  "ai.status": { params: empty, result: aiStatus },
  "ai.configure": { params: aiConfigure, result: aiStatus },
  /** Write only. No call exists that returns a stored key. */
  "ai.setKey": { params: z.object({ key: z.string().min(1).max(512) }).strict(), result: aiStatus },
  "ai.removeKey": { params: empty, result: aiStatus },
  "ai.enableKeyLock": {
    params: z.object({ password: aiKeyPassword }).strict(),
    result: aiStatus,
  },
  "ai.disableKeyLock": {
    params: z.object({ password: z.string().max(200) }).strict(),
    result: aiStatus,
  },
  "ai.unlockKeys": {
    params: z.object({ password: z.string().max(200) }).strict(),
    result: aiStatus,
  },
  "ai.changeKeyPassword": {
    params: z.object({ current: z.string().max(200), password: aiKeyPassword }).strict(),
    result: aiStatus,
  },
  "ai.lockKeys": { params: empty, result: aiStatus },
  "ai.forgetKeys": { params: empty, result: aiStatus },
  "ai.models": { params: empty, result: aiModels },
  "ai.consent": { params: empty, result: aiStatus },
  "ai.conversation": { params: empty, result: aiConversation },
  "ai.send": { params: z.object({ text: z.string().min(1).max(4000) }).strict(), result: z.null() },
  "ai.stop": { params: empty, result: z.null() },
  "ai.reset": { params: empty, result: z.null() },
  /** `widget` replaces what the assistant suggested, after someone worked on it in the editor. */
  "ai.applyProposal": {
    params: z.object({ id: z.string().max(40), widget: customWidget.optional() }).strict(),
    result: z.null(),
  },
  "ai.rejectProposal": { params: z.object({ id: z.string().max(40) }).strict(), result: z.null() },
  "ai.changes": { params: empty, result: z.array(aiChange) },
  "ai.rollback": { params: z.object({ id: z.string().max(40) }).strict(), result: z.null() },
  "ai.answerPermission": {
    params: z.object({ decision: z.enum(["once", "always", "deny"]) }).strict(),
    result: z.null(),
  },
  "ai.answerQuestion": {
    params: z.object({ text: z.string().min(1).max(500) }).strict(),
    result: z.null(),
  },
  "ai.setPermission": {
    params: z.object({ scope: z.enum(aiPermissionScopes), allowed: z.boolean() }).strict(),
    result: aiStatus,
  },
  "ai.setExternalPermissions": {
    params: z.object({ allowed: z.boolean() }).strict(),
    result: aiStatus,
  },
  "ai.setKeepChats": { params: z.object({ keep: z.boolean() }).strict(), result: aiStatus },
  "ai.chats": { params: empty, result: aiChatList },
  "ai.openChat": { params: z.object({ id: z.string().max(40) }).strict(), result: z.null() },
  "ai.deleteChat": { params: z.object({ id: z.string().max(40) }).strict(), result: z.null() },
  "ai.reviewAnswered": { params: empty, result: z.null() },
  "ai.setAutoMode": {
    params: z.object({ enabled: z.boolean(), acknowledged: z.boolean() }).strict(),
    result: aiStatus,
  },
  "ai.setAutoExternal": {
    params: z.object({ enabled: z.boolean(), acknowledged: z.boolean() }).strict(),
    result: aiStatus,
  },
  "ai.setExternal": { params: z.object({ enabled: z.boolean() }).strict(), result: aiStatus },
  /** Shown once. Only a hash of it is kept, and a new code cancels the old one. */
  "ai.newExternalCode": { params: empty, result: z.object({ code: z.string() }).strict() },
  "ai.saveBridge": { params: empty, result: z.object({ saved: z.boolean() }).strict() },
  "wallpaper.preview": { params: empty, result: wallpaperPreview },
  "wallpaper.choose": { params: empty, result: wallpaperPreview },
  "wallpaper.remove": { params: empty, result: wallpaperPreview },
  "shortcuts.beginRecording": { params: empty, result: z.null() },
  "shortcuts.endRecording": { params: empty, result: z.null() },
  "shortcuts.set": {
    params: z.object({ action: z.enum(shortcutActions), keys: z.string().max(40) }).strict(),
    result: z.object({ conflict: z.string().nullable(), settings }).strict(),
  },
} as const;

/** Every event Python can push to the web app. */
export const events = {
  "host.themeChanged": z.object({ nightMode: z.boolean() }).strict(),
  "statistics.changed": z.object({}).strict(),
  "host.navigate": z
    .object({ path: z.string(), highlight: z.enum(aiHighlights).optional() })
    .strict(),
  /** A shortcut the system would act on before the page sees the key press. */
  "shortcuts.pressed": z.object({ keys: z.string() }).strict(),
  /** Part of the answer that is being written. */
  "ai.text": z.object({ messageId: z.string(), delta: z.string() }).strict(),
  /** The conversation changed in another way, so the app should read it again. */
  "ai.changed": z.object({}).strict(),
  /** A change reached the dashboard, a widget or the settings. */
  "ai.applied": z.object({}).strict(),
} as const;

export const errorCodes = [
  "bad_request",
  "unknown_method",
  "invalid_params",
  "collection_unavailable",
  "not_allowed",
  "internal",
] as const;

export type MethodName = keyof typeof methods;
export type Params<M extends MethodName> = z.input<(typeof methods)[M]["params"]>;
export type Result<M extends MethodName> = z.output<(typeof methods)[M]["result"]>;
export type EventName = keyof typeof events;
export type EventPayload<E extends EventName> = z.output<(typeof events)[E]>;
export type ErrorCode = (typeof errorCodes)[number];
