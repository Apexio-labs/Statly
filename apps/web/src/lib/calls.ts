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

/**
 * Refreshes statistics after Python reports new data, which happens after every answer while
 * someone studies. Answering a card waits behind Statly's queries, so news that arrives while
 * statistics are still loading waits for them and then counts once, instead of piling up
 * rounds. A hidden window waits until it shows again.
 */
export function useStatisticsUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    let waiting = false;
    const refresh = () => {
      const busy = client.isFetching({ queryKey: [STATISTICS_KEY] }) > 0;
      if (busy || document.visibilityState === "hidden") {
        waiting = true;
        return;
      }
      waiting = false;
      void client.invalidateQueries({ queryKey: [STATISTICS_KEY] });
    };
    const retry = () => {
      if (waiting) refresh();
    };
    const stopListening = bridge.on("statistics.changed", refresh);
    const stopWatching = client.getQueryCache().subscribe(retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      stopListening();
      stopWatching();
      document.removeEventListener("visibilitychange", retry);
    };
  }, [client]);
}
