export type AdapterErrorType = "authentication_error" | "invalid_request_error" | "upstream_error";

export class AdapterError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly type: AdapterErrorType = "invalid_request_error",
    readonly param?: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export function errorResponse(error: AdapterError, requestId: string): Response {
  return Response.json(
    {
      error: {
        type: error.type,
        code: error.code,
        message: error.message,
        param: error.param ?? null,
        request_id: requestId,
      },
    },
    { status: error.status },
  );
}
