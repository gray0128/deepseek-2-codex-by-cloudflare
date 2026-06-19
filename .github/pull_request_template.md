## 关联 Issue

Closes #

## 变更范围

-

## 协议与状态不变量

- [ ] 未静默忽略不支持的 Responses 字段
- [ ] SSE added/done、delta/final 和 completed 状态保持一致
- [ ] item id、call id 和 previous response 关联保持正确
- [ ] 未把 prompt、tool output、reasoning 或 secret 写入日志

## 验证

```text
# 列出实际执行的命令和结果
```

- [ ] 已更新相关 fixture 或说明不需要更新的原因
- [ ] 已执行对应阶段的真实 Codex E2E，或说明尚未进入该门禁

## 部署与回滚

- 配置/secret/DO migration 变化：
- 回滚方式：
