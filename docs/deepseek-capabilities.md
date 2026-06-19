# DeepSeek 能力门禁

日期：2026-06-19
状态：文档基线已冻结，真实端点探测待专用 API key

本页区分“官方文档声明”和“当前端点实测”。只有端点实测通过的能力才能进入
实现策略；文档声明不能替代 T00 的门禁证据。机器可读结果见
[`fixtures/deepseek/2026-06-19/capabilities.json`](../fixtures/deepseek/2026-06-19/capabilities.json)。

## 文档基线

| 能力 | 2026-06-19 官方文档声明 | 实测状态 |
|---|---|---|
| 模型 | `deepseek-v4-flash`、`deepseek-v4-pro` | 待探测 |
| 旧别名 | `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 15:59 UTC 弃用 | 待探测 |
| thinking 开关 | `thinking.type=enabled/disabled`，默认 enabled | 待探测 |
| effort | `high/max`；low/medium 映射 high，xhigh 映射 max | 待探测 |
| thinking 输出 | 流式 `delta.reasoning_content`，与 `content` 同级 | 待探测 |
| thinking + tools | 支持；工具子回合必须完整回传 `reasoning_content`，否则 400 | 待探测 |
| strict | 支持 thinking / non-thinking，但要求 `/beta` endpoint 且全部 function 设 `strict=true` | 待探测 |
| parallel tools | 文档未形成足够明确的契约 | 待探测 |
| `tool_choice` | 文档示例不能证明所有取值在当前端点可用 | 待探测 |

## 已关闭的 Codex 门禁

固定 Codex CLI `0.142.0-alpha.1` 的合成端点采集已经确认：

- Codex 使用 Responses wire API，发送 `stream=true`、`store=false`。
- 工具子回合重发本回合完整 input，不依赖 `previous_response_id`。
- reasoning 请求包含 `reasoning.encrypted_content` include 和 effort。
- 文本、function call、空 summary reasoning item 三种最小 SSE 序列均已被真实客户端消费。

对应 fixtures 位于 `fixtures/codex/0.142.0-alpha.1/`。

## 待执行端点矩阵

使用专门为本项目创建的 DeepSeek key 执行以下合成请求；输出只保存 HTTP 状态、
响应字段存在性、模型名和错误类型，不保存 reasoning、content、key 或完整错误正文。

1. `/models` 和两个 V4 模型的最小文本请求。
2. thinking disabled、enabled + high、enabled + max。
3. `tool_choice=auto/required`、单工具和可诱发双工具的请求。
4. standard endpoint 的 strict 拒绝和 `/beta` endpoint 的 strict 接受。
5. thinking + tool call 后完整回传 `reasoning_content` 的连续子回合。

## 来源

- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)
