import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../../src/config";
import { route, type SafeLogRecord } from "../../src/http/router";

const env = {
  ADAPTER_BEARER_TOKEN: "adapter-token-long-enough",
  DEEPSEEK_API_KEY: "upstream-secret",
  MODEL_ALIAS: "deepseek-codex",
  UPSTREAM_BASE_URL: "https://api.deepseek.com",
  UPSTREAM_TEXT_MODEL: "deepseek-v4-flash",
  UPSTREAM_REASONING_MODEL: "deepseek-v4-flash",
  REQUEST_MAX_BYTES: 1024,
  MESSAGE_MAX_BYTES: 128,
  FIRST_BYTE_TIMEOUT_MS: 100,
  CHUNK_IDLE_TIMEOUT_MS: 100,
  TOTAL_TIMEOUT_MS: 500,
} as unknown as RuntimeEnv;

function responsesRequest(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("https://worker.example/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ADAPTER_BEARER_TOKEN}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'),
    ),
  );
});

describe("route", () => {
  it("serves health without an environment", async () => {
    const response = await route(
      new Request("https://worker.example/healthz"),
      undefined,
      () => {},
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns a request id in structured 404 errors", async () => {
    const response = await route(
      new Request("https://worker.example/unknown", { headers: { "cf-ray": "ray-1" } }),
      env,
      () => {},
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found", request_id: "ray-1" },
    });
  });

  it("checks declared size before content type and authentication", async () => {
    const request = new Request("https://worker.example/v1/responses", {
      method: "POST",
      headers: { "content-length": "1025" },
      body: "x",
    });
    const response = await route(request, env, () => {});
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe("request_too_large");
  });

  it("checks content type before authentication", async () => {
    const request = new Request("https://worker.example/v1/responses", {
      method: "POST",
      body: "{}",
    });
    const response = await route(request, env, () => {});
    expect(response.status).toBe(415);
    expect(await errorCode(response)).toBe("unsupported_media_type");
  });

  it("rejects invalid bearer credentials", async () => {
    const response = await route(
      responsesRequest({}, { authorization: "Bearer wrong-token" }),
      env,
      () => {},
    );
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("invalid_api_key");
  });

  it("rejects unknown fields with a stable field path", async () => {
    const response = await route(
      responsesRequest({ model: "deepseek-codex", stream: true, input: "hi", unexpected: true }),
      env,
      () => {},
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request", param: "unexpected" },
    });
  });

  it("accepts Codex tool declarations as an inactive compatibility envelope", async () => {
    const response = await route(
      responsesRequest({
        model: "deepseek-codex",
        stream: true,
        input: "hello",
        tools: [{ type: "function", name: "lookup" }],
        tool_choice: "auto",
        parallel_tool_calls: true,
      }),
      env,
      () => {},
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("response.completed");
  });

  it("rejects a model outside the configured alias", async () => {
    const response = await route(
      responsesRequest({ model: "deepseek-v4-pro", stream: true, input: "hello" }),
      env,
      () => {},
    );
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("model_not_allowed");
  });

  it("logs only allowlisted metadata", async () => {
    const records: SafeLogRecord[] = [];
    const secretBody = "unique-private-body";
    await route(
      responsesRequest({ model: "deepseek-codex", stream: true, input: secretBody }),
      env,
      (record) => records.push(record),
    );
    const log = JSON.stringify(records);
    expect(log).not.toContain(secretBody);
    expect(log).not.toContain(env.ADAPTER_BEARER_TOKEN);
    expect(log).not.toContain(env.DEEPSEEK_API_KEY);
    expect(records[0]).toMatchObject({ path: "/v1/responses", status: 200 });
  });
});
