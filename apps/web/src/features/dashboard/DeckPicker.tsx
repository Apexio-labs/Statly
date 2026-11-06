import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "@statly/i18n";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DecksIcon } from "../../components/icons.tsx";
import {
  DECK_ROW,
  DeckMatches,
  DeckRows,
  DeckSearch,
  type RowState,
  walkRows,
} from "./DeckTreeRows.tsx";
import { type Deck, deckLabel, deckTree, pathsTo, searchDecks } from "./deckTree.ts";
import { ALL_DECKS } from "./useDashboardFilters.ts";

function Mark({ shown }: { shown: boolean }) {
  return shown ? <Check size={14} className="ml-auto shrink-0 text-accent" /> : null;
}

const mark = (state: RowState) => <Mark shown={state === "chosen"} />;

export function DeckPicker({
  decks,
  value,
  onChange,
}: {
  decks: Deck[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => deckTree(decks), [decks]);
  const current = decks.find((deck) => String(deck.id) === value);
  const searching = search.trim() !== "";
  const matches = useMemo(
    () => (searching ? searchDecks(decks, search) : []),
    [decks, search, searching],
  );

  function handleOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setSearch("");
      setExpanded(new Set(current ? pathsTo(current.name) : []));
    }
  }

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  function toggle(path: string) {
    const next = new Set(expanded);
    if (!next.delete(path)) {
      next.add(path);
    }
    setExpanded(next);
  }

  const choice = {
    stateOf: (id: number): RowState => (String(id) === value ? "chosen" : "none"),
    mark,
    onPick: (id: number) => pick(String(id)),
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger
        aria-label={t("dashboard.deck")}
        title={current?.name.replaceAll("::", " › ")}
        className="flex h-10 max-w-64 cursor-pointer items-center gap-2 rounded-control border border-line bg-control px-3 text-[13px] font-semibold text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <DecksIcon size={15} className="shrink-0" />
        <span className="truncate">
          {current ? deckLabel(current.name) : t("dashboard.allDecks")}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onKeyDown={(event) => walkRows(event, list)}
          className="z-50 flex max-h-[min(460px,calc(100vh-40px))] w-[320px] flex-col overflow-hidden rounded-popover border border-line bg-card text-text shadow-card"
        >
          <DeckSearch
            value={search}
            onChange={setSearch}
            onEnter={() => {
              const first = matches[0];
              if (first) {
                pick(String(first.id));
              }
            }}
          />
          <div
            ref={list}
            role="listbox"
            aria-label={t("dashboard.deck")}
            className="min-h-0 flex-1 overflow-y-auto p-1.5 statly-scroll"
          >
            {searching ? (
              <DeckMatches matches={matches} {...choice} />
            ) : (
              <>
                {/* Lined up with the decks below and set apart from them, so it reads as one more
                    choice and not as a heading. */}
                <div className="mb-1 flex items-center border-b border-line pb-1">
                  <span className="grid size-6 shrink-0 place-items-center text-muted">
                    <DecksIcon size={14} />
                  </span>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === ALL_DECKS}
                    data-deck-row
                    onClick={() => pick(ALL_DECKS)}
                    className={`${DECK_ROW} font-semibold`}
                  >
                    {t("dashboard.allDecks")}
                    <Mark shown={value === ALL_DECKS} />
                  </button>
                </div>
                <DeckRows tree={tree} open={expanded} onToggle={toggle} {...choice} />
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
