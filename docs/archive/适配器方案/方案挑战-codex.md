# 对《DeepSeek 适配 Codex 协议转换：Cloudflare Worker 最小适配器方案》的挑战性评审

---
评审日期：2026-06-19  
评审对象：`docs/适配器方案/方案.md`  
评审立场：不质疑 Worker 作为部署载体的可行性，重点挑战协议正确性、状态假设、DeepSeek thinking/tool 语义、运行时边界和工期判断。  
---

## 0. 结论

**架构方向有条件成立，但当前方案不能按“Tier 2 设计”进入实现。**

`Codex → Worker → DeepSeek Chat Completions` 比 Container 路线更短，也避免了 Container 唤醒延迟。Codex 自定义 provider 当前只支持 `wire_api = "responses"`，Cloudflare AI Gateway 的 DeepSeek provider-native 路径也确实是 `/deepseek/chat/completions`，所以协议适配层有存在理由。

问题在于，文档将“能转发文字 delta”误当成“实现了 Codex 所需的 Responses 子集”。§7 给出的骨架在工具调用、thinking 多轮、事件对象和超时语义上存在数个确定性错误。按当前骨架实现，最可能的结果是：纯文本偶尔可用，第一次工具调用之后 400、丢上下文或 Codex 无法正确解析最终输出。

**评审决策：**

| 决策项 | 结论 |
|---|---|
| Worker 代替 Container | 保留，值得做 MVP |
| Tier 1 流式纯文本 | 可进入原型，但必须按 Responses 正式事件序列实现 |
| Tier 2 工具调用 + reasoning | 暂缓，先解决下列 P0 阻断项 |
| “无状态是 Tier 2 默认” | 不接受，必须先用真实 Codex 请求证明 |
| 1–2 周交付可日常使用 | 过于乐观；1–2 周更像协议探针和 Tier 1 原型工期 |
| §7 代码作为实现起点 | 只能作为伪代码，不能直接演进为生产实现 |

---

## 1. P0 阻断项

### 1.1 thinking 工具回合会确定性丢失 `reasoning_content`

DeepSeek 官方文档明确要求：**thinking 模式产生 tool call 时，该 assistant 回合的 `reasoning_content` 必须在后续请求中完整传回，否则 API 返回 400。**

当前方案存在三重丢失：

1. `stream.ts` 只读取 `delta.content` 和 `delta.tool_calls`，完全忽略 `delta.reasoning_content`。
2. 生成的 Responses `function_call` item 不保存任何可恢复的 DeepSeek reasoning 数据。
3. `request.ts` 在下一轮只合成 `assistant.tool_calls` 和 `role=tool`，没有传回 `reasoning_content`。

因此，“reasoning + 客户端工具调用”不是已覆盖能力，而是当前设计的必现失败路径。这直接推翻 §0、§2 和 §12 对 Tier 2 的完成度判断。

**必须先决定：**

- 方案 A：在 Responses item 中保留可回传的 provider metadata，并确认 Codex 会原样带回；
- 方案 B：由 Worker 按 response/call id 保存完整 assistant tool-call turn；
- 方案 C：第一版禁用 thinking，仅完成工具调用；
- 方案 D：第一版只做 thinking 纯文本，不做工具调用。

在 A/B 未被真实请求证明前，C 或 D 才是可信的 MVP。

### 1.2 混淆 Responses item `id` 与函数 `call_id`

Responses 的函数调用项至少有两个不同标识：

- item `id`：标识输出 item；
- `call_id`：关联后续 `function_call_output.call_id`。

骨架把 DeepSeek `tool_calls[].id` 同时当作 Responses item id 使用，并且写入最终 `function_call` 时根本没有 `call_id`：

```ts
base.output.push({
  id: tc.id,
  type: "function_call",
  status: "ready",
  name: tc.name,
  arguments: tc.arguments,
});
```

