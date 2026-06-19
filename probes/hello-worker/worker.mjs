import { runCapabilities } from "./capabilities.mjs";

const encoder = new TextEncoder();

function jsonError(status, code, message) {
  return Response.json(
    { error: { type: "invalid_request_error", code, message } },
    { status },
  );
}

async function authorized(request, expectedToken) {
  if (typeof expectedToken !== "string" || expectedToken.length === 0) return false;
  const prefix = "Bearer ";
  const header = request.headers.get("authorization") ?? "";
  const suppliedToken = header.startsWith(prefix) ? header.slice(prefix.length) : "";
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(suppliedToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
  ]);
  const supplied = new Uint8Array(suppliedHash);
  const expected = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) {
    difference |= supplied[index] ^ expected[index];
  }
  return suppliedToken.length > 0 && difference === 0;
}

function messageText(message) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part?.type === "input_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function deepSeekMessages(body) {
  const messages = [];
  if (typeof body.instructions === "string" && body.instructions.length > 0) {
    messages.push({ role: "system", content: body.instructions });
  }
  for (const item of body.input ?? []) {
    if (item?.type !== "message") continue;
    const content = messageText(item);
    if (!content) continue;
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : "system";
    messages.push({ role, content });
  }
  return messages;
}

function responseState(id, status, output, usage = null) {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: "deepseek-v4-flash",
    output,
    parallel_tool_calls: false,
    previous_response_id: null,
    reasoning: null,
    store: false,
    tool_choice: "auto",
    tools: [],
    usage,
    metadata: {},
  };
}

function eventBytes(event) {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function responsesStream(upstream) {
  const responseId = `resp_${crypto.randomUUID().replaceAll("-", "")}`;
  const messageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  const pendingMessage = {
    id: messageId,
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [],
  };
  let sequence = 0;
  let buffer = "";
  let output = "";
  let sawDone = false;
  let usage = null;
  const decoder = new TextDecoder();

  const { readable, writable } = new TransformStream({
    start(controller) {
      controller.enqueue(eventBytes({
        type: "response.created",
        sequence_number: sequence++,
        response: responseState(responseId, "in_progress", []),
      }));
      controller.enqueue(eventBytes({
        type: "response.output_item.added",
        sequence_number: sequence++,
        output_index: 0,
        item: pendingMessage,
      }));
      controller.enqueue(eventBytes({
        type: "response.content_part.added",
        sequence_number: sequence++,
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", annotations: [], text: "" },
      }));
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const data = block.split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          sawDone = true;
          continue;
        }
        const chunk = JSON.parse(data);
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta !== "string" || delta.length === 0) continue;
        output += delta;
        controller.enqueue(eventBytes({
          type: "response.output_text.delta",
          sequence_number: sequence++,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          delta,
        }));
      }
    },
    flush(controller) {
      if (!sawDone) throw new Error("DeepSeek stream ended before [DONE].");
      const content = { type: "output_text", annotations: [], text: output };
      const doneMessage = { ...pendingMessage, status: "completed", content: [content] };
      controller.enqueue(eventBytes({
        type: "response.output_text.done",
        sequence_number: sequence++,
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        text: output,
      }));
      controller.enqueue(eventBytes({
        type: "response.content_part.done",
        sequence_number: sequence++,
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        part: content,
      }));
      controller.enqueue(eventBytes({
        type: "response.output_item.done",
        sequence_number: sequence++,
        output_index: 0,
        item: doneMessage,
      }));
      controller.enqueue(eventBytes({
        type: "response.completed",
        sequence_number: sequence++,
        response: responseState(responseId, "completed", [doneMessage], {
          input_tokens: usage?.prompt_tokens ?? 0,
          input_tokens_details: { cached_tokens: usage?.prompt_cache_hit_tokens ?? 0 },
          output_tokens: usage?.completion_tokens ?? 0,
          output_tokens_details: { reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0 },
          total_tokens: usage?.total_tokens ?? 0,
        }),
      }));
    },
  });

  void upstream.body.pipeTo(writable).catch(() => {});
  return readable;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return Response.json({ status: "ok", probe: "t00-hello" });
    }
    const isResponses = request.method === "POST" && url.pathname === "/v1/responses";
    const isCapabilitiesProbe =
      request.method === "POST" && url.pathname === "/probe/capabilities";
    if (!isResponses && !isCapabilitiesProbe) {
      return jsonError(404, "not_found", "Route not found.");
    }
    if (!(await authorized(request, env.PROBE_CLIENT_TOKEN))) {
      return jsonError(401, "invalid_api_key", "Invalid probe API key.");
    }
    if (isCapabilitiesProbe) {
      const capabilities = await runCapabilities(env.DEEPSEEK_API_KEY, request.signal);
      return Response.json(capabilities);
    }
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return jsonError(415, "unsupported_media_type", "Expected application/json.");
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "invalid_json", "Request body is not valid JSON.");
    }
    if (body.stream !== true) {
      return jsonError(400, "stream_required", "The T00 probe only supports stream=true.");
    }
    const messages = deepSeekMessages(body);
    if (messages.length === 0) {
      return jsonError(400, "input_required", "At least one text message is required.");
    }

    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages,
        thinking: { type: "disabled" },
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) {
      return jsonError(502, "upstream_error", `DeepSeek returned HTTP ${upstream.status}.`);
    }

    return new Response(responsesStream(upstream), {
      headers: {
        "cache-control": "no-cache, no-transform",
        "content-type": "text/event-stream; charset=utf-8",
      },
    });
  },
};
