import { readChartTheme } from "@statly/charts";
import { useTranslation } from "@statly/i18n";
import { type ReactNode, useMemo } from "react";

export type WidgetScope = {
  start: string;
  end: string;
  deckId: number | null;
  /** Changes with the theme, so charts redraw in the new colors. */
  themeKey: string;
};

export type WidgetProps = { scope: WidgetScope };

export function useFormatters() {
  const { t, i18n } = useTranslation();
  const numbers = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  return { t, locale: i18n.language, number: (value: number) => numbers.format(value) };
}

export function useChartTheme(themeKey: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is what invalidates it.
  return useMemo(() => readChartTheme(), [themeKey]);
}

/**
 * Fits any size a person drags it to. Long values shrink, and a note that has no room moves into
 * a column of its own beyond the edge: gone as a whole, instead of cut in half or spilling out.
 */
export function Tile({ value, note }: { value: ReactNode; note: string }) {
  return (
    <div
      title={note}
      className="flex h-full flex-col flex-wrap overflow-hidden [container-type:inline-size]"
    >
      <p className="m-0 w-full truncate text-[clamp(15px,22cqw,24px)] leading-tight font-bold text-text">
        {value}
      </p>
      <p className="m-0 mt-1 w-full text-[13px] text-muted">{note}</p>
    </div>
  );
}

const CHIP =
  "cursor-pointer rounded-full border border-line bg-transparent px-2.5 py-1 text-[11px] text-muted hover:bg-hover aria-pressed:border-accent aria-pressed:bg-selected aria-pressed:font-semibold aria-pressed:text-accent-strong";

export function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={CHIP}>
      {children}
    </button>
  );
}

export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  nameOf,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  nameOf: (value: T) => string;
}) {
  return (
    <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <Chip key={option} pressed={value === option} onClick={() => onChange(option)}>
          {nameOf(option)}
        </Chip>
      ))}
    </fieldset>
  );
}
