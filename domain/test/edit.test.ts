import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { editFunc } from "../src/tools/functions/edit";
import type { ToolContext } from "../src/context";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-edit-"));

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const P = (fileState?: Map<string, number>): ToolContext => ({
    workspace: { rootPath: tmp } as never,
    eventStream: { submit: () => {} },
    signal: new AbortController().signal,
    fileState: fileState ?? new Map(),
});

// EDIT staleness：对齐 write.ts 的 SPEC-022 AC-004 模式（mtime 漂移 → 警告不阻断）
describe("editFunc（staleness）", () => {
    it("正常替换成功：Removed/Added 齐全", async () => {
        const f = path.join(tmp, "a.txt");
        fs.writeFileSync(f, "hello world");
        const out = await editFunc(
            { filePath: "a.txt", oldString: "world", newString: "anycode" },
            P()
        );
        expect(out).toMatch(/Successfully edited file/);
        expect(fs.readFileSync(f).toString()).toBe("hello anycode");
    });

    it("oldString 不存在 → Error，不落盘", async () => {
        const f = path.join(tmp, "b.txt");
        fs.writeFileSync(f, "original");
        const out = await editFunc(
            { filePath: "b.txt", oldString: "nope", newString: "x" },
            P()
        );
        expect(out).toMatch(/not found/);
        expect(fs.readFileSync(f).toString()).toBe("original");
    });

    it("oldString 多次出现 → Error 要求唯一，不落盘", async () => {
        const f = path.join(tmp, "c.txt");
        fs.writeFileSync(f, "dup dup");
        const out = await editFunc(
            { filePath: "c.txt", oldString: "dup", newString: "x" },
            P()
        );
        expect(out).toMatch(/appears 2 times/);
        expect(fs.readFileSync(f).toString()).toBe("dup dup");
    });

    it("staleness：read 记 mtime 后外部改 mtime → 警告（仍编辑）", async () => {
        const f = path.join(tmp, "d.txt");
        fs.writeFileSync(f, "hello world");
        const fileState = new Map<string, number>();
        fileState.set(f, fs.statSync(f).mtimeMs); // 模拟 read 记录
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(f, future, future); // 模拟外部改动 mtime
        const out = await editFunc(
            { filePath: "d.txt", oldString: "world", newString: "anycode" },
            P(fileState)
        );
        expect(out).toMatch(/外部改动/);
        expect(fs.readFileSync(f).toString()).toBe("hello anycode"); // 仍编辑
    });

    it("无 read 记录 → 无 staleness 警告", async () => {
        const f = path.join(tmp, "e.txt");
        fs.writeFileSync(f, "hello world");
        const out = await editFunc(
            { filePath: "e.txt", oldString: "world", newString: "x" },
            P()
        );
        expect(out).not.toMatch(/外部改动/);
    });

    it("编辑后记录新 mtime → 二次编辑无警告（mtime 已对齐）", async () => {
        const f = path.join(tmp, "f.txt");
        fs.writeFileSync(f, "hello world");
        const fileState = new Map<string, number>();
        fileState.set(f, fs.statSync(f).mtimeMs);
        await editFunc(
            { filePath: "f.txt", oldString: "world", newString: "anycode" },
            P(fileState)
        );
        // 编辑后 fileState 已更新为写后 mtime
        expect(fileState.get(f)).toBeCloseTo(fs.statSync(f).mtimeMs, 0);
        const out2 = await editFunc(
            { filePath: "f.txt", oldString: "hello", newString: "hi" },
            P(fileState)
        );
        expect(out2).not.toMatch(/外部改动/); // mtime 对齐 → 无警告
    });
});