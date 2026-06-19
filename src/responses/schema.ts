import { z } from "zod";
import { MAX_INPUT_ITEMS, MAX_TOOLS } from "../config";

const inputTextSchema = z
  .object({
    type: z.literal("input_text"),
    text: z.string(),
  })
  .strict();

const messageSchema = z
  .object({
    type: z.literal("message"),
    role: z.enum(["developer", "system", "user", "assistant"]),
    content: z.union([z.string(), z.array(inputTextSchema)]),
  })
  .strict();

const functionToolSchema = z
  .object({
    type: z.literal("function"),
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()),
    strict: z.literal(false).optional(),
  })
  .strict();
const declaredToolSchema = z.union([
  functionToolSchema,
  z.object({ type: z.string().min(1) }).passthrough(),
]);

export const responsesRequestSchema = z
  .object({
    model: z.string().min(1),
    stream: z.literal(true),
    input: z.union([z.string(), z.array(messageSchema).max(MAX_INPUT_ITEMS)]),
    instructions: z.string().nullable().optional(),
    reasoning: z
      .object({ effort: z.enum(["none", "low", "medium", "high", "xhigh"]) })
      .strict()
      .nullable()
      .optional(),
    tools: z.array(declaredToolSchema).max(MAX_TOOLS).optional(),
    tool_choice: z.literal("auto").optional(),
    parallel_tool_calls: z.literal(false).optional(),
    include: z.array(z.literal("reasoning.encrypted_content")).max(1).optional(),
    store: z.literal(false).optional(),
    prompt_cache_key: z.string().optional(),
    client_metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ResponsesRequest = z.infer<typeof responsesRequestSchema>;
