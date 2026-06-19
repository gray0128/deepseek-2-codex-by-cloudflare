import { AdapterError } from "../http/errors";
import type { ResponsesRequest } from "./schema";
import type { NormalizedMessage, NormalizedTurn } from "./types";

const encoder = new TextEncoder();

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
    request.input.forEach((message, index) => {
      const content = normalizeContent(message.content);
      assertMessageSize(content, messageMaxBytes, `input.${index}.content`);
      const role = message.role === "developer" ? "system" : message.role;
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
    parallelToolCalls: request.parallel_tool_calls ?? false,
    reasoningEffort: request.reasoning?.effort ?? "none",
  } satisfies Omit<NormalizedTurn, "requestFingerprint">;
  return { ...normalized, requestFingerprint: await fingerprint(normalized) };
}
