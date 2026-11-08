import type { ExamStatus } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { filledEnd, type Slice, slicePath, slices } from "@statly/widget-runtime";
import { ArrowLeft } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useState } from "react";
import { richTip } from "../../../components/tip.ts";
import { motivation, studyTime } from "../examText.ts";
import { TONE_COLORS } from "../goalLogic.ts";
import { deckOf, parentFocus, type RingPart, ringParts, toneOfShare } from "../goalTree.ts";
import { StreakFlame } from "./StreakFlame.tsx";

const CENTER = 50;
const INNER = { from: 31, to: 41 };
const OUTER = { from: 42.5, to: 48 };
const TRACK = "var(--statly-hover)";
/** How far a slice under the pointer moves out of the ring, in the ring's own units. */
const NUDGE = 1.8;

/** A slice as drawn: inner slices are decks, outer ones the decks inside them. */
type Placed = { id: string; slice: Slice<RingPart>; outer: Placed[] };

function share(value: number, target: number): number {
  return target === 0 ? 0 : Math.min(1, value / target);
}

/** Moves a slice outwards along its middle. Slices of half the ring or more stay where they are. */
function nudge(slice: Slice<RingPart>): CSSProperties {
  const span = slice.end - slice.start;
  if (span >= Math.PI) {
    return {};
  }
  const middle = (slice.start + slice.end) / 2;
  return {
    "--out-x": `${(Math.sin(middle) * NUDGE).toFixed(3)}px`,
    "--out-y": `${(-Math.cos(middle) * NUDGE).toFixed(3)}px`,
  } as CSSProperties;
}

/** One slice: an empty track, the cards in their learning steps, and the cards learned. */
function SliceShape({
  slice,
  radii,
  focused,
}: {
  slice: Slice<RingPart>;
  radii: { from: number; to: number };
  focused: boolean;
}) {
  const { item } = slice;
  if (item.blank) {
    return null;
  }
  const color = TONE_COLORS[toneOfShare(item.done, item.target)];
  const learning = filledEnd(slice, share(item.done + item.inProgress, item.target));
  const learned = filledEnd(slice, share(item.done, item.target));
  return (
    <>
      <path
        d={slicePath(CENTER, CENTER, radii.from, radii.to, slice.start, slice.end)}
        fill={TRACK}
      />
      <path
        d={slicePath(CENTER, CENTER, radii.from, radii.to, slice.start, learning)}
        fill={color}
        opacity={0.35}
      />
      <path
        d={slicePath(CENTER, CENTER, radii.from, radii.to, slice.start, learned)}
        fill={color}
        opacity={focused ? 1 : 0.92}
      />
    </>
  );
}

/** The middle while a slice is pointed at: its deck, its numbers and how far it is. */
function PartCenter({ part }: { part: RingPart }) {
  const { t } = useTranslation();
  const tone = toneOfShare(part.done, part.target);
  const left = part.target - part.done;
  return (
    <>
      <span
        className="max-w-full truncate font-semibold text-muted"
        style={{ fontSize: "clamp(9px, 5.5cqmin, 14px)" }}
      >
        {part.label}
      </span>
      <span
        className="font-bold whitespace-nowrap text-text"
        style={{ fontSize: "clamp(13px, 12cqmin, 38px)" }}
      >
        {part.target > 0 ? `${part.done} / ${part.target}` : "–"}
      </span>
      <span
        data-tone={tone}
        className="mt-0.5 font-semibold"
        style={{ color: TONE_COLORS[tone], fontSize: "clamp(9px, 5cqmin, 13px)" }}
      >
        {left > 0
          ? t("goals.widget.left", { count: left })
          : t(part.target > 0 ? "goals.widget.states.done" : "goals.widget.states.rest")}
      </span>
      {part.inProgress > 0 ? (
        <span className="text-muted" style={{ fontSize: "clamp(9px, 4.5cqmin, 12px)" }}>
          {t("goals.widget.inProgress", { count: part.inProgress })}
        </span>
      ) : null}
    </>
  );
}