下一轮又用 `function_call_output.call_id` 查找 `assistant.tool_calls[].id`。这不是命名问题，而是跨回合关联契约错误。多工具并发时尤其容易把输出关联到错误调用。

**必须要求：** item id 与 call id 分开生成、保存、测试；fixture 至少覆盖两个并行工具、参数交错分片、完成顺序与声明顺序不同。

### 1.3 输出事件生命周期不完整，最终 `response.output` 也不完整

官方 Responses 流式示例的文本生命周期包含：

```text
response.output_item.added
response.content_part.added
response.output_text.delta
response.output_text.done
response.content_part.done
response.output_item.done
response.completed
```

方案只发 `response.created`、`response.in_progress`、若干 delta 和 `response.completed`。同时：

- 没有把文本 message 放入 `base.output`；
- `response.completed.response.output` 在纯文本场景始终为空；
- 没有 `output_text.done`、`content_part.done`、`output_item.done`；
- 工具调用也没有 `output_item.added/done`；
- SSE 示例缺少官方示例中的 `event: <type>` 行；
- 没有核对当前事件要求的字段和序号。

Codex 也许会容忍部分缺失事件，但文档没有证据支持这种容忍性。第三方 OpenResponses 只能当实现参考，不能替代“当前 Codex 客户端实际可接受契约”。

**挑战结论：** 应先录制 Codex 对官方 Responses endpoint 的请求/事件，再由同一 Codex 版本回放验证适配器；不能自行定义“最小事件集”。

### 1.4 请求转换会静默丢弃合法输入

`appendInputItem()` 仅保留：

- `type=message && role=user`；
- `type=function_call_output`。

它会静默丢弃 assistant/system/developer message、先前的 `function_call`、reasoning item、item reference，以及非文本输入。即使第一版明确不支持多模态，也不应静默忽略；应返回结构化 400，指出不支持的 item 类型。

更严重的是，当找不到 tool call 时，方案合成：

```json
{
  "name": "unknown_tool",
  "arguments": "{}"
}
```

`function_call_output` 本身通常不能提供原调用的 name/arguments。伪造调用不会恢复上下文，只会让 DeepSeek 收到语义错误的工具历史。正确做法只能是从完整输入、`previous_response_id` 对应状态，或适配器保存的调用记录中恢复。

### 1.5 Responses tool schema 到 Chat tool schema 的转换错误

Responses function tool 通常是扁平结构：

```json
{ "type": "function", "name": "shell", "description": "...", "parameters": {} }
```

Chat Completions 需要：

```json
{ "type": "function", "function": { "name": "shell", "description": "...", "parameters": {} } }
```

当前 `normalizeTool()` 直接把整个 Responses tool 包进 `function`，导致内层仍含 `type`，也没有显式处理 `strict` 等字段。方案还忽略 `tool_choice`、`parallel_tool_calls` 等会改变 Codex 行为的参数。

这部分必须使用显式 schema 和白名单映射，不能靠宽泛的 `Record<string, unknown>` 猜测兼容。

### 1.6 “无状态”不是实现策略，只是尚未验证的假设

§4.2 假定 Codex 每次把完整上下文放在 `input` 中，但 §3 的第二轮时序只展示一个 `function_call_output`。如果请求只带增量输入和 `previous_response_id`，无状态 Worker 无法恢复：

- 原工具名与参数；
- DeepSeek assistant tool-call message；
- thinking 工具回合必需的 `reasoning_content`；
- 之前的 system/developer 指令和对话。

而 Responses 官方文档明确说明 `previous_response_id` 用于创建多轮对话，并特别说明新请求的 `instructions` 不会从前一 response 自动继承。不能把是否需要状态推迟到“Phase 2 稳定性”；它决定 Tier 2 的基础数据模型，应在写转换器前完成抓包。

**要求把 Phase 0 前置为协议勘测：** 至少采集纯文本、单工具、多工具、工具失败、长工具输出、同一 thread 连续三轮的脱敏请求，并记录 Codex 版本。

