# MVP-A 运维记录

## 生产环境

- Worker：`deepseek-codex-adapter`
- URL：`https://deepseek-codex-adapter.amd2.workers.dev`
- 模型别名：`deepseek-codex`
- Secrets：`DEEPSEEK_API_KEY`、`ADAPTER_BEARER_TOKEN`

两个 secret 都只通过 `wrangler secret put` 写入，不放入配置、日志或仓库。

```sh
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put ADAPTER_BEARER_TOKEN
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
