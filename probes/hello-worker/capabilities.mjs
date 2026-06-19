const API_BASE = "https://api.deepseek.com";

const syntheticTool = {
  type: "function",
  function: {
    name: "get_synthetic_value",
    description: "Return a fixed synthetic value.",
    parameters: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
};

const secondSyntheticTool = {
  type: "function",
  function: {
    name: "get_second_synthetic_value",
    description: "Return a second fixed synthetic value.",
    parameters: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
};

function chatBody(overrides = {}) {
  return {
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "Reply with exactly: hello" }],
    max_tokens: 128,
    stream: false,
    ...overrides,
  };
}

function summarizeChat(name, response, payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return {
    case: name,
    http_status: response.status,
    ok: response.ok,
    error: payload?.error ? {
      code: payload.error.code ?? null,
      type: payload.error.type ?? null,
      param: payload.error.param ?? null,
    } : null,
    model: payload?.model ?? null,
    finish_reason: choice?.finish_reason ?? null,
    content_present: typeof message?.content === "string" && message.content.length > 0,
    reasoning_content_present:
      typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0,
    tool_call_count: toolCalls.length,
    tool_names: toolCalls.map((call) => call.function?.name).filter(Boolean),
    usage_present: payload?.usage != null,
  };
}

async function requestJson(url, apiKey, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The sanitized result records the status without retaining an upstream body.
  }
  return { response, payload };
}

async function probeChat(name, apiKey, body, signal, beta = false) {
  const base = beta ? `${API_BASE}/beta` : API_BASE;
  const { response, payload } = await requestJson(`${base}/chat/completions`, apiKey, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
  return { summary: summarizeChat(name, response, payload), payload };
}

async function probeThinkingToolContinuation(apiKey, signal) {
  const messages = [{ role: "user", content: "Call the synthetic tool once, then answer." }];
  const first = await probeChat("thinking_with_tools_first", apiKey, chatBody({
    messages,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    tools: [syntheticTool],
    tool_choice: "auto",
  }), signal);
  const assistant = first.payload?.choices?.[0]?.message;
  const call = assistant?.tool_calls?.[0];
  if (!first.summary.ok || !call) {
    return [first.summary, {
      case: "thinking_with_tools_continuation",
      status: "skipped_no_tool_call",
    }];
  }

  const secondMessages = [
    ...messages,
    {
      role: "assistant",
      content: assistant.content ?? "",
      reasoning_content: assistant.reasoning_content,
      tool_calls: assistant.tool_calls,
    },
    {
      role: "tool",
      tool_call_id: call.id,
      content: "synthetic-tool-result",
    },
  ];
  const second = await probeChat("thinking_with_tools_continuation", apiKey, chatBody({
    messages: secondMessages,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    tools: [syntheticTool],
    tool_choice: "auto",
  }), signal);
  return [first.summary, second.summary];
}

export async function runCapabilities(apiKey, signal) {
  const modelsRequest = requestJson(`${API_BASE}/models`, apiKey, { method: "GET", signal });
  const strictTool = {
    ...syntheticTool,
    function: { ...syntheticTool.function, strict: true },
  };
  const unsupportedStrictTool = {
    ...strictTool,
    function: {
      ...strictTool.function,
      parameters: {
        type: "object",
        properties: {
          value: {
            oneOf: [{ type: "string" }, { type: "number" }],
          },
        },
        required: ["value"],
      },
    },
  };
  const independent = [
    probeChat("thinking_disabled", apiKey, chatBody({
      thinking: { type: "disabled" },
    }), signal),
    probeChat("thinking_enabled_high", apiKey, chatBody({
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    }), signal),
    probeChat("thinking_enabled_max", apiKey, chatBody({
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    }), signal),
    probeChat("v4_pro", apiKey, chatBody({
      model: "deepseek-v4-pro",
      thinking: { type: "disabled" },
    }), signal),
    probeChat("tool_choice_auto", apiKey, chatBody({
      messages: [{ role: "user", content: "Call the synthetic tool." }],
      thinking: { type: "disabled" },
      tools: [syntheticTool],
      tool_choice: "auto",
    }), signal),
    probeChat("tool_choice_required", apiKey, chatBody({
      messages: [{ role: "user", content: "Call the synthetic tool." }],
      thinking: { type: "disabled" },
      tools: [syntheticTool],
      tool_choice: "required",
    }), signal),
    probeChat("tool_choice_none", apiKey, chatBody({
      messages: [{ role: "user", content: "Reply without calling a tool." }],
      thinking: { type: "disabled" },
      tools: [syntheticTool],
      tool_choice: "none",
    }), signal),
    probeChat("thinking_tool_choice_required", apiKey, chatBody({
      messages: [{ role: "user", content: "Call the synthetic tool." }],
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      tools: [syntheticTool],
      tool_choice: "required",
    }), signal),
    probeChat("parallel_tools", apiKey, chatBody({
      messages: [{ role: "user", content: "Call both synthetic tools." }],
      thinking: { type: "disabled" },
      tools: [syntheticTool, secondSyntheticTool],
      tool_choice: "required",
      parallel_tool_calls: true,
    }), signal),
    probeChat("strict_standard_endpoint", apiKey, chatBody({
      messages: [{ role: "user", content: "Call the synthetic tool." }],
      thinking: { type: "disabled" },
      tools: [strictTool],
      tool_choice: "required",
    }), signal),
    probeChat("strict_beta_endpoint", apiKey, chatBody({
      messages: [{ role: "user", content: "Call the synthetic tool." }],
      thinking: { type: "disabled" },
      tools: [strictTool],
      tool_choice: "required",
    }), signal, true),
    probeChat("strict_unsupported_schema_standard", apiKey, chatBody({
      messages: [{ role: "user", content: "Call the synthetic tool." }],
      thinking: { type: "disabled" },
      tools: [unsupportedStrictTool],
      tool_choice: "required",
    }), signal),
    probeChat("strict_unsupported_schema_beta", apiKey, chatBody({
      messages: [{ role: "user", content: "Call the synthetic tool." }],
      thinking: { type: "disabled" },
      tools: [unsupportedStrictTool],
      tool_choice: "required",
    }), signal, true),
  ];

  const [{ response: modelsResponse, payload: modelsPayload }, ...chatResults] = await Promise.all([
    modelsRequest,
    ...independent,
  ]);
  const continuation = await probeThinkingToolContinuation(apiKey, signal);
  return {
    observed_at: new Date().toISOString(),
    list_models: {
      http_status: modelsResponse.status,
      ok: modelsResponse.ok,
      models: Array.isArray(modelsPayload?.data)
        ? modelsPayload.data.map((model) => model.id).filter(Boolean).sort()
        : [],
    },
    probes: [...chatResults.map((result) => result.summary), ...continuation],
  };
}
