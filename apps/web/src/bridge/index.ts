import { BridgeClient, type BridgeResponse, type Transport } from "./client.ts";
import { MockTransport } from "./mock.ts";

declare global {
  // Provided by Anki inside its web views.
  var pycmd: ((message: string) => void) | undefined;
  var __statlyBridge: Pick<BridgeClient, "resolve" | "emit"> | undefined;
}

const COMMAND_PREFIX = "statly:";
const POLL_MS = 10;

function isInsideAnki(): boolean {
  return location.pathname.includes("/_addons/");
}

/** Anki defines pycmd only after the page has loaded, so early calls wait for it. */
class AnkiTransport implements Transport {
  send(request: string): void {
    if (globalThis.pycmd) {
      globalThis.pycmd(COMMAND_PREFIX + request);
    } else {
      setTimeout(() => this.send(request), POLL_MS);
    }
  }
}

function createBridge(): BridgeClient {
  if (isInsideAnki()) {
    return new BridgeClient(new AnkiTransport());
  }
  const mock = new MockTransport((response: BridgeResponse) => client.resolve(response));
  const client = new BridgeClient(mock);
  return client;
}

export const bridge = createBridge();
globalThis.__statlyBridge = bridge;

export { BridgeError } from "./client.ts";
