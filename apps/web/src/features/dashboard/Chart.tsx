import type { EChartsOption } from "@statly/charts";
import { lazy, Suspense } from "react";

const EChart = lazy(() => import("@statly/charts/EChart"));

export function Chart({ option, label }: { option: EChartsOption; label: string }) {
  return (
    <Suspense fallback={<div className="h-full animate-pulse rounded-control bg-hover" />}>
      <EChart option={option} label={label} />
    </Suspense>
  );
}
