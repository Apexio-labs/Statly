import type { Paint } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { createContext, type ReactNode, type RefObject, useContext } from "react";
import { Select } from "../../../components/Select.tsx";

type Reset = (() => void) | undefined;

/** Holds the reset of the field under the pointer, for the Backspace key. */
export const HoverReset = createContext<RefObject<Reset> | null>(null);

const FIELD =
  "h-8 w-full rounded-control border border-line bg-control px-2 text-xs text-text outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export function Field({
  label,
  onReset,
  children,
}: {
  label: string;
  onReset?: (() => void) | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const hovered = useContext(HoverReset);
  return (
    <div
      className="flex flex-col gap-1 text-xs"
      title={onReset ? t("editor.resetHint") : undefined}
      onPointerEnter={() => {
        if (hovered) {
          hovered.current = onReset;
        }
      }}
      onPointerLeave={() => {
        if (hovered) {
          hovered.current = undefined;
        }
      }}
    >
      <span className="font-semibold text-muted">{label}</span>
      {children}
    </div>
  );
}

export function TextField({
  label,
  value,
  multiline = false,
  maxLength,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  maxLength: number;
  onChange: (value: string) => void;
  onReset?: Reset;
}) {
  return (
    <Field label={label} onReset={onReset}>
      {multiline ? (
        <textarea
          aria-label={label}
          value={value}
          maxLength={maxLength}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          className={`${FIELD} h-auto py-1.5`}
        />
      ) : (
        <input
          aria-label={label}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
        />
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onReset?: Reset;
}) {
  return (
    <Field label={label} onReset={onReset}>
      <input
        aria-label={label}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== "" && next >= min && next <= max) {
            onChange(next);
          }
        }}
        className={FIELD}
      />
    </Field>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onReset?: Reset;
}) {
  return (
    <Field label={label} onReset={onReset}>
      <input
        aria-label={label}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--statly-accent)]"
      />
    </Field>
  );
}

export function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
  onReset,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; hint?: string | undefined }[];
  onChange: (value: T) => void;
  onReset?: Reset;
}) {
  return (
    <Field label={label} onReset={onReset}>
      <Select label={label} value={value} options={options} onChange={onChange} />
    </Field>
  );
}

const THEME_PAINTS = ["text", "muted", "accent", "card"] as const;
const CUSTOM = "custom";

export function PaintField({
  label,
  value,
  onChange,
  onReset,
}: {
  label: string;
  value: Paint;
  onChange: (value: Paint) => void;
  onReset?: Reset;
}) {
  const { t } = useTranslation();
  const custom = value.startsWith("#");
  return (
    <Field label={label} onReset={onReset}>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Select
            label={label}
            value={custom ? CUSTOM : value}
            options={[...THEME_PAINTS, CUSTOM].map((paint) => ({
              value: paint,
              label: t(`editor.paints.${paint}`),
            }))}
            onChange={(next) => onChange(next === CUSTOM ? "#087f8c" : (next as Paint))}
          />
        </div>
        {custom ? (
          <input
            type="color"
            aria-label={t("editor.paints.custom")}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="h-10 w-10 shrink-0 cursor-pointer rounded-control border border-line bg-transparent"
          />
        ) : null}
      </div>
    </Field>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onReset?: Reset;
}) {
  return (
    <Field label={label} onReset={onReset}>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full cursor-pointer rounded-control border border-line bg-transparent"
      />
    </Field>
  );
}
