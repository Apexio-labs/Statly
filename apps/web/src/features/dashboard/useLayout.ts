import type { DashboardLayout, DeviceLayouts } from "@statly/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bridge } from "../../bridge/index.ts";

const LAYOUT_KEY = ["dashboard"];

export function useLayout() {
  const client = useQueryClient();
  const stored = useQuery({
    queryKey: LAYOUT_KEY,
    queryFn: () => bridge.call("dashboard.get", {}),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const save = useMutation({
    mutationFn: (layout: DashboardLayout) => bridge.call("dashboard.save", { layout }),
    onSuccess: (_result, layout) => client.setQueryData(LAYOUT_KEY, layout),
  });
  const saveAll = useMutation({
    mutationFn: (params: { layout: DashboardLayout; devices: DeviceLayouts }) =>
      bridge.call("dashboard.save", params),
    onSuccess: (_result, { layout }) => client.setQueryData(LAYOUT_KEY, layout),
  });
  const reset = useMutation({
    mutationFn: () => bridge.call("dashboard.reset", {}),
    onSuccess: (layout) => client.setQueryData(LAYOUT_KEY, layout),
  });
  return { layout: stored.data, save, saveAll, reset };
}
