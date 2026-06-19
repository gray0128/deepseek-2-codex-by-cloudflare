export function route(request: Request): Response {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/healthz") {
    return Response.json({ status: "ok" });
  }

  return Response.json(
    { error: { type: "invalid_request_error", code: "not_found", message: "Route not found." } },
    { status: 404 },
  );
}

export default {
  fetch(request) {
    return route(request);
  },
} satisfies ExportedHandler<Env>;
