export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface NormalizedMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
