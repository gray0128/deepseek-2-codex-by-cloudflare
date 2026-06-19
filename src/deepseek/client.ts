import type { AppConfig } from "../config";
import type { DeepSeekRequest } from "./types";

export type UpstreamFailureKind =
  | "client_aborted"
  | "first_byte_timeout"
  | "idle_timeout"
  | "total_timeout"
  | "upstream_auth"
  | "upstream_rate_limited"
  | "upstream_rejected"
  | "upstream_5xx"
  | "upstream_closed"
  | "connection_error";

export class UpstreamFailure extends Error {
  constructor(
    readonly kind: UpstreamFailureKind,
    message: string,
    readonly upstreamStatus?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "UpstreamFailure";
  }
}

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface OpenStreamOptions {
  config: AppConfig;
  apiKey: string;
  body: DeepSeekRequest;
  incomingSignal: AbortSignal;
  fetch?: FetchImplementation;
}

function abortReason(controller: AbortController, fallback: unknown): UpstreamFailure {
  return controller.signal.reason instanceof UpstreamFailure
    ? controller.signal.reason
    : fallback instanceof UpstreamFailure
      ? fallback
      : new UpstreamFailure("connection_error", "DeepSeek connection failed.");
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  failure: UpstreamFailure,
  controller: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(controller, controller.signal.reason));
    };
    const timer = setTimeout(() => {
      controller.abort(failure);
    }, milliseconds);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
    promise.then(
      (value) => {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        reject(abortReason(controller, error));
      },
    );
  });
}

async function discardLimitedBody(response: Response, limit = 4096): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  let read = 0;
  try {
    while (read <= limit) {
      const result = await reader.read();
      if (result.done) return;
      read += result.value.byteLength;
      if (read > limit) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function parseRetryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

async function classifyResponse(response: Response): Promise<never> {
  await discardLimitedBody(response);
  if (response.status === 401 || response.status === 403) {
    throw new UpstreamFailure("upstream_auth", "DeepSeek authentication failed.", response.status);
  }
  if (response.status === 429) {
    throw new UpstreamFailure(
      "upstream_rate_limited",
      "DeepSeek rate limit exceeded.",
      response.status,
      parseRetryAfter(response),
    );
  }
  if (response.status >= 500) {
    throw new UpstreamFailure("upstream_5xx", "DeepSeek service failed.", response.status);
  }
  throw new UpstreamFailure("upstream_rejected", "DeepSeek rejected the request.", response.status);
}

export async function openDeepSeekStream({
  config,
  apiKey,
  body,
  incomingSignal,
  fetch: fetchImplementation = fetch,
}: OpenStreamOptions): Promise<ReadableStream<Uint8Array>> {
  const controller = new AbortController();
  const onIncomingAbort = () => {
    controller.abort(new UpstreamFailure("client_aborted", "Client cancelled the request."));
  };
  incomingSignal.addEventListener("abort", onIncomingAbort, { once: true });
  if (incomingSignal.aborted) onIncomingAbort();

  const totalFailure = new UpstreamFailure("total_timeout", "DeepSeek request timed out.");
  const totalTimer = setTimeout(() => controller.abort(totalFailure), config.TOTAL_TIMEOUT_MS);
  const cleanup = () => {
    clearTimeout(totalTimer);
    incomingSignal.removeEventListener("abort", onIncomingAbort);
  };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  let firstChunk: Uint8Array;
  try {
    const first = await withTimeout(
      (async () => {
        const response = await fetchImplementation(
          `${config.UPSTREAM_BASE_URL.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        if (!response.ok) await classifyResponse(response);
        if (!response.body) {
          throw new UpstreamFailure("upstream_closed", "DeepSeek response body is missing.");
        }
        reader = response.body.getReader();
        return reader.read();
      })(),
      config.FIRST_BYTE_TIMEOUT_MS,
      new UpstreamFailure("first_byte_timeout", "DeepSeek did not send a first byte in time."),
      controller,
    );
    if (first.done) {
      throw new UpstreamFailure("upstream_closed", "DeepSeek stream ended before the first byte.");
    }
    firstChunk = first.value;
  } catch (error) {
    cleanup();
    throw abortReason(controller, error);
  }

  return new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(firstChunk);
    },
    async pull(streamController) {
      try {
        const result = await withTimeout(
          reader.read(),
          config.CHUNK_IDLE_TIMEOUT_MS,
          new UpstreamFailure("idle_timeout", "DeepSeek stream became idle."),
          controller,
        );
        if (result.done) {
          cleanup();
          streamController.close();
          return;
        }
        streamController.enqueue(result.value);
      } catch (error) {
        cleanup();
        streamController.error(abortReason(controller, error));
      }
    },
    async cancel(reason) {
      controller.abort(new UpstreamFailure("client_aborted", "Downstream cancelled the stream."));
      cleanup();
      await reader.cancel(reason).catch(() => {});
    },
  });
}
