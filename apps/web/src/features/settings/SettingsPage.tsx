import { useTranslation } from "@statly/i18n";
import { X } from "lucide-react";
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useAero } from "../../lib/appearance.tsx";
import { useRail } from "../../shell/ShellContext.tsx";
import { recentSection, rememberSection } from "./lastSection.ts";
import { AiPanel } from "./panels/AiPanel.tsx";
import { AppearancePanel } from "./panels/AppearancePanel.tsx";
import { DashboardPanel } from "./panels/DashboardPanel.tsx";
import { GeneralPanel } from "./panels/GeneralPanel.tsx";
import { MobilePanel } from "./panels/MobilePanel.tsx";
import { NewsPanel } from "./panels/NewsPanel.tsx";
import { PrivacyPanel } from "./panels/PrivacyPanel.tsx";
import { ShortcutsPanel } from "./panels/ShortcutsPanel.tsx";
import { SponsorPanel, SupportersPanel, SupportPanel } from "./panels/SupportPanels.tsx";
import { WallpaperPanel } from "./panels/WallpaperPanel.tsx";
import { SettingsRail } from "./SettingsRail.tsx";

const PANELS = {
  general: GeneralPanel,
  news: NewsPanel,
  appearance: AppearancePanel,
  wallpaper: WallpaperPanel,
  dashboard: DashboardPanel,
  mobile: MobilePanel,
  ai: AiPanel,
  privacy: PrivacyPanel,
  shortcuts: ShortcutsPanel,
  support: SupportPanel,
  supporters: SupportersPanel,
  sponsor: SponsorPanel,
};

function scrollArea(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-scroll-area]");
}

/** Notes where someone was when they leave, and takes them back there if they return soon. */
function useReturnPoint(section: string) {
  const location = useLocation();
  const scroll = (location.state as { scroll?: number } | null)?.scroll;
  useLayoutEffect(() => {
    const area = scrollArea();
    if (area && scroll !== undefined) {
      area.scrollTop = scroll;
    }
    return () => rememberSection(section, scrollArea()?.scrollTop ?? 0);
  }, [section, scroll]);
}

export function SettingsPage() {
  const { section } = useParams();
  if (section === undefined) {
    const recent = recentSection();
    return (
      <Navigate
        to={`/settings/${recent?.section ?? "general"}`}
        replace
        state={recent ? { scroll: recent.scroll } : undefined}
      />
    );
  }
  if (!(section in PANELS)) {
    return <Navigate to="/settings/general" replace />;
  }
  return <Section name={section as keyof typeof PANELS} />;
}

function Section({ name }: { name: keyof typeof PANELS }) {
  const { t } = useTranslation();
  const railHost = useRail("settings");
  const aero = useAero();
  useReturnPoint(name);
  const Active = PANELS[name];
  return (
    <>
      <PageHeader title={t("nav.settings")}>
        {/* Vista closes a window with its red button, so that theme offers one here too. */}
        {aero ? (
          <Link
            to="/"
            aria-label={t("settings.back")}
            title={t("settings.back")}
            className="statly-close"
          >
            <X size={15} />
          </Link>
        ) : null}
      </PageHeader>
      <Active />
      {railHost ? createPortal(<SettingsRail />, railHost) : null}
    </>
  );
}
