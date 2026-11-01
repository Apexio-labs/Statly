import type { CustomWidget } from "@statly/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bridge } from "../../bridge/index.ts";

export const WIDGETS_KEY = ["widgets"];
const LAYOUT_KEY = ["dashboard"];

export function useCustomWidgets() {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: WIDGETS_KEY,
    queryFn: () => bridge.call("widgets.list", {}),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const refresh = () => client.invalidateQueries({ queryKey: WIDGETS_KEY });
  const save = useMutation({
    mutationFn: (widget: CustomWidget) => bridge.call("widgets.save", { widget }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => bridge.call("widgets.delete", { id }),
    onSuccess: async () => {
      await refresh();
      await client.invalidateQueries({ queryKey: LAYOUT_KEY });
    },
  });
  const importPackage = useMutation({
    mutationFn: () => bridge.call("widgets.import", {}),
    onSuccess: refresh,
  });
  return { widgets: list.data ?? [], loaded: list.isSuccess, save, remove, importPackage, refresh };
}

/** Media arrives as data URLs, so each file is fetched once and kept. */
export function useMedia(id: string | undefined) {
  const media = useQuery({
    queryKey: ["widgets.media", id],
    queryFn: () => bridge.call("widgets.media", { id: id ?? "" }),
    enabled: id !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return media.data?.url ?? undefined;
}
