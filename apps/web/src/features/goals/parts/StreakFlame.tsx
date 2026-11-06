import type { ExamStatus } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Flame } from "lucide-react";

/** The streak as a flame. While today's goal is still open, the flame is hollow: it is at stake. */
export function StreakFlame({
  streak,
  compact = false,
}: {
  streak: ExamStatus["streak"];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span
      data-streak={streak.current}
      title={t(streak.atRisk ? "goals.streak.atRisk" : "goals.streak.alive")}
      className="inline-flex items-center gap-1 font-semibold text-text"
    >
      <Flame
        size={compact ? 13 : 18}
        aria-hidden="true"
        className={streak.atRisk ? "text-muted" : "text-warning"}
        fill={streak.atRisk ? "none" : "currentColor"}
      />
      {compact ? streak.current : t("goals.widget.streak", { count: streak.current })}
    </span>
  );
}
