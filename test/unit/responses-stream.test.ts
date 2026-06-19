import { describe, expect, it } from "vitest";
import { responsesStream } from "../../src/stream/responses-stream";

const encoder = new TextEncoder();

function chunked(text: string, sizes: number[]): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      const size = sizes.shift() ?? bytes.length;
      controller.enqueue(bytes.slice(offset, Math.min(offset + size, bytes.length)));
      offset = Math.min(offset + size, bytes.length);
    },
  });
}

async function events(stream: ReadableStream<Uint8Array>): Promise<Array<Record<string, unknown>>> {
  const text = await new Response(stream).text();
  return text
    .trim()
    .split("\n\n")
    .map((block) =>
      JSON.parse(
        block
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6),
      ),
    );
}

describe("Responses text stream", () => {
  it("decodes arbitrary UTF-8 byte cuts and preserves event invariants", async () => {
    const upstream = [
      'data: {"choices":[{"delta":{"content":"你"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"好"}}]}',
      "",
      'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\r\n");
    const result = await events(
      responsesStream(chunked(upstream, [1, 2, 1, 3, 2, 5, 1]), "deepseek-codex"),
    );

    expect(result.map((event) => event.type)).toEqual([
      "response.created",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(result.map((event) => event.sequence_number)).toEqual(result.map((_, index) => index));
    expect(
      result
        .filter((event) => event.type === "response.output_text.delta")
        .map((event) => event.delta),
    ).toEqual(["你", "好"]);
    expect(result.at(-1)).toMatchObject({
      response: {
        status: "completed",
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      },
    });
  });

  it.each([
    ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', "missing done"],
    ["data: not-json\n\ndata: [DONE]\n\n", "bad JSON"],
  ])("does not complete a damaged stream: %s", async (upstream) => {
    const reader = responsesStream(chunked(upstream, [1, 2, 3]), "deepseek-codex").getReader();
    const chunks: Uint8Array[] = [];
    await expect(
      (async () => {
        while (true) {
          const result = await reader.read();
          if (result.done) return;
          chunks.push(result.value);
        }
      })(),
    ).rejects.toThrow();
    const partial = new TextDecoder().decode(
      Uint8Array.from(chunks.flatMap((value) => [...value])),
    );
    expect(partial).not.toContain("response.completed");
  });
});
