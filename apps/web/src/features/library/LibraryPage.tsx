import { customWidgetPrefix, widgetKinds } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { Check, Search, Star, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/Button.tsx";
import { AddIcon } from "../../components/icons.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useAppearance } from "../../lib/appearance.tsx";
import { useStatistic } from "../../lib/calls.ts";
import { addWidget, removeOneOfType, rulesOfWidgets } from "../dashboard/grid/engine.ts";
import { rangeOf } from "../dashboard/useDashboardFilters.ts";
import { useLayout } from "../dashboard/useLayout.ts";
import type { WidgetScope } from "../dashboard/widgets.tsx";
import { templates } from "../widgets/editor/templates.ts";
import { useCustomWidgets } from "../widgets/useCustomWidgets.ts";
import { LibraryDetail } from "./LibraryDetail.tsx";
import {
  belongsTo,
  favoriteKey,
  groupOf,
  type LibraryFilter,
  type LibraryItem,
  libraryFilters,
  matchesSearch,
  SECTION_LIMIT,
  sectionsFor,
  statisticsInOrder,
} from "./libraryItems.ts";
import { StatisticPicture, WidgetPicture } from "./Thumbnail.tsx";

const PICTURE_HEIGHT = 104;

function useLibraryItems(): LibraryItem[] {
  const { t } = useTranslation();
  const { widgets } = useCustomWidgets();
  return useMemo(
    () => [
      ...widgets.map(
        (widget): LibraryItem => ({
          kind: "custom",
          key: widget.id,
          widget,
          title: widget.name,
          text: widget.description || t("library.customKind"),
          tag: t("library.customKind"),
        }),
      ),
      ...statisticsInOrder().map(
        (type): LibraryItem => ({
          kind: "statistic",
          key: type,
          type,
          group: groupOf(type),
          title: t(`widgets.${type}.title`),
          text: t(`widgets.${type}.description`),
          tag: t(`library.kinds.${widgetKinds[type]}`),
        }),
      ),
      ...templates.map(
        ({ key }): LibraryItem => ({
          kind: "template",
          key,
          title: t(`editor.templateNames.${key as "streak"}`),
          text: t(`library.templateNotes.${key as "streak"}`),
          tag: t("library.templateKind"),
        }),
      ),
    ],
    [t, widgets],
  );
}

function TemplatePicture({
  templateKey,
  scope,
}: {
  templateKey: string;
  scope: WidgetScope | null;
}) {
  const widget = useMemo(
    () => templates.find((entry) => entry.key === templateKey)?.build("preview"),
    [templateKey],
  );
  return widget ? <WidgetPicture widget={widget} scope={scope} height={PICTURE_HEIGHT} /> : null;
}

function TileAction({ item }: { item: LibraryItem }) {
  const { t } = useTranslation();
  const { widgets } = useCustomWidgets();
  const { layout, save } = useLayout();
  const type =
    item.kind === "statistic"
      ? item.type
      : item.kind === "custom"
        ? `${customWidgetPrefix}${item.widget.id}`
        : null;
  if (!layout || !type) {
    return null;
  }
  const used = layout.widgets.filter((widget) => widget.type === type).length;
  const look =
    "absolute top-2 right-2 grid h-7 min-w-7 cursor-pointer place-items-center rounded-control border px-1.5 text-xs font-semibold shadow-card";
  return used > 0 ? (
    <button
      type="button"
      aria-label={t("library.removeNamed", { title: item.title })}
      title={t("library.removeNamed", { title: item.title })}
      onClick={() => save.mutate(removeOneOfType(layout, type))}
      className={`${look} group/used border-transparent bg-selected text-accent-strong`}
    >
      <Check size={14} className="group-hover/used:hidden" />
      <X size={14} className="hidden group-hover/used:block" />
    </button>
  ) : (
    <button
      type="button"
      aria-label={t("dashboard.addNamed", { title: item.title })}
      title={t("dashboard.addNamed", { title: item.title })}
      onClick={() => save.mutate(addWidget(layout, type, rulesOfWidgets(widgets)))}
      className={`${look} border-line bg-control text-text hover:bg-hover`}
    >
      <AddIcon size={14} />
    </button>
  );
}

function FavoriteButton({ item }: { item: LibraryItem }) {
  const { t } = useTranslation();
  const { settings, update } = useAppearance();
  const key = favoriteKey(item);
  const favorite = settings.favoriteWidgets.includes(key);
  const name = t(favorite ? "library.removeFavorite" : "library.addFavorite", {
    title: item.title,
  });
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={favorite}
      title={name}
      onClick={() =>
        update({
          favoriteWidgets: favorite
            ? settings.favoriteWidgets.filter((entry) => entry !== key)
            : [...settings.favoriteWidgets, key],
        })
      }
      className={`statly-favorite absolute top-2 left-2 grid size-7 cursor-pointer place-items-center rounded-control border border-line bg-control shadow-card hover:bg-hover ${
        favorite ? "text-accent-strong" : "text-muted"
      }`}
    >
      <Star size={14} fill={favorite ? "currentColor" : "none"} />
    </button>
  );
}

