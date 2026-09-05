import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    getSkillUpdates,
    upgradeSkill,
    skipSkillUpdate,
    seedBuiltinSkills,
    cmpVersion,
} from "../src/seed";

// FR-25 ③ seed 升级策略：版本比对 → 待升级清单（变更说明）→ 升级覆盖 / 跳过记忆。

let root: string;
const ORIG_HOME = process.env.HOME;

const SKILL_MD = (version: string, changes = ""): string =>
    `---\nname: demo\ndescription: 测试技能\nversion: ${version}\n${
        changes ? `changes: |\n  ${changes.split("\n").join("\n  ")}\n` : ""
    }---\n\n# demo\n`;

const builtinDir = () => join(root, "builtin");
const skillsDir = () => join(root, "skills");

const writeBuiltin = (name: string, version: string, changes = "") => {
    mkdirSync(join(builtinDir(), name), { recursive: true });
    writeFileSync(join(builtinDir(), name, "SKILL.md"), SKILL_MD(version, changes));
};
const install = (name: string, version: string) => {
    mkdirSync(join(skillsDir(), name), { recursive: true });
    writeFileSync(join(skillsDir(), name, "SKILL.md"), SKILL_MD(version));
};

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "anycode-seed-"));
    process.env.HOME = root; // globalConfigDir() → root/.anycode（与默认 skillsDir 无关，显式传参）
    mkdirSync(join(root, ".anycode"), { recursive: true });
});
afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
});

describe("cmpVersion", () => {
    it("逐段数值比较", () => {
        expect(cmpVersion("1.1.0", "1.0.0")).toBe(1);
        expect(cmpVersion("1.0.0", "1.1.0")).toBe(-1);
        expect(cmpVersion("1.0.0", "1.0.0")).toBe(0);
        expect(cmpVersion("1.10.0", "1.9.0")).toBe(1);
    });
});

describe("getSkillUpdates", () => {
    it("内置版本更新 → 待升级（含变更说明）", () => {
        writeBuiltin("demo", "1.1.0", "新增导出功能");
        install("demo", "1.0.0");
        expect(getSkillUpdates(builtinDir(), skillsDir())).toEqual([
            { name: "demo", installedVersion: "1.0.0", builtinVersion: "1.1.0", changes: "新增导出功能" },
        ]);
    });

    it("版本相同 → 无更新；未安装 → 不算更新（seed 负责）；内置无版本号 → 不参与", () => {
        writeBuiltin("demo", "1.0.0");
        install("demo", "1.0.0");
        writeBuiltin("newer", "1.0.0"); // 未安装
        mkdirSync(join(builtinDir(), "noversion")); // 无 SKILL.md → 不算内置技能
        expect(getSkillUpdates(builtinDir(), skillsDir())).toEqual([]);
    });

    it("跳过同版本不再提醒；内置再更新（更高版本）→ 重新提醒", () => {
        writeBuiltin("demo", "1.1.0", "v1.1 变更");
        install("demo", "1.0.0");
        skipSkillUpdate("demo", "1.1.0", skillsDir());
        expect(getSkillUpdates(builtinDir(), skillsDir())).toEqual([]);
        writeBuiltin("demo", "1.2.0", "v1.2 变更");
        expect(getSkillUpdates(builtinDir(), skillsDir())[0].builtinVersion).toBe("1.2.0");
    });
});

describe("upgradeSkill", () => {
    it("覆盖已装副本到内置版本，并清除跳过记录", () => {
        writeBuiltin("demo", "1.1.0", "新功能");
        install("demo", "1.0.0");
        skipSkillUpdate("demo", "1.1.0", skillsDir());
        const r = upgradeSkill("demo", builtinDir(), skillsDir());
        expect(r.ok).toBe(true);
        expect(readFileSync(join(skillsDir(), "demo", "SKILL.md"), "utf-8")).toContain("1.1.0");
        expect(getSkillUpdates(builtinDir(), skillsDir())).toEqual([]);
    });

    it("非法名 / 不存在的内置技能 → 拒绝", () => {
        expect(upgradeSkill("../evil", builtinDir(), skillsDir()).ok).toBe(false);
        expect(upgradeSkill("nope", builtinDir(), skillsDir()).ok).toBe(false);
        expect(existsSync(join(skillsDir(), "nope"))).toBe(false);
    });
});

describe("seedBuiltinSkills 与升级策略协同", () => {
    it("新技能 seed 后无更新；内置升版 + 已装旧版 → 报更新且不自动覆盖", () => {
        writeBuiltin("fresh", "1.0.0");
        expect(seedBuiltinSkills(builtinDir(), skillsDir())).toContain("fresh");
        expect(getSkillUpdates(builtinDir(), skillsDir())).toEqual([]);
        writeBuiltin("fresh", "1.1.0", "升版");
        const updates = getSkillUpdates(builtinDir(), skillsDir());
        expect(updates).toHaveLength(1);
        expect(existsSync(join(skillsDir(), "fresh", "SKILL.md"))).toBe(true);
        expect(readFileSync(join(skillsDir(), "fresh", "SKILL.md"), "utf-8")).toContain("1.0.0");
    });
});
