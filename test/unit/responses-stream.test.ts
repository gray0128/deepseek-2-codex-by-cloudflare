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

  it("streams function call arguments and keeps item id separate from call id", async () => {
    const upstream = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_deepseek","function":{"name":"exec_command","arguments":"{\\\"cmd"}}]}}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\":\\\"printf hi\\\"}"}}]}}]}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");
    const result = await events(responsesStream(chunked(upstream, [2, 4, 1, 7]), "deepseek-codex"));
    const added = result.find((event) => event.type === "response.output_item.added")!;
    const done = result.find((event) => event.type === "response.output_item.done")!;

    expect(result.map((event) => event.type)).toEqual([
      "response.created",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(added).toMatchObject({
      item: {
        type: "function_call",
        status: "in_progress",
        call_id: "call_deepseek",
        name: "exec_command",
      },
    });
    expect((added.item as { id: string }).id).not.toBe("call_deepseek");
    expect(done).toMatchObject({
      item: {
        type: "function_call",
        status: "completed",
        call_id: "call_deepseek",
        arguments: '{"cmd":"printf hi"}',
      },
    });
  });

  it("keeps interleaved parallel tool arguments associated by index", async () => {
    const upstream = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"b","arguments":"{\\\"b"}},{"index":0,"id":"call_a","function":{"name":"a","arguments":"{\\\"a"}}]}}]}',
      "",
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\":1}"}},{"index":1,"function":{"arguments":"\\\":2}"}}]}}]}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");
    const result = await events(responsesStream(chunked(upstream, [3, 1, 8]), "deepseek-codex"));
    const doneItems = result.filter((event) => event.type === "response.output_item.done");
    expect(doneItems).toHaveLength(2);
    expect(doneItems[0]).toMatchObject({
      output_index: 0,
      item: { call_id: "call_a", name: "a", arguments: '{"a":1}' },
    });
    expect(doneItems[1]).toMatchObject({
      output_index: 1,
      item: { call_id: "call_b", name: "b", arguments: '{"b":2}' },
    });
  });

  it("does not expose DeepSeek reasoning_content as output text", async () => {
    const resultText = await new Response(
      responsesStream(
        chunked(
          [
            'data: {"choices":[{"delta":{"reasoning_content":"SECRET_REASONING"}}]}',
            "",
            'data: {"choices":[{"delta":{"content":"hello"}}]}',
            "",
            "data: [DONE]",
            "",
            "",
          ].join("\n"),
          [5, 2, 1],
        ),
        "deepseek-codex",
      ),
    ).text();
    expect(resultText).toContain('"delta":"hello"');
    expect(resultText).not.toContain("SECRET_REASONING");
  });
});
