import { type AiProposal, customWidget } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { LayoutDashboard, Paintbrush, Shapes } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/Button.tsx";
import { useAppearance } from "../../lib/appearance.tsx";
import { useStatistic } from "../../lib/calls.ts";
import { rangeOf } from "../dashboard/useDashboardFilters.ts";
import type { WidgetScope } from "../dashboard/widgets.tsx";
import { WidgetPicture } from "../library/Thumbnail.tsx";
import { useAiCall } from "./useAi.ts";

const ICONS = { widget: Shapes, dashboard: LayoutDashboard, settings: Paintbrush };
const PICTURE_HEIGHT = 150;

function WidgetDetail({ proposal }: { proposal: AiProposal }) {
  const { theme } = useAppearance();
  const today = useStatistic("statistics.today", {});
  const date = today.data?.date;
  const scope = useMemo<WidgetScope | null>(
    () =>
      date
        ? {
            ...rangeOf({ preset: "last7", custom: null, today: date, firstReview: null }),
            deckId: null,
            themeKey: theme,
          }
        : null,
    [date, theme],
  );
  // A model wrote this, so it is drawn only if it really is a widget.
  const checked = customWidget.safeParse(proposal.widget);
  return checked.success ? (
    <div className="overflow-hidden rounded-control bg-hover" style={{ height: PICTURE_HEIGHT }}>
      <WidgetPicture widget={checked.data} scope={scope} height={PICTURE_HEIGHT} />
    </div>
  ) : null;
}

export function ProposalCard({ proposal }: { proposal: AiProposal }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const apply = useAiCall("ai.applyProposal");
  const reject = useAiCall("ai.rejectProposal");
  const Icon = ICONS[proposal.kind];
  const error = apply.error ?? reject.error;
  const settings = Object.entries(proposal.patch ?? {});

  return (
    <article
      data-proposal={proposal.status}
      className="flex flex-col gap-2 rounded-control border border-line bg-card p-3"
    >
      <header className="flex items-start gap-2">
        <Icon size={15} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <h3 className="m-0 text-xs font-semibold text-muted">
            {t(`ai.proposal.${proposal.kind}`)}
            {proposal.source === "external" ? ` · ${t("ai.proposal.external")}` : ""}
          </h3>
          <p className="m-0 text-[13px] [overflow-wrap:anywhere]">{proposal.summary}</p>
        </div>
      </header>
      {proposal.kind === "widget" ? <WidgetDetail proposal={proposal} /> : null}
      {proposal.layout ? (
        <p className="m-0 text-xs text-muted">
          {t("ai.proposal.widgetCount", { count: proposal.layout.widgets.length })}
        </p>
      ) : null}
      {settings.length > 0 ? (
        <ul className="m-0 pl-4 text-xs text-muted">
          {settings.map(([name, value]) => (
            <li key={name}>
              {name}: {typeof value === "object" ? "…" : String(value)}
            </li>
          ))}
        </ul>
      ) : null}
      {proposal.status === "pending" ? (
        <div className="flex flex-wrap gap-2">
          {proposal.kind === "widget" ? (
            <Button
              primary
              className="h-8"
              onClick={() => void navigate(`/library/widgets/new?proposal=${proposal.id}`)}
            >
              {t("ai.proposal.openEditor")}
            </Button>
          ) : null}
          <Button
            primary={proposal.kind !== "widget"}
            className="h-8"
            disabled={apply.isPending}
            onClick={() => apply.mutate({ id: proposal.id })}
          >
            {t("ai.proposal.apply")}
          </Button>
          <Button className="h-8" onClick={() => reject.mutate({ id: proposal.id })}>
            {t("ai.proposal.reject")}
          </Button>
        </div>
      ) : (
        <p className="m-0 text-xs text-muted">{t(`ai.proposal.${proposal.status}`)}</p>
      )}
      {error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {error.message}
        </p>
      ) : null}
    </article>
  );
}
