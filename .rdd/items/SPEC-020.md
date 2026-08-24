---
id: SPEC-020
type: spec
parent: RR-014
status: approved
created: 2026-08-24
approved: 2026-08-24
persists: permanent
scope: workspace 文件索引启动预热（/chat 加载即建树）
---

# SPEC-020: 文件索引启动预热

## behaviors
- B-001: web/lib/fileIndex.ts 抽取 collectFiles + loadGitignores + cache（per projectKey，TTL 60s）
- B-002: getFileIndex(projectKey, rootPath) sync：命中缓存返回；miss 同步 collect + 缓存
- B-003: preloadFileIndex(projectKey, rootPath) fire-and-forget：fresh 则 skip，否则 setImmediate 后台 collect 填缓存
- B-004: status route（/chat 加载即调）末尾 fire-and-forget preloadFileIndex → 进 chat 即建树
- B-005: /files GET 走 getFileIndex（预热后命中缓存，无 collect 延迟）+ substring 过滤 + slice 20

## constraints
- C-001: 预热非阻塞——status route 不等 preload 完成即返回 — status: confirmed
- C-002: TTL 60s——预热后长有效，过期自然重建 — status: confirmed
- C-003: 文件增删 60s 内可能 stale（接受，过期重建）— status: confirmed
- C-004: 预热 idempotent——fresh 缓存则不重复 collect — status: confirmed

## invariants
- I-001: /files 返回结果与预热前一致（同一 collect 逻辑）
- I-002: preload 失败不影响 status route（fire-and-forget）

## acceptance_criteria
- AC-001 getFileIndex：miss 同步 collect 返回文件；二次调命中缓存返回同结果
- AC-002 preloadFileIndex：fresh skip 不 collect；stale 则后台填缓存（下一次 getFileIndex 命中）
- AC-003 status route 触发 preload（/chat 加载即建树，不阻塞响应）
- AC-004 /files GET 走 getFileIndex，预热后无 collect（命中缓存）
- AC-005 TTL 60s：过期后下次 getFileIndex 重建

## decisions (frozen)
- DEC-067: 预热触发点 = status route（/chat 加载即调）
- DEC-068: TTL 60s（预热后长有效）
- DEC-069: 文件 staleness 用 TTL 过期重建，不上 fs.watch（deferred）
- DEC-070: 预热 setImmediate 后台 sync collect（anycode 规模 ~50ms 可接受）
