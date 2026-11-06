import { useTranslation } from "@statly/i18n";
import { Flame, PartyPopper } from "lucide-react";
import { type CSSProperties, useEffect } from "react";

const PIECES = 26;
const SHOWN_MS = 3800;
const COLORS = [
  "var(--statly-success)",
  "var(--statly-warning)",
  "var(--statly-accent)",
  "var(--statly-danger)",
  "var(--statly-sequence-3)",
];

/**
 * A short celebration when the day's goal is met: confetti made of plain shapes and a badge.
 * With reduced motion only the badge shows. It ends by itself.
 */
export function Celebration({
  streak,
  milestone,
  onDone,
}: {
  streak: number;
  milestone: number | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(onDone, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <div
      role="status"
      aria-live="polite"
      data-celebration
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-card"
    >
      {Array.from({ length: PIECES }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces never change places.
          key={index}
          className="statly-confetti"
          style={
            {
              left: `${(index * 37 + 7) % 100}%`,
              width: index % 3 ? 6 : 9,
              height: index % 3 ? 10 : 6,
              background: COLORS[index % COLORS.length],
              animationDelay: `${(index % 7) * 70}ms`,
              "--drift": `${((index * 53) % 70) - 35}px`,
              "--spin": `${(index % 2 ? 1 : -1) * (200 + ((index * 41) % 300))}deg`,
            } as CSSProperties
          }
        />
      ))}
      <div className="statly-celebration-badge absolute top-1/2 right-0 left-0 mx-auto w-fit rounded-popover border border-line bg-card px-4 py-2.5 text-center shadow-card">
        <p className="m-0 flex items-center justify-center gap-1.5 text-[15px] font-bold text-success">
          <PartyPopper size={18} aria-hidden="true" />
          {t("goals.celebration.done")}
        </p>
        {milestone ? (
          <p className="m-0 mt-1 flex items-center justify-center gap-1 text-xs font-semibold">
            <Flame size={13} aria-hidden="true" className="text-warning" fill="currentColor" />
            {t("goals.celebration.milestone", { count: milestone })}
          </p>
        ) : streak > 1 ? (
          <p className="m-0 mt-1 text-xs text-muted">
            {t("goals.widget.streak", { count: streak })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