### 1.7 非流式路径直接返回 Chat Completions，违反端点契约

当 `stream=false` 时，`index.ts` 直接 `return upstream`。客户端请求的是 `/v1/responses`，却收到 `chat.completion` 对象。这不是“Tier 1 待完善”，而是公开端点返回错误协议。

第一版若不支持非流式，应明确返回 `400/501`；若声明支持，则必须组装完整 Responses JSON，并对 tool call、usage、incomplete/failed 状态做映射。

### 1.8 把总时长超时误当成流空闲超时

Codex 的 `stream_idle_timeout_ms=300000` 是客户端等待流数据的空闲超时。Worker 却使用：

```ts
AbortSignal.timeout(300_000)
```

这会在请求开始 5 分钟后无条件取消上游，不管中间是否持续收到 token。两者语义完全不同。heartbeat 只发生在 Worker → Codex，不能延长 Worker → DeepSeek 的 `AbortSignal.timeout`。

正确实现应区分：

- 总请求上限；
- 上游首字节超时；
- 上游 chunk 空闲超时（每次收到 chunk 后重置）；
- 客户端断开时取消上游。

Cloudflare 官方文档确实说明 HTTP Worker 在客户端保持连接时没有硬 wall-clock 上限，等待 `fetch()` 也不计 CPU；因此没有必要用错误的固定 300 秒总超时模拟平台限制。

---

## 2. P1 高风险问题

### 2.1 DeepSeek effort 映射被过度简化

DeepSeek 当前文档的语义不是 low/medium/high 原样映射：

- thinking 默认是 enabled；
- low、medium 为兼容性会映射到 high；
- xhigh 映射到 max；
- thinking 模式主要有效值是 high/max；
- thinking 模式下 temperature、top_p、presence/frequency penalty 不生效。

当前代码在 effort 为 `none` 时不发送 `thinking`，但 DeepSeek 默认仍会启用 thinking。这意味着 Codex 请求“none”并不会关闭推理。另一方面，代码同时默认发送 `temperature=1` 和 `top_p=1`，在 thinking 模式下只是无效噪音，在非 thinking 模式也违背“一般只调整其中一个”的上游建议。

文档应给出明确策略：

| Codex effort | DeepSeek 请求 |
|---|---|
| `none` | `thinking.type=disabled` |
| `low` / `medium` | 说明会退化为 `high`，或在入口拒绝 |
| `high` | `thinking.type=enabled`, `reasoning_effort=high` |
| `xhigh` | `thinking.type=enabled`, `reasoning_effort=max` |

还应决定 reasoning 如何映射回 Responses。当前完全丢弃 `reasoning_content`，所以验收项“响应变慢/有推理痕迹”不是有效验证。

### 2.2 finish reason 与错误状态处理不足

骨架只处理 `tool_calls` 和 `stop`，遗漏至少：

- `length`；
- `content_filter`；
- `insufficient_system_resource`；
- 上游流中错误对象；
- JSON 半包、畸形 chunk、连接中断；
- `[DONE]` 前未出现 finish reason。

当前 `[DONE]` 会无条件补 `response.completed`，可能把截断或失败伪装成成功。适配器应根据上游结束原因生成 `completed`、`incomplete` 或 `failed`，并保留可诊断但不泄露 secret 的错误信息。

### 2.3 SSE 解析器不是合格的 SSE 解析器

按换行查找单个 `data:` 的实现没有处理：

- `event:` 字段；
- 多行 `data:`；
- event 以空行结束的边界；
- EOF 时 decoder flush 和残留 buffer；
- 注释、retry、未知字段；
- 单个坏事件的错误归因。

既然 SSE 状态机被认定为最高风险，就不应从一个只适合 happy path 的逐行 parser 开始。应选用经过 Workers 运行时验证的 parser，或至少用协议级 fixture 覆盖任意字节切片边界。

