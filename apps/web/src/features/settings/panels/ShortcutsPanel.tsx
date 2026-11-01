import { type ShortcutAction, shortcutActions } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useState } from "react";
import { bridge } from "../../../bridge/index.ts";
import { useAppearance } from "../../../lib/appearance.tsx";
import { Card, Panel } from "../parts.tsx";

const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift", "CapsLock"]);

const MAC_SYMBOLS: Record<string, string> = { Ctrl: "⌘", Meta: "⌃", Alt: "⌥", Shift: "⇧" };

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

export function ShortcutsPanel() {
  const { t } = useTranslation();
  const { settings } = useAppearance();
  const client = useQueryClient();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [status, setStatus] = useState("");
  const save = useMutation({
    mutationFn: (change: { action: ShortcutAction; keys: string }) =>
      bridge.call("shortcuts.set", change),
    onSuccess: (result) => {
      client.setQueryData(["settings"], result.settings);
      setStatus(
        result.conflict
          ? t("settings.shortcutConflict", { name: result.conflict })
          : t("settings.shortcutSaved"),
      );
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
      <Card>
        <div className="flex flex-col gap-3">
          {shortcutActions.map((action) => (
            <div key={action} className="flex items-center justify-between gap-4 text-[13px]">
              <span>{t(`settings.shortcutActions.${action}`)}</span>
              <button
                type="button"
                aria-label={t(`settings.shortcutActions.${action}`)}
                onClick={() => startRecording(action)}
                onBlur={() => {
                  if (recording === action) {
                    stopRecording();
                  }
                }}
                onKeyDown={(event) => handleKey(event, action)}
                className={`h-9 min-w-36 cursor-pointer rounded-control border bg-control px-3 text-[13px] font-semibold text-text outline-none ${
                  recording === action ? "border-accent ring-2 ring-accent/30" : "border-line"
                }`}
              >
                {recording === action
                  ? t("settings.shortcutRecording")
                  : displayKeys(settings.shortcuts[action]) || t("settings.shortcutNone")}
              </button>
            </div>
          ))}
          <p role="status" className="m-0 min-h-5 text-xs text-muted">
            {status}
          </p>
        </div>
      </Card>
    </Panel>
  );
}
