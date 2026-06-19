import { AdapterError } from "../http/errors";
import type { ResponsesRequest } from "./schema";
import type { NormalizedMessage, NormalizedTurn } from "./types";

const encoder = new TextEncoder();

type FunctionTool = NormalizedTurn["tools"][number];

function isFunctionTool(
  tool: NonNullable<ResponsesRequest["tools"]>[number],
): tool is FunctionTool {
  return tool.type === "function" && "name" in tool && "parameters" in tool;
}

function normalizeContent(content: string | Array<{ type: "input_text"; text: string }>): string {
  return typeof content === "string" ? content : content.map((part) => part.text).join("");
}

function assertMessageSize(content: string, maxBytes: number, path: string): void {
  if (encoder.encode(content).byteLength > maxBytes) {
    throw new AdapterError(
      413,
      "message_too_large",
      "Message exceeds the configured limit.",
      "invalid_request_error",
      path,
    );
  }
}

function assertValidToolOutputOrder(callIds: Set<string>, callId: string, path: string): void {
  if (!callIds.has(callId)) {
    throw new AdapterError(
      400,
      "unknown_tool_call",
      "Function call output does not match a known function call.",
      "invalid_request_error",
      path,
    );
  }
}

async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function normalizeRequest(
  request: ResponsesRequest,
  messageMaxBytes: number,
): Promise<NormalizedTurn> {
  const inputMessages: NormalizedMessage[] = [];
  if (request.instructions) {
    assertMessageSize(request.instructions, messageMaxBytes, "instructions");
    inputMessages.push({ role: "system", content: request.instructions });
  }

  if (typeof request.input === "string") {
    assertMessageSize(request.input, messageMaxBytes, "input");
    inputMessages.push({ role: "user", content: request.input });
  } else {
    const seenCallIds = new Set<string>();
    request.input.forEach((item, index) => {
      if (item.type === "function_call") {
        if (seenCallIds.has(item.call_id)) {
          throw new AdapterError(
            400,
            "duplicate_tool_call",
            "Function call id was repeated.",
            "invalid_request_error",
            `input.${index}.call_id`,
          );
        }
        seenCallIds.add(item.call_id);
        assertMessageSize(item.arguments, messageMaxBytes, `input.${index}.arguments`);
        inputMessages.push({
          role: "assistant",
          tool_calls: [
            {
              id: item.call_id,
              type: "function",
              function: { name: item.name, arguments: item.arguments },
            },
          ],
        });
        return;
      }
      if (item.type === "function_call_output") {
        assertValidToolOutputOrder(seenCallIds, item.call_id, `input.${index}.call_id`);
        assertMessageSize(item.output, messageMaxBytes, `input.${index}.output`);
        inputMessages.push({ role: "tool", tool_call_id: item.call_id, content: item.output });
        return;
      }

      const content = normalizeContent(item.content);
      assertMessageSize(content, messageMaxBytes, `input.${index}.content`);
      const role = item.role === "developer" ? "system" : item.role;
      inputMessages.push({ role, content });
    });
  }

  if (inputMessages.length === 0) {
    throw new AdapterError(
      400,
      "input_required",
      "At least one text input is required.",
      "invalid_request_error",
      "input",
    );
  }

  const normalized = {
    modelAlias: request.model,
    inputMessages,
    declaredTools: (request.tools?.length ?? 0) > 0,
    tools: (request.tools ?? []).filter(isFunctionTool),
    parallelToolCalls: request.parallel_tool_calls ?? false,
    reasoningEffort: request.reasoning?.effort ?? "none",
  } satisfies Omit<NormalizedTurn, "requestFingerprint">;
  return { ...normalized, requestFingerprint: await fingerprint(normalized) };
}