### 2.4 取消、背压和定时器生命周期不完整

`withHeartbeat().cancel()` 只清 timer，没有取消内部 reader，也没有把客户端断开传给上游 fetch。`readableFromAsyncGenerator()` 也没有 `cancel()` 调用 `gen.return()`。可能造成客户端已离开但 DeepSeek 调用仍继续计费。

实现必须贯通一个取消链：客户端 response cancel → generator return → upstream reader cancel / fetch abort。并验证慢客户端下不会无限累积数据。

### 2.5 重试可能重复工具回合

Codex 配置 `stream_max_retries=5`，但方案未说明断流后重试的幂等性。如果上游已经生成工具调用而下游只收到一部分，重放请求可能产生新的 call id 或不同参数。没有 response id 状态、重放游标和去重策略时，不能把 5 次重试当作稳定性增强。

MVP 应先把流重试降到可控值，并测试“工具参数传输一半时断流”的行为。

---

## 3. 对平台与运维叙事的挑战

### 3.1 “无冷启动”表述过度

Worker 路线避免的是 **Container 级别的 10–60 秒唤醒**，这是真实优势；但“无冷启动”是绝对化表达。更准确的说法应是“无需要用户管理的 Container scale-to-zero 唤醒，Worker isolate 启动开销通常远小于 Container”。

### 3.2 “Workers Paid（~$5）”不是完整成本模型

月费不能只写基础订阅价，还应说明请求量、CPU、AI Gateway 使用、DeepSeek token 和日志保留等变量。个人低量使用可能接近基础价，但这是使用假设，不是架构属性。

此外，方案写“锁定依赖版本”，示例却全部使用 caret 范围：

```json
"wrangler": "^4.20.0"
```

这不叫锁定。应提交 lockfile，并在需要可复现部署时使用精确版本或受控更新流程。

### 3.3 Gateway 应作为可选观测层，而不是默认正确答案

Cloudflare 官方文档确认 provider-native URL 拼接正确，但直连 DeepSeek 更适合作为 Phase 0 对照组。先直连可以减少一个故障域；协议正确后再引入 Gateway，比较首 token 延迟、流中断率和日志价值。

同时需明确 AI Gateway 日志是否保存 prompt/response、保存多久、是否满足个人代码和仓库内容的隐私要求。仅写“不要在 Worker DEBUG 打印 prompt”不足以覆盖 Gateway 侧数据面。

### 3.4 安全设计缺少成本保护

随机 bearer token + Worker secret 对个人入口是合理起点，但还缺少：

- 最大请求体和最大工具输出限制；
- 并发/速率限制；
- 上游超时与消费额度保护；
- 日志脱敏规则；
- 上游错误响应过滤；
- key 轮换和撤销步骤。

路径白名单不能防止已泄露 token 被用于消耗 DeepSeek 额度。

---

## 4. 对测试与验收方案的挑战

原方案的“5 种 scenario fixture”和“工具任务成功率 95%”不足以支撑协议适配器。95% 也没有样本数、任务集、Codex 版本和失败定义，无法复现。

建议建立以下验收矩阵：

| 层级 | 必测内容 | 通过标准 |
|---|---|---|
| 请求 schema | string input、message、function_call、function_call_output、未知 item | 支持项精确映射；不支持项明确 4xx，不静默丢弃 |
| 文本流 | 任意字节切片、Unicode 跨 chunk、EOF、坏 JSON | 完整事件顺序；最终 output 与 delta 拼接一致 |
| 工具流 | 单工具、双并行、参数交错、空参数、超长参数 | item id/call id 稳定且输出关联正确 |
| thinking | 纯文本、thinking+tool、连续两次 tool | `reasoning_content` 按 DeepSeek 规则回传，无 400 |
| 结束状态 | stop、length、filter、上游 4xx/5xx、断流 | 不把失败伪装为 completed |
| 取消与重试 | 客户端取消、半途断流、慢消费者 | 上游及时取消；无重复执行或有明确降级 |
| 状态 | full input 与 previous_response_id 两种请求形态 | 明确选择无状态或持久状态，不靠合成 unknown tool |
| 客户端兼容 | 固定 Codex Desktop/CLI 版本的 golden test | 单句、编辑文件、shell、多工具任务均通过 |

