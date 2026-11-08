import { type ExamConfig, type GoalDraft, type GoalView, goalDraft } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useStatistic } from "../../lib/calls.ts";
import { useUnsavedGuard } from "../../lib/useUnsavedGuard.tsx";
import { deckLabel } from "../dashboard/deckTree.ts";
import { addWidget, rulesOfWidgets } from "../dashboard/grid/engine.ts";
import { useLayout } from "../dashboard/useLayout.ts";
import { WidgetCard, WidgetState } from "../dashboard/WidgetCard.tsx";
import { useGoalCrumbs } from "./crumbs.tsx";
import { goalWidgetType, sameDraft } from "./goalLogic.ts";
import { GOAL_KINDS, isGoalKind } from "./kinds.tsx";
import { DeckMultiPicker } from "./parts/DeckMultiPicker.tsx";
import { ExamDatePicker } from "./parts/ExamDatePicker.tsx";
import { useGoalActions, useGoalDecks, useGoalPreview, useGoals } from "./useGoals.ts";
import { GoalBody } from "./widget/GoalWidget.tsx";

const INPUT =
  "h-10 w-full rounded-control border border-line bg-control px-3 text-[13px] text-text outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card p-5 shadow-card">
      <h2 className="m-0 text-[13px] font-bold">{title}</h2>
      {note ? <p className="m-0 mt-0.5 text-xs text-muted">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A choice of one in a row of cards. A disabled one says it comes soon. */
function Choice({
  checked,
  disabled = false,
  title,
  note,
  badge,
  onSelect,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  note: string;
  badge?: string;
  onSelect: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the whole card is the choice.
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={`flex cursor-pointer flex-col items-start gap-1 rounded-control border px-3 py-2.5 text-left disabled:cursor-default disabled:opacity-55 ${
        checked ? "border-accent bg-selected" : "border-line bg-control hover:bg-hover"
      }`}
    >
      <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-[8rem] flex-1 text-[13px] font-semibold text-text">{title}</span>
        {badge ? (
          <span className="shrink-0 rounded-full bg-success-surface px-2 py-0.5 text-[10px] font-semibold text-success">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-[11px] text-muted">{note}</span>
    </button>
  );
}

function SetupForm({
  initial,
  today,
  editing,
  suggestion,
}: {
  initial: GoalDraft;
  today: string;
  editing: boolean;
  /** The assistant's suggestion this form starts from. Saving here is what accepts it. */
  suggestion?: string;
}) {
  const { t } = useTranslation();
  const crumbs = useGoalCrumbs();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial);
  const [view, setView] = useState<GoalView>("ring");
  const decks = useGoalDecks();
  const preview = useGoalPreview(draft);
  const { save } = useGoalActions();
  const { layout, save: saveLayout } = useLayout();
  const config = draft.config as ExamConfig;
  const client = useQueryClient();
  const dirty = !sameDraft(draft, initial);

  async function store() {
    try {
      const saved = await save.mutateAsync(draft);
      if (suggestion) {
        await bridge.call("ai.applyProposal", { id: suggestion, goal: saved });
        void client.invalidateQueries({ queryKey: ["ai.conversation"] });
      }
      return saved;
    } catch {
      return null;
    }
  }

  const guard = useUnsavedGuard({ dirty, save: async () => (await store()) !== null });

  async function finish(toDashboard: boolean) {
    const goal = await store();
    if (!goal) {
      return;
    }
    guard.allowLeaving();
    if (toDashboard && layout) {
      const type = goalWidgetType(goal.id, view);
      if (!layout.widgets.some((widget) => widget.type === type)) {
        await saveLayout.mutateAsync(addWidget(layout, type, rulesOfWidgets()));
      }
      void navigate("/");
    } else {
      void navigate("/goals");
    }
  }

  function change(patch: Partial<ExamConfig>) {
    setDraft({ ...draft, config: { ...config, ...patch } });
  }

  const names = new Map((decks.data ?? []).map((deck) => [deck.id, deck.name]));
  const chosen = config.decks.map((deck) => deck.id);
  const firstName = config.decks[0]
    ? deckLabel(names.get(config.decks[0].id) ?? config.decks[0].name)
    : "";
  const covered = (decks.data ?? []).filter((deck) =>
    config.decks.some(
      (root) => deck.id === root.id || deck.name.startsWith(`${names.get(root.id) ?? root.name}::`),
    ),
  );
  const cards = covered.reduce((sum, deck) => sum + deck.cards, 0);
  const open = covered.reduce((sum, deck) => sum + deck.open, 0);
  const error = save.error ?? (draft.config.decks.length > 0 ? preview.error : null);

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t(editing ? "goals.setup.editTitle" : "goals.setup.newTitle")}
        trail={
          editing && initial.id
            ? [crumbs.goals, crumbs.goal(initial.id, initial.name)]
            : [crumbs.goals, crumbs.newGoal]
        }
      >
        <Button onClick={() => guard.leave(() => void navigate("/goals"))}>
          {t("goals.setup.cancel")}
        </Button>
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 px-4 pb-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {suggestion ? (
            <p
              role="note"
              data-suggested-goal
              className="m-0 flex items-start gap-2 rounded-card border border-accent/40 bg-selected px-4 py-3 text-[13px] text-text"
            >
              <Sparkles size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
              {t("goals.setup.suggested")}
            </p>
          ) : null}
          <Section title={t("goals.setup.name")}>
            <input
              value={draft.name}
              maxLength={80}
              aria-label={t("goals.setup.name")}
              placeholder={firstName || t("goals.setup.namePlaceholder")}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={INPUT}
            />
          </Section>
          <Section title={t("goals.setup.decks")} note={t("goals.setup.decksNote")}>
            <DeckMultiPicker
              decks={decks.data ?? []}
              value={chosen}
              onChange={(ids) =>
                change({
                  decks: ids.map((id) => ({ id, name: names.get(id) ?? "" })),
                })
              }
            />
            {chosen.length > 0 ? (
              <p className="m-0 mt-2 text-xs text-muted">
                {t("goals.setup.deckCounts", { cards, open })}
              </p>
            ) : null}
          </Section>
          <Section title={t("goals.setup.exam")} note={t("goals.setup.examNote")}>
            <ExamDatePicker value={config} today={today} onChange={(dates) => change(dates)} />
          </Section>
          <Section title={t("goals.setup.mode")}>
            <div
              role="radiogroup"
              aria-label={t("goals.setup.mode")}
              className="grid gap-2 sm:grid-cols-2"
            >
              <Choice
                checked={config.mode === "learned"}
                title={t("goals.setup.modes.learned.title")}
                note={t("goals.setup.modes.learned.note")}
                onSelect={() => change({ mode: "learned" })}
              />
              <Choice
                checked={config.mode === "reviewed"}
                title={t("goals.setup.modes.reviewed.title")}
                note={t("goals.setup.modes.reviewed.note")}
                onSelect={() => change({ mode: "reviewed" })}
              />
            </div>
          </Section>
          <Section title={t("goals.setup.counts")}>
            <div
              role="radiogroup"
              aria-label={t("goals.setup.counts")}
              className="grid gap-2 sm:grid-cols-2"
            >
              <Choice
                checked={config.counts === "newAndDue"}
                title={t("goals.setup.countsOptions.newAndDue.title")}
                note={t("goals.setup.countsOptions.newAndDue.note")}
                badge={t("goals.setup.recommended")}
                onSelect={() => change({ counts: "newAndDue" })}
              />
              <Choice
                checked={config.counts === "newOnly"}
                title={t("goals.setup.countsOptions.newOnly.title")}
                note={t("goals.setup.countsOptions.newOnly.note")}
                onSelect={() => change({ counts: "newOnly" })}
              />
            </div>
          </Section>
          <Section title={t("goals.setup.view")} note={t("goals.setup.viewNote")}>
            <div
              role="radiogroup"
              aria-label={t("goals.setup.view")}
              className="grid gap-2 sm:grid-cols-2"
            >
              <Choice
                checked={view === "ring"}
                title={t("goals.setup.views.ring.title")}
                note={t("goals.setup.views.ring.note")}
                onSelect={() => setView("ring")}
              />
              <Choice
                checked={view === "timeline"}
                title={t("goals.setup.views.timeline.title")}
                note={t("goals.setup.views.timeline.note")}
                onSelect={() => setView("timeline")}
              />
            </div>
          </Section>
          {error ? (
            <p role="alert" className="m-0 text-xs text-danger">
              {error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={save.isPending || chosen.length === 0}
              onClick={() => void finish(false)}
            >
              {t("goals.setup.save")}
            </Button>
            <Button
              primary
              disabled={save.isPending || chosen.length === 0}
              onClick={() => void finish(true)}
            >
              {t("goals.setup.saveAndAdd")}
            </Button>
          </div>
        </div>
        <aside className="self-start lg:sticky lg:top-[96px]" aria-label={t("goals.setup.preview")}>
          <h2 className="m-0 mb-2 text-[13px] font-bold text-muted">{t("goals.setup.preview")}</h2>
          <div className="h-[360px]">
            <WidgetCard title={draft.name || firstName || t("goals.title")}>
              {chosen.length === 0 ? (
                <div className="grid h-full place-items-center text-center text-[13px] text-muted">
                  {t("goals.setup.previewEmpty")}
                </div>
              ) : (
                <WidgetState status={preview} empty={false}>
                  {preview.data ? (
                    <GoalBody status={preview.data} goalId={draft.id ?? ""} view={view} />
                  ) : null}
                </WidgetState>
              )}
            </WidgetCard>
          </div>
        </aside>
      </div>
      {guard.dialog}
    </div>
  );
}

/** The assistant's suggestion, if the address names one that still waits. */
function useSuggestion(): { id: string; goal: GoalDraft } | null | undefined {
  const [search] = useSearchParams();
  const wanted = search.get("proposal");
  const conversation = useQuery({
    queryKey: ["ai.conversation"],
    queryFn: () => bridge.call("ai.conversation", {}),
    enabled: wanted !== null,
  });
  if (wanted === null) {
    return null;
  }
  if (!conversation.data) {
    return undefined;
  }
  const proposal = conversation.data.proposals.find((item) => item.id === wanted);
  // A model wrote this, so it is used only if it really is a goal.
  const checked = goalDraft.safeParse(proposal?.goal);
  return proposal?.status === "pending" && checked.success
    ? { id: wanted, goal: checked.data }
    : null;
}

/** Sets up a new goal of one kind, or changes an existing one. */
export function GoalSetupPage() {
  const { t } = useTranslation();
  const { kind, id } = useParams();
  const goals = useGoals();
  const today = useStatistic("statistics.today", {});
  const suggestion = useSuggestion();
  const [search] = useSearchParams();
  const copyOf = search.get("copy");
  if (goals.isPending || today.isPending || !today.data || suggestion === undefined) {
    return (
      <div className="flex flex-col">
        <PageHeader title={t("goals.title")} />
        <div className="px-4">
          <div className="h-40 animate-pulse rounded-card bg-hover" />
        </div>
      </div>
    );
  }
  const existing = id ? goals.data?.find((goal) => goal.id === id) : undefined;
  if (id && !existing) {
    return <Navigate to="/goals" replace />;
  }
  const goalKind = existing?.config.kind ?? kind;
  if (!isGoalKind(goalKind)) {
    return <Navigate to="/goals/new" replace />;
  }
  const source = !existing && copyOf ? goals.data?.find((goal) => goal.id === copyOf) : undefined;
  const fresh = GOAL_KINDS[goalKind].newConfig(today.data.date);
  const initial: GoalDraft = suggestion
    ? { ...suggestion.goal, id: existing?.id ?? null, archived: existing?.archived ?? false }
    : source
      ? {
          id: null,
          name: t("goals.copyName", { name: source.name }).slice(0, 80),
          archived: false,
          // A copy of a finished goal needs a new exam day, everything else stays.
          config:
            source.config.examDate > today.data.date
              ? source.config
              : { ...source.config, examDate: fresh.examDate },
        }
      : existing
        ? {
            id: existing.id,
            name: existing.name,
            archived: existing.archived,
            config: existing.config,
          }
        : {
            id: null,
            name: "",
            archived: false,
            config: fresh,
          };
  return (
    <SetupForm
      key={suggestion?.id ?? existing?.id ?? (source ? `copy-${source.id}` : "new")}
      initial={initial}
      today={today.data.date}
      editing={!!existing}
      {...(suggestion ? { suggestion: suggestion.id } : {})}
    />
  );
}
