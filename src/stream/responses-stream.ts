const encoder = new TextEncoder();

interface DeepSeekUsage {
  prompt_tokens?: number;
  prompt_cache_hit_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

function eventBytes(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
}

function responseState(
  id: string,
  model: string,
  status: "in_progress" | "completed",
  output: unknown[],
  usage: unknown = null,
): Record<string, unknown> {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
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

function parseDataBlock(block: string): string | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data || undefined;
}

function parseChunk(data: string): { delta?: string; usage?: DeepSeekUsage } {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error("DeepSeek sent invalid SSE JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("DeepSeek sent an invalid SSE event.");
  const object = value as {
    choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>;
    usage?: DeepSeekUsage;
  };
  if (object.choices !== undefined && !Array.isArray(object.choices)) {
    throw new Error("DeepSeek sent invalid choices.");
  }
  const content = object.choices?.[0]?.delta?.content;
  if (content !== undefined && content !== null && typeof content !== "string") {
    throw new Error("DeepSeek sent invalid content.");
  }
  return { ...(typeof content === "string" ? { delta: content } : {}), usage: object.usage };
}

export function responsesStream(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
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
  let usage: DeepSeekUsage | undefined;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        controller.enqueue(
          eventBytes({
            type: "response.created",
            sequence_number: sequence++,
            response: responseState(responseId, model, "in_progress", []),
          }),
        );
        controller.enqueue(
          eventBytes({
            type: "response.output_item.added",
            sequence_number: sequence++,
            output_index: 0,
            item: pendingMessage,
          }),
        );
        controller.enqueue(
          eventBytes({
            type: "response.content_part.added",
            sequence_number: sequence++,
            item_id: messageId,
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", annotations: [], text: "" },
          }),
        );
      },
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        buffer = buffer.replaceAll("\r\n", "\n");
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const data = parseDataBlock(block);
          if (!data) continue;
          if (data === "[DONE]") {
            sawDone = true;
            continue;
          }
          if (sawDone) throw new Error("DeepSeek sent data after [DONE].");
          const parsed = parseChunk(data);
          if (parsed.usage) usage = parsed.usage;
          if (!parsed.delta) continue;
          output += parsed.delta;
          controller.enqueue(
            eventBytes({
              type: "response.output_text.delta",
              sequence_number: sequence++,
              item_id: messageId,
              output_index: 0,
              content_index: 0,
              delta: parsed.delta,
            }),
          );
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.trim()) throw new Error("DeepSeek stream ended with an incomplete SSE event.");
        if (!sawDone) throw new Error("DeepSeek stream ended before [DONE].");

        const content = { type: "output_text", annotations: [], text: output };
        const doneMessage = { ...pendingMessage, status: "completed", content: [content] };
        controller.enqueue(
          eventBytes({
            type: "response.output_text.done",
            sequence_number: sequence++,
            item_id: messageId,
            output_index: 0,
            content_index: 0,
            text: output,
          }),
        );
        controller.enqueue(
          eventBytes({
            type: "response.content_part.done",
            sequence_number: sequence++,
            item_id: messageId,
            output_index: 0,
            content_index: 0,
            part: content,
          }),
        );
        controller.enqueue(
          eventBytes({
            type: "response.output_item.done",
            sequence_number: sequence++,
            output_index: 0,
            item: doneMessage,
          }),
        );
        controller.enqueue(
          eventBytes({
            type: "response.completed",
            sequence_number: sequence++,
            response: responseState(responseId, model, "completed", [doneMessage], {
              input_tokens: usage?.prompt_tokens ?? 0,
              input_tokens_details: { cached_tokens: usage?.prompt_cache_hit_tokens ?? 0 },
              output_tokens: usage?.completion_tokens ?? 0,
              output_tokens_details: {
                reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
              },
              total_tokens: usage?.total_tokens ?? 0,
            }),
          }),
        );
      },
    }),
  );
}
