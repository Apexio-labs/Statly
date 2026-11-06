import type { ExamStatus } from "@statly/contract";
import type { useTranslation } from "@statly/i18n";

/** A line for the middle of the ring: what to say depends on how far the day has come. */
export function motivation(
  status: Pick<ExamStatus, "tone" | "target" | "done" | "state" | "streak" | "totals">,
): { key: string; values: Record<string, number> } {
  const left = Math.max(0, status.target - status.done);
  if (status.state === "finished" && status.target === 0) {
    return { key: "goals.motivation.finished", values: {} };
  }
  const waiting = status.totals.waiting ?? 0;
  if (status.target === 0 && status.totals.open === 0 && waiting > 0) {
    return { key: "goals.motivation.waiting", values: { count: waiting } };
  }
  if (status.tone === "rest") {
    return { key: "goals.motivation.rest", values: {} };
  }
  if (status.tone === "done") {
    return status.streak.current > 1
      ? { key: "goals.motivation.doneStreak", values: { count: status.streak.current } }
      : { key: "goals.motivation.done", values: {} };
  }
  if (status.done === 0) {
    return status.streak.atRisk && status.streak.current > 1
      ? { key: "goals.motivation.keepStreak", values: { count: status.streak.current, left } }
      : { key: "goals.motivation.start", values: { count: status.target } };
  }
  const share = status.done / status.target;
  if (share >= 0.75) {
    return { key: "goals.motivation.almost", values: { count: left } };
  }
  if (share >= 0.4) {
    return { key: "goals.motivation.halfway", values: { count: left } };
  }
  return { key: "goals.motivation.going", values: { count: left } };
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** A study time in whole minutes, as hours and minutes once it is long. */
export function studyTime(seconds: number, t: Translate): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60
    ? t("time.hoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t("time.minutes", { minutes });
}

/** "≈ 52 min (45–60 min)": the forecast and the range most past days fell into. */
export function studyTimeRange(
  estimate: { seconds: number; low: number; high: number },
  t: Translate,
): string {
  return t("goals.time.range", {
    time: studyTime(estimate.seconds, t),
    low: Math.max(1, Math.round(estimate.low / 60)),
    high: Math.max(1, Math.round(estimate.high / 60)),
  });
}
