import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspace } from "../src/workspace";
import { resolveSkills, renderSkillCatalog } from "../src/skill";
import { assembleSystemPrompt, systemFingerprint } from "../src/prompt";

/**
 * SPEC-041：system prompt 装配字节稳定性——provider prompt 缓存按前缀命中，
 * messages[0] 一个字节漂移即作废整个会话缓存（直接影响费率）。
 * 防线：装配纯函数（同输入字节必同）+ 目录扫描确定性 + 指纹可观测。
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-prompt-"));
afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

const ws = createWorkspace(tmp);

const parts = () => ({
    instruction: "You are anycode.",
    rootPath: tmp,
    memory: "\n# Previous context\nSome memory.\n",
    enabledTools: new Set(["update_memory", "web_search"]),
    shellKind: "sh" as const,
    skillCatalog: renderSkillCatalog(resolveSkills(ws).values()),
    rule: "",
});

describe("system prompt 装配稳定性（SPEC-041）", () => {
    it("同输入两次装配字节一致（纯函数纪律）", () => {
        expect(systemFingerprint(assembleSystemPrompt(parts()))).toBe(
            systemFingerprint(assembleSystemPrompt(parts()))
        );
    });

    it("输入未变时 fingerprint 不变；技能文件变化后 fingerprint 变化（语义必要 bust）", () => {
        const skillDir = path.join(tmp, ".anycode", "skills");
        fs.mkdirSync(skillDir, { recursive: true });
        const f = path.join(skillDir, "stab.md");
        fs.writeFileSync(f, "---\nname: stab\ndescription: a\n---\nbody1");
        const fp1 = systemFingerprint(assembleSystemPrompt(parts()));

        // 未变：再次扫描装配，指纹不变（目录重扫不引入字节漂移）
        const fp2 = systemFingerprint(assembleSystemPrompt(parts()));
        expect(fp2).toBe(fp1);

        // 技能 description 变化 → 指纹变化（缓存作废是语义必要，可经 sysFp 日志观测）
        fs.writeFileSync(f, "---\nname: stab\ndescription: b\n---\nbody1");
        const fp3 = systemFingerprint(assembleSystemPrompt(parts()));
        expect(fp3).not.toBe(fp1);
    });

    it("memory 变化改变装配结果（下一任务全前缀作废——语义必要成本，记账）", () => {
        const a = assembleSystemPrompt({ ...parts(), memory: "\n# Previous context\nv1\n" });
        const b = assembleSystemPrompt({ ...parts(), memory: "\n# Previous context\nv2\n" });
        expect(a).not.toBe(b);
    });
});
