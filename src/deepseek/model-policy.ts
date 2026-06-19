import type { AppConfig } from "../config";
import { AdapterError } from "../http/errors";
import type { NormalizedTurn } from "../responses/types";

export interface ModelDecision {
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  thinking: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
}

export function decideModel(turn: NormalizedTurn, config: AppConfig): ModelDecision {
  if (turn.modelAlias !== config.MODEL_ALIAS) {
    throw new AdapterError(
      400,
      "model_not_allowed",
      "The requested model is not allowed.",
      "invalid_request_error",
      "model",
    );
  }
  if (turn.reasoningEffort === "none") {
    return { model: config.UPSTREAM_TEXT_MODEL, thinking: "disabled" };
  }
  return {
    model: config.UPSTREAM_REASONING_MODEL,
    thinking: "enabled",
    reasoningEffort: turn.reasoningEffort === "xhigh" ? "max" : "high",
  };
}
