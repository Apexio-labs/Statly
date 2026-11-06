import { useTranslation } from "@statly/i18n";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import type { DeckMatch, DeckNode } from "./deckTree.ts";

export const DECK_ROW =
  "flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-control border-0 bg-transparent px-2 py-1 text-left text-[13px] text-text outline-none hover:bg-hover focus-visible:bg-hover";
const INDENT_PX = 16;

/** Chosen by the person, part of a chosen parent, or neither. */
export type RowState = "chosen" | "included" | "none";

type RowChoice = {
  stateOf: (id: number) => RowState;
  /** What a row shows at its end for its state, such as a check mark or a box. */
  mark: (state: RowState) => ReactNode;
  onPick: (id: number) => void;
};

function DeckRow({
  node,
  depth,
  open,
  onToggle,
  choice,
}: {
  node: DeckNode;
  depth: number;
  open: Set<string>;
  onToggle: (path: string) => void;
  choice: RowChoice;
}) {
  const { t } = useTranslation();
  const expanded = open.has(node.path);
  const hasChildren = node.children.length > 0;
  const Arrow = expanded ? ChevronDown : ChevronRight;
  const state = node.id === null ? "none" : choice.stateOf(node.id);
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
          aria-selected={state !== "none"}
          aria-disabled={state === "included" ? true : undefined}
          data-deck-row
          title={node.path.replaceAll("::", " › ")}
          onClick={() => (node.id === null ? onToggle(node.path) : choice.onPick(node.id))}
          className={DECK_ROW}
        >
          <span className="truncate">{node.label}</span>
          {hasChildren ? (
            <span className="shrink-0 text-[11px] text-muted">{node.children.length}</span>
          ) : null}
          {choice.mark(state)}
        </button>
      </div>
      {expanded
        ? node.children.map((child) => (
            <DeckRow
              key={child.path}
              node={child}
              depth={depth + 1}
              open={open}
              onToggle={onToggle}
              choice={choice}
            />
          ))
        : null}
    </>
  );
}

/** The decks as a tree that opens and closes, one row per deck. */
export function DeckRows({
  tree,
  open,
  onToggle,
  ...choice
}: { tree: DeckNode[]; open: Set<string>; onToggle: (path: string) => void } & RowChoice) {
  return tree.map((node) => (
    <DeckRow
      key={node.path}
      node={node}
      depth={0}
      open={open}
      onToggle={onToggle}
      choice={choice}
    />
  ));
}

/** Search results, each with the decks it sits in. */
export function DeckMatches({ matches, ...choice }: { matches: DeckMatch[] } & RowChoice) {
  const { t } = useTranslation();
  if (matches.length === 0) {
    return <p className="m-0 p-3 text-center text-[13px] text-muted">{t("decks.none")}</p>;
  }
  return matches.map((match) => {
    const state = choice.stateOf(match.id);
    return (
      <button
        key={match.id}
        type="button"
        role="option"
        aria-selected={state !== "none"}
        aria-disabled={state === "included" ? true : undefined}
        data-deck-row
        onClick={() => choice.onPick(match.id)}
        className={DECK_ROW}
      >
        <span className="min-w-0">
          <span className="block truncate">{match.label}</span>
          {match.parents.length > 0 ? (
            <span className="block truncate text-[11px] text-muted">
              {match.parents.join(" › ")}
            </span>
          ) : null}
        </span>
        {choice.mark(state)}
      </button>
    );
  });
}

export function DeckSearch({
  value,
  onChange,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="relative block border-b border-line p-2">
      <Search
        size={14}
        aria-hidden="true"
        className="absolute top-1/2 left-4.5 -translate-y-1/2 text-muted"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onEnter();
          }
        }}
        placeholder={t("decks.search")}
        aria-label={t("decks.search")}
        className="h-9 w-full rounded-control border border-line bg-control pr-3 pl-8 text-[13px] text-text outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/40"
      />
    </label>
  );
}

/** Arrows walk through the rows, so nobody has to reach for the mouse after searching. */
export function walkRows(event: KeyboardEvent<HTMLElement>, list: RefObject<HTMLElement | null>) {
  const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
  if (!step) {
    return;
  }
  event.preventDefault();
  const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-deck-row]") ?? [])];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  rows[Math.max(0, Math.min(rows.length - 1, at + step))]?.focus();
}
