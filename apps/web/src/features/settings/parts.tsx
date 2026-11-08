import { useTranslation } from "@statly/i18n";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";

const RESET_KEYS = new Set(["Delete", "Backspace"]);

/**
 * Statly's convention: pointing at something and pressing Delete or Backspace resets or removes
 * it. Typing in a field never counts.
 */
export function useDeleteWhilePointed(action: (() => void) | null) {
  const [pointed, setPointed] = useState(false);
  useEffect(() => {
    if (!pointed || !action) {
      return;
    }
    function remove(event: globalThis.KeyboardEvent) {
      const target = event.target;
      const typing =
        (target instanceof HTMLInputElement && target.type !== "color") ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (RESET_KEYS.has(event.key) && !typing) {
        event.preventDefault();
        action?.();
      }
    }
    addEventListener("keydown", remove);
    return () => removeEventListener("keydown", remove);
  }, [pointed, action]);
  return { onMouseEnter: () => setPointed(true), onMouseLeave: () => setPointed(false) };
}

export function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-[976px] px-4 pt-2 pb-8">
      <h2 className="m-0 text-[22px] font-bold">{title}</h2>
      <p className="m-0 mt-1 mb-5 text-[13px] text-muted">{note}</p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Card({ children, highlight }: { children: ReactNode; highlight?: string }) {
  return (
    <section
      data-highlight={highlight}
      className="rounded-card border border-line bg-card p-5 shadow-card"
    >
      {children}
    </section>
  );
}

export function Row({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <h3 className="m-0 text-[13px] font-bold">{title}</h3>
        {note ? <p className="m-0 mt-0.5 text-xs text-muted">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[26px] w-12 shrink-0 cursor-pointer rounded-full border border-line outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-hover"
      }`}
    >
      <span
        className={`absolute top-[3px] size-[18px] rounded-full transition-[left] ${
          checked ? "left-[25px] bg-white" : "left-[3px] bg-muted"
        }`}
      />
    </button>
  );
}

/**
 * A color well. Like everywhere in Statly, pointing at it and pressing Delete or Backspace puts
 * back its default, and so does pressing them while it has the focus.
 */
export function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (color: string) => void;
}) {
  const { t } = useTranslation();
  const [pointed, setPointed] = useState(false);

  useEffect(() => {
    if (!pointed) {
      return;
    }
    function reset(event: globalThis.KeyboardEvent) {
      const typing = event.target instanceof HTMLInputElement && event.target.type !== "color";
      if (RESET_KEYS.has(event.key) && !typing && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        onChange(fallback);
      }
    }
    addEventListener("keydown", reset);
    return () => removeEventListener("keydown", reset);
  }, [pointed, fallback, onChange]);

  return (
    <input
      type="color"
      aria-label={label}
      title={t("settings.colorResetHint")}
      value={value.toLowerCase()}
      onChange={(event) => onChange(event.target.value)}
      onMouseEnter={() => setPointed(true)}
      onMouseLeave={() => setPointed(false)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (!pointed && RESET_KEYS.has(event.key)) {
          event.preventDefault();
          onChange(fallback);
        }
      }}
      className="h-7 w-12 shrink-0 cursor-pointer rounded border border-line bg-transparent"
    />
  );
}
