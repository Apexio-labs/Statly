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
  // The new layout shows at once, so a second change right after the first builds on it instead
  // of on the old one. If Python refuses it, the stored layout is read again.
  const save = useMutation({
    mutationFn: (layout: DashboardLayout) => bridge.call("dashboard.save", { layout }),
    onMutate: (layout) => client.setQueryData(LAYOUT_KEY, layout),
    onError: () => client.invalidateQueries({ queryKey: LAYOUT_KEY }),
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
