const encoder = new TextEncoder();

interface DeepSeekUsage {
  prompt_tokens?: number;
  prompt_cache_hit_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface DeepSeekToolDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface ParsedChunk {
  content?: string;
  toolCalls: DeepSeekToolDelta[];
  usage?: DeepSeekUsage;
}

interface ToolState {
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  item: Record<string, unknown>;
}

function eventBytes(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(
    "event: " + String(event.type) + "\ndata: " + JSON.stringify(event) + "\n\n",
  );
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

function parseChunk(data: string): ParsedChunk {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error("DeepSeek sent invalid SSE JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("DeepSeek sent an invalid SSE event.");
  const object = value as {
    choices?: Array<{ delta?: { content?: unknown; tool_calls?: unknown } }>;
    usage?: DeepSeekUsage;
  };
  if (object.choices !== undefined && !Array.isArray(object.choices)) {
    throw new Error("DeepSeek sent invalid choices.");
  }
  const delta = object.choices?.[0]?.delta;
  const content = delta?.content;
  if (content !== undefined && content !== null && typeof content !== "string") {
    throw new Error("DeepSeek sent invalid content.");
  }
  if (delta?.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) {
    throw new Error("DeepSeek sent invalid tool calls.");
  }
  return {
    ...(typeof content === "string" ? { content } : {}),
    toolCalls: (delta?.tool_calls as DeepSeekToolDelta[] | undefined) ?? [],
    usage: object.usage,
  };
}

function usageObject(usage: DeepSeekUsage | undefined): Record<string, unknown> {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    input_tokens_details: { cached_tokens: usage?.prompt_cache_hit_tokens ?? 0 },
    output_tokens: usage?.completion_tokens ?? 0,
    output_tokens_details: {
      reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
    total_tokens: usage?.total_tokens ?? 0,
  };
}

export function responsesStream(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const responseId = "resp_" + crypto.randomUUID().replaceAll("-", "");
  let sequence = 0;
  let buffer = "";
  let sawDone = false;
  let usage: DeepSeekUsage | undefined;
  let mode: "text" | "tools" | undefined;
  let outputItem: Record<string, unknown> | undefined;
  const toolStates = new Map<number, ToolState>();
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

  function addText(controller: TransformStreamDefaultController<Uint8Array>, delta: string): void {
    if (!mode) {
      mode = "text";
      const messageId = "msg_" + crypto.randomUUID().replaceAll("-", "");
      outputItem = {
        id: messageId,
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [],
      };
      controller.enqueue(
        eventBytes({
          type: "response.output_item.added",
          sequence_number: sequence++,
          output_index: 0,
          item: outputItem,
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
    }
    if (mode !== "text" || !outputItem) throw new Error("DeepSeek mixed text and tool calls.");
    text += delta;
    controller.enqueue(
      eventBytes({
        type: "response.output_text.delta",
        sequence_number: sequence++,
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        delta,
      }),
    );
  }

  function addTool(
    controller: TransformStreamDefaultController<Uint8Array>,
    tool: DeepSeekToolDelta,
  ): void {
    if (!mode) mode = "tools";
    if (mode !== "tools") throw new Error("DeepSeek mixed text and tool calls.");
    const outputIndex = tool.index ?? 0;
    if (!Number.isInteger(outputIndex) || outputIndex < 0) {
      throw new Error("DeepSeek sent invalid tool index.");
    }
    let state = toolStates.get(outputIndex);
    if (!state) {
      const itemId = "fc_" + crypto.randomUUID().replaceAll("-", "");
      const callId = tool.id ?? "call_" + crypto.randomUUID().replaceAll("-", "");
      const name = tool.function?.name ?? "";
      if (!name) throw new Error("DeepSeek tool call is missing a name.");
      const item = {
        id: itemId,
        type: "function_call",
        status: "in_progress",
        arguments: "",
        call_id: callId,
        name,
      };
      state = { outputIndex, itemId, callId, name, arguments: "", item };
      toolStates.set(outputIndex, state);
      controller.enqueue(
        eventBytes({
          type: "response.output_item.added",
          sequence_number: sequence++,
          output_index: outputIndex,
          item,
        }),
      );
    }
    if (tool.id && tool.id !== state.callId) throw new Error("DeepSeek changed tool call id.");
    if (tool.function?.name && tool.function.name !== state.name) {
      throw new Error("DeepSeek changed tool name.");
    }
    const delta = tool.function?.arguments ?? "";
    if (!delta) return;
    state.arguments += delta;
    controller.enqueue(
      eventBytes({
        type: "response.function_call_arguments.delta",
        sequence_number: sequence++,
        item_id: state.itemId,
        output_index: outputIndex,
        delta,
      }),
    );
  }

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
          if (parsed.content) addText(controller, parsed.content);
          for (const tool of parsed.toolCalls) addTool(controller, tool);
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.trim()) throw new Error("DeepSeek stream ended with an incomplete SSE event.");
        if (!sawDone) throw new Error("DeepSeek stream ended before [DONE].");
        if (!mode) throw new Error("DeepSeek stream ended without output.");

        const doneItems: Record<string, unknown>[] = [];
        if (mode === "text") {
          if (!outputItem) throw new Error("DeepSeek stream ended without output.");
          const content = { type: "output_text", annotations: [], text };
          const doneItem = { ...outputItem, status: "completed", content: [content] };
          doneItems.push(doneItem);
          controller.enqueue(
            eventBytes({
              type: "response.output_text.done",
              sequence_number: sequence++,
              item_id: outputItem.id,
              output_index: 0,
              content_index: 0,
              text,
            }),
          );
          controller.enqueue(
            eventBytes({
              type: "response.content_part.done",
              sequence_number: sequence++,
              item_id: outputItem.id,
              output_index: 0,
              content_index: 0,
              part: content,
            }),
          );
        } else {
          for (const state of [...toolStates.values()].sort(
            (left, right) => left.outputIndex - right.outputIndex,
          )) {
            const doneItem = { ...state.item, status: "completed", arguments: state.arguments };
            doneItems.push(doneItem);
            controller.enqueue(
              eventBytes({
                type: "response.function_call_arguments.done",
                sequence_number: sequence++,
                item_id: state.itemId,
                output_index: state.outputIndex,
                arguments: state.arguments,
              }),
            );
            controller.enqueue(
              eventBytes({
                type: "response.output_item.done",
                sequence_number: sequence++,
                output_index: state.outputIndex,
                item: doneItem,
              }),
            );
          }
        }
        if (mode === "text") {
          controller.enqueue(
            eventBytes({
              type: "response.output_item.done",
              sequence_number: sequence++,
              output_index: 0,
              item: doneItems[0],
            }),
          );
        }
        controller.enqueue(
          eventBytes({
            type: "response.completed",
            sequence_number: sequence++,
            response: responseState(responseId, model, "completed", doneItems, usageObject(usage)),
          }),
        );
      },
    }),
  );
}
