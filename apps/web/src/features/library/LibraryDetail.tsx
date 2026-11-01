import { builtinWidgets, customWidgetPrefix, type WidgetType } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { bridge } from "../../bridge/index.ts";
import { Button } from "../../components/Button.tsx";
import { addWidget, removeOneOfType, rulesOfWidgets } from "../dashboard/grid/engine.ts";
import { useLayout } from "../dashboard/useLayout.ts";
import { WidgetBoundary } from "../dashboard/WidgetCard.tsx";
import { type WidgetScope, widgetComponents } from "../dashboard/widgets.tsx";
import { templates } from "../widgets/editor/templates.ts";
import { useCustomWidgets } from "../widgets/useCustomWidgets.ts";
import type { LibraryItem } from "./libraryItems.ts";
import { WidgetPicture } from "./Thumbnail.tsx";

const PREVIEW_HEIGHT = 300;

function StatisticPreview({ type, scope }: { type: WidgetType; scope: WidgetScope }) {
  const { t } = useTranslation();
  const Preview = widgetComponents[type];
  return (
    <WidgetBoundary title={t(`widgets.${type}.title`)} message={t("dashboard.error")}>
      <Preview scope={scope} />
    </WidgetBoundary>
  );
}

export function LibraryDetail({
  item,
  scope,
  onClose,
}: {
  item: LibraryItem;
  scope: WidgetScope | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { widgets, remove } = useCustomWidgets();
  const { layout, save } = useLayout();
  const [confirming, setConfirming] = useState(false);
  const template = useMemo(
    () =>
      item.kind === "template"
        ? templates.find((entry) => entry.key === item.key)?.build("preview")
        : undefined,
    [item],
  );

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    addEventListener("keydown", handleKey);
    return () => removeEventListener("keydown", handleKey);
  }, [onClose]);

  const dashboardType =
    item.kind === "statistic"
      ? item.type
      : item.kind === "custom"
        ? `${customWidgetPrefix}${item.widget.id}`
        : null;
  const used = layout?.widgets.filter((widget) => widget.type === dashboardType).length ?? 0;
  const size =
    item.kind === "statistic"
      ? builtinWidgets[item.type]
      : item.kind === "custom"
        ? item.widget.size
        : template?.size;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the dialog as well.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog as well.
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        className="flex max-h-full w-full max-w-[720px] flex-col overflow-hidden rounded-popover bg-card text-text shadow-card"
      >
        <header className="flex items-start gap-3 border-b border-line p-5">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-lg font-bold">{item.title}</h2>
            <p className="m-0 mt-1 text-[13px] text-muted">{item.text}</p>
          </div>
          <button
            type="button"
            aria-label={t("library.close")}
            onClick={onClose}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-hover"
          >
            <X size={17} />
          </button>
        </header>
        <section
          aria-label={t("library.preview")}
          className="shrink-0 bg-page p-4"
          style={{ height: PREVIEW_HEIGHT }}
        >
          {item.kind === "statistic" && scope ? (
            <StatisticPreview type={item.type} scope={scope} />
          ) : null}
          {item.kind === "custom" ? (
            <WidgetPicture widget={item.widget} scope={scope} height={PREVIEW_HEIGHT - 32} />
          ) : null}
          {template ? (
            <WidgetPicture widget={template} scope={scope} height={PREVIEW_HEIGHT - 32} />
          ) : null}
        </section>
        <footer className="flex flex-wrap items-center gap-2 border-t border-line p-4">
          <span className="mr-auto text-xs text-muted">
            {item.tag}
            {size ? ` · ${t("library.standardSize", { w: size.w, h: size.h })}` : ""}
          </span>
          {item.kind === "custom" ? (
            <>
              {confirming ? (
                <Button
                  className="text-danger"
                  onClick={() => {
                    remove.mutate(item.widget.id);
                    onClose();
                  }}
                >
                  {t("library.confirmDelete")}
                </Button>
              ) : (
                <Button onClick={() => setConfirming(true)}>{t("library.delete")}</Button>
              )}
              <Button onClick={() => void bridge.call("widgets.export", { id: item.widget.id })}>
                {t("dashboard.export")}
              </Button>
              <Button onClick={() => void navigate(`/library/widgets/${item.widget.id}`)}>
                {t("library.edit")}
              </Button>
            </>
          ) : null}
          {item.kind === "template" ? (
            <Button
              primary
              onClick={() => void navigate(`/library/widgets/new?template=${item.key}`)}
            >
              {t("library.useTemplate")}
            </Button>
          ) : null}
          {layout && dashboardType ? (
            <>
              {used > 0 ? (
                <Button
                  aria-label={t("library.removeNamed", { title: item.title })}
                  onClick={() => save.mutate(removeOneOfType(layout, dashboardType))}
                >
                  {t("library.remove", { count: used })}
                </Button>
              ) : null}
              <Button
                primary
                onClick={() =>
                  save.mutate(addWidget(layout, dashboardType, rulesOfWidgets(widgets)))
                }
              >
                {t("library.addToDashboard")}
              </Button>
            </>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
