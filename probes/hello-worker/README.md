# T00 hello Worker

这是协议勘测阶段的一次性无状态探针，只支持 `POST /v1/responses` 的流式文本
hello。它有意不实现鉴权、工具调用、状态、完整 schema、超时和生产错误矩阵；这些属于
T01–T03，不能从本探针复制后宣称生产可用。

```sh
npx wrangler secret put DEEPSEEK_API_KEY \
  --config probes/hello-worker/wrangler.jsonc
npx wrangler secret put PROBE_CLIENT_TOKEN \
  --config probes/hello-worker/wrangler.jsonc
npx wrangler deploy --config probes/hello-worker/wrangler.jsonc
curl https://deepseek-codex-t00-hello.<subdomain>.workers.dev/healthz
```

部署后，将 `PROBE_CLIENT_TOKEN` 放入本地临时环境变量，并在 Codex 自定义 provider
中用 `env_key` 引用；base URL 指向 Worker 的 `/v1`。验收完成后删除 Worker 和两个
secret，不能将本探针保留为公共服务。