/**
 * The day's goal as rings of decks, like a disk usage chart. Clicking a deck opens its subdecks,
 * clicking the middle goes back. Each slice fills with its own share, in red, yellow or green.
 * Pointing at a slice shows its numbers in the middle; `highlight` does the same from outside,
 * for example from a table of the same decks.
 */
export function GoalSunburst({
  status,
  interactive = true,
  highlight = null,
  onHighlight,
}: {
  status: ExamStatus;
  interactive?: boolean;
  highlight?: number | null;
  onHighlight?: (deckId: number | null) => void;
}) {
  const { t } = useTranslation();
  const [focus, setFocus] = useState<number | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const reviewsLabel = t("goals.widget.reviews");
  const placed: Placed[] = slices(
    ringParts(status, focus, reviewsLabel),
    (part) => part.weight,
  ).map((slice) => ({
    id: slice.item.key,
    slice,
    outer:
      slice.item.deckId !== null && slice.item.opens
        ? slices(
            ringParts(status, slice.item.deckId, reviewsLabel),
            (part) => part.weight,
            slice.start,
            slice.end,
            0.012,
          ).map((child) => ({
            id: `${slice.item.key}/${child.item.key}`,
            slice: child,
            outer: [],
          }))
        : [],
  }));
  const all = placed.flatMap((item) => [item, ...item.outer]);

  /** The slice that shows a deck: the deck itself, or the closest deck above it that is drawn. */
  function visibleOf(deckId: number | null): string | null {
    let id = deckId;
    while (id !== null) {
      const found = all.find((item) => item.slice.item.deckId === id && !item.slice.item.blank);
      if (found) {
        return found.id;
      }
      id = deckOf(status.decks, id)?.parentId ?? null;
    }
    return null;
  }

  const lit = interactive ? (hovered ?? visibleOf(highlight)) : null;
  const litPart = all.find((item) => item.id === lit)?.slice.item;
  const litGroup = placed.find(
    (item) => item.id === lit || item.outer.some((child) => child.id === lit),
  );

  function point(item: Placed | null) {
    if (!interactive) {
      return;
    }
    const part = item && !item.slice.item.blank ? item.slice.item : null;
    setHovered(part && item ? item.id : null);
    onHighlight?.(part?.deckId ?? null);
  }

  const focused = deckOf(status.decks, focus);
  const target = focused ? focused.target : status.target;
  const done = focused ? focused.done : status.done;
  const tone = focused ? toneOfShare(done, target) : status.tone;
  const line = motivation(focused ? { ...status, target, done, tone } : status);

  function open(part: RingPart) {
    if (interactive && part.opens && part.deckId !== null) {
      setFocus(part.deckId);
      setHovered(null);
      onHighlight?.(null);
    }
  }

  function back() {
    setFocus(parentFocus(status.decks, focus));
    setHovered(null);
    onHighlight?.(null);
  }

  function keyed(event: KeyboardEvent, part: RingPart) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open(part);
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape goes back, the buttons do the same.
    <div
      className="relative h-full w-full [container-type:size]"
      onKeyDown={(event) => {
        if (event.key === "Escape" && focus !== null) {
          event.stopPropagation();
          back();
        }
      }}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full"
        role="img"
        aria-label={t("goals.widget.ringLabel", { done, target })}
        onPointerLeave={() => point(null)}
      >
        <g key={focus ?? "all"} className="statly-ring-zoom">
          {placed.map((item) => {
            const { slice } = item;
            const opens = slice.item.opens && interactive;
            const inGroup = litGroup?.id === item.id;
            return (
              <g
                key={item.id}
                className="statly-slice"
                style={nudge(slice)}
                data-lit={lit === item.id || undefined}
                data-dim={(lit !== null && !inGroup) || undefined}
              >
                {/* biome-ignore lint/a11y/noStaticElementInteractions: a slice that opens is a button. */}
                <g
                  data-slice={slice.item.key}
                  role={opens ? "button" : undefined}
                  tabIndex={opens ? 0 : undefined}
                  aria-label={
                    opens
                      ? t("goals.widget.openDeck", {
                          name: slice.item.label,
                          done: slice.item.done,
                          target: slice.item.target,
                        })
                      : undefined
                  }
                  onClick={() => open(slice.item)}
                  onKeyDown={(event) => keyed(event, slice.item)}
                  onPointerEnter={() => point(item)}
                  onFocus={() => point(item)}
                  onBlur={() => point(null)}
                  className={opens ? "cursor-pointer outline-none" : ""}
                  data-tooltip={richTip({
                    title: slice.item.label,
                    rows: [
                      {
                        label: t("goals.timeline.kinds.met"),
                        value: `${slice.item.done} / ${slice.item.target}`,
                      },
                    ],
                  })}
                >
                  <SliceShape slice={slice} radii={INNER} focused />
                </g>
                {item.outer.map((child) => (
                  // biome-ignore lint/a11y/noStaticElementInteractions: the inner slice is the button.
                  <g
                    key={child.id}
                    data-slice={`outer-${child.slice.item.key}`}
                    className={`statly-slice ${interactive ? "cursor-pointer" : ""}`}
                    style={nudge(child.slice)}
                    data-lit={lit === child.id || undefined}
                    data-dim={(inGroup && lit !== item.id && lit !== child.id) || undefined}
                    onPointerEnter={() => point(child)}
                    onClick={() => open(child.slice.item.opens ? child.slice.item : slice.item)}
                    data-tooltip={richTip({
                      title: child.slice.item.label,
                      rows: [
                        {
                          label: t("goals.timeline.kinds.met"),
                          value: `${child.slice.item.done} / ${child.slice.item.target}`,
                        },
                      ],
                    })}
                  >
                    <SliceShape slice={child.slice} radii={OUTER} focused={false} />
                  </g>
                ))}
              </g>
            );
          })}
        </g>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the back button does the same. */}
        <circle
          data-ring-center={focused && interactive ? true : undefined}
          cx={CENTER}
          cy={CENTER}
          r={INNER.from - 1}
          fill="transparent"
          className={focused && interactive ? "cursor-pointer" : ""}
          onPointerEnter={() => point(null)}
          onClick={() => (focused && interactive ? back() : null)}
          data-tooltip={focused && interactive ? t("goals.widget.back") : undefined}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div
          key={lit ?? "goal"}
          className="statly-fade-in flex flex-col items-center px-1 text-center leading-tight"
          style={{ maxWidth: "56cqmin" }}
        >
          {litPart ? (
            <PartCenter part={litPart} />
          ) : (
            <>
              {focused ? (
                <span
                  className="max-w-full truncate font-semibold text-muted"
                  style={{ fontSize: "clamp(9px, 5.5cqmin, 14px)" }}
                >
                  {focused.name.split("::").at(-1)}
                </span>
              ) : null}
              <span
                className="font-bold whitespace-nowrap text-text"
                style={{ fontSize: "clamp(13px, 12cqmin, 38px)" }}
              >
                {target > 0 ? `${done} / ${target}` : "–"}
              </span>
              <span
                data-tone={tone}
                className="mt-0.5 font-semibold"
                style={{ color: TONE_COLORS[tone], fontSize: "clamp(9px, 5cqmin, 13px)" }}
              >
                {t(line.key, line.values)}
              </span>
              {!focused && status.time && status.time.left.seconds >= 30 ? (
                <span
                  data-time-left
                  className="mt-0.5 text-muted"
                  style={{ fontSize: "clamp(8px, 4.5cqmin, 12px)" }}
                >
                  {t("goals.time.left", { time: studyTime(status.time.left.seconds, t) })}
                </span>
              ) : null}
              {!focused && status.streak.current > 0 ? (
                <span className="mt-1" style={{ fontSize: "clamp(9px, 5cqmin, 13px)" }}>
                  <StreakFlame streak={status.streak} compact />
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
      {focused && interactive ? (
        <button
          type="button"
          aria-label={t("goals.widget.back")}
          title={t("goals.widget.back")}
          onClick={back}
          className="statly-arrow-back absolute top-0 left-0 grid size-7 cursor-pointer place-items-center rounded-control border border-line bg-control text-muted hover:bg-hover"
        >
          <ArrowLeft size={14} className="statly-back-arrow" />
        </button>
      ) : null}
    </div>
  );
}
