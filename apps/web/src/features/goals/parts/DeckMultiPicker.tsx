import * as Popover from "@radix-ui/react-popover";
import type { GoalDeckChoice } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DecksIcon } from "../../../components/icons.tsx";
import {
  DeckMatches,
  DeckRows,
  DeckSearch,
  type RowState,
  walkRows,
} from "../../dashboard/DeckTreeRows.tsx";
import {
  coveringDeck,
  deckLabel,
  deckTree,
  pathsTo,
  searchDecks,
  toggleDeck,
} from "../../dashboard/deckTree.ts";

/** A box that is ticked, empty, or greyed out when a chosen parent already covers the deck. */
function Box({ state }: { state: RowState }) {
  const ticked = state !== "none";
  return (
    <span
      aria-hidden="true"
      className={`ml-auto grid size-4 shrink-0 place-items-center rounded-[4px] border ${
        state === "chosen"
          ? "border-transparent bg-primary text-on-primary"
          : ticked
            ? "border-line bg-hover text-muted"
            : "border-line bg-control"
      }`}
    >
      {ticked ? <Check size={11} strokeWidth={3} /> : null}
    </span>
  );
}

const mark = (state: RowState) => <Box state={state} />;

/** Several decks at once, with checkboxes. A ticked parent takes its subdecks along. */
export function DeckMultiPicker({
  decks,
  value,
  onChange,
}: {
  decks: GoalDeckChoice[];
  value: number[];
  onChange: (value: number[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => deckTree(decks), [decks]);
  const searching = search.trim() !== "";
  const matches = useMemo(
    () => (searching ? searchDecks(decks, search) : []),
    [decks, search, searching],
  );
  const names = new Map(decks.map((deck) => [deck.id, deck.name]));
  const chosen = value.flatMap((id) => names.get(id) ?? []);

  function handleOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setSearch("");
      setExpanded(new Set(chosen.flatMap((name) => pathsTo(name))));
    }
  }

  function toggle(path: string) {
    const next = new Set(expanded);
    if (!next.delete(path)) {
      next.add(path);
    }
    setExpanded(next);
  }

  const choice = {
    stateOf: (id: number): RowState =>
      value.includes(id) ? "chosen" : coveringDeck(decks, value, id) !== null ? "included" : "none",
    mark,
    onPick: (id: number) => onChange(toggleDeck(decks, value, id)),
  };
  const summary =
    chosen.length === 0
      ? t("goals.setup.chooseDecks")
      : chosen.length <= 2
        ? chosen.map(deckLabel).join(", ")
        : t("goals.setup.decksChosen", { count: chosen.length });

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger
        aria-label={t("goals.setup.decks")}
        className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-control border border-line bg-control px-3 text-left text-[13px] font-semibold text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <DecksIcon size={15} className="shrink-0" />
        <span className={`min-w-0 flex-1 truncate ${chosen.length ? "" : "text-muted"}`}>
          {summary}
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
          className="z-50 flex max-h-[min(460px,calc(100vh-40px))] w-[340px] flex-col overflow-hidden rounded-popover border border-line bg-card text-text shadow-card"
        >
          <DeckSearch
            value={search}
            onChange={setSearch}
            onEnter={() => {
              const first = matches[0];
              if (first) {
                choice.onPick(first.id);
              }
            }}
          />
          <div
            ref={list}
            role="listbox"
            aria-multiselectable="true"
            aria-label={t("goals.setup.decks")}
            className="min-h-0 flex-1 overflow-y-auto p-1.5 statly-scroll"
          >
            {searching ? (
              <DeckMatches matches={matches} {...choice} />
            ) : (
              <DeckRows tree={tree} open={expanded} onToggle={toggle} {...choice} />
            )}
          </div>
          <p className="m-0 border-t border-line px-3 py-2 text-[11px] text-muted">
            {t("goals.setup.decksNote")}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
