import { ZodError } from "zod";
import { loadConfig, type RuntimeEnv } from "../config";
import { decideModel } from "../deepseek/model-policy";
import { buildDeepSeekRequest } from "../deepseek/request-builder";
import { normalizeRequest } from "../responses/normalize";
import { responsesRequestSchema } from "../responses/schema";
import { hasValidBearerToken } from "./auth";
import { AdapterError, errorResponse } from "./errors";

export interface SafeLogRecord {
  request_id: string;
  method: string;
  path: string;
  status: number;
  code: string;
}

export type SafeLogger = (record: SafeLogRecord) => void;

function defaultLogger(record: SafeLogRecord): void {
  console.log(JSON.stringify(record));
}

function requestId(request: Request): string {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}

function zodError(error: ZodError): AdapterError {
  const issue = error.issues[0];
  const issuePath = issue?.path.map(String) ?? [];
  const unknownKey = issue?.code === "unrecognized_keys" ? issue.keys[0] : undefined;
  const param = [...issuePath, ...(unknownKey ? [unknownKey] : [])].join(".") || undefined;
  return new AdapterError(
    400,
    "invalid_request",
    "Request body is invalid.",
    "invalid_request_error",
    param,
  );
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new AdapterError(413, "request_too_large", "Request body exceeds the configured limit.");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return body + decoder.decode();
      bytes += result.value.byteLength;
      if (bytes > maxBytes) {
        throw new AdapterError(
          413,
          "request_too_large",
          "Request body exceeds the configured limit.",
        );
      }
      body += decoder.decode(result.value, { stream: true });
    }
  } finally {
    if (bytes > maxBytes) await reader.cancel().catch(() => {});
  }
}

async function requireAuth(request: Request, token: string): Promise<void> {
  if (!(await hasValidBearerToken(request, token))) {
    throw new AdapterError(401, "invalid_api_key", "Invalid bearer token.", "authentication_error");
  }
}

async function handleResponses(request: Request, env: RuntimeEnv): Promise<Response> {
  const config = loadConfig(env);
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > config.REQUEST_MAX_BYTES) {
    throw new AdapterError(413, "request_too_large", "Request body exceeds the configured limit.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new AdapterError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  await requireAuth(request, config.ADAPTER_BEARER_TOKEN);
  const rawBody = await readBoundedBody(request, config.REQUEST_MAX_BYTES);

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new AdapterError(400, "invalid_json", "Request body is not valid JSON.");
  }

  let parsed;
  try {
    parsed = responsesRequestSchema.parse(json);
  } catch (error) {
    if (error instanceof ZodError) throw zodError(error);
    throw error;
  }
  const turn = await normalizeRequest(parsed, config.MESSAGE_MAX_BYTES);
  const decision = decideModel(turn, config);
  buildDeepSeekRequest(turn, decision);

  throw new AdapterError(
    501,
    "stream_adapter_not_implemented",
    "Responses stream translation is not implemented yet.",
  );
}

export async function route(
  request: Request,
  env?: RuntimeEnv,
  logger: SafeLogger = defaultLogger,
): Promise<Response> {
  const id = requestId(request);
  const url = new URL(request.url);
  let response: Response;
  let code = "ok";

  try {
    if (request.method === "GET" && url.pathname === "/healthz") {
      response = Response.json({ status: "ok" });
    } else if (request.method === "GET" && url.pathname === "/v1/models") {
      if (!env) throw new Error("Runtime environment is required.");
      const config = loadConfig(env);
      await requireAuth(request, config.ADAPTER_BEARER_TOKEN);
      response = Response.json({
        object: "list",
        data: [
          {
            id: config.MODEL_ALIAS,
            object: "model",
            owned_by: "deepseek-cloudflare-adapter",
            capabilities: { responses: true, streaming: false, tools: false },
          },
        ],
      });
    } else if (request.method === "POST" && url.pathname === "/v1/responses") {
      if (!env) throw new Error("Runtime environment is required.");
      response = await handleResponses(request, env);
    } else {
      throw new AdapterError(404, "not_found", "Route not found.");
    }
  } catch (error) {
    const adapterError =
      error instanceof AdapterError
        ? error
        : new AdapterError(500, "internal_error", "Internal server error.", "upstream_error");
    code = adapterError.code;
    response = errorResponse(adapterError, id);
  }

  logger({
    request_id: id,
    method: request.method,
    path: url.pathname,
    status: response.status,
    code,
  });
  return response;
}
