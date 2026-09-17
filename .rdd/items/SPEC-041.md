---
id: SPEC-041
type: spec
parent: RR-029
status: approved
owner: human
created: 2026-09-16
persists: permanent
---

# SPEC-041: system prompt 装配稳定性（prompt 前缀缓存防线）

> 补档：随 commit 19563ab 落地（solo-dev 超轻量通道，spec 即 commit body，此处留档供追溯）。

```yaml
spec:
  id: SPEC-041
  story: RR-029 衍生——用户关注费率，system head 字节漂移会作废整个会话的 prompt 前缀缓存
  status: approved

  behaviors:
    - id: B-001
      description: system prompt 装配为纯函数 assembleSystemPrompt（prompt.ts）——全部输入显式传入、无 IO/时钟/随机，同输入字节必同。
    - id: B-002
      description: 每任务 resolveSkills 只扫一次（executeTask 顶部），命令展开/ensureSystemHead/use_skill ctx 三处共享。

  constraints:
    - id: C-001
      description: 新增注入段必须保持纯函数纪律（promptStability.test.ts 防线）。

  invariants:
    - id: I-001
      description: 输入未变时 system head 字节不变（含技能目录重扫）。

  acceptance_criteria:
    - id: AC-001
      given: 同输入两次 assembleSystemPrompt
      when: 比对字节
      then: 逐字节相等（fingerprint 相等）
    - id: AC-002
      given: 技能文件未变
      when: 重新扫描并装配
      then: 指纹不变；技能 description 变化 → 指纹变化

  decisions:
    - id: DEC-148
      question: memory 写入导致的缓存作废怎么处理
      selected: 记账不硬改——语义必要成本；先用量面板看到真实命中率再决定去抖
      decided_by: human
      reason: 无数据先行的优化是盲调
      status: frozen
```
