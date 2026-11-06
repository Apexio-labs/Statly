import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "@statly/i18n";
import { ArrowLeft, FileText } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router";
import { HomeIcon } from "./icons.tsx";
import { MenuContent, type MenuEntry } from "./Menu.tsx";

/** A page above the current one, from the top down. */
export type Crumb = { label: string; to: string; icon?: ReactNode };

/**
 * The page's title. On a page below another one it opens a menu of the pages above it, the way a
 * Mac shows the folders above a window's title.
 */
function PathMenu({ title, icon, trail }: { title: string; icon?: ReactNode; trail: Crumb[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const entries: MenuEntry[] = [
    { label: title, icon: icon ?? <FileText size={14} />, current: true },
    ...[...trail].reverse().map((crumb) => ({
      label: crumb.label,
      icon: crumb.icon,
      onSelect: () => void navigate(crumb.to),
    })),
    { label: "Statly", icon: <HomeIcon size={14} />, onSelect: () => void navigate("/") },
  ];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <h1 className="m-0 flex min-w-0 flex-1 items-center text-[15px] font-bold text-text">
        <Popover.Trigger
          aria-haspopup="menu"
          title={t("pages.path")}
          className="statly-path -ml-1.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-control border-0 bg-transparent px-1.5 py-1 font-bold text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:bg-hover"
        >
          <span className="truncate">{title}</span>
        </Popover.Trigger>
      </h1>
      <MenuContent label={t("pages.path")} entries={entries} onClose={() => setOpen(false)} />
    </Popover.Root>
  );
}

export function PageHeader({
  title,
  icon,
  trail = [],
  children,
}: {
  title: string;
  /** Shown next to the title in the menu of pages above. */
  icon?: ReactNode;
  /** The pages above this one, from the top down. The last one is where the arrow leads. */
  trail?: Crumb[];
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const parent = trail.at(-1);
  return (
    <header className="statly-page-header sticky top-0 z-20 bg-page p-4 pb-3">
      <div className="statly-page-bar flex min-h-[58px] items-center gap-2 rounded-card bg-card px-5 py-2 shadow-card">
        <span className="text-[13px] font-bold text-accent">Statly</span>
        <span aria-hidden="true" className="statly-crumb mx-1 h-3.5 w-px bg-line" />
        {parent ? (
          <>
            {/* Through the router, so a page with unsaved work still asks before it is left. */}
            <Link
              to={parent.to}
              aria-label={t("pages.backTo", { name: parent.label })}
              title={t("pages.backTo", { name: parent.label })}
              className="statly-arrow-back grid size-7 shrink-0 place-items-center self-center rounded-control text-text transition-colors hover:bg-hover"
            >
              <ArrowLeft size={17} strokeWidth={2.25} className="statly-back-arrow block" />
            </Link>
            <PathMenu title={title} icon={icon} trail={trail} />
          </>
        ) : (
          <h1 className="m-0 min-w-0 flex-1 truncate text-[15px] font-bold text-text">{title}</h1>
        )}
        {children}
      </div>
    </header>
  );
}
