export interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekRequest {
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  messages: DeepSeekMessage[];
  stream: true;
  stream_options: { include_usage: true };
  thinking: { type: "enabled" | "disabled" };
  reasoning_effort?: "high" | "max";
}
