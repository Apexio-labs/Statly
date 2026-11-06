import type { GoalConfig, GoalKind } from "@statly/contract";
import { GraduationCap, type LucideIcon } from "lucide-react";
import { newExamConfig } from "./goalLogic.ts";

/**
 * Every kind of goal the app can set up. TypeScript reports a kind from the contract that is
 * missing here, so a new kind cannot be forgotten. Its texts live under `goals.kinds.<kind>`.
 */
export const GOAL_KINDS: Record<
  GoalKind,
  { icon: LucideIcon; newConfig: (today: string) => GoalConfig }
> = {
  exam: { icon: GraduationCap, newConfig: newExamConfig },
};

export function isGoalKind(kind: string | undefined): kind is GoalKind {
  return kind !== undefined && kind in GOAL_KINDS;
}
