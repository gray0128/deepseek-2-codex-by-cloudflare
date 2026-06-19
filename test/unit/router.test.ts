import { describe, expect, it } from "vitest";
import { route } from "../../src/index";

describe("route", () => {
  it("returns a health response", async () => {
    const response = route(new Request("https://worker.example/healthz"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns a structured 404 for unknown routes", async () => {
    const response = route(new Request("https://worker.example/unknown"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        type: "invalid_request_error",
        code: "not_found",
        message: "Route not found.",
      },
    });
  });
});
