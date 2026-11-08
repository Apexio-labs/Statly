import type { Goal, GoalDraft, GoalStatus } from "@statly/contract";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { bridge } from "../../bridge/index.ts";

export const GOALS_KEY = ["goals"];
// Under the statistics root, so a sync or the end of a review session counts goals again too.
const STATUS_KEY = ["statistics", "goals.status"];
const PREVIEW_DELAY_MS = 250;

/** Python counts goals in the background and says so, or another window changed one. */
export function useGoalUpdates() {
  const client = useQueryClient();
  useEffect(
    () =>
      bridge.on("goals.changed", () => {
        void client.invalidateQueries({ queryKey: GOALS_KEY });
        void client.invalidateQueries({ queryKey: STATUS_KEY });
      }),
    [client],
  );
}

export function useGoals() {
  return useQuery({
    queryKey: GOALS_KEY,
    queryFn: () => bridge.call("goals.list", {}),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** A goal's numbers for today. When the Anki day changes while the page is open, it counts anew. */
export function useGoalStatus(id: string) {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: [...STATUS_KEY, id],
    queryFn: () => bridge.call("goals.status", { id }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const refreshAt = status.data?.refreshAt;
  useEffect(() => {
    if (refreshAt === undefined) {
      return;
    }
    const wait = Math.max(1000, refreshAt * 1000 - Date.now() + 1000);
    const timer = setTimeout(
      () => void client.invalidateQueries({ queryKey: [...STATUS_KEY, id] }),
      wait,
    );
    return () => clearTimeout(timer);
  }, [client, id, refreshAt]);
  return status;
}

/** Live numbers while setting a goal up. Typing waits a moment, and the last numbers stay. */
export function useGoalPreview(draft: GoalDraft | null) {
  const [settled, setSettled] = useState(draft);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(draft), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft]);
  return useQuery<GoalStatus>({
    queryKey: ["goals.preview", settled],
    queryFn: () => bridge.call("goals.preview", { goal: settled as GoalDraft }),
    enabled: settled !== null && settled.config.decks.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useGoalDecks() {
  return useQuery({
    queryKey: ["goals.decks"],
    queryFn: () => bridge.call("goals.decks", {}),
    staleTime: 60_000,
  });
}

export function useGoalActions() {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: GOALS_KEY });
    void client.invalidateQueries({ queryKey: STATUS_KEY });
  };
  const save = useMutation({
    mutationFn: (goal: GoalDraft) => bridge.call("goals.save", { goal }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => bridge.call("goals.delete", { id }),
    onSuccess: () => {
      refresh();
      // Its widgets leave the dashboard, which Python works out when it is read again.
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const archive = useMutation({
    mutationFn: (goal: Goal) =>
      bridge.call("goals.save", {
        goal: { id: goal.id, name: goal.name, archived: !goal.archived, config: goal.config },
      }),
    onSuccess: refresh,
  });
  /**
   * Saves a copy as a new goal. Python refuses it when the exam is over or its decks are gone;
   * then the caller opens the setup with the copy instead.
   */
  const duplicate = useMutation({
    mutationFn: ({ goal, name }: { goal: Goal; name: string }) =>
      bridge.call("goals.save", {
        goal: { id: null, name: name.slice(0, 80), archived: false, config: goal.config },
      }),
    onSuccess: refresh,
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) => bridge.call("goals.acknowledge", { id }),
  });
  /** Python works out the limits and asks in its own popup. The page only names the goal. */
  const raiseLimit = useMutation({
    mutationFn: (id: string) => bridge.call("goals.raiseLimit", { id }),
    onSuccess: (result) => {
      if (result.applied) {
        refresh();
        void client.invalidateQueries({ queryKey: ["changes"] });
      }
    },
  });
  const openDeckOptions = useMutation({
    mutationFn: (deckId: number) => bridge.call("goals.openDeckOptions", { deckId }),
  });
  return { save, remove, archive, duplicate, acknowledge, raiseLimit, openDeckOptions };
}
