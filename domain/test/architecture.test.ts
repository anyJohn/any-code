import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * AR-19 分层依赖守卫：domain 内部分层（provider 适配层 / 运行时层 / 基础设施层 /
 * 应用装配层）的依赖方向约束。分层先以模块边界约束，不拆独立发布包。
 *
 * 层定义（依赖只能向下）：
 * - L0 类型与事件：type.ts / context.ts
 * - L1 provider 与策略：llm.ts / providers/** / config.ts / permissions.ts / compact.ts
 * - L2 基础设施：mcp.ts / snapshot.ts / jobs.ts / extensions.ts / workspace.ts /
 *   session/** / skill.ts / rule.ts / memory.ts / ripgrep.ts / prompt.ts / eventStream.ts
 * - L3 运行时：core.ts / tools/**
 * - L4 应用装配：main.ts / agent.ts / builtin.ts / seed.ts / cliExample.ts
 *
 * 禁止方向（高层 import 低层是正常方向，这里守的是反向）：
 * - L1 不得 import L3/L4（provider 层不感知运行时与应用装配）
 * - L2 不得 import L3/L4
 * - L3 不得 import L4（运行时不感知应用装配）
 */
const ROOT = path.join(__dirname, "..", "src");

const L1 = ["llm.ts", "config.ts", "permissions.ts", "compact.ts"];
const L2 = [
    "mcp.ts",
    "snapshot.ts",
    "jobs.ts",
    "extensions.ts",
    "workspace.ts",
    "skill.ts",
    "rule.ts",
    "memory.ts",
    "ripgrep.ts",
    "prompt.ts",
    "eventStream.ts",
];
const FORBIDDEN_APP = ["main", "agent", "core", "builtin", "seed", "cliExample"];

function* tsFiles(dir: string): Generator<string> {
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
            if (f === "builtin" || f === "__tests__") continue; // builtin 数据目录 / 无源码
            yield* tsFiles(p);
        } else if (f.endsWith(".ts")) {
            yield p;
        }
    }
}

function relImportTargets(file: string): string[] {
    // 先剔除 type-only import（擦除性导入，零运行时依赖，不计入分层约束）
    const src = fs
        .readFileSync(file, "utf-8")
        .replace(/^import\s+type\s[^;]*;/gm, "");
    const out: string[] = [];
    for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const spec = m[1];
        // 相对 import 解析到 src 内的目标文件（补 .ts）
        let target = path.resolve(path.dirname(file), spec);
        for (const cand of [target, `${target}.ts`, path.join(target, "index.ts")]) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
                target = cand;
                break;
            }
        }
        out.push(path.relative(ROOT, target).replace(/\\/g, "/"));
    }
    return out;
}

function isAppLayer(rel: string): boolean {
    return FORBIDDEN_APP.some((m) => rel === `${m}.ts` || rel.startsWith(`${m}/`));
}

describe("AR-19 分层依赖方向（domain 内部）", () => {
    it("L1 provider/策略层不得 import 运行时与应用装配（L3/L4）", () => {
        const files = [
            ...L1.map((f) => path.join(ROOT, f)),
            ...[...tsFiles(path.join(ROOT, "providers"))],
        ];
        const violations: string[] = [];
        for (const f of files) {
            for (const target of relImportTargets(f)) {
                if (isAppLayer(target) || target.startsWith("tools/")) {
                    violations.push(`${path.relative(ROOT, f)} → ${target}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it("L2 基础设施层不得 import 运行时与应用装配（L3/L4）", () => {
        const files = [...L2.map((f) => path.join(ROOT, f))];
        const violations: string[] = [];
        for (const f of files) {
            for (const target of relImportTargets(f)) {
                if (isAppLayer(target) || target.startsWith("tools/")) {
                    violations.push(`${path.relative(ROOT, f)} → ${target}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it("L3 运行时层不得 import 应用装配（L4）", () => {
        const files = [
            path.join(ROOT, "core.ts"),
            ...[...tsFiles(path.join(ROOT, "tools"))],
        ];
        const violations: string[] = [];
        for (const f of files) {
            for (const target of relImportTargets(f)) {
                if (isAppLayer(target)) {
                    violations.push(`${path.relative(ROOT, f)} → ${target}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });
});
