import { useTranslation } from "@statly/i18n";
import { createPortal } from "react-dom";
import { Navigate, useParams } from "react-router";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useRail } from "../../shell/ShellContext.tsx";
import { AiPanel } from "./panels/AiPanel.tsx";
import { AppearancePanel } from "./panels/AppearancePanel.tsx";
import { DashboardPanel } from "./panels/DashboardPanel.tsx";
import { GeneralPanel } from "./panels/GeneralPanel.tsx";
import { MobilePanel } from "./panels/MobilePanel.tsx";
import { NewsPanel } from "./panels/NewsPanel.tsx";
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
  shortcuts: ShortcutsPanel,
  support: SupportPanel,
  supporters: SupportersPanel,
  sponsor: SponsorPanel,
};

export function SettingsPage() {
  const { t } = useTranslation();
  const { section = "general" } = useParams();
  const railHost = useRail("settings");
  const Active = PANELS[section as keyof typeof PANELS];
  if (!Active) {
    return <Navigate to="/settings/general" replace />;
  }
  return (
    <>
      <PageHeader title={t("nav.settings")} />
      <Active />
      {railHost ? createPortal(<SettingsRail />, railHost) : null}
    </>
  );
}
