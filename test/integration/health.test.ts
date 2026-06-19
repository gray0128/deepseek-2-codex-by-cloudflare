import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Worker runtime", () => {
  it("serves /healthz through the Workers integration harness", async () => {
    const response = await exports.default.fetch("https://worker.example/healthz");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
