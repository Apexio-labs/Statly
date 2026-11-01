import type {
  ErrorCode,
  EventName,
  EventPayload,
  MethodName,
  Params,
  Result,
} from "@statly/contract";

const CALL_TIMEOUT_MS = 30_000;

export type BridgeResponse =
  | { id: number | null; ok: true; result: unknown }
  | { id: number | null; ok: false; error: { code: ErrorCode | "timeout"; message: string } };

export type Transport = {
  send(request: string): void;
};

export class BridgeError extends Error {
  constructor(
    readonly code: ErrorCode | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

type Pending = {
  resolve(result: unknown): void;
  reject(error: BridgeError): void;
  timer: ReturnType<typeof setTimeout>;
};

type Listener = (payload: never) => void;

export class BridgeClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    private readonly transport: Transport,
    private readonly timeoutMs = CALL_TIMEOUT_MS,
  ) {}

  call<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError("timeout", `${method} did not answer in time.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as Pending["resolve"], reject, timer });
      this.transport.send(JSON.stringify({ id, method, params }));
    });
  }

  on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener as Listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener as Listener);
  }

  resolve(response: BridgeResponse): void {
    if (response.id === null) {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(new BridgeError(response.error.code, response.error.message));
    }
  }

  emit(event: string, payload: never): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}
