import type { NormalizedTurn } from "../responses/types";
import type { ModelDecision } from "./model-policy";
import type { DeepSeekRequest } from "./types";

export function buildDeepSeekRequest(
  turn: NormalizedTurn,
  decision: ModelDecision,
): DeepSeekRequest {
  return {
    model: decision.model,
    messages: turn.inputMessages,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: decision.thinking },
    ...(decision.reasoningEffort ? { reasoning_effort: decision.reasoningEffort } : {}),
    ...(turn.tools.length > 0
      ? {
          tools: turn.tools.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              ...(tool.description ? { description: tool.description } : {}),
              parameters: tool.parameters,
            },
          })),
          tool_choice: "auto" as const,
          parallel_tool_calls: turn.parallelToolCalls,
        }
      : {}),
  };
}
