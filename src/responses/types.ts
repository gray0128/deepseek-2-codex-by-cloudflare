export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface NormalizedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface NormalizedTurn {
  modelAlias: string;
  inputMessages: NormalizedMessage[];
  declaredTools: boolean;
  tools: Array<{
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  }>;
  parallelToolCalls: boolean;
  reasoningEffort: ReasoningEffort;
  requestFingerprint: string;
}
