# Codex 0.142.0-alpha.1 fixtures

采集表面：Codex CLI `0.142.0-alpha.1`，非交互 `codex exec`。

采集方法：将自定义 Responses provider 指向本地合成 SSE 端点，使用空目录、
`--ignore-user-config`、`--ephemeral` 和合成 prompt 执行。端点只记录请求 body，
不记录认证 header；返回的 ID、文本、工具参数和 reasoning 均为固定合成值。

```sh
codex -a never exec \
  --ignore-user-config --skip-git-repo-check --ephemeral --json \
  -C /tmp/codex-fixture-empty -s read-only -m synthetic-codex \
  -c 'model_provider="probe"' \
  -c 'model_providers.probe.base_url="http://127.0.0.1:18080/v1"' \
  -c 'model_providers.probe.wire_api="responses"' \
  'Reply with exactly: hello'
```

## 已验证结论

- 请求固定为 `POST /v1/responses`，且 `stream=true`、`store=false`。
- 文本最小事件序列必须包含 item/content part 的 added/done、text delta/done，
  最后才发送 `response.completed`；此目录中的序列已被真实 Codex 客户端消费。
- 工具子回合的下一次请求重发本回合完整 input，包括原始 `function_call` 和新增
  `function_call_output`；未发送 `previous_response_id`。
- `gpt-5.4` + high reasoning 请求包含
  `include=["reasoning.encrypted_content"]` 和 `reasoning.effort="high"`。
- 空 summary 的 reasoning item 加密内容可与后续 message 一起被客户端消费；
  reasoning 不会混入最终 agent message。

## 脱敏规则

- 删除全部请求 header、session/thread/request ID 和 prompt cache key。
- 将 Codex 内置长 instructions、用户目录、插件和工具说明压缩为合成占位内容。
- 只保留与适配器契约相关的字段；所有 prompt、命令和输出均为合成数据。
- fixtures 中不得出现 API key 前缀、认证方案值、用户主目录或真实仓库内容。
