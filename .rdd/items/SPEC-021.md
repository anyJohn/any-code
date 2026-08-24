---
id: SPEC-021
type: spec
parent: RR-015
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: 文件系统引入 ripgrep（domain glob/grep 工具 + web @file 搜索）+ 修 3 个 web 交互 bug
---

# SPEC-021: 引入 ripgrep + 文件系统优化

## behaviors
- B-001: domain/src/ripgrep.ts 封装 runRipgrep——spawn @vscode/ripgrep 二进制，纯 argv 向量（无 shell，防注入），强制 --no-config 防 RIPGREP_CONFIG_PATH 注入
- B-002: domain glob 工具改用 rg --files -g PATTERN（尊重 .gitignore，跳 VCS/node_modules），上限 100
- B-003: domain grep 工具改用 rg --json --regexp=PATTERN（尊重 .gitignore，避免搜 build 产物），支持 output_mode files_with_matches/content/count + glob 过滤 + case_insensitive
- B-004: web /files route 改用 rg --files（尊重 .gitignore）+ JS substring 过滤 slice 20；删 fileIndex cache/preload/TTL（rg 够快，每次实时）
- B-005: web status route 删 preloadFileIndex（不预热）
- B-006: useFileReference effect 依赖改 fileToken（稳定 string，非 atMatch 引用）——修问题1 循环调用
- B-007: useFileReference 空 token（@ 单独）也检索（q=空 → rg --files 前 20）——修问题2 无反应
- B-008: useFileReference @ 前必须空格或行首：正则 (?:^|\s)@([^\s@]*)$——修问题3，"文字@" 不触发

## constraints
- C-001: ripgrep 经 @vscode/ripgrep 打包二进制，不依赖系统 rg — status: confirmed（DEC-071）
- C-002: 非对称 ignore：glob --no-ignore --hidden（发现配置/锁），grep 尊重 .gitignore（避搜 build） — status: confirmed（DEC-072）
- C-003: rg 强制 --no-config 防 host 配置注入预处理器 — status: confirmed
- C-004: @ 前必须空格/行首才触发弹层，不自动插空格 — status: confirmed（DEC-073）
- C-005: 不预热、不缓存——每次 /files 实时 rg --files — status: confirmed（DEC-074）

## invariants
- I-001: glob/grep/@file 结果与之前纯 JS 实现语义一致或更优（rg 尊重 .gitignore）
- I-002: useFileReference 不再因 setFileItems 触发 render 循环调 /files

## acceptance_criteria（即测试契约）
- AC-001 (runRipgrep): given argv，when runRipgrep，then spawn @vscode/ripgrep 二进制，强制 --no-config，纯 argv 无 shell
- AC-002 (domain glob): given pattern "*.ts", when globFunc, then 返匹配文件（rg --files -g）；排除 VCS 目录
- AC-003 (domain grep): given pattern + content 模式, when grepFunc, then 返 file:line:content（rg --json）；files_with_matches/count 模式
- AC-004 (web /files rg): given q, when GET /files, then rg --files + substring 过滤 slice 20；尊重 .gitignore
- AC-005 (问题1 修复): given draft 变致 fileToken 不变, when render, then effect 不重跑（依赖 fileToken 稳定 string，不循环调 /files）
- AC-006 (问题2 修复): given draft="@", when 渲染, then 弹层显示 workspace 前 20 文件
- AC-007 (问题3 修复): given draft="你好@", when 渲染, then 不弹（@ 前无空格）；draft="你好 @" 弹
- AC-008 (真 run): given anycode workspace, when rg --files, then 比 JS collect 快/同等，结果含 .ts 文件、不含 node_modules

## decisions (frozen)
- DEC-071: @vscode/ripgrep 打包二进制（不依赖系统 rg）
- DEC-072: 对称 ignore——glob/grep 均尊重 .gitignore（rg 默认，跳 node_modules 避免 flood）
- DEC-073: @ 前空格规则要求，不自动插
- DEC-074: 不预热不缓存，每次实时 rg（rg --files 中型仓 < 30ms）
- DEC-075: rg 强制 --no-config 防 host 配置注入
