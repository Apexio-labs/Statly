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
import {
  goal,
  goalDeckChoice,
  goalDraft,
  goalId,
  goalOverview,
  goalStatus,
  maxGoals,
} from "./goals.ts";
import {
  changeEntry,
  changeList,
  changeResult,
  permissionIds,
  permissionList,
} from "./permissions.ts";
import { customWidget, mediaTypes } from "./widget.ts";

const empty = z.object({}).strict();

/** About 20 MB of picture as base64. Larger files and videos need the dropped file's path. */
export const MAX_DROPPED_IMAGE_CHARS = 28_000_000;

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

/**
 * What a chart counts. A review is a card moved to a later day, counted once per card and day.
 * A rating is every press of Again, Hard, Good or Easy (what Anki calls reviews).
 */
export const measures = ["reviews", "ratings"] as const;
export type Measure = (typeof measures)[number];
const measure = z.enum(measures).optional();
const countedRangeParams = z
  .object({ start: isoDate, end: isoDate, deckId: deckScope, measure })
  .strict();
const deckParams = z.object({ deckId: deckScope }).strict();

export const reviewSummary = z
  .object({
    /** Cards moved to a later day, once per card and day. */
    reviews: count,
    /** Every press of Again, Hard, Good or Easy. */
    ratings: count,
    studyTimeMs: count,
    /** Share of all ratings that were Hard or better, from 0 to 1. Null without ratings. */
    successRate: z.number().nullable(),
    /** Same share, limited to cards in review with an interval of at least one day. */
    retention: z.number().nullable(),
    activeDays: count,
    /** Cards seen for the very first time. */
    newCards: count,
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
      /** Reviews or ratings, as asked. */
      count,
    })
    .strict(),
);

