export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface NormalizedMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NormalizedTurn {
  modelAlias: string;
  inputMessages: NormalizedMessage[];
  declaredTools: boolean;
  parallelToolCalls: boolean;
  reasoningEffort: ReasoningEffort;
  requestFingerprint: string;
}