每个 `response.completed` 还应做不变量检查：

1. 所有 added item 都有对应 done；
2. delta 拼接值等于 done/最终 response 中的值；
3. output_index 连续且不冲突；
4. 每个 function call 的 item id 与 call id 可区分；
5. usage、status、error/incomplete_details 与上游结束原因一致。

---

## 5. 建议重排实施路线

### Phase -1：协议勘测（1–2 天）

1. 固定 Codex Desktop/CLI 版本。
2. 录制脱敏后的真实 Responses 请求：纯文本、单工具、并行工具、连续工具。
3. 核对请求是否携带完整历史、`previous_response_id`、function call item 和 reasoning item。
4. 形成 `fixtures/codex/<version>/`，它才是适配器范围的依据。

### Phase 0：严格 Tier 1（2–4 天）

只支持：文本输入、流式文本输出、明确的错误映射、取消传播。遇到 tools、非文本 item 或 `previous_response_id` 直接返回清晰的 4xx，不假装支持。

验收条件：正式 Responses 事件生命周期完整，最终 response.output 可重建，连续运行与断流测试通过。

### Phase 1：工具调用，不带 thinking（3–7 天）

先显式 `thinking.type=disabled`，完成 tool schema、call id、并行调用、function output 和上下文恢复。此阶段必须先决定无状态还是持久状态。

### Phase 2：thinking + tools（至少 3–7 天）

加入 `reasoning_content` 的捕获、保存和回传，验证 DeepSeek 连续工具回合；再决定是否向 Codex 暴露 reasoning summary。

### Phase 3：Gateway、观测和硬化

在直连基线稳定后引入 AI Gateway，补限流、额度保护、指标和脱敏策略，并以相同 fixture 回归。

这一排期的核心不是增加流程，而是避免同时调试三个未知量：Codex 请求形态、Responses 事件契约和 DeepSeek thinking/tool 上下文。

---

## 6. 最终挑战结论

Worker shim 是比 Container 更值得优先验证的方向，但方案当前低估的不是 TypeScript 代码量，而是**两个有状态协议之间的语义差异**。

最关键的修正是：

1. 不再把第三方 OpenResponses 文档当作唯一 golden reference，建立固定 Codex 版本的真实 fixture；
2. 不再默认无状态，先证明每次请求确实带齐 DeepSeek 所需的完整 tool/thinking 上下文；
3. 分离 Responses item id 与 call id，补齐正式事件生命周期和最终 output；
4. thinking + tools 上线前，完整保存并回传 DeepSeek `reasoning_content`；
5. 将固定总超时改为真正的 idle timeout，并贯通客户端取消；
6. Tier 1 对不支持能力显式失败，不静默丢字段或返回 Chat Completions 对象。

完成这些修正后，可以继续采用 Worker 路线；在此之前，推荐结论应从“Tier 2，1–2 周可落地”降级为：

> **先用 1–2 周完成协议勘测与严格 Tier 1；只有真实 Codex fixture 证明上下文模型后，再评估 Tier 2 的状态存储和工期。**

---

## 7. 核对来源

- [OpenAI Codex Configuration Reference](https://developers.openai.com/codex/config-reference/)
- [OpenAI Responses Create API Reference](https://developers.openai.com/api/reference/resources/responses/methods/create/)
- [OpenAI Streaming API Responses](https://developers.openai.com/api/docs/guides/streaming-responses/)
- [DeepSeek Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [Cloudflare AI Gateway DeepSeek Provider](https://developers.cloudflare.com/ai-gateway/usage/providers/deepseek/)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)

