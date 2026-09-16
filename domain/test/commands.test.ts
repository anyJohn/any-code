import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspace } from "../src/workspace";
import { resolveSkills } from "../src/skill";
import {
    expandTask,
    parseSlashCommand,
    resolveSlashCommand,
} from "../src/commands";

/** SPEC-040 B-003/AC-002/AC-006：斜杠命令在 domain submit 边界展开。 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-cmds-"));
afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

const ws = createWorkspace(tmp);

describe("parseSlashCommand", () => {
    it("解析首行 /name args", () => {
        expect(parseSlashCommand("/review foo bar")).toEqual({
            name: "review",
            args: "foo bar",
        });
        expect(parseSlashCommand("/plan")).toEqual({ name: "plan", args: "" });
        // 多行文本只看首行
        expect(parseSlashCommand("/cmd x\nbody line")).toEqual({
            name: "cmd",
            args: "x",
        });
        // 非命令
        expect(parseSlashCommand("普通消息 /not")).toBeNull();
        expect(parseSlashCommand("path/like")).toBeNull();
    });
});

describe("resolveSlashCommand / expandTask", () => {
    // 项目技能：<ws>/.anycode/skills/cmd-test.md
    fs.mkdirSync(path.join(tmp, ".anycode", "skills"), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, ".anycode", "skills", "cmd-test.md"),
        "---\nname: cmd-test\ndescription: test skill\n---\nSKILL BODY"
    );
    // custom command：<ws>/.anycode/commands/cmd-custom.md
    fs.mkdirSync(path.join(tmp, ".anycode", "commands"), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, ".anycode", "commands", "cmd-custom.md"),
        "CUSTOM BODY"
    );
    const skills = resolveSkills(ws);

    it("skill 命中：展开 + command 标记", () => {
        const r = expandTask("/cmd-test 写个测试", ws, skills);
        expect(r.display).toBe("/cmd-test 写个测试");
        // 与旧 web 展开等价：content 为技能原文（含 frontmatter，web 旧路径也是原文）
        expect(r.content).toBe(
            "/cmd-test 写个测试\n\n---\nname: cmd-test\ndescription: test skill\n---\nSKILL BODY"
        );
        expect(r.command).toEqual({
            name: "cmd-test",
            args: "写个测试",
            body: "---\nname: cmd-test\ndescription: test skill\n---\nSKILL BODY",
        });
    });

    it("custom command 次之", () => {
        const r = expandTask("/cmd-custom", ws, skills);
        expect(r.command?.kind ?? "custom").toBe("custom");
        expect(r.content).toBe("/cmd-custom\n\nCUSTOM BODY");
    });

    it("未匹配 → 原样当普通消息", () => {
        const r = expandTask("/no-such-cmd x", ws, skills);
        expect(r.command).toBeUndefined();
        expect(r.content).toBe("/no-such-cmd x");
        expect(resolveSlashCommand("/no-such-cmd x", ws, skills)).toBeNull();
    });

    it("普通消息不受影响", () => {
        const r = expandTask("普通 /slash 混在中间", ws, skills);
        expect(r.command).toBeUndefined();
        expect(r.content).toBe("普通 /slash 混在中间");
    });

    it("display 与输入逐字符一致（去重契约）：trim 责任在 server 入口，两侧同 trim", () => {
        // server /run 与 /queue 都对输入 trim（sessions.ts:45 / queue 路由），
        // User 事件 message = expandTask(trimmed).display —— web 乐观插入同用 trim 后文本，
        // 去重（同文跳过）才成立。expandTask 自身不得悄悄 trim。
        const raw = "/cmd-test 尾随空格   ";
        const r = expandTask(raw, ws, skills);
        expect(r.display).toBe(raw);
    });

    it("多行用户输入不丢内容", () => {
        const r = expandTask("/cmd-test\n第二行", ws, skills);
        expect(r.display).toBe("/cmd-test\n第二行");
        expect(r.content).toContain("第二行");
        expect(r.content).toContain("SKILL BODY");
    });
});
