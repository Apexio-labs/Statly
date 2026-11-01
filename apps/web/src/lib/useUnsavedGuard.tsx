import { useTranslation } from "@statly/i18n";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { bridge } from "../bridge/index.ts";
import { Button } from "../components/Button.tsx";

/**
 * Nobody leaves an editor with unsaved work by accident: not through the menu, not with Cancel and
 * not by closing the window. `save` answers whether saving worked.
 */
export function useUnsavedGuard({
  dirty,
  save,
  samePage = false,
}: {
  dirty: boolean;
  save: () => Promise<boolean>;
  /** The editor lives on a page of its own, so even a link to that page leaves it. */
  samePage?: boolean;
}): { dialog: ReactNode; leave: (action: () => void) => void; allowLeaving: () => void } {
  const { t } = useTranslation();
  const allowed = useRef(false);
  const [waiting, setWaiting] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowed.current && (samePage || currentLocation.pathname !== nextLocation.pathname),
  );
  const blocked = blocker.state === "blocked";
  const message = dirty ? t("unsaved.closeWindow") : null;

  useEffect(() => {
    void bridge.call("system.setUnsaved", { message });
    return () => void bridge.call("system.setUnsaved", { message: null });
  }, [message]);

  function goOn() {
    allowed.current = true;
    if (blocked) {
      blocker.proceed();
    }
    waiting?.();
    setWaiting(null);
    allowed.current = false;
  }

  function stay() {
    if (blocked) {
      blocker.reset();
    }
    setWaiting(null);
  }

  async function saveAndGoOn() {
    setSaving(true);
    const saved = await save();
    setSaving(false);
    if (saved) {
      goOn();
    } else {
      stay();
    }
  }

  const dialog =
    blocked || waiting ? (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={t("unsaved.title")}
          className="flex w-full max-w-sm flex-col gap-3 rounded-popover bg-card p-6 text-text shadow-card"
        >
          <h2 className="m-0 text-lg font-bold">{t("unsaved.title")}</h2>
          <p className="m-0 text-[13px] text-muted">{t("unsaved.body")}</p>
          <Button
            primary
            className="justify-center"
            disabled={saving}
            onClick={() => void saveAndGoOn()}
          >
            {t("unsaved.save")}
          </Button>
          <div className="flex gap-2">
            <Button className="flex-1 justify-center" onClick={stay}>
              {t("unsaved.stay")}
            </Button>
            <Button className="flex-1 justify-center text-danger" onClick={goOn}>
              {t("unsaved.discard")}
            </Button>
          </div>
        </div>
      </div>
    ) : null;

  return {
    dialog,
    leave: (action) => {
      if (dirty) {
        setWaiting(() => action);
      } else {
        action();
      }
    },
    /** For a save that navigates by itself, because nothing is unsaved anymore. */
    allowLeaving: () => {
      allowed.current = true;
    },
  };
}
