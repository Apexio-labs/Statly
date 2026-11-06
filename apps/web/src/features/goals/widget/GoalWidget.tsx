import type { ExamStatus, GoalView } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { CalendarCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { GoalsIcon } from "../../../components/icons.tsx";
import { useContextMenu } from "../../../components/Menu.tsx";
import { shortDate } from "../../../lib/format.ts";
import { WidgetCard, WidgetState } from "../../dashboard/WidgetCard.tsx";
import { Celebration } from "../parts/Celebration.tsx";
import { GoalSunburst } from "../parts/GoalSunburst.tsx";
import { GoalTimeline } from "../parts/GoalTimeline.tsx";
import { StreakFlame } from "../parts/StreakFlame.tsx";
import { useGoalActions, useGoalStatus, useGoals } from "../useGoals.ts";

/** Streak, tomorrow and the days left, under either view. */
export function GoalFooter({ status }: { status: ExamStatus }) {
  const { t } = useTranslation();
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
      {status.streak.current > 0 ? <StreakFlame streak={status.streak} /> : null}
      {status.state === "active" || status.state === "buffer" ? (
        <span>{t("goals.widget.tomorrow", { count: status.tomorrow.ifMet })}</span>
      ) : null}
      <span className="flex items-center gap-1">
        <CalendarCheck size={12} aria-hidden="true" />
        {t("goals.widget.daysLeft", { count: status.studyDaysLeft })}
      </span>
    </footer>
  );
}

/** What a goal shows instead of its numbers when there is nothing to plan. */
export function GoalNotice({ status, goalId }: { status: ExamStatus; goalId: string }) {
  const { t } = useTranslation();
  if (status.state === "noDecks") {
    return (
      <div className="grid h-full place-items-center text-center text-[13px] text-muted">
        <p className="m-0">
          {t("goals.widget.noDecks")}{" "}
          <Link to={`/goals/${goalId}/edit`} className="font-semibold text-accent-strong">
            {t("goals.widget.chooseDecks")}
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="grid h-full place-items-center text-center text-[13px] text-muted">
      {t(status.state === "over" ? "goals.widget.over" : "goals.widget.finished")}
    </div>
  );
}

export function GoalBody({
  status,
  goalId,
  view = "ring",
  interactive = true,
}: {
  status: ExamStatus;
  goalId: string;
  view?: GoalView;
  interactive?: boolean;
}) {
  if (status.state === "noDecks" || status.state === "over") {
    return <GoalNotice status={status} goalId={goalId} />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1">
        {view === "timeline" ? (
          <GoalTimeline status={status} />
        ) : (
          <GoalSunburst status={status} interactive={interactive} />
        )}
      </div>
      <GoalFooter status={status} />
    </div>
  );
}

/**
 * Celebrates once when the day's goal is met. Python is told right away, so a second widget or
 * the next visit does not celebrate the same day again.
 */
export function useCelebration(goalId: string, status: ExamStatus | undefined) {
  const { acknowledge } = useGoalActions();
  const [showing, setShowing] = useState<{ streak: number; milestone: number | null } | null>(null);
  const celebrate = status?.celebrate ?? false;
  const streak = status?.streak.current ?? 0;
  const milestone = status?.streak.milestone ?? null;
  const { mutate } = acknowledge;
  useEffect(() => {
    if (celebrate) {
      setShowing({ streak, milestone });
      mutate(goalId);
    }
  }, [celebrate, goalId, milestone, mutate, streak]);
  const done = useCallback(() => setShowing(null), []);
  return showing ? (
    <Celebration streak={showing.streak} milestone={showing.milestone} onDone={done} />
  ) : null;
}

/** A goal on the dashboard, as `goal:<id>:ring` or `goal:<id>:timeline`. */
export function GoalWidgetView({ goalId, view }: { goalId: string; view: GoalView }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const goals = useGoals();
  const status = useGoalStatus(goalId);
  const celebration = useCelebration(goalId, status.data);
  const context = useContextMenu(t("goals.widget.menu"), [
    {
      label: t("goals.widget.openInGoals"),
      icon: <GoalsIcon size={14} />,
      onSelect: () => void navigate(`/goals/${goalId}`),
    },
  ]);
  const goal = goals.data?.find((item) => item.id === goalId);
  if (goals.data && !goal) {
    return (
      <WidgetCard title={t("goals.title")}>
        <div className="grid h-full place-items-center text-[13px] text-muted">
          {t("goals.widget.gone")}
        </div>
      </WidgetCard>
    );
  }
  const exam = goal?.config.examDate;
  const warnings = status.data?.warnings.length ?? 0;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a right click offers what the goal page does.
    <div
      className="relative h-full"
      data-goal-widget={goalId}
      onContextMenu={context.onContextMenu}
    >
      <WidgetCard
        title={goal?.name ?? t("goals.title")}
        note={exam ? t("goals.widget.examOn", { date: shortDate(exam, i18n.language) }) : undefined}
        actions={
          warnings > 0 ? (
            <Link
              to={`/goals/${goalId}`}
              aria-label={t("goals.widget.warnings", { count: warnings })}
              title={t("goals.widget.warnings", { count: warnings })}
              className="grid size-7 shrink-0 place-items-center rounded-control text-warning hover:bg-hover"
            >
              <TriangleAlert size={15} />
            </Link>
          ) : null
        }
      >
        <WidgetState status={status} empty={false}>
          {status.data ? <GoalBody status={status.data} goalId={goalId} view={view} /> : null}
        </WidgetState>
      </WidgetCard>
      {celebration}
      {context.menu}
    </div>
  );
}
