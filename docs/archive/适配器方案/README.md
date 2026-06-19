# 适配器方案

Cloudflare Worker 最小协议适配器路线，用于 Codex `wire_api = "responses"` 对接 DeepSeek Chat Completions。

## 文档

| 文件 | 说明 |
|---|---|
| [方案.md](./方案.md) | 完整架构、范围、代码骨架、部署与验收 |

## 与 Container 方案的关系

| 目录 | 路线 |
|---|---|
| `docs/方案.md` | Worker + Container + OpenResponses |
| `docs/适配器方案/` | Worker 内 TS 协议 shim（无 Container） |
| `docs/方案挑战.md` | 对 Container 方案的评审与替代路径分析 |

两套方案可并行部署，Codex 通过不同 profile 的 `base_url` 切换。