import type { AiConversation, AiMessage, AiStatus, MethodName, Params } from "@statly/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { bridge } from "../../bridge/index.ts";
import { WIDGETS_KEY } from "../widgets/useCustomWidgets.ts";

const STATUS_KEY = ["ai.status"];
const CONVERSATION_KEY = ["ai.conversation"];
const CHANGES_KEY = ["ai.changes"];
const CHATS_KEY = ["ai.chats"];

type StatusMethod =
  | "ai.configure"
  | "ai.setKey"
  | "ai.removeKey"
  | "ai.enableKeyLock"
  | "ai.disableKeyLock"
  | "ai.unlockKeys"
  | "ai.changeKeyPassword"
  | "ai.lockKeys"
  | "ai.forgetKeys"
  | "ai.consent"
  | "ai.setAutoMode"
  | "ai.setAutoExternal"
  | "ai.setExternal"
  | "ai.setPermission"
  | "ai.setExternalPermissions"
  | "ai.setKeepChats";

export function useAiStatus() {
  return useQuery({ queryKey: STATUS_KEY, queryFn: () => bridge.call("ai.status", {}) });
}

/** A change to the assistant's setup. The answer is always the new status. */
export function useAiSetting<M extends StatusMethod>(method: M) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: Params<M>) => bridge.call(method, params) as Promise<AiStatus>,
    onSuccess: (status) => client.setQueryData(STATUS_KEY, status),
  });
}

export function useConversation() {
  const client = useQueryClient();
  const conversation = useQuery({
    queryKey: CONVERSATION_KEY,
    queryFn: () => bridge.call("ai.conversation", {}),
  });
  const [written, setWritten] = useState<Record<string, string>>({});

  useEffect(
    () =>
      bridge.on("ai.changed", () => {
        void client.invalidateQueries({ queryKey: CONVERSATION_KEY });
        void client.invalidateQueries({ queryKey: CHANGES_KEY });
      }),
    [client],
  );
  useEffect(
    () =>
      bridge.on("ai.text", ({ messageId, delta }) =>
        setWritten((current) => ({
          ...current,
          [messageId]: (current[messageId] ?? "") + delta,
        })),
      ),
    [],
  );

  const data: AiConversation | undefined = conversation.data;
  const messages: AiMessage[] = (data?.messages ?? []).map((message) => {
    const live = written[message.id] ?? "";
    return live.length > message.text.length ? { ...message, text: live } : message;
  });
  return {
    messages,
    proposals: data?.proposals ?? [],
    running: data?.running ?? false,
    waiting: data?.waiting ?? null,
    askReview: data?.askReview ?? false,
    title: data?.title ?? "",
    error: data?.error ?? null,
  };
}

export function useChats() {
  const client = useQueryClient();
  const chats = useQuery({ queryKey: CHATS_KEY, queryFn: () => bridge.call("ai.chats", {}) });
  useEffect(
    () => bridge.on("ai.changed", () => void client.invalidateQueries({ queryKey: CHATS_KEY })),
    [client],
  );
  return chats;
}

export function useChanges() {
  return useQuery({ queryKey: CHANGES_KEY, queryFn: () => bridge.call("ai.changes", {}) });
}

export function useAiCall<M extends MethodName>(method: M) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: Params<M>) => bridge.call(method, params),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CONVERSATION_KEY });
      void client.invalidateQueries({ queryKey: CHANGES_KEY });
      void client.invalidateQueries({ queryKey: CHATS_KEY });
      // An answer in the chat can grant a permission for good.
      void client.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
}

/** Changes can arrive while the panel is closed, from the automatic mode or another app. */
export function useAiChangesApply() {
  const client = useQueryClient();
  useEffect(
    () =>
      bridge.on("ai.applied", () => {
        for (const key of ["settings", "dashboard", ...WIDGETS_KEY]) {
          void client.invalidateQueries({ queryKey: [key] });
        }
        void client.invalidateQueries({ queryKey: CHANGES_KEY });
      }),
    [client],
  );
}
