import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import worker from "./worker.mjs";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function requestBody() {
  return {
    model: "synthetic-codex",
    instructions: "Synthetic instructions.",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Reply with exactly: hello" }],
      },
    ],
    stream: true,
  };
}

function request() {
  return new Request("https://probe.example/v1/responses", {
    method: "POST",
    headers: {
      authorization: ["Bearer", "synthetic-probe-token"].join(" "),
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody()),
  });
}

function chunkedResponse(bytes, cuts) {
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = cuts.shift() ?? bytes.length - offset;
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  }));
}

test("streams split UTF-8 content and completes only after [DONE]", async () => {
  const upstreamText = [
    'data: {"choices":[{"delta":{"content":"你"}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"好"}}]}',
    "",
    "data: [DONE]",
    "",
    "",
  ].join("\r\n");
  const bytes = new TextEncoder().encode(upstreamText);
  let upstreamRequest;
  globalThis.fetch = async (url, init) => {
    upstreamRequest = { url, init };
    return chunkedResponse(bytes, [1, 2, 3, 1, 5, 2, 7]);
  };

  const response = await worker.fetch(request(), {
    DEEPSEEK_API_KEY: "synthetic-key",
    PROBE_CLIENT_TOKEN: "synthetic-probe-token",
  });
  const events = (await response.text()).trim().split("\n\n").map((block) => {
    const data = block.split("\n").find((line) => line.startsWith("data: "));
    return JSON.parse(data.slice(6));
  });

  assert.equal(response.status, 200);
  assert.equal(events.at(-1).type, "response.completed");
  assert.equal(events.at(-1).response.output[0].content[0].text, "你好");
  assert.deepEqual(
    events.filter((event) => event.type === "response.output_text.delta").map((event) => event.delta),
    ["你", "好"],
  );
  assert.equal(upstreamRequest.url, "https://api.deepseek.com/chat/completions");
  const deepSeekBody = JSON.parse(upstreamRequest.init.body);
  assert.equal(deepSeekBody.model, "deepseek-v4-flash");
  assert.deepEqual(deepSeekBody.thinking, { type: "disabled" });
  assert.deepEqual(deepSeekBody.stream_options, { include_usage: true });
});

test("does not emit response.completed for a truncated upstream stream", async () => {
  const bytes = new TextEncoder().encode(
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
  );
  globalThis.fetch = async () => chunkedResponse(bytes, [2, 1, 4]);

  const response = await worker.fetch(request(), {
    DEEPSEEK_API_KEY: "synthetic-key",
    PROBE_CLIENT_TOKEN: "synthetic-probe-token",
  });
  const reader = response.body.getReader();
  const chunks = [];
  let failed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch {
    failed = true;
  }

  const partial = new TextDecoder().decode(
    Uint8Array.from(chunks.flatMap((chunk) => [...chunk])),
  );
  assert.equal(failed, true);
  assert.equal(partial.includes("response.completed"), false);
});

test("rejects a missing probe token without calling DeepSeek", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  const unauthorized = new Request("https://probe.example/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody()),
  });

  const response = await worker.fetch(unauthorized, {
    DEEPSEEK_API_KEY: "synthetic-key",
    PROBE_CLIENT_TOKEN: "synthetic-probe-token",
  });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("capability probe returns only sanitized response metadata", async () => {
  globalThis.fetch = async (url, init) => {
    if (url.endsWith("/models")) {
      return Response.json({ data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] });
    }
    const body = JSON.parse(init.body);
    const hasToolResult = body.messages.some((message) => message.role === "tool");
    const toolCount = body.parallel_tool_calls ? 2 : body.tools?.length ? 1 : 0;
    const toolCalls = hasToolResult ? null : Array.from({ length: toolCount }, (_, index) => ({
      id: `call_synthetic_${index}`,
      type: "function",
      function: {
        name: body.tools[index]?.function.name ?? body.tools[0].function.name,
        arguments: "{\"key\":\"synthetic\"}",
      },
    }));
    return Response.json({
      model: body.model,
      choices: [{
        finish_reason: toolCalls?.length ? "tool_calls" : "stop",
        message: {
          content: toolCalls?.length ? "" : "SECRET_SYNTHETIC_CONTENT",
          reasoning_content: body.thinking?.type === "enabled"
            ? "SECRET_SYNTHETIC_REASONING"
            : null,
          tool_calls: toolCalls,
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };
  const probeRequest = new Request("https://probe.example/probe/capabilities", {
    method: "POST",
    headers: { authorization: ["Bearer", "synthetic-probe-token"].join(" ") },
  });

  const response = await worker.fetch(probeRequest, {
    DEEPSEEK_API_KEY: "synthetic-key",
    PROBE_CLIENT_TOKEN: "synthetic-probe-token",
  });
  const resultText = await response.text();
  const result = JSON.parse(resultText);

  assert.equal(response.status, 200);
  assert.deepEqual(result.list_models.models, ["deepseek-v4-flash", "deepseek-v4-pro"]);
  assert.equal(result.probes.some((probe) => probe.case === "parallel_tools"), true);
  assert.equal(result.probes.some((probe) => probe.case === "thinking_with_tools_continuation"), true);
  assert.equal(resultText.includes("SECRET_SYNTHETIC_CONTENT"), false);
  assert.equal(resultText.includes("SECRET_SYNTHETIC_REASONING"), false);
  assert.equal(resultText.includes("synthetic-key"), false);
});
