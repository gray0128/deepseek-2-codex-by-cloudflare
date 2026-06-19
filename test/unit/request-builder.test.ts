import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/config";
import { decideModel } from "../../src/deepseek/model-policy";
import { buildDeepSeekRequest } from "../../src/deepseek/request-builder";
import type { NormalizedTurn, ReasoningEffort } from "../../src/responses/types";

const config = {
  MODEL_ALIAS: "deepseek-codex",
  UPSTREAM_TEXT_MODEL: "deepseek-v4-flash",
  UPSTREAM_REASONING_MODEL: "deepseek-v4-pro",
} as AppConfig;

function turn(reasoningEffort: ReasoningEffort): NormalizedTurn {
  return {
    modelAlias: "deepseek-codex",
    inputMessages: [{ role: "user", content: "hello" }],
    declaredTools: false,
    tools: [],
    parallelToolCalls: false,
    reasoningEffort,
    requestFingerprint: "fingerprint",
  };
}

describe("DeepSeek request policy", () => {
  it.each([
    ["none", "deepseek-v4-flash", "disabled", undefined],
    ["low", "deepseek-v4-pro", "enabled", "high"],
    ["high", "deepseek-v4-pro", "enabled", "high"],
    ["xhigh", "deepseek-v4-pro", "enabled", "max"],
  ] as const)("maps %s effort", (effort, model, thinking, reasoning) => {
    const normalized = turn(effort);
    const result = buildDeepSeekRequest(normalized, decideModel(normalized, config));
    expect(result).toMatchObject({ model, thinking: { type: thinking } });
    expect(result.reasoning_effort).toBe(reasoning);
    expect(result).not.toHaveProperty("tools");
  });

  it("maps function tools to DeepSeek without executing them", () => {
    const normalized = {
      ...turn("none"),
      declaredTools: true,
      tools: [
        {
          type: "function" as const,
          name: "exec_command",
          description: "Run a command.",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
        },
      ],
    };
    const result = buildDeepSeekRequest(normalized, decideModel(normalized, config));
    expect(result.tools).toEqual([
      {
        type: "function",
        function: {
          name: "exec_command",
          description: "Run a command.",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
        },
      },
    ]);
    expect(result.tool_choice).toBe("auto");
    expect(result.parallel_tool_calls).toBe(false);
  });
});
