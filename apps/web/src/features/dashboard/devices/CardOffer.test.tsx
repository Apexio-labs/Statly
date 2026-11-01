import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCardOffer } from "./CardOffer.tsx";

const call = vi.hoisted(() => vi.fn());
vi.mock("../../../bridge/index.ts", () => ({ bridge: { call } }));

function renderOffer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCardOffer(), { wrapper });
}

describe("the card offer", () => {
  let answer: (status: { enabled: boolean }) => void;

  beforeEach(() => {
    call.mockReset();
    call.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
  });

  it("still asks someone who saves before the status has arrived", async () => {
    const { result } = renderOffer();
    const goOn = vi.fn();
    act(() => result.current.offerBefore(goOn));
    expect(goOn).not.toHaveBeenCalled();

    answer({ enabled: false });
    await waitFor(() => expect(result.current.dialog).not.toBeNull());
    expect(goOn).not.toHaveBeenCalled();
  });

  it("goes straight on when the card already exists", async () => {
    const { result } = renderOffer();
    const goOn = vi.fn();
    act(() => result.current.offerBefore(goOn));

    answer({ enabled: true });
    await waitFor(() => expect(goOn).toHaveBeenCalledOnce());
    expect(result.current.dialog).toBeNull();
  });

  it("never blocks saving when the status cannot be read", async () => {
    call.mockRejectedValue(new Error("closed"));
    const { result } = renderOffer();
    const goOn = vi.fn();
    act(() => result.current.offerBefore(goOn));

    await waitFor(() => expect(goOn).toHaveBeenCalledOnce());
    expect(result.current.dialog).toBeNull();
  });
});
