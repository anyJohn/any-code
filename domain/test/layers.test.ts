import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadSkills } from "../src/skill";
import { loadRule } from "../src/rule";
import { loadProjectMcp } from "../src/mcp";
import { createWorkspace } from "../src/workspace";

// 两层合并：全局层用临时 HOME（~/.anycode），项目层用临时 workspace（.anycode）
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-layers-home-"));
const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-layers-proj-"));
const ws = createWorkspace(tmpProject);

const globalSub = (sub: string) => path.join(tmpHome, ".anycode", sub);
const projectSub = (sub: string) => path.join(tmpProject, ".anycode", sub);
const writeFile = (dir: string, file: string, content: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
};

beforeEach(() => {
    process.env.HOME = tmpHome;
    fs.rmSync(path.join(tmpHome, ".anycode"), { recursive: true, force: true });
    fs.rmSync(path.join(tmpProject, ".anycode"), { recursive: true, force: true });
});

afterAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProject, { recursive: true, force: true });
});

describe("两层合并（SPEC-013）", () => {
    it("AC-001 skills 全局+项目合并，同名项目覆盖全局", () => {
        writeFile(globalSub("skills"), "a.md", "GLOBAL-A");
        writeFile(globalSub("skills"), "b.md", "GLOBAL-B");
        writeFile(projectSub("skills"), "a.md", "PROJ-A");
        writeFile(projectSub("skills"), "c.md", "PROJ-C");
        const out = loadSkills(ws);
        expect(out).toContain("PROJ-A");
        expect(out).not.toContain("GLOBAL-A"); // 同名 a 被项目覆盖
        expect(out).toContain("GLOBAL-B");
        expect(out).toContain("PROJ-C");
    });

    it("AC-002 rules 全局+项目合并，同名项目覆盖", () => {
        writeFile(globalSub("rules"), "r1.md", "GLOBAL-R1");
        writeFile(projectSub("rules"), "r1.md", "PROJ-R1");
        const out = loadRule(ws);
        expect(out).toContain("PROJ-R1");
        expect(out).not.toContain("GLOBAL-R1");
    });

    it("AC-003 loadProjectMcp 读项目 mcp.yaml（flat servers）", () => {
        writeFile(
            projectSub(""),
            "mcp.yaml",
            "fs:\n  type: stdio\n  command: npx\nremote:\n  type: sse\n  url: https://x/sse\n"
        );
        const mcp = loadProjectMcp(ws);
        expect(Object.keys(mcp)).toHaveLength(2);
        expect(mcp.fs).toMatchObject({ type: "stdio", command: "npx" });
        expect(mcp.remote).toMatchObject({ type: "sse", url: "https://x/sse" });
    });

    it("AC-003b loadProjectMcp 无文件 → 空", () => {
        expect(Object.keys(loadProjectMcp(ws))).toHaveLength(0);
    });

    it("AC-004 无全局层 → 仅项目（向后兼容）", () => {
        writeFile(projectSub("skills"), "only.md", "PROJ-ONLY");
        const out = loadSkills(ws);
        expect(out).toContain("PROJ-ONLY");
    });

    it("AC-004b 无项目层 → 仅全局", () => {
        writeFile(globalSub("skills"), "g.md", "GLOBAL-ONLY");
        const out = loadSkills(ws);
        expect(out).toContain("GLOBAL-ONLY");
    });
});
