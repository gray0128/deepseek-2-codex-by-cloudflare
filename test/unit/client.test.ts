import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/config";
import { openDeepSeekStream, UpstreamFailure } from "../../src/deepseek/client";
import type { DeepSeekRequest } from "../../src/deepseek/types";

const config = {
  UPSTREAM_BASE_URL: "https://api.deepseek.com",
  FIRST_BYTE_TIMEOUT_MS: 10,
  CHUNK_IDLE_TIMEOUT_MS: 10,
  TOTAL_TIMEOUT_MS: 30,
} as AppConfig;
const body = {
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
  stream_options: { include_usage: true },
  thinking: { type: "disabled" },
} satisfies DeepSeekRequest;

function pendingFetch(): typeof fetch {
  return vi.fn((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
}

function oneChunkThenPending(): Response {
  let sent = false;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new Uint8Array([1]));
        }
      },
    }),
  );
}

describe("DeepSeek streaming client", () => {
  it("classifies first-byte timeout without exposing an upstream body", async () => {
    await expect(
      openDeepSeekStream({
        config,
        apiKey: "secret",
        body,
        incomingSignal: new AbortController().signal,
        fetch: pendingFetch(),
      }),
    ).rejects.toMatchObject({ kind: "first_byte_timeout" });
  });

  it("classifies upstream rate limits and keeps response text private", async () => {
    const privateText = "private upstream response";
    await expect(
      openDeepSeekStream({
        config,
        apiKey: "secret",
        body,
        incomingSignal: new AbortController().signal,
        fetch: async () =>
          new Response(privateText, { status: 429, headers: { "retry-after": "7" } }),
      }),
    ).rejects.toEqual(
      expect.objectContaining({ kind: "upstream_rate_limited", retryAfterSeconds: 7 }),
    );
    try {
      await openDeepSeekStream({
        config,
        apiKey: "secret",
        body,
        incomingSignal: new AbortController().signal,
        fetch: async () => new Response(privateText, { status: 500 }),
      });
    } catch (error) {
      expect(String(error)).not.toContain(privateText);
    }
  });

  it("propagates incoming cancellation", async () => {
    const incoming = new AbortController();
    const promise = openDeepSeekStream({
      config,
      apiKey: "secret",
      body,
      incomingSignal: incoming.signal,
      fetch: pendingFetch(),
    });
    incoming.abort();
    await expect(promise).rejects.toMatchObject({ kind: "client_aborted" });
  });

  it("classifies an idle stream", async () => {
    const stream = await openDeepSeekStream({
      config,
      apiKey: "secret",
      body,
      incomingSignal: new AbortController().signal,
      fetch: async () => oneChunkThenPending(),
    });
    const reader = stream.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await expect(reader.read()).rejects.toMatchObject({ kind: "idle_timeout" });
  });

  it("enforces the total request deadline", async () => {
    const stream = await openDeepSeekStream({
      config: { ...config, CHUNK_IDLE_TIMEOUT_MS: 100, TOTAL_TIMEOUT_MS: 10 },
      apiKey: "secret",
      body,
      incomingSignal: new AbortController().signal,
      fetch: async () => oneChunkThenPending(),
    });
    const reader = stream.getReader();
    await reader.read();
    await expect(reader.read()).rejects.toMatchObject({ kind: "total_timeout" });
  });

  it("aborts upstream when downstream cancels", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const stream = await openDeepSeekStream({
      config,
      apiKey: "secret",
      body,
      incomingSignal: new AbortController().signal,
      fetch: async (_input, init) => {
        upstreamSignal = init?.signal ?? undefined;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
          }),
        );
      },
    });
    await stream.cancel();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("uses typed failures", () => {
    expect(new UpstreamFailure("total_timeout", "timed out").kind).toBe("total_timeout");
  });
});
