import { z } from "zod";
import { dashboardLayout, settings } from "./dashboard.ts";
import { customWidget } from "./widget.ts";

export const aiProviders = [
  "anthropic",
  "openai",
  "openrouter",
  "custom",
  "ollama",
  "lmstudio",
] as const;
export type AiProvider = (typeof aiProviders)[number];

/** Local services run on the user's computer: nothing leaves it and no key is needed. */
export const aiProviderDefaults: Record<
  AiProvider,
  { baseUrl: string; model: string; local: boolean; needsKey: boolean; beta: boolean }
> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-opus-5-5",
    local: false,
    needsKey: true,
    beta: true,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "",
    local: false,
    needsKey: true,
    beta: true,
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    local: false,
    needsKey: true,
    beta: true,
  },
  custom: { baseUrl: "", model: "", local: false, needsKey: false, beta: true },
  ollama: {
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "",
    local: true,
    needsKey: false,
    beta: false,
  },
  lmstudio: {
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "",
    local: true,
    needsKey: false,
    beta: false,
  },
};

/**
 * What a person has to allow before an AI may see it. Decks reveal what someone studies, cards
 * what is on them. Nothing here ever allows a change: no tool can write to cards or decks.
 */
export const aiPermissionScopes = ["decks", "cards"] as const;
export type AiPermissionScope = (typeof aiPermissionScopes)[number];

/** Pages the assistant may open, with their address in the app. */
export const aiPages = {
  dashboard: "/",
  library: "/library",
  "new-widget": "/library/widgets/new",
  "settings-general": "/settings/general",
  "settings-appearance": "/settings/appearance",
  "settings-wallpaper": "/settings/wallpaper",
  "settings-dashboard": "/settings/dashboard",
  "settings-mobile": "/settings/mobile",
  "settings-shortcuts": "/settings/shortcuts",
  "settings-support": "/settings/support",
} as const;

/** Settings the assistant can point at after opening their page. */
export const aiHighlights = ["language", "theme", "autoUpdate", "fullscreen"] as const;

/**
 * The only settings an AI may ever touch. Everything else, above all the phone card, this
 * panel's own switches and anything about keys, is out of reach by construction.
 */
export const aiSettingKeys = [
  "theme",
  "language",
  "counterColorsEnabled",
  "counterColors",
  "wallpaper",
  "deckHeatmap",
  "brandAnimation",
] as const;

export const aiSettingsPatch = settings
  .pick({
    theme: true,
    language: true,
    counterColorsEnabled: true,
    counterColors: true,
    wallpaper: true,
    deckHeatmap: true,
    brandAnimation: true,
  })
  .partial()
  .strict();

/** Where people get a key. Only these addresses are ever offered as links. */
export const aiKeyPages: Partial<Record<AiProvider, string>> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  openrouter: "https://openrouter.ai/keys",
};

export const aiErrorCodes = [
  "not_configured",
  "key_missing",
  "keys_locked",
  "consent_needed",
  "bad_url",
  "key_invalid",
  "no_access",
  "model_missing",
  "rate_limited",
  "no_credit",
  "provider_down",
  "unreachable",
  "no_tool_support",
  "context_too_small",
  "bad_request",
  "bad_response",
  "chat_too_long",
] as const;
export type AiErrorCode = (typeof aiErrorCodes)[number];

export const aiStatus = z
  .object({
    provider: z.enum(aiProviders).nullable(),
    model: z.string(),
    baseUrl: z.string(),
    /** Whether a key is stored. The key itself never reaches the web app. */
    hasKey: z.boolean(),
    /** "system" is the keychain of the OS, "session" lasts until Anki closes. */
    keyStorage: z.enum(["system", "session"]),
    /** An extra password around stored keys. Without a real keychain it would protect nothing. */
    keyLock: z.enum(["unavailable", "off", "locked", "unlocked"]),
    consented: z.boolean(),
    permissions: z.object({ decks: z.boolean(), cards: z.boolean() }).strict(),
    /** Whether external apps may use what the chat was allowed to see. */
    externalPermissions: z.boolean(),
    keepChats: z.boolean(),
    autoMode: z.boolean(),
    autoExternal: z.boolean(),
    external: z
      .object({
        enabled: z.boolean(),
        running: z.boolean(),
        port: z.number().int().nullable(),
        hasCode: z.boolean(),
      })
      .strict(),
  })
  .strict();

/** Short passwords fall to guessing even at scrypt's price. */
export const aiKeyPasswordMin = 8;
export const aiKeyPassword = z.string().min(aiKeyPasswordMin).max(200);

export const aiConfigure = z
  .object({
    provider: z.enum(aiProviders),
    model: z.string().max(200),
    baseUrl: z.string().max(300),
  })
  .strict();

export const aiModels = z
  .object({
    models: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          /** False if the service says the model cannot use tools, null if it does not say. */
          tools: z.boolean().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const aiProposal = z
  .object({
    id: z.string(),
    kind: z.enum(["widget", "dashboard", "settings"]),
    summary: z.string(),
    source: z.enum(["chat", "external"]),
    createdAt: z.string(),
    status: z.enum(["pending", "applied", "rejected"]),
    widget: customWidget.optional(),
    addToDashboard: z.boolean().optional(),
    layout: dashboardLayout.optional(),
    patch: aiSettingsPatch.optional(),
  })
  .strict();

export const aiChange = z
  .object({
    id: z.string(),
    at: z.string(),
    kind: z.enum(["widget", "dashboard", "settings"]),
    summary: z.string(),
    source: z.enum(["chat", "external"]),
    /** "approved" came from a click, "auto" from the automatic mode. */
    mode: z.enum(["approved", "auto"]),
    rolledBack: z.boolean(),
  })
  .strict();

export const aiNotices = ["refused", "length", "steps", "stopped"] as const;

export const aiMessage = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    /** The tools used for this answer, shown so nothing happens unseen. */
    tools: z.array(z.string()),
    proposals: z.array(z.string()),
    notice: z.enum(aiNotices).nullable(),
  })
  .strict();

/** The assistant waits for a person: to allow something, or to choose how to go on. */
export const aiWaiting = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("permission"), scope: z.enum(aiPermissionScopes) }).strict(),
  z
    .object({
      kind: z.literal("question"),
      question: z.string(),
      options: z.array(
        z.object({ label: z.string(), description: z.string().optional() }).strict(),
      ),
    })
    .strict(),
]);

export const aiConversation = z
  .object({
    chatId: z.string().nullable(),
    title: z.string(),
    running: z.boolean(),
    waiting: aiWaiting.nullable(),
    messages: z.array(aiMessage),
    proposals: z.array(aiProposal),
    /** A service in beta just worked for this person, which is worth asking them to tell. */
    askReview: z.boolean(),
    error: z
      .object({ code: z.enum(aiErrorCodes), detail: z.string() })
      .strict()
      .nullable(),
  })
  .strict();

export const aiChatList = z.array(
  z.object({ id: z.string(), title: z.string(), updatedAt: z.string() }).strict(),
);

export type AiStatus = z.output<typeof aiStatus>;
export type AiProposal = z.output<typeof aiProposal>;
export type AiChange = z.output<typeof aiChange>;
export type AiMessage = z.output<typeof aiMessage>;
export type AiConversation = z.output<typeof aiConversation>;
export type AiWaiting = z.output<typeof aiWaiting>;
