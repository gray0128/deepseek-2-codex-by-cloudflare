# DeepSeek 能力门禁

日期：2026-06-19
状态：文档基线和真实端点探测均已完成

本页区分“官方文档声明”和“当前端点实测”。只有端点实测通过的能力才能进入
实现策略；文档声明不能替代 T00 的门禁证据。机器可读结果见
[`fixtures/deepseek/2026-06-19/capabilities.json`](../fixtures/deepseek/2026-06-19/capabilities.json)。

## 文档基线

| 能力 | 2026-06-19 官方文档声明 | 实测状态 |
|---|---|---|
| 模型 | `deepseek-v4-flash`、`deepseek-v4-pro` | `/models` 和两模型请求均 200 |
| 旧别名 | `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 15:59 UTC 弃用 | 不作为实现默认值 |
| thinking 开关 | `thinking.type=enabled/disabled`，默认 enabled | enabled / disabled 均 200 |
| effort | `high/max`；low/medium 映射 high，xhigh 映射 max | high / max 均 200 且返回 reasoning |
| thinking 输出 | 流式 `delta.reasoning_content`，与 `content` 同级 | 非流式字段存在；流式映射留给 T08 fixture |
| thinking + tools | 支持；工具子回合必须完整回传 `reasoning_content`，否则 400 | auto 下两子回合均 200；完整回传成功 |
| strict | `/beta` 执行严格 JSON Schema 校验 | standard 接受不支持的 schema，beta 对同一 schema 返回 400 |
| parallel tools | 文档未形成足够明确的契约 | required + 两工具返回两个 tool calls |
| `tool_choice` | 文档示例不能证明所有取值在当前端点可用 | non-thinking 的 auto/required/none 均 200；thinking 的 required 为 400 |

## 已关闭的 Codex 门禁

固定 Codex CLI `0.142.0-alpha.1` 的合成端点采集已经确认：

- Codex 使用 Responses wire API，发送 `stream=true`、`store=false`。
- 工具子回合重发本回合完整 input，不依赖 `previous_response_id`。
- reasoning 请求包含 `reasoning.encrypted_content` include 和 effort。
- 文本、function call、空 summary reasoning item 三种最小 SSE 序列均已被真实客户端消费。

对应 fixtures 位于 `fixtures/codex/0.142.0-alpha.1/`。

## 端点结论

使用项目专用 DeepSeek key 执行合成请求；输出只保存 HTTP 状态、响应字段存在性、
模型名和错误类型，没有保存 reasoning、content、key 或完整错误正文。

1. 实现默认模型使用 `deepseek-v4-flash`；`deepseek-v4-pro` 可进入显式白名单。
2. thinking 使用 `enabled/disabled`；effort 只向上游发送 `high/max`。
3. non-thinking 支持 `tool_choice=auto/required/none` 和并行工具。
4. thinking + tools 只发送 `tool_choice=auto`；`required` 必须在 HTTP 边界返回 400。
5. strict 只能路由到 `/beta`；standard 虽接受字段，但不会执行同等 schema 校验。
6. thinking 工具子回合必须原样保存并回传 `reasoning_content`。

## 来源

- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)