export const reviewTimeline = z
  .object({
    granularity: z.enum(["day", "week", "month"]),
    items: z.array(
      z.object({ date: isoDate, count, runningAverage: z.number().nonnegative() }).strict(),
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
    /** Reviews or ratings, as asked. */
    days: z.array(z.object({ date: isoDate, count }).strict()),
    total: count,
    dailyAverage: z.number().nonnegative(),
    /** Share of days with at least one rating, from 0 to 1. Streaks count such days too. */
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
    /** Cards in review with an interval of at least 21 days, in any queue. */
    mature: count,
  })
  .strict();

const share = z.number().min(0).max(1);

/** Cards answered Again most often. A card's very first answer never counts as forgotten. */
export const forgottenCards = z
  .object({
    cards: z.array(
      z
        .object({
          cardId: z.number().int(),
          text: z.string(),
          deck: z.string(),
          forgot: count,
          /** Answers in the range, without the first sight of a new card. */
          seen: count,
          /** Null while the card is new or still in its first steps. */
          intervalDays: count.nullable(),
        })
        .strict(),
    ),
    /** Cards forgotten at least once in the range. */
    total: count,
  })
  .strict();

/** One deck in the deck table. Rows come flat, each naming the row it belongs under. */
export const deckTableRow = z
  .object({
    deckId: z.number().int(),
    parentId: z.number().int().nullable(),
    depth: count,
    name: z.string(),
    /** The decks above it, separated by "::", for a deck that was lifted out of a folder. */
    path: z.string(),
    /** Reviews or ratings, as asked. */
    count,
    /** The same, for each part of the range in `buckets`. */
    series: z.array(count),
    timeMs: count,
    retention: share.nullable(),
    cards: count,
    matureShare: share.nullable(),
    /** Stability against cards first studied around the same time, as a factor. */
    stability: z.number().positive().nullable(),
    stabilityDays: z.number().nonnegative().nullable(),
    children: count,
  })
  .strict();

export const deckTable = z
  .object({
    /** The first day of each part of the range. */
    buckets: z.array(isoDate),
    /** Without FSRS, a card's interval stands in for its stability. */
    stabilityKind: z.enum(["stability", "interval"]),
    rows: z.array(deckTableRow),
  })
  .strict();

export const dailyStatistics = z
  .object({
    days: z.array(
      z
        .object({
          date: isoDate,
          reviews: count,
          ratings: count,
          timeMs: count,
          newCards: count,
          /** Answers to cards in review with an interval of at least a day, and the passed ones. */
          checked: count,
          passed: count,
        })
        .strict(),
    ),
  })
  .strict();

export const answerMix = z
  .object({
    again: count,
    hard: count,
    good: count,
    easy: count,
    new: count,
    learning: count,
    review: count,
    relearning: count,
  })
  .strict();

const topicDeck = { deckId: z.number().int(), name: z.string(), path: z.string() };

export const studyTopics = z
  .object({
    retention: share.nullable(),
    weakest: z.array(z.object({ ...topicDeck, checked: count, passed: count }).strict()),
    newFrom: z.array(z.object({ ...topicDeck, cards: count }).strict()),
    newCards: count,
  })
  .strict();

const speedDistribution = z
  .object({
    answers: count,
    /** Share of answers that were not slower than usual. */
    focus: share.nullable(),
    medianMs: count.nullable(),
    /** 5th, 25th, 50th, 75th and 95th percentile, in spreads from the usual time. */
    quantiles: z.array(z.number()).length(5).nullable(),
    /** Answers per step of `zStep` from `zLow` on. */
    histogram: z.array(count),
  })
  .strict();

export const answerSpeed = z
  .object({
    zLow: z.number(),
    zStep: z.number().positive(),
    /** Answers beyond this many spreads count as slow. */
    slowAt: z.number(),
    usualMs: z.object({ new: count, review: count }).strict(),
    current: speedDistribution,
    /** The range of the same length right before. */
    previous: speedDistribution.nullable(),
  })
  .strict();

/**
 * Time spent making new cards in Anki's Add window, measured by Statly since it was installed.
 * Only notes that still exist count, in the current deck of their first card.
 */
export const creationTime = z
  .object({
    granularity: z.enum(["day", "week", "month"]),
    /** Every day, week or month of the range, also the empty ones. */
    items: z
      .array(
        z
          .object({
            date: isoDate,
            seconds: z.number().nonnegative(),
            cards: count,
            notes: count,
          })
          .strict(),
      )
      .max(400),
    total: z.object({ seconds: z.number().nonnegative(), cards: count, notes: count }).strict(),
    /** Seconds per card over all decks and every measured note: the usual pace to compare with. */
    usualSecondsPerCard: z.number().nonnegative().nullable(),
    /** The Anki day of the first measured note, or null before the first one. */
    measuredSince: isoDate.nullable(),
  })
  .strict();

export const studySessions = z
  .object({
    /** The hour at which an Anki day starts. */
    dayStartHour: z.number().int().min(0).max(23),
    /** The last days of the range, at most 14. Times in seconds from the day's start. */
    days: z.array(
      z
        .object({
          date: isoDate,
          sessions: z.array(
            z
              .object({
                start: count,
                end: count,
                ratings: count,
                timeMs: count,
                focus: share.nullable(),
                retention: share.nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    /** Every hour of the clock over the whole range. */
    hours: z.array(z.object({ ratings: count, focus: share.nullable() }).strict()).length(24),
  })
  .strict();

export const dayNote = z.object({ date: isoDate, text: z.string().max(2000) }).strict();

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

/** Rows of a list with a few value columns, such as decks or forgotten cards. */
const mobileTable = z
  .object({
    kind: z.literal("table"),
    label: z.string(),
    note: z.string(),
    columns: z.array(z.string()).max(4),
    rows: z
      .array(
        z
          .object({
            label: z.string(),
            sub: z.string(),
            cells: z.array(z.string()).max(4),
            /** Colors the first cell: good in green, bad in red. */
            tone: z.enum(["good", "bad"]).nullable(),
          })
          .strict(),
      )
      .max(12),
    facts: z.array(mobileFact),
  })
  .strict();

/** What Python worked out for one element, because a card cannot ask for anything. */
const mobileElementValue = z
  .object({
    text: z.string().optional(),
    share: z.number().optional(),
    bars: z.array(z.object({ label: z.string(), value: count }).strict()).optional(),
    /** A combined chart's points, one list per layer, in the layers' order. */
    layers: z
      .array(z.array(z.object({ label: z.string(), value: z.number().min(0) }).strict()))
      .max(6)
      .optional(),
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
  mobileTable,
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
  "statistics.deckActivity": { params: countedRangeParams, result: deckActivity },
  "statistics.timeline": { params: countedRangeParams, result: reviewTimeline },
  "statistics.answerButtons": { params: rangeParams, result: answerButtons },
  "statistics.rhythm": { params: countedRangeParams, result: studyRhythm },
  "statistics.heatmap": {
    params: z.object({ year: z.number().int().nullable(), deckId: deckScope, measure }).strict(),
    result: reviewHeatmap,
  },
  "statistics.due": { params: deckParams, result: z.object({ cards: count }).strict() },
  "statistics.forecast": {
    params: z
      .object({ deckId: deckScope, days: z.number().int().min(1).max(365).optional() })
      .strict(),
    result: dueForecast,
  },
  "statistics.cardStates": { params: deckParams, result: cardStates },
  "statistics.ankiView": { params: ankiViewParams, result: ankiViewResult },
  "statistics.forgotten": {
    params: rangeParams.extend({ limit: z.number().int().min(1).max(50).optional() }).strict(),
    result: forgottenCards,
  },
  "statistics.deckTable": { params: countedRangeParams, result: deckTable },
  "statistics.daily": { params: rangeParams, result: dailyStatistics },
  "statistics.answerMix": { params: rangeParams, result: answerMix },
  "statistics.topics": { params: rangeParams, result: studyTopics },
  "statistics.speed": { params: rangeParams, result: answerSpeed },
  "statistics.sessions": { params: rangeParams, result: studySessions },
  /** Time spent making new cards, from Statly's own measurements on this computer. */
  "statistics.creation": { params: rangeParams, result: creationTime },
  /** Opens Anki's card browser on these cards. Changes nothing. */
  "system.openBrowser": {
    params: z.object({ cardIds: z.array(z.number().int()).min(1).max(100) }).strict(),
    result: z.null(),
  },
  /** Notes a person wrote about their study days. Kept only on this computer. */
  "notes.list": {
    params: z.object({ start: isoDate, end: isoDate }).strict(),
    result: z.array(dayNote),
  },
  /** An empty text removes the day's note. */
  "notes.save": { params: dayNote, result: z.null() },
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
    result: z.object({ askRating: z.boolean(), askShare: z.boolean() }).strict(),
  },
  "feedback.answer": {
    params: z.object({ choice: z.enum(["rate", "later", "never"]) }).strict(),
    result: z.null(),
  },
  "feedback.answerShare": {
    params: z.object({ choice: z.enum(["share", "later", "never"]) }).strict(),
    result: z.null(),
  },
  /**
   * What a big update brought: the page shows the notes of every big version after ``since`` up
   * to ``current``. Both are equal when there is nothing to show.
   */
  "releaseNotes.pending": {
    params: empty,
    result: z.object({ since: z.string().max(40), current: z.string().max(40) }).strict(),
  },
  "releaseNotes.seen": { params: empty, result: z.null() },
  /** Opens the system's share sheet where there is one. Elsewhere the text lands on the clipboard. */
  "system.share": {
    params: z
      .object({
        text: z.string().max(300),
        url: z.string().max(300),
        /** The button it opens from, in page pixels. */
        anchor: z
          .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
          .strict(),
      })
      .strict(),
    result: z.object({ method: z.enum(["sheet", "clipboard"]) }).strict(),
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
        /** Every answer the card ever got. */
        ratings: count,
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
    params: z
      .object({
        id: z.string().max(40),
        widget: customWidget.optional(),
        /** A suggested goal as the person saved it on the setup page, after checking it. */
        goal: goal.optional(),
      })
      .strict(),
    result: z.null(),
  },
  "ai.rejectProposal": { params: z.object({ id: z.string().max(40) }).strict(), result: z.null() },
  "ai.changes": { params: empty, result: z.array(aiChange) },
  "ai.rollback": { params: z.object({ id: z.string().max(40) }).strict(), result: z.null() },
  /** The chat's own buttons. They only allow this chat: for good is a switch in the settings. */
  "ai.answerPermission": {
    params: z.object({ decision: z.enum(["once", "deny"]) }).strict(),
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
  "wallpaper.choose": { params: empty, result: settings },
  /**
   * Uses the file that was just dropped onto the page, which a page cannot name itself. An image
   * also comes along as base64, for when the window never saw the drop, as on some Windows setups.
   */
  "wallpaper.dropped": {
    params: z.object({ image: z.string().max(MAX_DROPPED_IMAGE_CHARS).optional() }).strict(),
    result: settings,
  },
  "wallpaper.remove": { params: empty, result: settings },
  /** Puts a file from the history back behind Statly. */
  "wallpaper.use": { params: z.object({ id: z.string().max(64) }).strict(), result: settings },
  /** Drops a file from the history, and deletes it once nothing else uses it. */
  "wallpaper.forget": { params: z.object({ id: z.string().max(64) }).strict(), result: settings },
  "shortcuts.beginRecording": { params: empty, result: z.null() },
  "shortcuts.endRecording": { params: empty, result: z.null() },
  "shortcuts.set": {
    params: z.object({ action: z.enum(shortcutActions), keys: z.string().max(40) }).strict(),
    result: z.object({ conflict: z.string().nullable(), settings }).strict(),
  },
  /** Every permission a part of Statly offers, and the ones given earlier. */
  "permissions.list": { params: empty, result: permissionList },
  /** Opens Statly's own dialog. Only the person's click there allows anything. */
  "permissions.request": {
    params: z.object({ id: z.enum(permissionIds) }).strict(),
    result: permissionList,
  },
  /** Takes a permission back at once, after cleaning up what it allowed, such as the phone card. */
  "permissions.revoke": {
    params: z.object({ id: z.enum(permissionIds) }).strict(),
    result: permissionList,
  },
  /**
   * Lets the goal's decks show today the new cards it plans. Statly works out the numbers itself
   * and asks in its own popup unless this was allowed for good. Never offered to the assistant.
   */
  "goals.raiseLimit": { params: z.object({ id: goalId }).strict(), result: changeResult },
  /** Every goal in short, with today's numbers, for the assistant's get_goals. Only reads. */
  "goals.overview": { params: empty, result: z.array(goalOverview).max(maxGoals) },
  /** Opens Anki's own options of a deck. That changes nothing by itself. */
  "goals.openDeckOptions": {
    params: z.object({ deckId: z.number().int() }).strict(),
    result: z.null(),
  },
  /** What Statly changed in Anki, newest first. */
  "changes.list": { params: empty, result: changeList },
  "changes.undo": {
    params: z.object({ id: changeEntry.shape.id }).strict(),
    result: changeList,
  },
  /** Every goal, archived ones included. */
  "goals.list": { params: empty, result: z.array(goal).max(maxGoals) },
  /** Creates a goal when its id is null. Checks the decks, so it reads the collection. */
  "goals.save": { params: z.object({ goal: goalDraft }).strict(), result: goal },
  /** Removes the goal and its history. Its widgets leave the dashboard by themselves. */
  "goals.delete": { params: z.object({ id: goalId }).strict(), result: z.null() },
  "goals.status": { params: z.object({ id: goalId }).strict(), result: goalStatus },
  /** The numbers a goal would have, for the live preview while setting one up. Stores nothing. */
  "goals.preview": { params: z.object({ goal: goalDraft }).strict(), result: goalStatus },
  "goals.decks": { params: empty, result: z.array(goalDeckChoice).max(5000) },
  /** The celebration for today's goal was shown, so it does not come again today. */
  "goals.acknowledge": { params: z.object({ id: goalId }).strict(), result: z.null() },
} as const;

/** Every event Python can push to the web app. */
export const events = {
  "host.themeChanged": z.object({ nightMode: z.boolean() }).strict(),
  "statistics.changed": z.object({}).strict(),
  /** The assistant's shortcut: opens it, or closes it when it is open. */
  "host.toggleAssistant": z.object({}).strict(),
  /** Python changed a setting on its own, so the app should read them again. */
  "settings.changed": z.object({}).strict(),
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
  /** Something was allowed or taken back, possibly in a dialog or by cleaning up. */
  "permissions.changed": z.object({}).strict(),
  /** Statly changed something in Anki, so the app can offer to undo it. */
  "changes.applied": z.object({ id: changeEntry.shape.id }).strict(),
  /** A goal was saved, removed or counted again, so the app should read goals again. */
  "goals.changed": z.object({}).strict(),
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
