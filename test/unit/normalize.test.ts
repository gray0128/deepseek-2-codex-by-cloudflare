import { describe, expect, it } from "vitest";
import { buildDeepSeekRequest } from "../../src/deepseek/request-builder";
import { normalizeRequest } from "../../src/responses/normalize";
import { responsesRequestSchema } from "../../src/responses/schema";

describe("Responses normalization", () => {
  it("maps function_call and function_call_output to DeepSeek history", async () => {
    const parsed = responsesRequestSchema.parse({
      model: "deepseek-codex",
      stream: true,
      input: [
        { type: "message", role: "user", content: "run a tool" },
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "exec_command",
          arguments: '{"cmd":"printf synthetic-tool-output"}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "synthetic-tool-output",
        },
      ],
      tools: [{ type: "function", name: "exec_command", parameters: { type: "object" } }],
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
    });
    const turn = await normalizeRequest(parsed, 4096);
    const request = buildDeepSeekRequest(turn, {
      model: "deepseek-v4-flash",
      thinking: "disabled",
    });
    expect(request.messages).toEqual([
      { role: "user", content: "run a tool" },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "exec_command", arguments: '{"cmd":"printf synthetic-tool-output"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "synthetic-tool-output" },
    ]);
  });

  it("rejects unknown tool outputs", async () => {
    const parsed = responsesRequestSchema.parse({
      model: "deepseek-codex",
      stream: true,
      input: [{ type: "function_call_output", call_id: "missing", output: "x" }],
    });
    await expect(normalizeRequest(parsed, 4096)).rejects.toMatchObject({
      code: "unknown_tool_call",
      param: "input.0.call_id",
    });
  });

  it("rejects duplicate tool call ids", async () => {
    const parsed = responsesRequestSchema.parse({
      model: "deepseek-codex",
      stream: true,
      input: [
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "a", arguments: "{}" },
        { type: "function_call", id: "fc_2", call_id: "call_1", name: "a", arguments: "{}" },
      ],
    });
    await expect(normalizeRequest(parsed, 4096)).rejects.toMatchObject({
      code: "duplicate_tool_call",
      param: "input.1.call_id",
    });
  });
});
