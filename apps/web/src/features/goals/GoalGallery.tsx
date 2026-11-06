import { goalKinds } from "@statly/contract";
import { useTranslation } from "@statly/i18n";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { GOAL_KINDS } from "./kinds.tsx";

/** One tile per kind of goal. A new kind appears here by itself once it is in `kinds.tsx`. */
export function GoalGallery() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-[15px] font-bold">{t("goals.gallery.title")}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {goalKinds.map((kind) => {
          const Icon = GOAL_KINDS[kind].icon;
          return (
            <Link
              key={kind}
              to={`/goals/new/${kind}`}
              data-goal-kind={kind}
              className="statly-goal-kind statly-lift group flex items-start gap-3 rounded-card border border-line bg-card p-4 text-text no-underline shadow-card hover:border-accent"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-control bg-selected text-accent-strong">
                <Icon size={22} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold">
                  {t(`goals.kinds.${kind}.title`)}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {t(`goals.kinds.${kind}.description`)}
                </span>
              </span>
              <ChevronRight
                size={16}
                aria-hidden="true"
                className="mt-1 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
              />
            </Link>
          );
        })}
      </div>
      <p className="m-0 text-xs text-muted">{t("goals.gallery.more")}</p>
    </section>
  );
}
