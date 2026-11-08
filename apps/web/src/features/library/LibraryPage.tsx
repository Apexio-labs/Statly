import { builtinWidgets, customWidgetPrefix, widgetKinds } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { sizeLimits } from "@statly/widget-runtime";
import { Check, Search, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/Button.tsx";
import { AddIcon } from "../../components/icons.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { richTip } from "../../components/tip.ts";
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
  columnsFor,
  favoriteKey,
  groupOf,
  type LibraryFilter,
  type LibraryItem,
  libraryFilters,
  MAX_COLUMNS,
  matchesSearch,
  sectionLimit,
  sectionsFor,
  statisticsInOrder,
  stepThrough,
  TILE_GAP_PX,
  TILE_MIN_PX,
  takesKeys,
  widthName,
} from "./libraryItems.ts";
import { Footprint, StatisticPicture, WidgetPicture } from "./Thumbnail.tsx";

const PICTURE_HEIGHT = 112;
/** Room the picture keeps free on every side, so a sketch never touches the edge. */
const PICTURE_INSET = 12;

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
  return widget ? (
    <WidgetPicture widget={widget} scope={scope} height={PICTURE_HEIGHT - 2 * PICTURE_INSET} />
  ) : null;
}

function dashboardTypeOf(item: LibraryItem): string | null {
  if (item.kind === "statistic") {
    return item.type;
  }
  return item.kind === "custom" ? `${customWidgetPrefix}${item.widget.id}` : null;
}

type Sizes = { w: number; h: number; minW: number; maxW: number; minH: number; maxH: number };

/** The item's standard size and the smallest and largest it may take, in grid cells. */
function sizesOf(item: LibraryItem): Sizes | null {
  if (item.kind === "statistic") {
    return builtinWidgets[item.type];
  }
  const size =
    item.kind === "custom"
      ? item.widget.size
      : templates.find((entry) => entry.key === item.key)?.build("preview").size;
  return size ? { w: size.w, h: size.h, ...sizeLimits(size) } : null;
}

/** Counts every tile's place on the dashboard at once instead of once per tile. */
function useDashboardCounts(): Map<string, number> | null {
  const { layout } = useLayout();
  return useMemo(() => {
    if (!layout) {
      return null;
    }
    const counts = new Map<string, number>();
    for (const widget of layout.widgets) {
      counts.set(widget.type, (counts.get(widget.type) ?? 0) + 1);
    }
    return counts;
  }, [layout]);
}

/** How many tiles fit in a row, so a shortened section can stop at the end of one. */
function useColumns() {
  const node = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const current = node.current;
    if (!current) {
      return;
    }
    const sizes = new ResizeObserver(() => setWidth(current.clientWidth));
    sizes.observe(current);
    return () => sizes.disconnect();
  }, []);
  return { node, columns: columnsFor(width) };
}

function TileAction({ item, used }: { item: LibraryItem; used: number }) {
  const { t } = useTranslation();
  const { widgets } = useCustomWidgets();
  const { layout, save } = useLayout();
  const type = dashboardTypeOf(item);
  if (!layout || !type) {
    return null;
  }
  const look =
    "statly-tile-action relative z-[1] grid size-7 shrink-0 cursor-pointer place-items-center rounded-control border";
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
      className={`${look} border-line bg-control text-text hover:border-accent hover:bg-hover`}
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
      className={`statly-favorite relative z-[1] grid size-7 shrink-0 cursor-pointer place-items-center rounded-control border border-transparent bg-transparent hover:bg-hover ${
        favorite ? "text-accent-strong" : "text-muted hover:text-text"
      }`}
    >
      <Star size={14} fill={favorite ? "currentColor" : "none"} />
    </button>
  );
}

