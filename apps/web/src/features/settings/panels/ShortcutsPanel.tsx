import type { ShortcutAction } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useState } from "react";
import { bridge } from "../../../bridge/index.ts";
import { useAppearance } from "../../../lib/appearance.tsx";
import { Card, Panel } from "../parts.tsx";

const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift", "CapsLock"]);

const MAC_SYMBOLS: Record<string, string> = { Ctrl: "⌘", Meta: "⌃", Alt: "⌥", Shift: "⇧" };

/** Every action belongs to exactly one group, which a test checks. */
export const SHORTCUT_GROUPS = {
  pages: ["dashboard", "library", "settings", "ankiStatistics", "appearance", "wallpaper"],
  actions: [
    "editDashboard",
    "createWidget",
    "importDashboard",
    "assistant",
    "nextTheme",
    "fullscreen",
  ],
} as const satisfies Record<string, readonly ShortcutAction[]>;

export const isMac = navigator.userAgent.includes("Macintosh");

/** Turns a key press into Qt's notation. On a Mac, Qt calls ⌘ Ctrl and ⌃ Meta. */
export function keysFromEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  mac = isMac,
): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey || event.metaKey) {
    parts.push("Ctrl");
  }
  if (mac && event.ctrlKey) {
    parts.push("Meta");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  // event.key changes with Alt on a Mac, so letters and digits come from the physical key.
  const physical = /^(?:Key|Digit)(.)$/.exec(event.code)?.[1];
  parts.push(physical ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key));
  return parts.join("+");
}

/** Shows a shortcut the way the user's system writes it. */
export function displayKeys(keys: string, mac = isMac): string {
  if (!mac) {
    return keys;
  }
  return keys
    .split("+")
    .map((part) => MAC_SYMBOLS[part] ?? part)
    .join("");
}

type Clash = { action: ShortcutAction; keys: string; name: string };

export function ShortcutsPanel() {
  const { t } = useTranslation();
  const { settings } = useAppearance();
  const client = useQueryClient();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [status, setStatus] = useState("");
  const [clash, setClash] = useState<Clash | null>(null);
  const save = useMutation({
    mutationFn: (change: { action: ShortcutAction; keys: string }) =>
      bridge.call("shortcuts.set", change),
    onSuccess: (result, change) => {
      client.setQueryData(["settings"], result.settings);
      if (result.conflict) {
        setClash({ ...change, name: result.conflict });
        setStatus("");
      } else {
        setClash(null);
        setStatus(t("settings.shortcutSaved"));
      }
    },
  });

  // The system acts on Cmd+Q before the page sees it, so Python reports it instead.
  useEffect(() => {
    if (!recording) {
      return;
    }
    return bridge.on("shortcuts.pressed", ({ keys }) => {
      setRecording(null);
      save.mutate({ action: recording, keys });
    });
  }, [recording, save]);

  function startRecording(action: ShortcutAction) {
    setRecording(action);
    setClash(null);
    setStatus(t("settings.shortcutPress"));
    void bridge.call("shortcuts.beginRecording", {});
  }

  function stopRecording() {
    setRecording(null);
    void bridge.call("shortcuts.endRecording", {});
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, action: ShortcutAction) {
    if (recording !== action) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopRecording();
      setStatus("");
    } else if (event.key === "Backspace" || event.key === "Delete") {
      setRecording(null);
      save.mutate({ action, keys: "" });
    } else {
      const keys = keysFromEvent(event);
      if (keys) {
        setRecording(null);
        save.mutate({ action, keys });
      }
    }
  }

  return (
    <Panel
      title={t("settings.sections.shortcuts.title")}
      note={t("settings.sections.shortcuts.note")}
    >
      {Object.entries(SHORTCUT_GROUPS).map(([key, actions]) => {
        const group = key as keyof typeof SHORTCUT_GROUPS;
        return (
          <Card key={group}>
            <div className="mb-4 border-b border-line pb-3">
              <h3 className="statly-group-title m-0 text-[17px] font-bold text-accent-strong">
                {t(`settings.shortcutGroups.${group}`)}
              </h3>
              <p className="m-0 mt-0.5 text-xs text-muted">
                {t(`settings.shortcutGroupNotes.${group}`)}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {actions.map((action) => {
                const clashing = clash?.action === action;
                return (
                  <div key={action} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-4 text-[13px]">
                      <span>{t(`settings.shortcutActions.${action}`)}</span>
                      <button
                        type="button"
                        aria-label={t(`settings.shortcutActions.${action}`)}
                        aria-invalid={clashing || undefined}
                        onClick={() => startRecording(action)}
                        onBlur={() => {
                          if (recording === action) {
                            stopRecording();
                          }
                        }}
                        onKeyDown={(event) => handleKey(event, action)}
                        className={`h-9 min-w-36 cursor-pointer rounded-control border bg-control px-3 text-[13px] font-semibold text-text outline-none ${
                          recording === action
                            ? "border-accent ring-2 ring-accent/30"
                            : clashing
                              ? "border-danger ring-2 ring-danger/30"
                              : "border-line"
                        }`}
                      >
                        {recording === action
                          ? t("settings.shortcutRecording")
                          : displayKeys(settings.shortcuts[action]) || t("settings.shortcutNone")}
                      </button>
                    </div>
                    {clash && clashing ? (
                      <div
                        role="alert"
                        className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
                      >
                        <p className="m-0 font-bold">
                          {t("settings.shortcutConflictTitle", { keys: displayKeys(clash.keys) })}
                        </p>
                        <p className="m-0 mt-0.5">
                          {t("settings.shortcutConflict", { name: clash.name })}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
      <p role="status" className="m-0 min-h-5 text-xs text-muted">
        {status}
      </p>
    </Panel>
  );
}
