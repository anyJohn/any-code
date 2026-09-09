---
id: SPEC-039
type: spec
story: RR-028
parent: RR-028
status: implementing
owner: human
created: 2026-09-09
persists: permanent
decisions:
  - id: DEC-140
    question: browser_use 执行范式？
    selected: playwright-core 底座 + connectOverCDP 连用户已开浏览器
    decided_by: human
    reason: 保留 v2 零配置设计（不下载浏览器）；白拿 Playwright 的等待/选择器/ariaSnapshot 能力；cookie/多页签一行 API。业界事实标准是 Playwright MCP 的无障碍快照范式。
---

# SPEC-039: browser_use 底座换 playwright-core（RR-028 中期）

## Behaviors
- B-001: browser_use 底层用 `playwright-core` 的 `chromium.connectOverCDP(cdpUrl)` 连接用户已开浏览器
  （保持零配置设计——不下载浏览器，需用户 `--remote-debugging-port=9222` 启动）。
- B-002: 连接/页面句柄模块级缓存，跨调用复用；cdpUrl 变化时重连。
- B-003: action 面：
  - `navigate(url)`：`page.goto`，load 超时不报错——返回当前页面状态 + SPA 提示
  - `content(selector?)`：URL/标题/文本（可 selector 圈定区域），截断带标记
  - `eval(js)`：`page.evaluate`（Promise 自动 await）
  - `snapshot()`：`locator.ariaSnapshot({ ref: true })`——无障碍树，元素带 ref
  - `click(ref | selector)`：按 snapshot ref（`aria-ref=`）或 CSS 选择器点击，自动等待可操作
  - `fill(ref | selector, text)`：清空并填入
  - `cookies(op)`：get / set(name,value,url) / clear
  - `tabs(op)`：list / new(url?) / select(index) / close(index)
- B-004: 未配置 cdpUrl 的报错信息保持不变（含启动命令示例）。

## Invariants
- I-001: 不调用 `playwright` 的浏览器下载（只用 playwright-core + 用户的浏览器）。
- I-002: 现有三 action（navigate/content/eval）的输出语义向后兼容。

## Acceptance Criteria
- AC-001: 真实 Chrome（--remote-debugging-port=9222）下：snapshot 返回带 ref 的无障碍树；
  click 按 ref 命中元素；content(selector) 只返回命中区域。
- AC-002: eval 返回 Promise 时拿到 resolve 值。
- AC-003: cookies get/set/clear 与 tabs list/select 生效。
- AC-004: cdpUrl 未配置/浏览器未启动 → 明确报错（不崩、不挂起）。
