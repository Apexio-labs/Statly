import { useTranslation } from "@statly/i18n";
import { useState } from "react";
import { Link, NavLink } from "react-router";
import {
  AppearanceIcon,
  BackIcon,
  BotIcon,
  DashboardIcon,
  GeneralIcon,
  KeyboardIcon,
  MobileIcon,
  NewsIcon,
  PrivacyIcon,
  SponsorIcon,
  SupportersIcon,
  SupportIcon,
  type ThemedIcon,
  WallpaperIcon,
} from "../../components/icons.tsx";

export const PRIMARY_SECTIONS = {
  general: GeneralIcon,
  news: NewsIcon,
  appearance: AppearanceIcon,
  wallpaper: WallpaperIcon,
  dashboard: DashboardIcon,
  mobile: MobileIcon,
  ai: BotIcon,
  privacy: PrivacyIcon,
  shortcuts: KeyboardIcon,
} as const satisfies Record<string, ThemedIcon>;

export const SECONDARY_SECTIONS = {
  support: SupportIcon,
  supporters: SupportersIcon,
  sponsor: SponsorIcon,
} as const satisfies Record<string, ThemedIcon>;

export type SectionName = keyof typeof PRIMARY_SECTIONS | keyof typeof SECONDARY_SECTIONS;

function Item({ name, icon: Icon }: { name: SectionName; icon: ThemedIcon }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={`/settings/${name}`}
      className={({ isActive }) =>
        `flex min-h-[38px] items-center gap-2 rounded-control px-2.5 text-[13px] font-semibold no-underline hover:bg-hover ${
          isActive ? "bg-selected text-text" : "text-muted"
        }`
      }
    >
      <Icon size={17} className="shrink-0" />
      <span className="min-w-0 truncate">{t(`settings.sections.${name}.title`)}</span>
    </NavLink>
  );
}

export function SettingsRail() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();

  function matches(name: SectionName): boolean {
    const texts = [t(`settings.sections.${name}.title`), t(`settings.sections.${name}.note`)];
    return texts.some((text) => text.toLowerCase().includes(needle));
  }

  const entries = (sections: Record<string, ThemedIcon>) =>
    (Object.entries(sections) as [SectionName, ThemedIcon][]).filter(([name]) => matches(name));

  return (
    <div className="flex h-full flex-col gap-1 p-2.5">
      <div className="flex items-center gap-1.5 pb-1">
        <Link
          to="/"
          aria-label={t("settings.back")}
          title={t("settings.back")}
          className="grid size-8 place-items-center rounded-control text-muted hover:bg-hover"
        >
          <BackIcon size={18} />
        </Link>
        <h2 className="m-0 text-[13px] font-bold">{t("nav.settings")}</h2>
      </div>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("settings.search")}
        aria-label={t("settings.search")}
        className="mb-1 h-9 w-full rounded-control border border-line bg-control px-3 text-[13px] text-text outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/40"
      />
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {entries(PRIMARY_SECTIONS).map(([name, icon]) => (
          <Item key={name} name={name} icon={icon} />
        ))}
      </nav>
      <nav className="flex flex-col gap-0.5 border-t border-line pt-2">
        {entries(SECONDARY_SECTIONS).map(([name, icon]) => (
          <Item key={name} name={name} icon={icon} />
        ))}
      </nav>
    </div>
  );
}
