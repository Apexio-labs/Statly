import { useTranslation } from "@statly/i18n";
import { Target } from "lucide-react";
import { AddIcon, GoalsIcon } from "../../components/icons.tsx";
import type { Crumb } from "../../components/PageHeader.tsx";

/** The pages above the goal pages, for the arrow back and the menu on the title. */
export function useGoalCrumbs() {
  const { t } = useTranslation();
  const goals: Crumb = { label: t("goals.title"), to: "/goals", icon: <GoalsIcon size={14} /> };
  return {
    goals,
    newGoal: { label: t("goals.new"), to: "/goals/new", icon: <AddIcon size={14} /> } as Crumb,
    goal: (id: string, name: string): Crumb => ({
      label: name,
      to: `/goals/${id}`,
      icon: <Target size={14} />,
    }),
  };
}
