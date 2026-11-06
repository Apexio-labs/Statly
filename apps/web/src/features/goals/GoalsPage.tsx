import type { Goal } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import {
  Archive,
  ArchiveRestore,
  Check,
  Flame,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { AddIcon } from "../../components/icons.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { shortDate } from "../../lib/format.ts";
import { spotlight } from "../../lib/spotlight.ts";
import { addWidget, rulesOfWidgets } from "../dashboard/grid/engine.ts";
import { useLayout } from "../dashboard/useLayout.ts";
import { usePermissions } from "../privacy/usePrivacy.ts";
import { useGoalCrumbs } from "./crumbs.tsx";
import { GoalGallery } from "./GoalGallery.tsx";
import { goalWidgetType, progressOf, TONE_COLORS } from "./goalLogic.ts";
import { ProgressRing } from "./parts/ProgressRing.tsx";
import { useGoalActions, useGoalStatus, useGoals } from "./useGoals.ts";

const ACTION =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-control px-2.5 text-xs font-semibold text-text no-underline hover:bg-hover";

function GoalCard({ goal, onDelete }: { goal: Goal; onDelete: () => void }) {
  const { t, i18n } = useTranslation();
  const status = useGoalStatus(goal.id);
  const { archive } = useGoalActions();
  const { layout, save } = useLayout();
  const placed = layout?.widgets.some((widget) => widget.type.startsWith(`goal:${goal.id}:`));
  const data = status.data;
  return (
    <article
      data-goal={goal.id}
      className="statly-lift flex gap-4 rounded-card border border-line bg-card p-4 shadow-card"
    >
      <div className="size-[92px] shrink-0">
        {data ? (
          <ProgressRing
            progress={progressOf(data)}
            color={TONE_COLORS[data.tone]}
            label={t("goals.widget.ringLabel", { done: data.done, target: data.target })}
          >
            <span className="text-[13px] font-bold">
              {data.target > 0 ? `${data.done}/${data.target}` : "–"}
            </span>
          </ProgressRing>
        ) : (
          <div className="size-full animate-pulse rounded-full bg-hover" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <h3 className="m-0 truncate text-[15px] font-bold">
            <Link
              to={`/goals/${goal.id}`}
              className="text-text no-underline hover:text-accent-strong"
            >
              {goal.name}
            </Link>
          </h3>
          <p className="m-0 mt-0.5 text-xs text-muted">
            {t("goals.widget.examOn", { date: shortDate(goal.config.examDate, i18n.language) })}
            {data ? ` · ${t("goals.widget.daysLeft", { count: data.studyDaysLeft })}` : ""}
          </p>
          {data && data.streak.current > 0 ? (
            <p className="m-0 mt-1 flex items-center gap-1 text-xs font-semibold">
              <Flame size={12} aria-hidden="true" className="text-warning" />
              {t("goals.widget.streak", { count: data.streak.current })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {placed ? (
            <span className="inline-flex h-8 items-center gap-1.5 px-1 text-xs font-semibold text-success">
              <Check size={14} aria-hidden="true" />
              {t("goals.actions.onDashboard")}
            </span>
          ) : (
            <Button
              primary
              className="h-8 text-xs"
              disabled={!layout || goal.archived}
              onClick={() =>
                layout &&
                save.mutate(addWidget(layout, goalWidgetType(goal.id, "ring"), rulesOfWidgets()))
              }
            >
              <Plus size={14} aria-hidden="true" />
              {t("goals.actions.addToDashboard")}
            </Button>
          )}
          <Link to={`/goals/${goal.id}/edit`} className={ACTION}>
            <Pencil size={13} aria-hidden="true" />
            {t("goals.actions.edit")}
          </Link>
          <button type="button" className={ACTION} onClick={() => archive.mutate(goal)}>
            {goal.archived ? (
              <ArchiveRestore size={13} aria-hidden="true" />
            ) : (
              <Archive size={13} aria-hidden="true" />
            )}
            {t(goal.archived ? "goals.actions.restore" : "goals.actions.archive")}
          </button>
          <button type="button" className={`${ACTION} text-danger`} onClick={onDelete}>
            <Trash2 size={13} aria-hidden="true" />
            {t("goals.actions.delete")}
          </button>
        </div>
      </div>
    </article>
  );
}

export function GoalsPage() {
  const { t } = useTranslation();
  const goals = useGoals();
  const { remove } = useGoalActions();
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const all = goals.data ?? [];
  const active = all.filter((goal) => !goal.archived);
  const archived = all.filter((goal) => goal.archived);

  return (
    <div className="flex flex-col">
      <PageHeader title={t("goals.title")}>
        {all.length > 0 ? (
          <Link to="/goals/new" className={`${ACTION} h-9 text-[13px]`}>
            <Plus size={15} aria-hidden="true" />
            {t("goals.new")}
          </Link>
        ) : null}
      </PageHeader>
      <div className="flex flex-col gap-6 px-4 pb-6">
        {all.length > 0 ? <SyncLine /> : null}
        {goals.isPending ? (
          <div className="h-32 animate-pulse rounded-card bg-hover" />
        ) : all.length === 0 ? (
          <>
            <p className="m-0 max-w-[620px] text-[13px] text-muted">{t("goals.empty")}</p>
            <GoalGallery />
          </>
        ) : (
          <>
            <section className="grid grid-cols-[repeat(auto-fill,minmax(440px,1fr))] gap-3">
              {active.map((goal) => (
                <GoalCard key={goal.id} goal={goal} onDelete={() => setDeleting(goal)} />
              ))}
            </section>
            {archived.length > 0 ? (
              <section className="flex flex-col gap-3">
                <button
                  type="button"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived(!showArchived)}
                  className="w-fit cursor-pointer border-0 bg-transparent p-0 text-[13px] font-bold text-muted"
                >
                  {t("goals.archived", { count: archived.length })}
                </button>
                {showArchived ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(440px,1fr))] gap-3">
                    {archived.map((goal) => (
                      <GoalCard key={goal.id} goal={goal} onDelete={() => setDeleting(goal)} />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
      {deleting ? (
        <ConfirmDialog
          title={t("goals.deleteConfirm.title")}
          body={t("goals.deleteConfirm.body")}
          confirm={t("goals.deleteConfirm.confirm")}
          onConfirm={() => {
            remove.mutate(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

/** Whether goals reach the other computers, with the way to the switch. */
function SyncLine() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { list } = usePermissions();
  const sync = list.data?.find((state) => state.id === "goals.sync");
  if (!sync) {
    return null;
  }
  return (
    <p data-goal-sync className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-muted">
      <RefreshCw size={13} aria-hidden="true" />
      {t(sync.granted ? "goals.sync.on" : "goals.sync.off")}
      <button
        type="button"
        onClick={() => {
          void navigate("/settings/privacy");
          spotlight("permission-goals.sync");
        }}
        className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-accent-strong underline-offset-2 hover:underline"
      >
        {t(sync.granted ? "goals.sync.change" : "goals.sync.switchOn")}
      </button>
    </p>
  );
}

/** "New goal": the kinds of goals to choose from. */
export function NewGoalPage() {
  const { t } = useTranslation();
  const crumbs = useGoalCrumbs();
  return (
    <div className="flex flex-col">
      <PageHeader title={t("goals.new")} icon={<AddIcon size={14} />} trail={[crumbs.goals]} />
      <div className="flex flex-col gap-6 px-4 pb-6">
        <GoalGallery />
      </div>
    </div>
  );
}
