import add from "@statly/ui/assets/aero/icons/add.svg";
import ai from "@statly/ui/assets/aero/icons/ai.svg";
import appearance from "@statly/ui/assets/aero/icons/appearance.svg";
import back from "@statly/ui/assets/aero/icons/back.svg";
import bot from "@statly/ui/assets/aero/icons/bot.svg";
import calendar from "@statly/ui/assets/aero/icons/calendar.svg";
import dashboard from "@statly/ui/assets/aero/icons/dashboard.svg";
import decks from "@statly/ui/assets/aero/icons/decks.svg";
import edit from "@statly/ui/assets/aero/icons/edit.svg";
import general from "@statly/ui/assets/aero/icons/general.svg";
import goals from "@statly/ui/assets/aero/icons/goals.svg";
import home from "@statly/ui/assets/aero/icons/home.svg";
import keyboard from "@statly/ui/assets/aero/icons/keyboard.svg";
import library from "@statly/ui/assets/aero/icons/library.svg";
import mobile from "@statly/ui/assets/aero/icons/mobile.svg";
import monitor from "@statly/ui/assets/aero/icons/monitor.svg";
import news from "@statly/ui/assets/aero/icons/news.svg";
import privacy from "@statly/ui/assets/aero/icons/privacy.svg";
import settings from "@statly/ui/assets/aero/icons/settings.svg";
import sponsor from "@statly/ui/assets/aero/icons/sponsor.svg";
import statistics from "@statly/ui/assets/aero/icons/statistics.svg";
import support from "@statly/ui/assets/aero/icons/support.svg";
import supporters from "@statly/ui/assets/aero/icons/supporters.svg";
import tablet from "@statly/ui/assets/aero/icons/tablet.svg";
import wallpaper from "@statly/ui/assets/aero/icons/wallpaper.svg";
import {
  Bot,
  CalendarDays,
  ChartColumn,
  Heart,
  Home,
  Image,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  type LucideIcon,
  type LucideProps,
  Monitor,
  Newspaper,
  Pencil,
  Plus,
  Settings,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
  Tablet,
  Target,
} from "lucide-react";
import type { ComponentType } from "react";
import { useAero } from "../lib/appearance.tsx";

/** Glossy pictures need more room than lines to show what they are. */
const AERO_SCALE = 1.6;
const DEFAULT_SIZE = 24;

export type ThemedIcon = ComponentType<LucideProps>;

/** A line icon, which Frutiger Aero swaps for a bigger glossy picture of the same thing. */
function themed(Line: LucideIcon, picture: string): ThemedIcon {
  return function Icon(props: LucideProps) {
    const aero = useAero();
    if (!aero) {
      return <Line {...props} />;
    }
    const size = Math.round(Number(props.size ?? DEFAULT_SIZE) * AERO_SCALE);
    return (
      <img
        src={picture}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className={props.className}
      />
    );
  };
}

export const AddIcon = themed(Plus, add);
export const AiIcon = themed(Sparkles, ai);
export const AppearanceIcon = themed(Sun, appearance);
export const BackIcon = themed(Home, back);
export const BotIcon = themed(Bot, bot);
export const CalendarIcon = themed(CalendarDays, calendar);
export const DashboardIcon = themed(LayoutDashboard, dashboard);
export const DecksIcon = themed(LayoutGrid, decks);
export const EditIcon = themed(Pencil, edit);
export const GeneralIcon = themed(SlidersHorizontal, general);
export const GoalsIcon = themed(Target, goals);
export const HomeIcon = themed(Home, home);
export const KeyboardIcon = themed(Keyboard, keyboard);
export const LibraryIcon = themed(LayoutGrid, library);
export const MobileIcon = themed(Smartphone, mobile);
export const MonitorIcon = themed(Monitor, monitor);
export const NewsIcon = themed(Newspaper, news);
export const PrivacyIcon = themed(ShieldCheck, privacy);
export const SettingsIcon = themed(Settings, settings);
export const SponsorIcon = themed(Shirt, sponsor);
export const StatisticsIcon = themed(ChartColumn, statistics);
export const SupportIcon = themed(LifeBuoy, support);
export const SupportersIcon = themed(Heart, supporters);
export const TabletIcon = themed(Tablet, tablet);
export const WallpaperIcon = themed(Image, wallpaper);
