# MVP-C 运维记录

## 生产环境

- Worker：`deepseek-codex-adapter`
- URL：`https://deepseek-codex-adapter.amd2.workers.dev`
- 模型别名：`deepseek-codex`
- 当前生产版本：`f9e772c3-1853-4451-976d-148fe499ce63`（secret 轮换生成）
- 对应代码部署版本：`eef8dd04-f1ce-4632-8542-8c5334d502a7`
- Secrets：`DEEPSEEK_API_KEY`、`ADAPTER_BEARER_TOKEN`、`RESPONSE_ID_SECRET`

两个 secret 都只通过 `wrangler secret put` 写入，不放入配置、日志或仓库。

```sh
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put ADAPTER_BEARER_TOKEN
npx wrangler secret put RESPONSE_ID_SECRET
npm run deploy
curl -fsS https://deepseek-codex-adapter.amd2.workers.dev/healthz
```

## Codex 配置

固定验收版本为 Codex CLI `0.142.0-alpha.1`。`CODEX_GATEWAY_API_KEY` 必须与
Cloudflare 的 `ADAPTER_BEARER_TOKEN` 一致。

```toml
model = "deepseek-codex"
model_provider = "cf_deepseek_adapter"

[model_providers.cf_deepseek_adapter]
name = "Cloudflare DeepSeek Responses Adapter"
base_url = "https://deepseek-codex-adapter.amd2.workers.dev/v1"
env_key = "CODEX_GATEWAY_API_KEY"
wire_api = "responses"
stream_max_retries = 0
supports_websockets = false
```

## MVP-A 基线

2026-06-19 在生产 Worker 上串行执行 30 次合成文本请求：

| 指标 | 结果 |
|---|---:|
| HTTP 200 | 30/30 |
| adapter 5xx | 0 |
| TTFT 平均 / 最小 / 最大 | 0.427s / 0.335s / 0.650s |
| 总耗时平均 / 最小 / 最大 | 1.067s / 0.756s / 1.487s |

固定 Codex 的真实 E2E 返回 `hello` 并产生 `turn.completed`，usage 为 input 11193、
output 1、reasoning 0。入口日志只包含 request id、method、path、status、code 和首字节前的
`duration_ms`；不包含 header、请求正文、上游正文或 reasoning。

真实断连探针以客户端 timeout 主动取消（curl exit 28），随后 `/healthz` 正常。单元测试
进一步断言请求 signal 和下游 stream cancel 都会 abort DeepSeek fetch。

## MVP-C 验收矩阵

固定验收版本：Codex CLI `0.142.0-alpha.1`。所有 E2E 均通过生产 Worker
`https://deepseek-codex-adapter.amd2.workers.dev/v1` 执行，`stream_max_retries=0`。

| 能力 | 结果 |
|---|---|
| 文本 | `agent_message=hello`，`turn.completed` |
| 单工具 | 执行 `printf synthetic-tool-output`，工具输出后 `agent_message=hello` |
| 双工具/连续工具 | 执行 `printf first`、`printf second`，最终 `agent_message=done` |
| thinking 文本 | `model_reasoning_effort=high` 下返回 `hello`，不暴露 reasoning item |
| thinking + tool | 执行工具并返回 `hello`，`reasoning_output_tokens=0` |
| 并行 tool stream | Golden test 覆盖交错 arguments、逆序 index 和 output_index/call_id 关联 |
| 取消 | 客户端 timeout 产生 curl exit 28，Worker 随后健康 |
| 回滚 | 实际切到首个代码版本并恢复，两个版本 `/healthz` 均通过 |

当前策略是不向 Codex 暴露 DeepSeek `reasoning_content`，也不将其写入日志或 `output_text`。
`reasoning_content` 相关回归测试会确保上游 reasoning 不出现在 SSE 响应文本中。

## 版本与回滚

```sh
npx wrangler versions list
npx wrangler versions deploy <VERSION_ID>@100
curl -fsS https://deepseek-codex-adapter.amd2.workers.dev/healthz
```

回滚不会恢复或替换 secret。回滚后必须检查 `/healthz`，再用有效 Bearer token发一条最小
`/v1/responses` smoke。若新版本只改 secret，应轮换 secret，而不是回滚代码。

2026-06-19 已实际将 100% 流量从当前版本切到首个代码版本，健康检查通过后恢复到原版本；
恢复后的部署状态仍为原版本 100%，健康检查通过。

## 错误与取消

- 客户端认证失败：401 `invalid_api_key`。
- DeepSeek 429：429 `upstream_rate_limited`；不返回上游正文。
- DeepSeek 401/403、其他 4xx、5xx：502；不返回上游正文。
- 首字节或总时限超时：504；流开始后的 idle/断流以流错误结束，不发送
  `response.completed`。
- 客户端断开会 abort 上游 fetch；首事件发出后不自动重试。

## 日志与隐私

允许记录字段：request id、method、path、status、code、`duration_ms`。禁止记录：
Authorization、DeepSeek key、input、instructions、tool schema 正文、arguments、tool output、
reasoning、上游错误正文和完整 DeepSeek 响应。
