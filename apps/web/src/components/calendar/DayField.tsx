import { useTranslation } from "@statly/i18n";
import { useState } from "react";
import { formatDay, parseDay, typedDay } from "./calendar.ts";

const FIELD =
  "h-9 w-full rounded-control border border-line bg-control px-3 text-[13px] text-text outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

/** A date typed as dd.mm.yyyy. It takes effect as soon as it is complete and valid. */
export function DayField({
  label,
  value,
  invalidNote,
  onChange,
}: {
  label: string;
  value: string;
  invalidNote: (shown: boolean) => void;
  onChange: (date: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const invalid = text !== null && text.length === 10 && parseDay(text) === null;

  function confirm() {
    if (text !== null) {
      const parsed = parseDay(text);
      invalidNote(parsed === null);
      if (parsed) {
        onChange(parsed);
        setText(null);
      }
    }
  }

  return (
    <input
      aria-label={label}
      aria-invalid={invalid}
      inputMode="numeric"
      maxLength={10}
      placeholder={t("calendar.placeholder")}
      value={text ?? formatDay(value)}
      className={`${FIELD} ${invalid ? "border-danger" : ""}`}
      onChange={(event) => {
        const typed = typedDay(event.target.value);
        setText(typed);
        const parsed = parseDay(typed);
        if (parsed) {
          invalidNote(false);
          onChange(parsed);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          confirm();
        }
      }}
      onBlur={confirm}
    />
  );
}