function Tile({
  item,
  scope,
  used,
  onOpen,
  onHover,
}: {
  item: LibraryItem;
  scope: WidgetScope | null;
  used: number;
  onOpen: () => void;
  onHover: (hovered: boolean) => void;
}) {
  const { t } = useTranslation();
  const data =
    item.kind === "statistic"
      ? { "data-library-card": item.type }
      : item.kind === "custom"
        ? { "data-custom-widget": item.widget.name }
        : { "data-library-template": item.key };
  const sizes = sizesOf(item);
  const cells = (w: number, h: number) => t("library.standardSize", { w, h });
  const width = (columns: number) => {
    const name = widthName(columns);
    return name ? t(`library.width.${name}`) : t("library.width.columns", { count: columns });
  };
  // Only the size symbol has a hover box, so moving across the tiles stays quiet.
  const sizeTip = sizes
    ? richTip({
        title: t("library.sizeTip.title"),
        rows: [
          { label: t("library.sizeTip.standard"), value: cells(sizes.w, sizes.h) },
          { label: t("library.sizeTip.smallest"), value: cells(sizes.minW, sizes.minH) },
          { label: t("library.sizeTip.largest"), value: cells(sizes.maxW, sizes.maxH) },
        ],
        lines: [t("library.sizeTip.widths", { from: width(sizes.minW), to: width(sizes.maxW) })],
      })
    : undefined;
  return (
    <article
      {...data}
      data-used={used > 0 ? "" : undefined}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      className="statly-tile group/tile relative flex flex-col overflow-hidden rounded-card border border-line bg-card shadow-card transition-colors hover:border-accent"
    >
      <span
        className="statly-tile-picture relative block bg-page"
        style={{ height: PICTURE_HEIGHT, padding: PICTURE_INSET }}
      >
        {item.kind === "statistic" ? <StatisticPicture type={item.type} /> : null}
        {item.kind === "custom" ? (
          <WidgetPicture
            widget={item.widget}
            scope={scope}
            height={PICTURE_HEIGHT - 2 * PICTURE_INSET}
          />
        ) : null}
        {item.kind === "template" ? <TemplatePicture templateKey={item.key} scope={scope} /> : null}
        {used > 0 ? (
          <span className="statly-tile-used absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-selected px-2 py-0.5 text-[10px] font-semibold text-accent-strong shadow-card">
            <Check size={11} strokeWidth={3} aria-hidden="true" />
            {used > 1 ? t("library.onDashboardCount", { count: used }) : t("library.onDashboard")}
          </span>
        ) : null}
      </span>
      <div className="statly-tile-caption flex flex-1 flex-col gap-1.5 px-3 pt-2.5 pb-2">
        <button
          type="button"
          aria-label={item.title}
          onClick={onOpen}
          className="cursor-pointer border-0 bg-transparent p-0 text-left text-text outline-none after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent/50"
        >
          <span className="line-clamp-2 min-h-[34px] text-[13px] leading-[17px] font-bold">
            {item.title}
          </span>
        </button>
        <div className="mt-auto flex items-center gap-1">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted">
            {sizes ? (
              <span
                data-tooltip={sizeTip}
                data-size-tip=""
                className="statly-footprint-hit relative z-[1] -m-1 grid shrink-0 place-items-center p-1"
              >
                <Footprint columns={sizes.w} />
              </span>
            ) : null}
            <span className="truncate">{item.tag}</span>
          </span>
          <FavoriteButton item={item} />
          <TileAction item={item} used={used} />
        </div>
      </div>
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
  const counts = useDashboardCounts();
  const grid = useColumns();
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const hovered = useRef<string | null>(null);
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
    .filter((section) => section.items.length > 0)
    .map((section) => ({
      ...section,
      shown: section.limited ? section.items.slice(0, sectionLimit(grid.columns)) : section.items,
    }));
  // The order the arrow keys walk in the preview: every tile on the page, each once.
  const order = [...new Set(sections.flatMap((section) => section.shown.map((item) => item.key)))];

  // Space opens the tile under the pointer, as long as no field is being typed in.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== " " || event.repeat || openKey !== null || hovered.current === null) {
        return;
      }
      if (takesKeys(event.target)) {
        return;
      }
      event.preventDefault();
      setOpenKey(hovered.current);
    }
    addEventListener("keydown", handleKey);
    return () => removeEventListener("keydown", handleKey);
  }, [openKey]);

  function close() {
    hovered.current = null;
    setOpenKey(null);
  }

  return (
    <>
      <PageHeader title={t("nav.library")}>
        <Button onClick={() => importPackage.mutate()}>{t("library.importWidget")}</Button>
        <Button primary onClick={() => void navigate("/library/widgets/new")}>
          {t("library.createWidget")}
        </Button>
      </PageHeader>
      <div className="px-4 pb-6">
        <div ref={grid.node} aria-hidden="true" className="h-0" />
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
          const { shown } = section;
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
              <div
                className="grid"
                style={{
                  gap: TILE_GAP_PX,
                  gridTemplateColumns: `repeat(auto-fill, minmax(max(${TILE_MIN_PX}px, calc((100% - ${
                    (MAX_COLUMNS - 1) * TILE_GAP_PX
                  }px) / ${MAX_COLUMNS})), 1fr))`,
                }}
              >
                {shown.map((item) => {
                  const type = dashboardTypeOf(item);
                  return (
                    <Tile
                      key={`${item.kind}-${item.key}`}
                      item={item}
                      scope={scope}
                      used={type ? (counts?.get(type) ?? 0) : 0}
                      onOpen={() => setOpenKey(item.key)}
                      onHover={(on) => {
                        if (on) {
                          hovered.current = item.key;
                        } else if (hovered.current === item.key) {
                          hovered.current = null;
                        }
                      }}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {opened ? (
        <LibraryDetail
          item={opened}
          scope={scope}
          position={{ index: order.indexOf(opened.key) + 1, total: order.length }}
          onStep={(direction) => setOpenKey((current) => stepThrough(order, current, direction))}
          onClose={close}
        />
      ) : null}
    </>
  );
}
