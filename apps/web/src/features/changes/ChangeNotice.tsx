import type { ChangeEntry } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { useAnkiChanges } from "../privacy/usePrivacy.ts";

const SHOWN_MS = 20_000;

/** One line per deck, as the list under Privacy & Security says it. */
export function changeLines(entry: ChangeEntry, t: ReturnType<typeof useTranslation>["t"]) {
  return entry.details.decks.map((deck) =>
    t("privacy.kinds.deckLimit", {
      deck: deck.deckName.replaceAll("::", " › "),
      before: deck.before,
      after: deck.after,
    }),
  );
}

/**
 * Every change Statly makes in Anki shows here at once, with a button that takes it back. It
 * stays a while, longer while the pointer is on it, and the full list lives under Privacy &
 * Security.
 */
export function ChangeNotice() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { list, undo } = useAnkiChanges();
  const [shownId, setShownId] = useState<string | null>(null);
  const [resting, setResting] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () =>
      bridge.on("changes.applied", ({ id }) => {
        setShownId(id);
      }),
    [],
  );
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (shownId && !resting) {
      timer.current = window.setTimeout(() => setShownId(null), SHOWN_MS);
    }
    return () => window.clearTimeout(timer.current);
  }, [shownId, resting]);

  const entry = list.data?.find((item) => item.id === shownId);
  if (!entry) {
    return null;
  }
  return (
    <section
      role="status"
      aria-label={t("changes.noticeTitle")}
      data-change-notice={entry.id}
      onPointerEnter={() => setResting(true)}
      onPointerLeave={() => setResting(false)}
      className="statly-fade-in fixed right-4 bottom-4 z-40 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 rounded-popover border border-line bg-card p-4 text-text shadow-card"
    >
      <div className="flex items-start gap-2">
        <h2 className="m-0 min-w-0 flex-1 text-[13px] font-bold">
          {t(entry.undone ? "changes.noticeUndone" : "changes.noticeTitle")}
        </h2>
        <button
          type="button"
          aria-label={t("changes.close")}
          onClick={() => setShownId(null)}
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
        >
          <X size={14} />
        </button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px]">
        {changeLines(entry, t).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="m-0 text-xs text-muted">{t("changes.noticeNote")}</p>
      {entry.canUndo ? (
        <div className="flex justify-end">
          <Button
            disabled={undo.isPending}
            onClick={() =>
              undo.mutate(entry.id, {
                onSuccess: () => {
                  void client.invalidateQueries({ queryKey: ["statistics", "goals.status"] });
                },
              })
            }
          >
            <Undo2 size={14} />
            {t("privacy.undo")}
          </Button>
        </div>
      ) : null}
      {undo.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {undo.error.message}
        </p>
      ) : null}
    </section>
  );
}
