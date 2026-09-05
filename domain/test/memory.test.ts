import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { loadMemory, rewriteMemory, saveMemory } from "../src/memory";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-memory-"));
const ws = { rootPath: tmp } as never;
const file = path.join(tmp, ".anycode", "memory.md");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// FR-24 / SPEC-035：记忆追加（AC-001 行为不变）+ rewrite 全量重写（AC-002）+ 注入窗口（AC-003）
describe("memory（SPEC-035）", () => {
    it("AC-001 append：saveMemory 追加条目，行为与旧 save_memory 一致", () => {
        saveMemory(ws, "first note", "project");
        saveMemory(ws, "second note", "project");
        const raw = fs.readFileSync(file, "utf-8");
        expect(raw).toContain("first note");
        expect(raw).toContain("second note");
        expect(raw.startsWith("# Agent Memory")).toBe(true);
    });

    it("AC-002 rewrite：rewriteMemory 全量替换该层文件", () => {
        saveMemory(ws, "old entry A", "project");
        saveMemory(ws, "old entry B", "project");
        rewriteMemory(ws, "## 2026-09-05\n\ndistilled only\n\n---", "project");
        const raw = fs.readFileSync(file, "utf-8");
        expect(raw).toContain("distilled only");
        expect(raw).not.toContain("old entry A");
        expect(raw).not.toContain("old entry B");
    });

    it("AC-002 rewrite 后仍可继续 append", () => {
        rewriteMemory(ws, "## base\n\nkept\n\n---", "project");
        saveMemory(ws, "appended after rewrite", "project");
        const raw = fs.readFileSync(file, "utf-8");
        expect(raw).toContain("kept");
        expect(raw).toContain("appended after rewrite");
    });

    it("AC-003 短记忆全量注入；超窗口从条目边界截取", () => {
        // 全量注入（未超窗口）
        rewriteMemory(ws, "## t1\n\nshort\n\n---", "project");
        expect(loadMemory(ws, 4000)).toContain("short");
        // 超窗口：窗口截到某条目开头，最早的条目被挤出
        const big = Array.from({ length: 30 }, (_, i) => `## t${i}\n\nentry-${i}-${"x".repeat(300)}\n\n---\n\n`).join("");
        rewriteMemory(ws, big, "project");
        const injected = loadMemory(ws, 1000);
        // 窗口近似：从最近的 "## " 条目边界回退，最多多含一条（~350 字符）
        expect(injected.length).toBeLessThanOrEqual(1500);
        expect(injected).toContain("entry-29"); // 最近的条目在
        expect(injected).not.toContain("entry-0"); // 最老的条目被截掉
    });
});
