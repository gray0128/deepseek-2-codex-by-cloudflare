import { z } from "zod";

export const MAX_INPUT_ITEMS = 128;
export const MAX_TOOLS = 64;

export type RuntimeEnv = Env & {
  ADAPTER_BEARER_TOKEN: string;
  DEEPSEEK_API_KEY: string;
};

const configSchema = z.object({
  ADAPTER_BEARER_TOKEN: z.string().min(16),
  DEEPSEEK_API_KEY: z.string().min(1),
  MODEL_ALIAS: z.string().min(1),
  UPSTREAM_BASE_URL: z.url(),
  UPSTREAM_TEXT_MODEL: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]),
  UPSTREAM_REASONING_MODEL: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]),
  REQUEST_MAX_BYTES: z.coerce.number().int().positive(),
  MESSAGE_MAX_BYTES: z.coerce.number().int().positive(),
  FIRST_BYTE_TIMEOUT_MS: z.coerce.number().int().positive(),
  CHUNK_IDLE_TIMEOUT_MS: z.coerce.number().int().positive(),
  TOTAL_TIMEOUT_MS: z.coerce.number().int().positive(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: RuntimeEnv): AppConfig {
  return configSchema.parse(env);
}
