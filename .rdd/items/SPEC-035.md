---
id: SPEC-035
type: spec
story: FR-24
parent: FR-24
status: completed
owner: human
created: 2026-09-05
persists: permanent
origin: 用户决策 2026-09-05（会话内指令）+ 开源 agent 记忆机制调研（Letta/MemGPT、mem0、LangMem、Claude Code、OpenHands、aider）
---

# SPEC: 记忆管理升级 —— update_memory 重写模式

> 场景 C（轻量变更）。FR-24 原规格的"检索注入 / 有效期 / 权重"经用户决策砍除：
> 检索（及向量 RAG 跨 session 长期记忆）移入长远计划（优先级很低）；有效期/权重不做
> ——业界调研佐证：五家开源 agent 中四家无 TTL、全部无权重字段，过期/整理均交给
> LLM 主动重写（self-edit）。

## 决策（人类，2026-09-05 会话）

- DEC-121：**不做检索注入**——记忆仍全量注入 + 滑动窗口截断；RAG 长期大容量跨 session 记忆入长远计划。
- DEC-122：**不做有效期/权重元数据**——记忆价值判断是语义的；新者优先用时间戳天然承载。
- DEC-123：**蒸馏走 LLM self-edit**——`save_memory` 更名 `update_memory` 并新增 rewrite 模式（对标 Letta `memory_rethink` / Claude Code 强制精简索引）。

```yaml
spec:
  behaviors:
    - { id: B-001, description: "save_memory 工具更名为 update_memory（toolName 枚举、schema、文件名、prompt 引用、anycode-docs 技能同步）；追加写入行为不变" }
    - { id: B-002, description: "update_memory 新增 mode 参数：缺省 append（现行为）；mode=rewrite 时用 content 全量重写该 scope 的记忆文件——LLM 依据 system prompt 已注入的当前记忆整理（压缩/合并/剔除过时），无需先读文件" }
    - { id: B-003, description: "prompt.ts 记忆引导段更新：告知 rewrite 模式的用途（记忆冗余/过时→主动整理），引导克制使用（低频蒸馏，不每轮触发）" }
    - { id: B-004, description: "config.yaml 新增可选 memory.maxChars——记忆注入截断窗口，缺省 4000（现硬编码值）" }
  constraints:
    - { id: C-001, description: "记忆文件格式不变（## 时间戳条目流），旧文件零迁移" }
    - { id: C-002, description: "rewrite 不做版本/备份——记忆文件是缓存不是数据源，LLM 重写错误靠用户 git/手改兜底" }
  acceptance_criteria:
    - { id: AC-001, given: "agent 工具列表", when: "组装", then: "出现 update_memory 且无 save_memory；追加调用落盘行为与旧 save_memory 一致（AC 由现有 saveMemory 测试迁移改名覆盖）" }
    - { id: AC-002, given: "update_memory mode=rewrite + 全量 content", when: "调用", then: "该 scope 记忆文件被整体替换为 content" }
    - { id: AC-003, given: "config 设 memory.maxChars=1000 且记忆超长", when: "loadMemory 注入", then: "注入段 ≤ 窗口且从条目边界截取（现有测试参数化扩展）" }
    - { id: AC-004, given: "真实 LLM run（记忆库含冗余条目）", when: "提示整理记忆", then: "LLM 调用 update_memory rewrite 且文件被精简（LLM 行为依赖项，真 LLM run 验证）" }
```

## 实现落点

- domain：`tools/toolName.enum.ts`（SaveMemory→UpdateMemory）、`tools/functions/saveMemory.ts`→`updateMemory.ts`（+mode）、`prompt.ts`（引导段）、`memory.ts`（loadMemory 接受 maxChars 参数）、`config.ts`（memory 段）、`main.ts`（透传）
- builtin 技能：`anycode-docs/SKILL.md` 三处 save_memory → update_memory + rewrite 说明
- server/web：零改动（工具开关按名引用处若有 save_memory 字样同步）

## 长远计划备忘（不入本 spec 实现）

RAG 长期大容量跨 session 记忆（向量检索、条目结构化）——记忆规模到"单文件装不下"时再启动。
