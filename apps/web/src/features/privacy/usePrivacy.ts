import type { ChangeEntry, PermissionId, PermissionState } from "@statly/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { bridge } from "../../bridge/index.ts";

export const PERMISSIONS_KEY = ["permissions"];
export const CHANGES_KEY = ["changes"];

/** What Statly may do. Allowing opens Python's own dialog, so this page only asks for it. */
export function usePermissions() {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: PERMISSIONS_KEY,
    queryFn: () => bridge.call("permissions.list", {}),
  });
  useEffect(
    () =>
      bridge.on("permissions.changed", () => {
        void client.invalidateQueries({ queryKey: PERMISSIONS_KEY });
      }),
    [client],
  );
  const settle = (states: PermissionState[]) => {
    client.setQueryData(PERMISSIONS_KEY, states);
    // The assistant and the phone card show the same permissions in their own sections.
    void client.invalidateQueries({ queryKey: ["ai.status"] });
    void client.invalidateQueries({ queryKey: ["mobile.status"] });
  };
  const request = useMutation({
    mutationFn: (id: PermissionId) => bridge.call("permissions.request", { id }),
    onSuccess: settle,
  });
  const revoke = useMutation({
    mutationFn: (id: PermissionId) => bridge.call("permissions.revoke", { id }),
    onSuccess: settle,
  });
  return { list, request, revoke };
}

/** What Statly changed in Anki, newest first, with undo where it still applies. */
export function useAnkiChanges() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: CHANGES_KEY, queryFn: () => bridge.call("changes.list", {}) });
  useEffect(
    () =>
      bridge.on("changes.applied", () => {
        void client.invalidateQueries({ queryKey: CHANGES_KEY });
      }),
    [client],
  );
  const undo = useMutation({
    mutationFn: (id: string) => bridge.call("changes.undo", { id }),
    onSuccess: (entries: ChangeEntry[]) => client.setQueryData(CHANGES_KEY, entries),
  });
  return { list, undo };
}
