import {
  type CustomWidget,
  customWidgetPrefix,
  type DashboardLayout,
  widgetGroups,
} from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Check, Plus } from "lucide-react";
import { type DragEvent, useState } from "react";
import { bridge } from "../../bridge/index.ts";
import { useAppearance } from "../../lib/appearance.tsx";
import { createDashboardFile, readDashboardFile } from "./dashboardFile.ts";

const CONFIRM_MS = 1200;

type Props = {
  layout: DashboardLayout;
  customWidgets: CustomWidget[];
  onAdd: (type: string) => void;
  onImport: (layout: DashboardLayout) => void;
};

export function WidgetRail({ layout, customWidgets, onAdd, onImport }: Props) {
  const { t } = useTranslation();
  const { settings } = useAppearance();
  const [search, setSearch] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; failed: boolean } | null>(null);
  const [dropping, setDropping] = useState(false);

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
  const builtin = Object.entries(widgetGroups).map(([group, types]) => ({
    group,
    items: types.map((type) => ({ type: type as string, title: t(`widgets.${type}.title`) })),
  }));
  const custom = customWidgets.map((widget) => ({
    type: `${customWidgetPrefix}${widget.id}`,
    title: widget.name,
  }));
  const everything = [...builtin.flatMap(({ items }) => items), ...custom];
  const favorites = settings.favoriteWidgets.flatMap((key) =>
    everything.filter((item) => item.type === key),
  );
  const groups = [
    { group: "favorites", items: favorites },
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
        {groups.map(({ group, items }) => (
          <section key={group} className="mb-2">
            <h3 className="m-0 px-1 py-1.5 text-[13px] font-bold text-nav-text">
              {t(`dashboard.groups.${group as "custom"}`)}
            </h3>
            {items.map(({ type, title }) => {
              return (
                <div
                  key={`${group}-${type}`}
                  className="flex items-center gap-1 rounded-control pl-3 hover:bg-nav-hover"
                >
                  <span className="min-w-0 flex-1 truncate py-2 text-xs font-medium">{title}</span>
                  <button
                    type="button"
                    aria-label={t("dashboard.addNamed", { title })}
                    onClick={() => add(type)}
                    className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-[var(--statly-sequence-3)] hover:bg-nav/40"
                  >
                    {added === type ? <Check size={15} /> : <Plus size={15} strokeWidth={3} />}
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <section className="rounded-control border border-nav-text/20 p-2.5">
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
      {feedback ? (
        <p
          role="status"
          className={`m-0 text-[11px] ${feedback.failed ? "text-[var(--statly-danger)]" : "text-nav-muted"}`}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
