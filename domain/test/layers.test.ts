import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveSkills } from "../src/skill";
import { loadRule } from "../src/rule";
import { loadProjectMcp } from "../src/mcp";
import { createWorkspace } from "../src/workspace";
// 注册内置连接器（技能是纯文件：项目/全局/.agents 三层，无内置技能层）
import "../src/builtin";

// 三层技能合并：全局层用临时 HOME（~/.anycode + ~/.agents），项目层用临时 workspace（.anycode）。
// 旧两层全量注入（SPEC-013）已 superseded（SPEC-031 场景 B），测试按新语义更新。
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-layers-home-"));
const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-layers-proj-"));
const ws = createWorkspace(tmpProject);

const globalSub = (sub: string) => path.join(tmpHome, ".anycode", sub);
const projectSub = (sub: string) => path.join(tmpProject, ".anycode", sub);
const agentsSkillsDir = path.join(tmpHome, ".agents", "skills");
const writeFile = (dir: string, file: string, content: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
};

beforeEach(() => {
    process.env.HOME = tmpHome;
    fs.rmSync(path.join(tmpHome, ".anycode"), { recursive: true, force: true });
    fs.rmSync(path.join(tmpHome, ".agents"), { recursive: true, force: true });
    fs.rmSync(path.join(tmpProject, ".anycode"), { recursive: true, force: true });
});

afterAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProject, { recursive: true, force: true });
});

describe("三层技能合并（SPEC-031 B-003）", () => {
    it("AC-001 并集 + 同名项目覆盖全局 + .agents 参与", () => {
        writeFile(globalSub("skills"), "a.md", "GLOBAL-A");
        writeFile(globalSub("skills"), "b.md", "GLOBAL-B");
        writeFile(projectSub("skills"), "a.md", "PROJ-A");
        writeFile(projectSub("skills"), "c.md", "PROJ-C");
        writeFile(agentsSkillsDir, "d.md", "AGENTS-D");
        const map = resolveSkills(ws);
        expect(map.get("a")?.content).toBe("PROJ-A"); // 项目覆盖全局同名
        expect(map.get("b")?.content).toBe("GLOBAL-B");
        expect(map.get("c")?.content).toBe("PROJ-C");
        expect(map.get("d")?.content).toBe("AGENTS-D");
        expect(map.get("d")?.origin).toBe("agents");
    });

    it("目录制技能跨层同样受优先级约束（项目目录制覆盖全局平铺同名）", () => {
        writeFile(globalSub("skills"), "dup.md", "GLOBAL-DUP");
        writeFile(path.join(projectSub("skills"), "dup"), "SKILL.md", "PROJ-DUP-DIR");
        const map = resolveSkills(ws);
        expect(map.get("dup")?.content).toBe("PROJ-DUP-DIR");
        expect(map.get("dup")?.origin).toBe("project");
    });

    it("AC-004 项目同名覆盖 .agents（.agents 最低用户层）", () => {
        writeFile(agentsSkillsDir, "x.md", "AGENTS-X");
        writeFile(projectSub("skills"), "x.md", "PROJ-X");
        const map = resolveSkills(ws);
        expect(map.get("x")?.content).toBe("PROJ-X");
    });

    it("AC-004b 无全局/项目层 → 仅 .agents", () => {
        writeFile(agentsSkillsDir, "only.md", "AGENTS-ONLY");
        const map = resolveSkills(ws);
        expect(map.get("only")?.content).toBe("AGENTS-ONLY");
    });
});

describe("rules（AGENTS.md，SPEC-031 B-006）与 MCP（SPEC-013 保留）", () => {
    it("AC-007 AGENTS.md 三层 additive + 同目录 override 优先；rules/ 永不再读", () => {
        writeFile(path.join(tmpHome, ".anycode"), "AGENTS.md", "GLOBAL-RULES");
        writeFile(
            path.join(tmpHome, ".anycode"),
            "AGENTS.override.md",
            "GLOBAL-OVERRIDE"
        );
        writeFile(path.join(tmpHome, ".agents"), "AGENTS.md", "AGENTS-RULES");
        writeFile(tmpProject, "AGENTS.md", "PROJ-RULES");
        // 旧 rules/ 目录（superseded 机制）不应再被读取（SPEC-031 I-003）
        writeFile(globalSub("rules"), "old.md", "OLD-RULES");
        const out = loadRule(ws);
        expect(out).toContain("GLOBAL-OVERRIDE"); // 同目录 override 顶掉 AGENTS.md
        expect(out).not.toContain("GLOBAL-RULES");
        expect(out).toContain("AGENTS-RULES"); // .agents 层参与 additive
        expect(out).toContain("PROJ-RULES"); // 项目层参与 additive
        expect(out).not.toContain("OLD-RULES"); // rules/ 退役
    });

    it("AGENTS.override.md 单独存在（无 AGENTS.md）也生效", () => {
        writeFile(path.join(tmpHome, ".anycode"), "AGENTS.override.md", "ONLY-OVERRIDE");
        const out = loadRule(ws);
        expect(out).toContain("ONLY-OVERRIDE");
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
});