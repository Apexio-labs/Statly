import {
  type AiChange,
  type AiConversation,
  type AiProposal,
  type AiStatus,
  aiProviderDefaults,
  type CustomWidget,
  type DashboardLayout,
  type DeviceLayout,
  type DeviceLayouts,
  type DeviceWidget,
  defaultDevicePeriod,
  defaultLayout,
  defaultSettings,
  deviceColumns,
  type MethodName,
  type ResolvedDevice,
  type Result,
  type Settings,
  type ShortcutAction,
} from "@statly/contract";
import type { BridgeResponse, Transport } from "./client.ts";
import { statisticsMocks } from "./mockStatistics.ts";

declare global {
  /** Lets browser tests answer the file dialog that Anki would show. */
  var __mockOpenFile: string | undefined;
}

const RESPONSE_DELAY_MS = 30;

let mockLayout = defaultLayout;
let mockSettings: Settings = defaultSettings;
let mockSettingsReady = false;
let mockAutoUpdate = true;
let mockWidgets: CustomWidget[] = [];
let mockMobile: { enabled: boolean; updated: string | null } = { enabled: false, updated: null };

let mockKeyPassword: string | null = null;

function checkMockPassword(password: string) {
  if (password !== mockKeyPassword) {
    throw new Error("wrong_password");
  }
}

let mockAi: AiStatus = {
  provider: null,
  model: "",
  baseUrl: "",
  hasKey: false,
  keyStorage: "system",
  keyLock: "off",
  consented: false,
  permissions: { decks: false, cards: false },
  externalPermissions: false,
  keepChats: true,
  autoMode: false,
  autoExternal: false,
  external: { enabled: false, running: false, port: null, hasCode: false },
};
const NEW_CHAT: AiConversation = {
  chatId: null,
  title: "",
  running: false,
  waiting: null,
  messages: [],
  proposals: [],
  askReview: false,
  error: null,
};
let mockChat = NEW_CHAT;
let mockChats: Record<string, AiConversation> = {};
let mockResume: (() => void) | null = null;
let mockChanges: AiChange[] = [];
let mockUndo: Record<string, () => void> = {};

function emit(event: string, payload: unknown): void {
  globalThis.__statlyBridge?.emit(event, payload as never);
}

