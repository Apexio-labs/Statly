import { type ExamStatus, type GoalView, streakMilestones } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Award, Check, Pencil, Target, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { Button } from "../../components/Button.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { fullDate, shortDate } from "../../lib/format.ts";
import { addWidget, rulesOfWidgets } from "../dashboard/grid/engine.ts";
import { useLayout } from "../dashboard/useLayout.ts";
import { useGoalCrumbs } from "./crumbs.tsx";
import { studyTime, studyTimeRange } from "./examText.ts";
import { goalWidgetType } from "./goalLogic.ts";
import { GoalSunburst } from "./parts/GoalSunburst.tsx";
import { GoalTimeline } from "./parts/GoalTimeline.tsx";
import { StreakFlame } from "./parts/StreakFlame.tsx";
import { useGoalActions, useGoalStatus, useGoals } from "./useGoals.ts";
import { GoalFooter, GoalNotice, useCelebration } from "./widget/GoalWidget.tsx";

const RESULT_CLASS: Record<ExamStatus["history"][number]["result"], string> = {
  met: "bg-success",
  missed: "bg-danger opacity-80",
  rest: "bg-line",
  pending: "bg-hover outline-2 outline-accent outline-solid",
};

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-card border border-line bg-card p-5 shadow-card ${className}`}
    >
      <h2 className="m-0 mb-3 text-[13px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="m-0 text-right text-[13px] font-semibold">{value}</dd>
    </div>
  );
}

function Warning({
  warning,
  onOptions,
}: {
  warning: ExamStatus["warnings"][number];
  onOptions: (deckId: number) => void;
}) {
  const { t } = useTranslation();
  const text =
    warning.kind === "deckMissing"
      ? t("goals.warnings.deckMissing", { name: warning.name.replaceAll("::", " › ") })
      : warning.kind === "suspended"
        ? t("goals.warnings.suspended", { count: warning.cards })
        : warning.kind === "lateCards"
          ? t("goals.warnings.lateCards", { count: warning.cards })
          : warning.kind === "noTimeToReview"
            ? t("goals.warnings.noTimeToReview", { count: warning.days })
            : t("goals.warnings.newLimit", {
                name: warning.name.replaceAll("::", " › "),
                limit: warning.limit,
                target: warning.target,
              });
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <TriangleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">{text}</span>
      {warning.kind === "newLimit" ? (
        <button
          type="button"
          onClick={() => onOptions(warning.deckId)}
          className="shrink-0 cursor-pointer rounded-control border border-line bg-control px-2 py-0.5 text-xs font-semibold text-text hover:bg-hover"
        >
          {t("goals.limits.options")}
        </button>
      ) : null}
    </li>
  );
}

/** "Raise for today": Python works out the numbers and asks in Statly's own popup first. */
function RaiseLimits({ goalId }: { goalId: string }) {
  const { t } = useTranslation();
  const { raiseLimit } = useGoalActions();
  const reason = raiseLimit.data && !raiseLimit.data.applied ? raiseLimit.data.reason : null;
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button primary disabled={raiseLimit.isPending} onClick={() => raiseLimit.mutate(goalId)}>
          {t("goals.limits.raise")}
        </Button>
        <p className="m-0 min-w-0 flex-1 text-xs text-muted">{t("goals.limits.raiseNote")}</p>
      </div>
      {reason === "postponed" || reason === "notNeeded" ? (
        <p role="status" className="m-0 text-xs text-muted">
          {t(`goals.limits.${reason}`)}
        </p>
      ) : null}
      {raiseLimit.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {raiseLimit.error.message}
        </p>
      ) : null}
    </div>
  );
}

function depthOf(status: ExamStatus, deckId: number): number {
  let depth = 0;
  let parent = status.decks.find((deck) => deck.deckId === deckId)?.parentId ?? null;
  while (parent !== null) {
    depth += 1;
    const above = parent;
    parent = status.decks.find((deck) => deck.deckId === above)?.parentId ?? null;
  }
  return depth;
}

/** Each deck in tree order, so subdecks follow their parent. */
function inTreeOrder(status: ExamStatus): ExamStatus["decks"] {
  const ordered: ExamStatus["decks"] = [];
  const visit = (parent: number | null) => {
    for (const deck of status.decks.filter((item) => item.parentId === parent)) {
      ordered.push(deck);
      visit(deck.deckId);
    }
  };
  visit(null);
  return ordered;
}

function Details({ status, goalId }: { status: ExamStatus; goalId: string }) {
  const { t, i18n } = useTranslation();
  const celebration = useCelebration(goalId, status);
  const { openDeckOptions } = useGoalActions();
  const [deckHover, setDeckHover] = useState<number | null>(null);
  const quiet = status.state === "noDecks" || status.state === "over";
  return (
    <div className="grid grid-cols-1 gap-4 px-4 pb-6 xl:grid-cols-2">
      <Card title={t("goals.detail.today")} className="relative h-[400px]">
        {quiet ? (
          <GoalNotice status={status} goalId={goalId} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="min-h-0 flex-1">
              <GoalSunburst status={status} highlight={deckHover} onHighlight={setDeckHover} />
            </div>
            <GoalFooter status={status} />
          </div>
        )}
        {celebration}
      </Card>
      <Card title={t("goals.detail.way")} className="h-[400px]">
        {quiet ? <GoalNotice status={status} goalId={goalId} /> : <GoalTimeline status={status} />}
      </Card>
      <Card title={t("goals.detail.numbers")}>
        <dl className="m-0">
          <Fact
            label={t("goals.detail.newCards")}
            value={`${status.newCards.done} / ${status.newCards.target}`}
          />
          <Fact
            label={t(
              status.reviews.counted
                ? "goals.detail.reviewsCounted"
                : "goals.detail.reviewsNotCounted",
            )}
            value={`${status.reviews.done} / ${status.reviews.target}`}
          />
          <Fact label={t("goals.detail.inProgress")} value={status.totals.inProgress} />
          {status.time ? (
            <>
              <Fact label={t("goals.detail.timeDay")} value={studyTimeRange(status.time.day, t)} />
              <Fact
                label={t("goals.detail.timeLeft")}
                value={studyTimeRange(status.time.left, t)}
              />
              <Fact
                label={t("goals.detail.timeSplit")}
                value={t("goals.detail.timeSplitValue", {
                  newCards: status.newCards.target,
                  newTime: studyTime(status.time.newCards.seconds, t),
                  reviews: status.reviews.target,
                  reviewTime: studyTime(status.time.reviews.seconds, t),
                })}
              />
            </>
          ) : null}
          <Fact label={t("goals.detail.ifMet")} value={status.tomorrow.ifMet} />
          <Fact label={t("goals.detail.ifStopped")} value={status.tomorrow.ifStopped} />
          <Fact
            label={t("goals.detail.learned")}
            value={`${status.totals.learned} / ${status.totals.cards}`}
          />
          {status.totals.finished !== null ? (
            <Fact
              label={t("goals.detail.finished")}
              value={`${status.totals.finished} / ${status.totals.cards}`}
            />
          ) : null}
          {status.totals.waiting !== null ? (
            <Fact label={t("goals.detail.waiting")} value={status.totals.waiting} />
          ) : null}
          <Fact
            label={t("goals.detail.deadline")}
            value={fullDate(status.learnBy ?? status.deadline, i18n.language)}
          />
          {status.learnBy ? (
            <Fact
              label={t("goals.detail.reviewUntil")}
              value={t("goals.detail.reviewUntilValue", {
                date: fullDate(status.deadline, i18n.language),
                count: status.firstGapDays ?? 1,
              })}
            />
          ) : null}
          <Fact label={t("goals.detail.exam")} value={fullDate(status.examDate, i18n.language)} />
          <Fact label={t("goals.detail.daysLeft")} value={status.studyDaysLeft} />
        </dl>
        {status.time ? (
          <p className="m-0 mt-3 text-[11px] text-muted">{t("goals.detail.timeNote")}</p>
        ) : null}
      </Card>
      <Card title={t("goals.detail.decks")}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="pb-2 pl-2 font-semibold">{t("goals.detail.deck")}</th>
              <th className="pb-2 text-right font-semibold">{t("goals.detail.todayColumn")}</th>
              <th className="pb-2 text-right font-semibold">{t("goals.detail.learningColumn")}</th>
              <th className="pb-2 pr-2 text-right font-semibold">{t("goals.detail.openColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {inTreeOrder(status).map((deck) => (
              <tr
                key={deck.deckId}
                data-deck-row={deck.deckId}
                data-lit={deckHover === deck.deckId || undefined}
                onPointerEnter={() => setDeckHover(deck.deckId)}
                onPointerLeave={() => setDeckHover(null)}
                className="border-t border-line transition-colors duration-150 hover:bg-hover data-lit:bg-hover"
              >
                <td
                  className="py-1.5"
                  style={{ paddingLeft: 8 + depthOf(status, deck.deckId) * 16 }}
                >
                  {deck.name.split("::").at(-1)}
                </td>
                <td className="py-1.5 text-right font-semibold">
                  {deck.done} / {deck.target}
                </td>
                <td className="py-1.5 text-right text-muted">{deck.inProgress}</td>
                <td className="py-1.5 pr-2 text-right text-muted">{deck.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title={t("goals.detail.streak")}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <StreakFlame streak={status.streak} />
          <span className="text-xs text-muted">
            {t("goals.detail.best", { count: status.streak.best })}
          </span>
        </div>
        <h3 className="m-0 mt-4 mb-2 text-[11px] font-semibold text-muted">
          {t("goals.detail.badges")}
        </h3>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {streakMilestones.map((days) => {
            const earned = status.streak.best >= days;
            return (
              <li
                key={days}
                data-badge={days}
                data-earned={earned}
                className={`statly-badge flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  earned
                    ? "border-transparent bg-success-surface text-success"
                    : "border-line text-muted opacity-60"
                }`}
              >
                {earned ? <Award size={13} aria-hidden="true" /> : null}
                {t("goals.detail.badge", { count: days })}
              </li>
            );
          })}
        </ul>
        <h3 className="m-0 mt-4 mb-2 text-[11px] font-semibold text-muted">
          {t("goals.detail.calendar")}
        </h3>
        <ol
          className="m-0 flex list-none flex-wrap gap-1 p-0"
          aria-label={t("goals.detail.calendar")}
        >
          {status.history.slice(-56).map((day) => (
            <li
              key={day.date}
              data-result={day.result}
              title={`${shortDate(day.date, i18n.language)}: ${day.done} / ${day.target}`}
              className={`statly-history-day size-3.5 rounded-[3px] ${RESULT_CLASS[day.result]}`}
            />
          ))}
        </ol>
      </Card>
      <Card title={t("goals.detail.notices")}>
        {status.warnings.length === 0 ? (
          <p className="m-0 flex items-center gap-1.5 text-[13px] text-muted">
            <Check size={15} aria-hidden="true" className="text-success" />
            {t("goals.detail.noNotices")}
          </p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {status.warnings.map((warning) => (
                <Warning
                  key={JSON.stringify(warning)}
                  warning={warning}
                  onOptions={(deckId) => openDeckOptions.mutate(deckId)}
                />
              ))}
            </ul>
            {status.warnings.some((warning) => warning.kind === "newLimit") ? (
              <RaiseLimits goalId={goalId} />
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}

/** One goal in full: today's rings, the way to the exam, the numbers, decks and the streak. */
export function GoalDetailPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const goals = useGoals();
  const status = useGoalStatus(id);
  const { layout, save } = useLayout();
  const crumbs = useGoalCrumbs();
  const goal = goals.data?.find((item) => item.id === id);
  if (goals.data && !goal) {
    return <Navigate to="/goals" replace />;
  }

  function placed(view: GoalView) {
    return layout?.widgets.some((widget) => widget.type === goalWidgetType(id, view)) ?? false;
  }

  function add(view: GoalView) {
    if (layout) {
      save.mutate(addWidget(layout, goalWidgetType(id, view), rulesOfWidgets()));
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title={goal?.name ?? t("goals.title")}
        icon={<Target size={14} />}
        trail={[crumbs.goals]}
      >
        {(["ring", "timeline"] as const).map((view) => (
          <Button
            key={view}
            className="h-9"
            disabled={!layout || placed(view)}
            onClick={() => add(view)}
          >
            {placed(view) ? <Check size={14} aria-hidden="true" /> : null}
            {t(placed(view) ? `goals.detail.placed.${view}` : `goals.detail.add.${view}`)}
          </Button>
        ))}
        <Link
          to={`/goals/${id}/edit`}
          className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line bg-control px-3 text-[13px] font-semibold text-text no-underline hover:bg-hover"
        >
          <Pencil size={14} aria-hidden="true" />
          {t("goals.actions.edit")}
        </Link>
      </PageHeader>
      {status.data ? (
        <Details status={status.data} goalId={id} />
      ) : (
        <div className="px-4">
          <div className="h-[400px] animate-pulse rounded-card bg-hover" />
        </div>
      )}
    </div>
  );
}
