# Codex hello 复现记录

状态：本地合成链路和 Cloudflare -> DeepSeek -> Codex 真实链路均已通过。

## 固定版本

- Codex CLI：`0.142.0-alpha.1`
- Wrangler：`4.99.0`
- 采集日期：`2026-06-19`
- 运行表面：Codex CLI `exec --json`

## 已通过的本地链路

Codex 使用自定义 provider 请求本地合成 Responses SSE 端点。prompt 为
`Reply with exactly: hello`，最终客户端事件为：

```jsonl
{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}
{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1,"reasoning_output_tokens":0}}
```

同一方法已验证 function call 后继续请求，以及带合成加密 reasoning item 的文本响应。
完整脱敏请求和事件见 `fixtures/codex/0.142.0-alpha.1/`。

## 真实链路

部署信息：

- Worker：`deepseek-codex-t00-hello`
- URL：`https://deepseek-codex-t00-hello.amd2.workers.dev`
- 验收版本：`88dcaf66-065e-4c1d-82b5-4a971187605a`（100% traffic）
- Secrets：`DEEPSEEK_API_KEY`、`PROBE_CLIENT_TOKEN`
- DeepSeek key：项目专用 `deepseek-codex-cloudflare-t00`，未记录明文

Codex 自定义 provider 使用 Worker `/v1` base URL，并通过 `env_key` 从临时环境变量
读取 probe token。执行相同 hello prompt 后，真实客户端输出为：

```jsonl
{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}
{"type":"turn.completed","usage":{"input_tokens":11190,"cached_input_tokens":11136,"output_tokens":1,"reasoning_output_tokens":0}}
```

能力矩阵随后通过受保护的 `/probe/capabilities` 路由执行，结果见
`fixtures/deepseek/2026-06-19/capabilities.json`。该路由只返回状态和字段存在性，
不会返回 content、reasoning、错误正文或 secret。

## 已知限制

本 Worker 是 discovery probe，不具备生产 HTTP schema、完整错误映射、工具流、状态层和
限额控制。T00 合并后应删除线上 probe；T01–T03 必须重新实现生产 Worker，不能将本探针
视为 MVP-A。
