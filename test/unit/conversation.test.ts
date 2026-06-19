import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Conversation Durable Object", () => {
  it("records begin and complete transitions", async () => {
    const stub = env.CONVERSATIONS.getByName("conversation-basic");
    await expect(stub.beginTurn("resp_test", "fingerprint", 100)).resolves.toMatchObject({
      responseId: "resp_test",
      status: "in_progress",
    });
    await expect(stub.completeTurn("resp_test", 200)).resolves.toMatchObject({
      responseId: "resp_test",
      status: "completed",
      completedAt: 200,
    });
  });

  it("rejects duplicate begin and invalid terminal transitions", async () => {
    const stub = env.CONVERSATIONS.getByName("conversation-duplicate");
    await stub.beginTurn("resp_test", "fingerprint", 100);
    await expect(stub.tryBeginTurn("resp_test", "fingerprint", 101)).resolves.toEqual({
      ok: false,
      code: "turn_exists",
    });
    await expect(stub.tryFailTurn("resp_test", 200)).resolves.toMatchObject({
      ok: true,
      turn: { status: "failed" },
    });
    await expect(stub.tryCompleteTurn("resp_test", 300)).resolves.toEqual({
      ok: false,
      code: "invalid_transition",
    });
  });

  it("isolates conversations by durable object name", async () => {
    const first = env.CONVERSATIONS.getByName("conversation-a");
    const second = env.CONVERSATIONS.getByName("conversation-b");
    await first.beginTurn("resp_test", "fingerprint-a", 100);
    await expect(first.getTurn("resp_test")).resolves.toMatchObject({
      requestFingerprint: "fingerprint-a",
    });
    await expect(second.getTurn("resp_test")).resolves.toBeNull();
  });
});
