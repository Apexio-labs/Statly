import { z } from "zod";

/**
 * Everything Statly may only do after the person allowed it.
 *
 * Allowing happens in a dialog that Statly's own Python code opens, never through a click inside
 * the web page alone, so neither a page nor an assistant can grant anything. Taking a permission
 * back works everywhere, because that is the safe direction. Grants stay on this computer.
 */
export const permissionIds = [
  "ai.decks",
  "ai.cards",
  "ai.external",
  "mobile.card",
  "goals.sync",
  "anki.deckLimits",
] as const;
export type PermissionId = (typeof permissionIds)[number];

/** "once" covers exactly one action, or one chat for the assistant. "always" lasts until revoked. */
export const grantModes = ["once", "always"] as const;
export type GrantMode = (typeof grantModes)[number];

/** How each permission can be given, and whether it lets Statly change the collection. */
export const permissionRules = {
  "ai.decks": { modes: ["once", "always"], changesAnki: false },
  "ai.cards": { modes: ["once", "always"], changesAnki: false },
  "ai.external": { modes: ["always"], changesAnki: false },
  "mobile.card": { modes: ["always"], changesAnki: true },
  "goals.sync": { modes: ["always"], changesAnki: true },
  "anki.deckLimits": { modes: ["once", "always"], changesAnki: true },
} as const satisfies Record<PermissionId, { modes: readonly GrantMode[]; changesAnki: boolean }>;

const moment = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const permissionState = z
  .object({
    id: z.enum(permissionIds),
    granted: z.boolean(),
    grantedAt: moment.nullable(),
    /** "migrated" means it was allowed in an earlier version, before this list existed. */
    source: z.enum(["dialog", "migrated"]).nullable(),
    lastUsedAt: moment.nullable(),
    /** False when allowing it only makes sense where it is used, such as setting up the phone card. */
    requestable: z.boolean(),
  })
  .strict();
export type PermissionState = z.output<typeof permissionState>;

export const permissionList = z.array(permissionState).max(permissionIds.length);

/** Who started a change: the person, Statly on its own with an "always" permission, or the assistant. */
export const changeSources = ["user", "automatic", "ai"] as const;

const deckLimitChange = z
  .object({
    kind: z.literal("deckLimit"),
    /** All decks of one change are one step in Anki's undo history. */
    decks: z
      .array(
        z
          .object({
            deckId: z.number().int(),
            deckName: z.string().max(400),
            /** The limit that applied today before the change. */
            before: z.number().int().nonnegative(),
            after: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export const changeDetails = z.discriminatedUnion("kind", [deckLimitChange]);
export type ChangeDetails = z.output<typeof changeDetails>;

/** One change Statly made in Anki. Each is a step of its own in Anki's undo history too. */
export const changeEntry = z
  .object({
    id: z.string().regex(/^[a-f0-9]{16}$/),
    at: moment,
    source: z.enum(changeSources),
    permission: z.enum(permissionIds),
    undone: z.boolean(),
    /** Only the newest change of a thing can be undone here, and only while it still applies. */
    canUndo: z.boolean(),
    details: changeDetails,
  })
  .strict();
export type ChangeEntry = z.output<typeof changeEntry>;

export const maxChanges = 100;
export const changeList = z.array(changeEntry).max(maxChanges);

/** What became of a change Statly was asked to make: made, or why not. */
export const changeResult = z.discriminatedUnion("applied", [
  z.object({ applied: z.literal(true), id: changeEntry.shape.id }).strict(),
  z
    .object({
      applied: z.literal(false),
      /** "denied" by the person, "postponed" during a review or before a waiting redo. */
      reason: z.enum(["denied", "postponed", "notNeeded"]),
    })
    .strict(),
]);
export type ChangeResult = z.output<typeof changeResult>;
