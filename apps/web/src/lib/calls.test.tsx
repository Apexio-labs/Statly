import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useStatistic, useStatisticsUpdates } from "./calls.ts";

const bridge = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  return {
    call: vi.fn(),
    on: (event: string, listener: () => void) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    emit: (event: string) => listeners.get(event)?.(),
  };
});
vi.mock("../bridge/index.ts", () => ({ bridge }));

function renderStatistic() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => {
      useStatisticsUpdates();
      return useStatistic("statistics.today", {});
    },
    { wrapper },
  );
}

describe("statistics updates while studying", () => {
  it("counts once more after loading instead of piling up a round per answer", async () => {
    const answers: Array<(value: unknown) => void> = [];
    bridge.call.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { result } = renderStatistic();
    await waitFor(() => expect(answers).toHaveLength(1));
    act(() => answers[0]?.({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => bridge.emit("statistics.changed"));
    await waitFor(() => expect(answers).toHaveLength(2));
    // Three more answers arrive while the window is still counting.
    act(() => {
      bridge.emit("statistics.changed");
      bridge.emit("statistics.changed");
      bridge.emit("statistics.changed");
    });
    expect(answers).toHaveLength(2);

    act(() => answers[1]?.({}));
    await waitFor(() => expect(answers).toHaveLength(3));
    act(() => answers[2]?.({}));
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(answers).toHaveLength(3);
  });
});
