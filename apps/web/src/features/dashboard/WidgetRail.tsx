import {
  type CustomWidget,
  customWidgetPrefix,
  type DashboardLayout,
  type Goal,
  widgetGroups,
} from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Check, ChevronDown, RotateCcw, Target } from "lucide-react";
import { type DragEvent, type ReactNode, useState } from "react";
import { Link } from "react-router";
import { bridge } from "../../bridge/index.ts";
import { AddIcon } from "../../components/icons.tsx";
import { useAppearance } from "../../lib/appearance.tsx";
import { goalWidgetType } from "../goals/goalLogic.ts";
import { createDashboardFile, readDashboardFile } from "./dashboardFile.ts";

const CONFIRM_MS = 1200;

type Props = {
  layout: DashboardLayout;
  customWidgets: CustomWidget[];
  goals: Goal[];
  onAdd: (type: string) => void;
  onImport: (layout: DashboardLayout) => void;
  onReset: () => void;
};

/** A group that folds up under its title. Closed, its content is out of reach for the keyboard. */
function Fold({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="statly-rail-fold mb-1">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex h-9 w-full cursor-pointer items-center gap-1.5 rounded-control border-0 bg-transparent px-1 text-left text-[13px] font-bold text-nav-text hover:bg-nav-hover"
        >
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={`shrink-0 text-nav-muted transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {count === undefined ? null : (
            <span className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold text-nav-muted">
              {count}
            </span>
          )}
        </button>
      </h3>
      <div className="statly-fold" data-open={open || undefined} inert={!open}>
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  );
}

export function WidgetRail({ layout, customWidgets, goals, onAdd, onImport, onReset }: Props) {
  const { t } = useTranslation();
  const { settings } = useAppearance();
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; failed: boolean } | null>(null);
  const [dropping, setDropping] = useState(false);

  function toggle(group: string) {
    const next = new Set(opened);
    if (!next.delete(group)) {
      next.add(group);
    }
    setOpened(next);
  }

  function add(type: string) {
    onAdd(type);
    setAdded(type);
    setTimeout(() => setAdded((current) => (current === type ? null : current)), CONFIRM_MS);
  }

  function importText(text: string) {
    const imported = readDashboardFile(text);
    if (imported) {
      onImport(imported);
      setFeedback({ text: t("dashboard.imported"), failed: false });
    } else {
      setFeedback({ text: t("dashboard.importFailed"), failed: true });
    }
  }

  async function chooseFile() {
    const { content } = await bridge.call("system.openFile", {});
    if (content !== null) {
      importText(content);
    }
  }

  async function dropFile(file: File | undefined) {
    if (file) {
      importText(await file.text());
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropping(false);
    void dropFile(event.dataTransfer.files[0]);
  }

  async function exportFile() {
    const { saved } = await bridge.call("system.saveFile", {
      name: "statly-dashboard.json",
      content: createDashboardFile(layout),
    });
    if (saved) {
      setFeedback({ text: t("dashboard.exported"), failed: false });
    }
  }

  const needle = search.trim().toLowerCase();
  const searching = needle !== "";
  const builtin = Object.entries(widgetGroups).map(([group, types]) => ({
    group,
    items: types.map((type) => ({ type: type as string, title: t(`widgets.${type}.title`) })),
  }));
  const custom = customWidgets.map((widget) => ({
    type: `${customWidgetPrefix}${widget.id}`,
    title: widget.name,
  }));
  const goalItems = goals
    .filter((goal) => !goal.archived)
    .map((goal) => ({ type: goalWidgetType(goal.id, "ring"), title: goal.name }));
  const everything = [...builtin.flatMap(({ items }) => items), ...custom, ...goalItems];
  const favorites = settings.favoriteWidgets.flatMap((key) =>
    everything.filter((item) => item.type === key),
  );
  const groups = [
    { group: "favorites", items: favorites },
    { group: "goals", items: goalItems },
    ...builtin,
    { group: "custom", items: custom },
  ]
    .map(({ group, items }) => ({
      group,
      items: items.filter((item) => item.title.toLowerCase().includes(needle)),
    }))
    .filter(({ items }) => items.length > 0);

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <h2 className="m-0 text-[15px] font-bold text-nav-text">{t("dashboard.widgets")}</h2>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("dashboard.searchWidgets")}
        aria-label={t("dashboard.searchWidgets")}
        className="h-9 w-full rounded-control border border-nav-text/20 bg-nav-hover/60 px-3 text-[13px] text-nav-text outline-none placeholder:text-nav-muted focus-visible:ring-2 focus-visible:ring-accent/50"
      />
      <div className="statly-scroll min-h-0 flex-1 overflow-y-auto">
        <Link
          to="/goals/new"
          className="mb-1 flex h-9 items-center gap-1.5 rounded-control px-1 text-xs font-semibold text-nav-text no-underline hover:bg-nav-hover"
        >
          <Target size={15} aria-hidden="true" className="shrink-0 text-nav-muted" />
          {t("goals.newInRail")}
        </Link>
        {groups.map(({ group, items }) => (
          <Fold
            key={group}
            title={t(`dashboard.groups.${group as "custom"}`)}
            count={items.length}
            open={searching || opened.has(group)}
            onToggle={() => toggle(group)}
          >
            {items.map(({ type, title }) => (
              <div
                key={`${group}-${type}`}
                className="flex items-center gap-1 rounded-control pl-6 hover:bg-nav-hover"
              >
                <span className="min-w-0 flex-1 truncate py-2 text-xs font-medium">{title}</span>
                <button
                  type="button"
                  aria-label={t("dashboard.addNamed", { title })}
                  onClick={() => add(type)}
                  className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-[var(--statly-sequence-3)] hover:bg-nav/40"
                >
                  {added === type ? <Check size={15} /> : <AddIcon size={15} strokeWidth={3} />}
                </button>
              </div>
            ))}
          </Fold>
        ))}
      </div>
      {feedback ? (
        <p
          role="status"
          className={`m-0 text-[11px] ${feedback.failed ? "text-[var(--statly-danger)]" : "text-nav-muted"}`}
        >
          {feedback.text}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onReset}
        className="flex h-9 w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control border border-nav-text/20 bg-transparent text-xs font-semibold text-nav-text hover:bg-nav-hover"
      >
        <RotateCcw size={14} aria-hidden="true" />
        {t("dashboard.reset")}
      </button>
      <section className="shrink-0 rounded-control border border-nav-text/20 p-2.5">
        <h3 className="m-0 text-xs font-bold">{t("dashboard.share")}</h3>
        <p className="m-0 mt-1 text-[11px] text-nav-muted">{t("dashboard.shareNote")}</p>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the Import button does the same. */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={handleDrop}
          data-testid="dashboard-drop"
          className={`mt-2 rounded-control border border-dashed p-2 text-center text-[11px] font-semibold ${
            dropping ? "border-nav-text bg-nav-hover" : "border-nav-text/30"
          }`}
        >
          {t("dashboard.dropHere")}
        </div>
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => void exportFile()}
            className="h-8 flex-1 cursor-pointer rounded-control border border-nav-text/20 bg-transparent text-xs font-semibold text-nav-text hover:bg-nav-hover"
          >
            {t("dashboard.export")}
          </button>
          <button
            type="button"
            onClick={() => void chooseFile()}
            className="h-8 flex-1 cursor-pointer rounded-control border-0 bg-primary text-xs font-semibold text-on-primary hover:bg-primary-hover"
          >
            {t("dashboard.import")}
          </button>
        </div>
      </section>
    </div>
  );
}