function Tile({
  item,
  scope,
  onOpen,
}: {
  item: LibraryItem;
  scope: WidgetScope | null;
  onOpen: () => void;
}) {
  const data =
    item.kind === "statistic"
      ? { "data-library-card": item.type }
      : item.kind === "custom"
        ? { "data-custom-widget": item.widget.name }
        : { "data-library-template": item.key };
  return (
    <article
      {...data}
      className="statly-tile relative overflow-hidden rounded-card border border-line bg-card shadow-card transition-colors hover:border-accent"
    >
      <button
        type="button"
        aria-label={item.title}
        onClick={onOpen}
        className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left text-text"
      >
        <span className="statly-tile-picture block bg-page" style={{ height: PICTURE_HEIGHT }}>
          {item.kind === "statistic" ? <StatisticPicture type={item.type} /> : null}
          {item.kind === "custom" ? (
            <WidgetPicture widget={item.widget} scope={scope} height={PICTURE_HEIGHT} />
          ) : null}
          {item.kind === "template" ? (
            <TemplatePicture templateKey={item.key} scope={scope} />
          ) : null}
        </span>
        <span className="statly-tile-caption block px-3 py-2.5">
          <span className="block truncate text-[13px] font-bold">{item.title}</span>
          <span className="block truncate text-[11px] text-muted">{item.tag}</span>
        </span>
      </button>
      <FavoriteButton item={item} />
      <TileAction item={item} />
    </article>
  );
}

export function LibraryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { paletteKey, settings } = useAppearance();
  const { importPackage } = useCustomWidgets();
  const today = useStatistic("statistics.today", {});
  const items = useLibraryItems();
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const opened = items.find((item) => item.key === openKey) ?? null;
  const date = today.data?.date;
  const scope = useMemo<WidgetScope | null>(
    () =>
      date
        ? {
            ...rangeOf({ preset: "last7", custom: null, today: date, firstReview: null }),
            deckId: null,
            themeKey: paletteKey,
          }
        : null,
    [date, paletteKey],
  );

  const favorites = settings.favoriteWidgets;
  const found = items.filter((item) => matchesSearch(item, search));
  const searching = search.trim() !== "";
  const sections = sectionsFor(filter, searching)
    .map((section) => ({
      ...section,
      items: found.filter((item) => belongsTo(item, section.filter, favorites)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      <PageHeader title={t("nav.library")}>
        <Button onClick={() => importPackage.mutate()}>{t("library.importWidget")}</Button>
        <Button primary onClick={() => void navigate("/library/widgets/new")}>
          {t("library.createWidget")}
        </Button>
      </PageHeader>
      <div className="px-4 pb-6">
        <div className="statly-library-tools mb-4 flex flex-wrap items-center gap-2">
          <label className="relative block min-w-[220px] flex-1 sm:max-w-[320px]">
            <Search
              size={15}
              aria-hidden="true"
              className="absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("library.search")}
              aria-label={t("library.search")}
              className="h-9 w-full rounded-control border border-line bg-control pr-3 pl-9 text-[13px] text-text outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </label>
          <div role="tablist" aria-label={t("library.filter")} className="flex flex-wrap gap-1">
            {libraryFilters.map((name) => {
              const count = found.filter((item) => belongsTo(item, name, favorites)).length;
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={filter === name}
                  onClick={() => setFilter(name)}
                  className={`h-8 cursor-pointer rounded-full border-0 px-3 text-xs font-semibold transition-colors ${
                    filter === name
                      ? "bg-selected text-accent-strong"
                      : "bg-transparent text-muted hover:bg-hover"
                  }`}
                >
                  {t(`library.filters.${name}`)} <span className="opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
        {importPackage.isError ? (
          <p role="alert" className="m-0 mb-3 text-xs text-danger">
            {importPackage.error.message}
          </p>
        ) : null}
        {sections.length === 0 ? (
          <p className="m-0 py-10 text-center text-[13px] text-muted">
            {t(filter === "favorites" && !searching ? "library.noFavorites" : "library.noResults")}
          </p>
        ) : null}
        {sections.map((section) => {
          const shown = section.limited ? section.items.slice(0, SECTION_LIMIT) : section.items;
          return (
            <section
              key={section.filter}
              className="mb-7"
              aria-label={t(`library.filters.${section.filter}`)}
            >
              {filter === "all" ? (
                <div className="mb-2.5 flex items-baseline justify-between gap-4">
                  <h2 className="statly-group-title m-0 text-[15px] font-bold">
                    {t(`library.filters.${section.filter}`)}
                  </h2>
                  {shown.length < section.items.length ? (
                    <button
                      type="button"
                      onClick={() => setFilter(section.filter)}
                      className="statly-link cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-accent-strong"
                    >
                      {t("library.showAll", { count: section.items.length })}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                {shown.map((item) => (
                  <Tile
                    key={`${item.kind}-${item.key}`}
                    item={item}
                    scope={scope}
                    onOpen={() => setOpenKey(item.key)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {opened ? (
        <LibraryDetail item={opened} scope={scope} onClose={() => setOpenKey(null)} />
      ) : null}
    </>
  );
}