const MOCK_WIDGET: CustomWidget = {
  id: "ai-streak",
  name: "Study time",
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

function mockFinish(answerId: string, reply: string): void {
  const number = mockChat.messages.length;
  emit("ai.text", { messageId: answerId, delta: reply });
  mockChat = {
    ...mockChat,
    running: false,
    waiting: null,
    askReview: aiProviderDefaults[mockAi.provider ?? "ollama"].beta && number === 2,
    messages: mockChat.messages.map((item) =>
      item.id === answerId ? { ...item, text: reply } : item,
    ),
  };
  if (mockChat.chatId) {
    mockChats = { ...mockChats, [mockChat.chatId]: mockChat };
  }
  emit("ai.changed", {});
}

/** A pretend model, so the panel can be used and tested without any service. */
function mockAnswer(text: string): void {
  const number = mockChat.messages.length;
  const answerId = `a${number}`;
  const lower = text.toLowerCase();
  const proposals: AiProposal[] = [];
  if (lower.includes("widget")) {
    proposals.push({
      id: `p${number}`,
      kind: "widget",
      summary: "A tile with today's study time",
      source: "chat",
      createdAt: "2026-11-01T09:30:00",
      status: "pending",
      widget: MOCK_WIDGET,
      addToDashboard: true,
    });
  }
  mockChat = {
    ...mockChat,
    chatId: mockChat.chatId ?? `c${Object.keys(mockChats).length + 1}`,
    title: mockChat.title || text.slice(0, 40),
    running: true,
    error: null,
    askReview: false,
    messages: [
      ...mockChat.messages,
      { id: `u${number}`, role: "user", text, tools: [], proposals: [], notice: null },
      {
        id: answerId,
        role: "assistant",
        text: "",
        tools: ["get_today", "get_statistic"],
        proposals: proposals.map((proposal) => proposal.id),
        notice: null,
      },
    ],
    proposals: [...mockChat.proposals, ...proposals],
  };
  const reply = lower.includes("options")
    ? "Which one should I build?\n\n1. Study time\n2. Deck activity\n3. Daily reviews"
    : "You studied **1 h 24 min** on that day.";
  if (lower.includes("card") && !mockAi.permissions.cards) {
    mockChat = { ...mockChat, waiting: { kind: "permission", scope: "cards" } };
    mockResume = () => mockFinish(answerId, "This card is in your Spanish deck.");
    emit("ai.changed", {});
    return;
  }
  if (lower.includes("choose")) {
    mockChat = {
      ...mockChat,
      waiting: {
        kind: "question",
        question: "Which range do you mean?",
        options: [{ label: "This week", description: "Monday to today" }, { label: "This month" }],
      },
    };
    mockResume = () => mockFinish(answerId, reply);
    emit("ai.changed", {});
    return;
  }
  emit("ai.changed", {});
  setTimeout(() => mockFinish(answerId, reply), lower.includes("slow") ? 3000 : RESPONSE_DELAY_MS);
}

function setProposal(id: string, status: AiProposal["status"]): AiProposal | undefined {
  mockChat = {
    ...mockChat,
    proposals: mockChat.proposals.map((item) => (item.id === id ? { ...item, status } : item)),
  };
  return mockChat.proposals.find((item) => item.id === id);
}

let mockDevices: DeviceLayouts = { tablet: null, phone: null };

const MOCK_TILES = new Set(["review-summary", "study-time", "success-rate", "due-cards"]);

function mockResolved(
  layout: DashboardLayout,
  stored: DeviceLayout | null,
  columns: number,
): ResolvedDevice {
  if (stored) {
    return { widgets: stored.widgets, automatic: false };
  }
  let x = 0;
  let y = 0;
  let row = 0;
  const widgets = [...layout.widgets]
    .sort((first, second) => first.y - second.y || first.x - second.x)
    .map((widget) => {
      const w = MOCK_TILES.has(widget.type) ? 2 : 4;
      if (x + w > columns) {
        x = 0;
        y += row;
        row = 0;
      }
      const placed = { ...widget, x, y, w, period: defaultDevicePeriod(widget.type) };
      x += w;
      row = Math.max(row, widget.h);
      return placed;
    });
  return { widgets, automatic: true };
}

const MOCK_PERIODS = { today: "Today", last7: "Last 7 days", last30: "Last 30 days" };

function mockBlock(widget: DeviceWidget): Result<"mobile.preview">["blocks"][string] {
  const label = widget.type.replace(/-/g, " ");
  const note = MOCK_PERIODS[widget.period];
  if (widget.type === "review-heatmap") {
    const levels = Array.from({ length: 371 }, (_, day) => (day * 7) % 5);
    return { kind: "heatmap", label, note: "Streak 12 days", levels, facts: [] };
  }
  if (MOCK_TILES.has(widget.type)) {
    return { kind: "tile", label, value: "412", note, facts: [] };
  }
  const bars = Array.from({ length: 12 }, (_, day) => ({
    label: `10-${10 + day}`,
    value: 20 + ((day * 37) % 90),
  }));
  return { kind: "bars", label, note, horizontal: false, bars, facts: [] };
}

function mockPlaced(widgets: DeviceWidget[]) {
  return widgets.map(({ x, y, w, h, type, period }) => ({
    block: `${type}|${period}`,
    x,
    y,
    w,
    h,
  }));
}

function mockSnapshot(tablet: DeviceWidget[], phone: DeviceWidget[]): Result<"mobile.preview"> {
  return {
    title: "Statly",
    updated: "Updated 2026-11-01 09:30",
    hint: "This card shows your statistics. There is no need to answer it.",
    blocks: Object.fromEntries(
      [...tablet, ...phone].map((widget) => [`${widget.type}|${widget.period}`, mockBlock(widget)]),
    ),
    tablet: mockPlaced(tablet),
    phone: mockPlaced(phone),
    backgrounds: { tablet: null, phone: null },
    words: {
      back: "Back",
      total: "Total",
      average: "Average",
      best: "Highest",
      share: "Share of the total",
      comparedTo: "Compared to the average",
      videoHere: "This video plays on the desktop",
    },
  };
}

const results: { [M in MethodName]: (params: never) => Result<M> } = {
  "system.ping": (params: { nonce: string }) => ({ nonce: params.nonce }),
  "system.info": () => ({
    statlyVersion: "dev",
    ankiVersion: "browser preview",
    nightMode: matchMedia("(prefers-color-scheme: dark)").matches,
    language: navigator.language,
  }),
  "system.collectionSummary": () => ({ cards: 12480, reviews: 386214 }),
  "system.openExternal": () => null,
  ...statisticsMocks,
  "dashboard.get": () => mockLayout,
  "dashboard.save": ({ layout, devices }: { layout: DashboardLayout; devices?: DeviceLayouts }) => {
    mockLayout = layout;
    mockDevices = devices ?? mockDevices;
    return null;
  },
  "dashboard.devices": ({
    layout,
    devices,
  }: {
    layout: DashboardLayout;
    devices?: DeviceLayouts;
  }) => {
    const stored = devices ?? mockDevices;
    return {
      tablet: mockResolved(layout, stored.tablet, deviceColumns.tablet),
      phone: mockResolved(layout, stored.phone, deviceColumns.phone),
    };
  },
  "dashboard.storedDevices": () => mockDevices,
  "dashboard.chooseBackground": ({ device }: { device: "desktop" | "tablet" | "phone" }) => {
    const asset = { id: "a".repeat(64), type: "image/png" as const };
    mockSettings = {
      ...mockSettings,
      dashboardBackgrounds: { ...mockSettings.dashboardBackgrounds, [device]: asset },
    };
    return mockSettings;
  },
  "dashboard.removeBackground": ({ device }: { device: "desktop" | "tablet" | "phone" }) => {
    mockSettings = {
      ...mockSettings,
      dashboardBackgrounds: { ...mockSettings.dashboardBackgrounds, [device]: null },
    };
    return mockSettings;
  },
  "dashboard.reset": () => {
    mockLayout = defaultLayout;
    return mockLayout;
  },
  "system.openAnkiStatistics": () => null,
  "system.saveFile": () => ({ saved: true }),
  "system.openFile": () => ({ content: globalThis.__mockOpenFile ?? null }),
  "system.setUnsaved": () => null,
  "system.addon": () => ({ autoUpdate: mockAutoUpdate }),
  "system.setAutoUpdate": ({ enabled }: { enabled: boolean }) => {
    mockAutoUpdate = enabled;
    return null;
  },
  "system.uninstall": () => ({ uninstalled: false }),
  "settings.get": () => {
    if (!mockSettingsReady) {
      mockSettingsReady = true;
      // Browser tests skip the first-run dialog unless a test asks for it.
      mockSettings = { ...mockSettings, onboardingDone: !location.search.includes("welcome") };
    }
    return mockSettings;
  },
  "settings.update": (patch: Partial<Settings>) => {
    mockSettings = { ...mockSettings, ...patch };
    return mockSettings;
  },
  "shortcuts.beginRecording": () => null,
  "shortcuts.endRecording": () => null,
  "feedback.visit": () => ({ askRating: location.search.includes("rating") }),
  "feedback.answer": () => null,
  "widgets.list": () => mockWidgets,
  "widgets.save": ({ widget }: { widget: CustomWidget }) => {
    mockWidgets = [...mockWidgets.filter((item) => item.id !== widget.id), widget];
    return widget;
  },
  "widgets.delete": ({ id }: { id: string }) => {
    mockWidgets = mockWidgets.filter((item) => item.id !== id);
    mockLayout = {
      widgets: mockLayout.widgets.filter((widget) => widget.type !== `custom:${id}`),
    };
    return null;
  },
  "widgets.addMedia": () => ({ asset: null }),
  "widgets.setGifLoop": ({ id }: { id: string }) => ({ id, type: "image/gif" as const }),
  "widgets.media": () => ({ url: null }),
  "widgets.export": () => ({ saved: true }),
  "widgets.import": () => ({ widget: null }),
  "mobile.status": () => mockMobile,
  "mobile.enable": () => {
    mockMobile = { enabled: true, updated: "2026-11-01T09:30" };
    return mockMobile;
  },
  "mobile.disable": () => {
    mockMobile = { enabled: false, updated: null };
    return mockMobile;
  },
  "mobile.refresh": () => mockMobile,
  "mobile.preview": ({ tablet, phone }: { tablet: DeviceWidget[]; phone: DeviceWidget[] }) =>
    mockSnapshot(tablet, phone),
  "ai.status": () => mockAi,
  "ai.configure": ({
    provider,
    model,
    baseUrl,
  }: {
    provider: NonNullable<AiStatus["provider"]>;
    model: string;
    baseUrl: string;
  }) => {
    const defaults = aiProviderDefaults[provider];
    mockAi = {
      ...mockAi,
      provider,
      model: model || defaults.model,
      baseUrl: baseUrl || defaults.baseUrl,
      hasKey: provider === mockAi.provider && mockAi.hasKey,
      consented: defaults.local,
    };
    return mockAi;
  },
  "ai.setKey": () => {
    mockAi = { ...mockAi, hasKey: true };
    return mockAi;
  },
  "ai.removeKey": () => {
    mockAi = { ...mockAi, hasKey: false };
    return mockAi;
  },
  "ai.enableKeyLock": ({ password }: { password: string }) => {
    mockKeyPassword = password;
    mockAi = { ...mockAi, keyLock: "unlocked" };
    return mockAi;
  },
  "ai.disableKeyLock": ({ password }: { password: string }) => {
    checkMockPassword(password);
    mockKeyPassword = null;
    mockAi = { ...mockAi, keyLock: "off" };
    return mockAi;
  },
  "ai.unlockKeys": ({ password }: { password: string }) => {
    checkMockPassword(password);
    mockAi = { ...mockAi, keyLock: "unlocked" };
    return mockAi;
  },
  "ai.changeKeyPassword": ({ current, password }: { current: string; password: string }) => {
    checkMockPassword(current);
    mockKeyPassword = password;
    return mockAi;
  },
  "ai.lockKeys": () => {
    mockAi = { ...mockAi, keyLock: "locked" };
    return mockAi;
  },
  "ai.forgetKeys": () => {
    mockKeyPassword = null;
    mockAi = { ...mockAi, hasKey: false, keyLock: "off" };
    return mockAi;
  },
  "ai.models": () => ({
    models: [
      { id: "claude-opus-5-5", name: "Claude Opus 5.5", tools: true },
      { id: "plain", name: "Plain model", tools: false },
    ],
  }),
  "ai.consent": () => {
    mockAi = { ...mockAi, consented: true };
    return mockAi;
  },
  "ai.conversation": () => mockChat,
  "ai.send": ({ text }: { text: string }) => {
    mockAnswer(text);
    return null;
  },
  "ai.stop": () => null,
  "ai.reset": () => {
    mockChat = NEW_CHAT;
    return null;
  },
  "ai.answerPermission": ({ decision }: { decision: "once" | "always" | "deny" }) => {
    if (decision === "always") {
      mockAi = { ...mockAi, permissions: { ...mockAi.permissions, cards: true } };
    }
    mockResume?.();
    mockResume = null;
    return null;
  },
  "ai.answerQuestion": ({ text }: { text: string }) => {
    const last = mockChat.messages.length - 1;
    const asked = {
      id: `q${last}`,
      role: "user" as const,
      text,
      tools: [],
      proposals: [],
      notice: null,
    };
    mockChat = {
      ...mockChat,
      waiting: null,
      messages: [...mockChat.messages.slice(0, last), asked, ...mockChat.messages.slice(last)],
    };
    mockResume?.();
    mockResume = null;
    return null;
  },
  "ai.setPermission": ({ scope, allowed }: { scope: "decks" | "cards"; allowed: boolean }) => {
    mockAi = { ...mockAi, permissions: { ...mockAi.permissions, [scope]: allowed } };
    return mockAi;
  },
  "ai.setExternalPermissions": ({ allowed }: { allowed: boolean }) => {
    mockAi = { ...mockAi, externalPermissions: allowed };
    return mockAi;
  },
  "ai.setKeepChats": ({ keep }: { keep: boolean }) => {
    mockAi = { ...mockAi, keepChats: keep };
    return mockAi;
  },
  "ai.chats": () =>
    Object.values(mockChats).map((chat) => ({
      id: chat.chatId ?? "",
      title: chat.title,
      updatedAt: "2026-11-01T09:30:00",
    })),
  "ai.openChat": ({ id }: { id: string }) => {
    mockChat = mockChats[id] ?? NEW_CHAT;
    return null;
  },
  "ai.deleteChat": ({ id }: { id: string }) => {
    mockChats = Object.fromEntries(Object.entries(mockChats).filter(([key]) => key !== id));
    return null;
  },
  "ai.reviewAnswered": () => {
    mockChat = { ...mockChat, askReview: false };
    return null;
  },
  "cards.find": () => [],
  "cards.get": () => {
    throw new Error("The simulated Anki has no cards.");
  },
  "ai.applyProposal": ({ id, widget: finished }: { id: string; widget?: CustomWidget }) => {
    const proposal = setProposal(id, "applied");
    if (proposal?.widget) {
      const widget = finished ?? proposal.widget;
      mockWidgets = [...mockWidgets, widget];
      const change = `c${mockChanges.length}`;
      mockUndo[change] = () => {
        mockWidgets = mockWidgets.filter((item) => item.id !== widget.id);
      };
      mockChanges = [
        {
          id: change,
          at: "2026-11-01T09:31:00",
          kind: proposal.kind,
          summary: proposal.summary,
          source: proposal.source,
          mode: "approved",
          rolledBack: false,
        },
        ...mockChanges,
      ];
    }
    emit("ai.changed", {});
    emit("ai.applied", {});
    return null;
  },
  "ai.rejectProposal": ({ id }: { id: string }) => {
    setProposal(id, "rejected");
    emit("ai.changed", {});
    return null;
  },
  "ai.changes": () => mockChanges,
  "ai.rollback": ({ id }: { id: string }) => {
    mockUndo[id]?.();
    mockUndo = Object.fromEntries(Object.entries(mockUndo).filter(([name]) => name !== id));
    mockChanges = mockChanges.map((item) =>
      item.id === id ? { ...item, rolledBack: true } : item,
    );
    emit("ai.applied", {});
    return null;
  },
  "ai.setAutoMode": ({ enabled }: { enabled: boolean }) => {
    mockAi = { ...mockAi, autoMode: enabled };
    return mockAi;
  },
  "ai.setAutoExternal": ({ enabled }: { enabled: boolean }) => {
    mockAi = { ...mockAi, autoExternal: enabled };
    return mockAi;
  },
  "ai.setExternal": ({ enabled }: { enabled: boolean }) => {
    const { external } = mockAi;
    mockAi = {
      ...mockAi,
      external: { ...external, enabled, running: enabled && external.hasCode },
    };
    return mockAi;
  },
  "ai.newExternalCode": () => {
    mockAi = {
      ...mockAi,
      external: { enabled: true, running: true, port: 52741, hasCode: true },
    };
    return { code: "statly1.52741.mock-code" };
  },
  "ai.saveBridge": () => ({ saved: true }),
  "wallpaper.preview": () => ({ image: null }),
  "wallpaper.choose": () => ({ image: null }),
  "wallpaper.remove": () => ({ image: null }),
  "shortcuts.set": ({ action, keys }: { action: ShortcutAction; keys: string }) => {
    if (keys === "Ctrl+Q") {
      return { conflict: "Quit", settings: mockSettings };
    }
    mockSettings = { ...mockSettings, shortcuts: { ...mockSettings.shortcuts, [action]: keys } };
    return { conflict: null, settings: mockSettings };
  },
};

/** Simulated Anki for `pnpm dev`, so interface work needs no running Anki. */
export class MockTransport implements Transport {
  constructor(private readonly respond: (response: BridgeResponse) => void) {}

  send(request: string): void {
    const { id, method, params } = JSON.parse(request) as {
      id: number;
      method: MethodName;
      params: never;
    };
    setTimeout(() => {
      try {
        this.respond({ id, ok: true, result: results[method](params) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.respond({ id, ok: false, error: { code: "not_allowed", message } });
      }
    }, RESPONSE_DELAY_MS);
  }
}
