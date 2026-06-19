import { describe, expect, it } from "vitest";
import { createResponseId, ResponseIdError, verifyResponseId } from "../../src/state/response-id";

describe("signed response ids", () => {
  it("signs and verifies a response id", async () => {
    const id = await createResponseId({
      secret: "test-secret-long-enough",
      ttlSeconds: 60,
      now: 1_000,
    });
    await expect(
      verifyResponseId({ id, secrets: { v1: "test-secret-long-enough" }, now: 1_000 }),
    ).resolves.toMatchObject({ keyId: "v1" });
  });

  it("rejects tampered ids", async () => {
    const id = await createResponseId({
      secret: "test-secret-long-enough",
      ttlSeconds: 60,
      now: 1_000,
    });
    const tampered = id.replace(".v1.", ".v2.");
    await expect(
      verifyResponseId({ id: tampered, secrets: { v1: "test-secret-long-enough" }, now: 1_000 }),
    ).rejects.toBeInstanceOf(ResponseIdError);
  });

  it("rejects expired ids", async () => {
    const id = await createResponseId({
      secret: "test-secret-long-enough",
      ttlSeconds: 1,
      now: 1_000,
    });
    await expect(
      verifyResponseId({ id, secrets: { v1: "test-secret-long-enough" }, now: 3_000 }),
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("supports key rotation by key id", async () => {
    const id = await createResponseId({
      secret: "new-secret-long-enough",
      keyId: "v2",
      ttlSeconds: 60,
      now: 1_000,
    });
    await expect(
      verifyResponseId({
        id,
        secrets: { v1: "old-secret-long-enough", v2: "new-secret-long-enough" },
        now: 1_000,
      }),
    ).resolves.toMatchObject({ keyId: "v2" });
  });
});
