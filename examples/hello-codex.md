# Codex hello 复现记录

状态：本地合成 Responses 链路已通过；Cloudflare -> DeepSeek 真实链路待专用 API key。

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

## 真实链路待办

1. 创建项目专用 DeepSeek key，不复用个人应用 key。
2. 用该 key 完成能力矩阵并写回 `fixtures/deepseek/2026-06-19/capabilities.json`。
3. 部署最简无状态 Worker，将 Codex provider 指向 Worker `/v1`。
4. 执行相同 hello prompt，记录 Worker version、命令、结果和已知限制。

真实链路通过前，本记录不能作为 T00 已验收或 MVP-A 可开始的证据。
