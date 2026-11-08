import type { EChartsOption } from "echarts";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import type { EChartsType } from "echarts/core";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

use([
  BarChart,
  CanvasRenderer,
  GridComponent,
  LegendComponent,
  LineChart,
  MarkLineComponent,
  PieChart,
  TooltipComponent,
]);

const RESIZE_SETTLE_MS = 90;

/** Draws an ECharts option. Loaded on demand, because ECharts is the largest dependency. */
export default function EChart({ option, label }: { option: EChartsOption; label: string }) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const latestOption = useRef(option);

  useEffect(() => {
    latestOption.current = option;
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const node = element.current;
    if (!node) {
      return;
    }
    let settle: ReturnType<typeof setTimeout> | undefined;
    const fit = () => {
      if (node.clientWidth === 0 || node.clientHeight === 0) {
        return;
      }
      if (chart.current) {
        // Redrawing a chart takes too long for every frame of an animation next to it.
        clearTimeout(settle);
        settle = setTimeout(() => chart.current?.resize(), RESIZE_SETTLE_MS);
      } else {
        chart.current = init(node);
        chart.current.setOption(latestOption.current, { notMerge: true });
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => {
      observer.disconnect();
      clearTimeout(settle);
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  return <div ref={element} role="img" aria-label={label} className="h-full w-full" />;
}
