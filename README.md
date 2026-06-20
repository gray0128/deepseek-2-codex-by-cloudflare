# DeepSeek to Codex on Cloudflare

使用 Cloudflare Worker 将 Codex Responses API 请求适配到 DeepSeek Chat Completions。

当前实现已覆盖 MVP-C：流式文本、客户端 function tools、连续工具回合、thinking 请求、
并行 tool call 流解析、取消传播、错误映射、回滚和生产 smoke。

## 使用场景

适合：

- 在 Codex Desktop 或 Codex CLI 中，通过自定义 Responses provider 使用 DeepSeek 模型；
- 在 Cloudflare Workers 上部署轻量协议适配层，将 Codex 的 Responses 请求转换为 DeepSeek Chat Completions；
- 需要流式文本、客户端 function tools、连续或并行工具调用，以及 thinking 请求的内部开发环境。

当前不适合：

- OpenAI Responses API 的通用替代服务；
- `stream=false`、多模态输入、服务端内置工具或 reasoning item 透传；
- 需要向客户端暴露 DeepSeek `reasoning_content` 的场景。

## 使用方法

### 接入现有 Worker

设置一个与 Worker `ADAPTER_BEARER_TOKEN` 相同的本地环境变量：

```sh
export CODEX_GATEWAY_API_KEY='<adapter-bearer-token>'
```

在 Codex 的 `config.toml` 中添加 provider，并将其设为当前模型：

```toml
model = "deepseek-codex"
model_provider = "cf_deepseek_adapter"

[model_providers.cf_deepseek_adapter]
name = "Cloudflare DeepSeek Responses Adapter"
base_url = "https://codex.bobocai.win/v1"
env_key = "CODEX_GATEWAY_API_KEY"
wire_api = "responses"
stream_max_retries = 0
supports_websockets = false
```

完成配置后即可正常启动 Codex。可先检查服务是否在线：

```sh
curl -fsS https://codex.bobocai.win/healthz
```

### 自行部署

要求 Node.js 22+ 和可用的 Cloudflare 账号。安装依赖、写入 secrets 并部署：

```sh
npm ci
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put ADAPTER_BEARER_TOKEN
npx wrangler secret put RESPONSE_ID_SECRET
npm run deploy
```

`ADAPTER_BEARER_TOKEN` 和 `RESPONSE_ID_SECRET` 均至少使用 16 个字符。部署后，将上方
Codex 配置中的 `base_url` 替换为你的 Worker 地址并保留 `/v1` 后缀；
`CODEX_GATEWAY_API_KEY` 必须与部署时写入的 `ADAPTER_BEARER_TOKEN` 相同。

服务端点：

- `GET /healthz`：存活检查，不验证 DeepSeek 或 Durable Object；
- `GET /v1/models`：查询可用模型，需要 Bearer token；
- `POST /v1/responses`：流式 Responses 适配入口，需要 Bearer token。

## 部署与配置文档

- [子智能体配置方案](./docs/子智能体配置方案.md)：配置 DeepSeek 与 MiniMax 子智能体、跨平台认证和使用方法；
- [MVP-C 运维记录](./docs/operations.md)：生产部署、secrets、验收证据和回滚；
- [生产 Worker](https://codex.bobocai.win/healthz)
