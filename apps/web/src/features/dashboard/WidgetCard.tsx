import { useTranslation } from "@statly/i18n";
import { Component, type ReactNode } from "react";
import { Link } from "react-router";
import { BridgeError } from "../../bridge/index.ts";

type Status = { isPending: boolean; error: Error | null };

export function WidgetCard({
  title,
  titleTo,
  note,
  actions,
  children,
}: {
  title: string;
  /** Where the title leads when clicked. While the dashboard is edited it leads nowhere. */
  titleTo?: string | undefined;
  note?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="statly-widget flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-line bg-card p-4 shadow-card">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[13px] font-bold text-text">
            {titleTo ? (
              <Link
                to={titleTo}
                draggable={false}
                onClick={(event) => {
                  if (event.currentTarget.closest(".statly-editing")) {
                    event.preventDefault();
                  }
                }}
                className="statly-widget-title text-text no-underline underline-offset-2 hover:text-accent-strong hover:underline"
              >
                {title}
              </Link>
            ) : (
              title
            )}
          </h2>
          {note ? <p className="m-0 mt-0.5 truncate text-xs text-muted">{note}</p> : null}
        </div>
        {actions}
      </header>
      <div className="mt-2 min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** Shows a widget's loading, error and empty states the same way everywhere. */
export function WidgetState({
  status,
  empty,
  emptyText,
  children,
}: {
  status: Status;
  empty: boolean;
  emptyText?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (status.error) {
    const closed =
      status.error instanceof BridgeError && status.error.code === "collection_unavailable";
    return <Message text={t(closed ? "dashboard.closed" : "dashboard.error")} tone="text-danger" />;
  }
  if (status.isPending) {
    return <div className="h-full animate-pulse rounded-control bg-hover" aria-busy="true" />;
  }
  if (empty) {
    return <Message text={emptyText ?? t("dashboard.empty")} tone="text-muted" />;
  }
  return children;
}

function Message({ text, tone }: { text: string; tone: string }) {
  return (
    <div className={`grid h-full place-items-center text-center text-[13px] ${tone}`}>{text}</div>
  );
}

/** Keeps one broken widget from taking the rest of the dashboard down with it. */
export class WidgetBoundary extends Component<
  { title: string; message: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <WidgetCard title={this.props.title}>
          <Message text={this.props.message} tone="text-danger" />
        </WidgetCard>
      );
    }
    return this.props.children;
  }
}
