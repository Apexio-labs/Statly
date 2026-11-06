import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuEntry = {
  label: string;
  icon?: ReactNode;
  /** The page the menu was opened on: shown with a tick, not chosen again. */
  current?: boolean;
  onSelect?: () => void;
};

const ENABLED = '[role="menuitem"]:not([aria-disabled="true"])';

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ENABLED)];
  if (items.length === 0) {
    return;
  }
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "ArrowDown"
      ? (index + 1) % items.length
      : event.key === "ArrowUp"
        ? (index - 1 + items.length) % items.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : null;
  if (next !== null) {
    event.preventDefault();
    items[next]?.focus();
  }
}

/** The list of a dropdown or right-click menu. The arrow keys move through it, Escape closes it. */
export function MenuContent({
  label,
  entries,
  onClose,
  align = "start",
  sideOffset = 6,
}: {
  label: string;
  entries: readonly MenuEntry[];
  onClose: () => void;
  align?: "start" | "center" | "end";
  sideOffset?: number;
}) {
  const list = useRef<HTMLDivElement>(null);
  return (
    <Popover.Portal>
      <Popover.Content
        ref={list}
        role="menu"
        aria-label={label}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          list.current?.querySelector<HTMLElement>(ENABLED)?.focus();
        }}
        onKeyDown={moveFocus}
        className="statly-menu z-50 flex min-w-[220px] flex-col gap-0.5 rounded-popover border border-line bg-card p-1 text-text shadow-card"
      >
        {entries.map((entry) => (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            aria-disabled={entry.current ? true : undefined}
            aria-current={entry.current ? "page" : undefined}
            onClick={() => {
              if (!entry.current) {
                onClose();
                entry.onSelect?.();
              }
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-control border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] text-text outline-none transition-colors hover:bg-hover focus-visible:bg-hover aria-disabled:cursor-default aria-disabled:font-semibold aria-disabled:hover:bg-transparent"
          >
            <span className="grid size-4 shrink-0 place-items-center text-muted">{entry.icon}</span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.current ? (
              <Check size={14} aria-hidden="true" className="shrink-0 text-accent" />
            ) : null}
          </button>
        ))}
      </Popover.Content>
    </Popover.Portal>
  );
}

/**
 * A menu that opens where the pointer is on a right click. Spread `onContextMenu` on the element
 * and render `menu` anywhere next to it.
 */
export function useContextMenu(label: string, entries: readonly MenuEntry[]) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const menu = (
    <Popover.Root open={at !== null} onOpenChange={(open) => (open ? null : setAt(null))}>
      {at
        ? createPortal(
            <Popover.Anchor asChild>
              <span
                aria-hidden="true"
                className="pointer-events-none fixed size-0"
                style={{ left: at.x, top: at.y }}
              />
            </Popover.Anchor>,
            document.body,
          )
        : null}
      <MenuContent label={label} entries={entries} onClose={() => setAt(null)} sideOffset={2} />
    </Popover.Root>
  );
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      // The menu key on a keyboard reports no pointer, so the menu opens at the element's corner.
      const box = event.currentTarget.getBoundingClientRect();
      const keyed = event.clientX === 0 && event.clientY === 0;
      setAt(keyed ? { x: box.left + 16, y: box.top + 16 } : { x: event.clientX, y: event.clientY });
    },
    menu,
  };
}
