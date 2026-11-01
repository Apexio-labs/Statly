import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "@statly/i18n";
import { Check, ChevronDown, ChevronRight, LayoutGrid, Search } from "lucide-react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { type Deck, type DeckNode, deckLabel, deckTree, pathsTo, searchDecks } from "./deckTree.ts";
import { ALL_DECKS } from "./useDashboardFilters.ts";

const ROW =
  "flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-control border-0 bg-transparent px-2 py-1 text-left text-[13px] text-text outline-none hover:bg-hover focus-visible:bg-hover";
const INDENT_PX = 16;

function Mark({ shown }: { shown: boolean }) {
  return shown ? <Check size={14} className="ml-auto shrink-0 text-accent" /> : null;
}

function DeckRow({
  node,
  depth,
  chosen,
  open,
  onToggle,
  onPick,
}: {
  node: DeckNode;
  depth: number;
  chosen: string;
  open: Set<string>;
  onToggle: (path: string) => void;
  onPick: (id: number) => void;
}) {
  const { t } = useTranslation();
  const expanded = open.has(node.path);
  const hasChildren = node.children.length > 0;
  const Arrow = expanded ? ChevronDown : ChevronRight;
  return (
    <>
      <div className="flex items-center" style={{ paddingLeft: depth * INDENT_PX }}>
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={t(expanded ? "decks.collapse" : "decks.expand", { name: node.label })}
            onClick={() => onToggle(node.path)}
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
          >
            <Arrow size={14} />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <button
          type="button"
          role="option"
          aria-selected={String(node.id) === chosen}
          data-deck-row
          title={node.path.replaceAll("::", " › ")}
          onClick={() => (node.id === null ? onToggle(node.path) : onPick(node.id))}
          className={ROW}
        >
          <span className="truncate">{node.label}</span>
          {hasChildren ? (
            <span className="shrink-0 text-[11px] text-muted">{node.children.length}</span>
          ) : null}
          <Mark shown={String(node.id) === chosen} />
        </button>
      </div>
      {expanded
        ? node.children.map((child) => (
            <DeckRow
              key={child.path}
              node={child}
              depth={depth + 1}
              chosen={chosen}
              open={open}
              onToggle={onToggle}
              onPick={onPick}
            />
          ))
        : null}
    </>
  );
}

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

  /** Arrows walk through the rows, so nobody has to reach for the mouse after searching. */
  function walk(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) {
      return;
    }
    event.preventDefault();
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-deck-row]") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    rows[Math.max(0, Math.min(rows.length - 1, at + step))]?.focus();
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger
        aria-label={t("dashboard.deck")}
        title={current?.name.replaceAll("::", " › ")}
        className="flex h-10 max-w-64 cursor-pointer items-center gap-2 rounded-control border border-line bg-control px-3 text-[13px] font-semibold text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <LayoutGrid size={15} className="shrink-0" />
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
          onKeyDown={walk}
          className="z-50 flex max-h-[min(460px,calc(100vh-40px))] w-[320px] flex-col overflow-hidden rounded-popover border border-line bg-card text-text shadow-card"
        >
          <label className="relative block border-b border-line p-2">
            <Search
              size={14}
              aria-hidden="true"
              className="absolute top-1/2 left-4.5 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                const first = matches[0];
                if (event.key === "Enter" && first) {
                  pick(String(first.id));
                }
              }}
              placeholder={t("decks.search")}
              aria-label={t("decks.search")}
              className="h-9 w-full rounded-control border border-line bg-control pr-3 pl-8 text-[13px] text-text outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </label>
          <div
            ref={list}
            role="listbox"
            aria-label={t("dashboard.deck")}
            className="min-h-0 flex-1 overflow-y-auto p-1.5 statly-scroll"
          >
            {searching ? (
              matches.map((match) => (
                <button
                  key={match.id}
                  type="button"
                  role="option"
                  aria-selected={String(match.id) === value}
                  data-deck-row
                  onClick={() => pick(String(match.id))}
                  className={ROW}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{match.label}</span>
                    {match.parents.length > 0 ? (
                      <span className="block truncate text-[11px] text-muted">
                        {match.parents.join(" › ")}
                      </span>
                    ) : null}
                  </span>
                  <Mark shown={String(match.id) === value} />
                </button>
              ))
            ) : (
              <>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === ALL_DECKS}
                  data-deck-row
                  onClick={() => pick(ALL_DECKS)}
                  className={`${ROW} font-semibold`}
                >
                  {t("dashboard.allDecks")}
                  <Mark shown={value === ALL_DECKS} />
                </button>
                {tree.map((node) => (
                  <DeckRow
                    key={node.path}
                    node={node}
                    depth={0}
                    chosen={value}
                    open={expanded}
                    onToggle={toggle}
                    onPick={(id) => pick(String(id))}
                  />
                ))}
              </>
            )}
            {searching && matches.length === 0 ? (
              <p className="m-0 p-3 text-center text-[13px] text-muted">{t("decks.none")}</p>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
