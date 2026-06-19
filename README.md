# DeepSeek to Codex on Cloudflare

使用 Cloudflare Worker 将 Codex Responses API 请求适配到 DeepSeek Chat Completions。

当前仓库处于方案与任务准备阶段，尚不包含可部署实现。目标范围、技术实现和任务进度分别由以下文档管理：

- [最终实施方案](./docs/最终方案.md)：项目范围、阶段和关键决策；
- [MVP-C 技术设计](./docs/MVP-C技术设计.md)：模块、接口、状态机、数据模型和测试方案；
- [开发路线图与 Issue 索引](./docs/开发路线图.md)：任务依赖、验收标准和 GitHub issues；
- [历史方案与评审归档](./docs/archive/)：只用于追溯，不作为实现依据。

## 开发进度

- [MVP-C milestone](https://github.com/gray0128/deepseek-2-codex-by-cloudflare/milestone/1)
- [MVP-C Epic #1](https://github.com/gray0128/deepseek-2-codex-by-cloudflare/issues/1)
- [设计基线 Issue #2](https://github.com/gray0128/deepseek-2-codex-by-cloudflare/issues/2)
- [设计基线 Draft PR #14](https://github.com/gray0128/deepseek-2-codex-by-cloudflare/pull/14)

Epic 是总体进度入口；`docs/开发路线图.md` 是任务依赖和验收定义的仓库内镜像。两者不一致时，先修正 issue，再同步路线图。

## Issue 流程

1. **先查重和依赖**
   - 在 [Epic #1](https://github.com/gray0128/deepseek-2-codex-by-cloudflare/issues/1) 和 [开发路线图](./docs/开发路线图.md) 中确认任务尚未存在。
   - 检查 `Blocked by #...`；依赖未关闭时不开始占位实现。
2. **冻结任务范围**
   - issue 必须写清目标、交付物、验收标准和依赖。
   - 使用 `phase:discovery`、`phase:foundation`、`phase:mvp-a`、`phase:mvp-b`、`phase:mvp-c` 或 `phase:release` 标记阶段。
   - 所有 MVP-C 任务加入 `MVP-C` milestone，并分配明确负责人。
3. **开始开发**
   - 从最新 `main` 创建 `codex/issue-<number>-<short-name>` 分支。
   - 在 issue 中记录实施计划；发现范围变化时先更新 issue 和活动文档。
4. **保持进度可见**
   - 阻塞、外部契约结论和验收证据写回 issue，不只保留在本地或 PR 对话中。
   - 新增任务必须加入 Epic checklist 和路线图索引。

## PR 流程

1. **一个 issue 对应一个 PR**
   - 除 Epic 外，每个 issue 原则上由一个 PR 关闭；不要把无关任务混入同一 PR。
   - PR 标题概括实际变更，正文使用 `Closes #<number>` 关联 issue。
2. **尽早创建 Draft PR**
   - 首个可评审提交推送后创建 Draft PR，持续在同一分支更新。
   - PR 必须填写 `.github/pull_request_template.md` 中的范围、不变量、验证和回滚信息。
3. **提交验证证据**
   - 列出实际执行的 typecheck、test、fixture 和真实 Codex E2E 命令及结果。
   - 协议变化必须更新对应 fixture；DO schema、secret、compatibility date 变化必须单独说明。
   - 禁止把 prompt、tool output、reasoning 或 secret 放入日志、fixture 或 PR 内容。
4. **转为 Ready for review**
   - issue 验收项全部有证据、依赖已关闭、CI 通过后才能取消 Draft。
   - 评审意见必须在原 PR 处理；不以新 PR 绕过未解决评论。
5. **合并与收尾**
   - 只合并当前 head 已通过 CI 和评审的 PR。
   - 合并后确认 `Closes` 已关闭 issue，并同步 Epic checklist、路线图和相关活动文档。
   - 若实现与技术设计不同，必须在同一 PR 中记录决策和更新文档。

## 活动文档规则

`docs/` 根目录只保留当前实施需要的文档。被新决策替代的方案、挑战报告和评审记录移动到 `docs/archive/`，并修正活动文档中的引用；归档内容不再用于指导实现。
