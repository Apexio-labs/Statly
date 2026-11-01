import type { MethodName, Params, Result } from "@statly/contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { bridge } from "../bridge/index.ts";

const STATISTICS_KEY = "statistics";

/** Reads a statistic. All statistics share one key root, so they refresh together. */
export function useStatistic<M extends MethodName & `statistics.${string}`>(
  method: M,
  params: Params<M>,
  enabled = true,
) {
  return useQuery({
    queryKey: [STATISTICS_KEY, method, params],
    queryFn: () => bridge.call(method, params) as Promise<Result<M>>,
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });
}

/** Refreshes statistics after Python reports new data. */
export function useStatisticsUpdates() {
  const client = useQueryClient();
  useEffect(
    () =>
      bridge.on("statistics.changed", () => {
        void client.invalidateQueries({ queryKey: [STATISTICS_KEY] });
      }),
    [client],
  );
}
