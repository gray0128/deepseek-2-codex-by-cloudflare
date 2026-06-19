import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const fixtureRoot = join(root, "fixtures");
const codexRoot = join(fixtureRoot, "codex", "0.142.0-alpha.1");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

const files = await listFiles(fixtureRoot);
const sensitivePatterns = [
  [/sk-[A-Za-z0-9]/, "API key"],
  [/Bearer\s+[A-Za-z0-9]/i, "authorization value"],
  [/\/Users\/[^/\s]+/, "user home path"],
  [/chatgpt-account-id/i, "account header"],
];

for (const file of files) {
  const text = await readFile(file, "utf8");
  const name = relative(root, file);
  for (const [pattern, label] of sensitivePatterns) {
    check(!pattern.test(text), `${name}: contains ${label}`);
  }

  if (extname(file) === ".json") {
    try {
      JSON.parse(text);
    } catch (error) {
      failures.push(`${name}: invalid JSON (${error.message})`);
    }
  }

  if (extname(file) === ".jsonl") {
    const events = text.trim().split("\n").map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        failures.push(`${name}:${index + 1}: invalid JSON (${error.message})`);
        return null;
      }
    }).filter(Boolean);

    events.forEach((event, index) => {
      check(event.sequence_number === index, `${name}: non-contiguous sequence at ${index}`);
    });
    check(events[0]?.type === "response.created", `${name}: must start with response.created`);
    check(events.at(-1)?.type === "response.completed", `${name}: must end with response.completed`);
    check(
      events.filter((event) => event.type === "response.completed").length === 1,
      `${name}: must contain exactly one response.completed`,
    );
  }
}

const textRequest = JSON.parse(await readFile(join(codexRoot, "text-request.json"), "utf8"));
check(textRequest.stream === true, "text request must stream");
check(textRequest.store === false, "text request must not use upstream storage");
check(textRequest.previous_response_id === undefined, "text request must omit previous_response_id");
check(textRequest.client_metadata?.thread_id === "thread_synthetic", "text request metadata is missing");

const toolRequests = JSON.parse(await readFile(join(codexRoot, "tool-requests.json"), "utf8"));
check(toolRequests.length === 2, "tool fixture must contain two sub-requests");
check(
  toolRequests[1]?.input.some((item) => item.type === "function_call"),
  "tool continuation must replay function_call",
);
check(
  toolRequests[1]?.input.some((item) => item.type === "function_call_output"),
  "tool continuation must append function_call_output",
);
check(
  toolRequests.every((request) => request.previous_response_id === undefined),
  "tool requests must omit previous_response_id",
);
check(
  toolRequests.every((request) => request.tools.every((tool) => tool.strict === undefined)),
  "Codex tool fixture must omit unobserved strict",
);

const reasoningRequest = JSON.parse(
  await readFile(join(codexRoot, "reasoning-request.json"), "utf8"),
);
check(reasoningRequest.reasoning?.effort === "high", "reasoning effort must be high");
check(
  reasoningRequest.include?.includes("reasoning.encrypted_content"),
  "reasoning request must include encrypted content",
);
check(reasoningRequest.parallel_tool_calls === true, "reasoning request must enable parallel tools");

const capabilities = JSON.parse(
  await readFile(join(fixtureRoot, "deepseek", "2026-06-19", "capabilities.json"), "utf8"),
);
const capabilityByCase = new Map(capabilities.probes.map((probe) => [probe.case, probe]));
check(capabilities.status === "endpoint_probe_complete", "DeepSeek endpoint probe is incomplete");
check(
  capabilities.list_models?.models.includes("deepseek-v4-flash") &&
    capabilities.list_models?.models.includes("deepseek-v4-pro"),
  "DeepSeek V4 model list is incomplete",
);
check(
  capabilityByCase.get("parallel_tools")?.tool_call_count === 2,
  "parallel tool capability is not proven",
);
check(
  capabilityByCase.get("thinking_tool_choice_required")?.http_status === 400,
  "thinking tool_choice=required rejection is not recorded",
);
check(
  capabilityByCase.get("thinking_with_tools_continuation")?.http_status === 200,
  "thinking tool continuation is not proven",
);
check(
  capabilityByCase.get("strict_unsupported_schema_standard")?.http_status === 200 &&
    capabilityByCase.get("strict_unsupported_schema_beta")?.http_status === 400,
  "strict endpoint behavior is not proven",
);

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} T00 fixture files.`);
}
