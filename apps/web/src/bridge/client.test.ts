import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeClient, BridgeError } from "./client.ts";

function setup(timeoutMs?: number) {
  const sent: string[] = [];
  const client = new BridgeClient({ send: (request) => sent.push(request) }, timeoutMs);
  return { client, sent };
}

function lastId(sent: string[]): number {
  return JSON.parse(sent.at(-1) ?? "{}").id;
}

describe("BridgeClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches responses to their calls by id", async () => {
    const { client, sent } = setup();
    const first = client.call("system.ping", { nonce: "a" });
    const firstId = lastId(sent);
    const second = client.call("system.ping", { nonce: "b" });
    client.resolve({ id: lastId(sent), ok: true, result: { nonce: "b" } });
    client.resolve({ id: firstId, ok: true, result: { nonce: "a" } });
    await expect(first).resolves.toEqual({ nonce: "a" });
    await expect(second).resolves.toEqual({ nonce: "b" });
  });

  it("turns error responses into BridgeError with the contract code", async () => {
    const { client, sent } = setup();
    const call = client.call("system.collectionSummary", {});
    client.resolve({
      id: lastId(sent),
      ok: false,
      error: { code: "collection_unavailable", message: "closed" },
    });
    await expect(call).rejects.toMatchObject({ code: "collection_unavailable" });
  });

  it("rejects instead of hanging when Python never answers", async () => {
    vi.useFakeTimers();
    const { client } = setup(100);
    const call = client.call("system.info", {});
    vi.advanceTimersByTime(101);
    await expect(call).rejects.toBeInstanceOf(BridgeError);
  });

  it("ignores late answers after a timeout", async () => {
    vi.useFakeTimers();
    const { client, sent } = setup(100);
    const call = client.call("system.info", {});
    vi.advanceTimersByTime(101);
    await expect(call).rejects.toMatchObject({ code: "timeout" });
    expect(() => client.resolve({ id: lastId(sent), ok: true, result: null })).not.toThrow();
  });

  it("delivers events until the listener unsubscribes", () => {
    const { client } = setup();
    const listener = vi.fn();
    const stop = client.on("host.themeChanged", listener);
    client.emit("host.themeChanged", { nightMode: true } as never);
    stop();
    client.emit("host.themeChanged", { nightMode: false } as never);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
