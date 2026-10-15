import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DICTS } from "../index";

/**
 * i18n 覆盖防线（2026-09-16 bugfix）：t() 对缺 key 回退返回 key 原文，
 * 用户看到的是裸 key 字符串——编译器抓不到，只能静态扫描断言。
 * 扫描 web/{pages,components,hooks,lib} 源码中所有 t("...") 字面量，
 * 断言 zh/en 字典都存在。
 */

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "__tests__") continue;
            walk(p, out);
        } else if (/\.(tsx?|ts)$/.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

describe("i18n key 覆盖（缺 key 回退裸 key 字符串——静态断言防线）", () => {
    it("源码中所有 t(\"...\") 字面量在 zh/en 字典都存在", () => {
        const roots = ["pages", "components", "hooks", "lib"].map((d) =>
            path.resolve(__dirname, "../..", d)
        );
        const used = new Set<string>();
        for (const root of roots) {
            for (const file of walk(root)) {
                const src = fs.readFileSync(file, "utf-8");
                for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) {
                    used.add(m[1]);
                }
            }
        }
        expect(used.size).toBeGreaterThan(50); // 扫描没失灵的 sanity check
        const missingZh = [...used].filter((k) => !(k in DICTS.zh));
        const missingEn = [...used].filter((k) => !(k in DICTS.en));
        expect(missingZh, `zh 缺 key: ${missingZh.join(", ")}`).toEqual([]);
        expect(missingEn, `en 缺 key: ${missingEn.join(", ")}`).toEqual([]);
    });

    it("domain 事件 i18nKey 字面量在 zh/en 字典都存在（跨包协议防线）", () => {
        // domain 发英文 message + i18nKey（todo #13），web 按 key 渲染——domain 侧
        // 新增 key 而 web 漏配时，界面会显示裸 key 字符串。跨包扫描钉住。
        const domainSrc = path.resolve(__dirname, "../../../domain/src");
        const keys = new Set<string>();
        for (const file of walk(domainSrc)) {
            const src = fs.readFileSync(file, "utf-8");
            for (const m of src.matchAll(/i18nKey:\s*"([^"]+)"/g)) {
                keys.add(m[1]);
            }
            // Interaction 选项映射（optionI18nKeys: { Approve: "interaction.x", ... }）
            for (const block of src.matchAll(/optionI18nKeys:\s*\{([\s\S]*?)\}/g)) {
                for (const m of block[1].matchAll(/"([^"]+)"/g)) keys.add(m[1]);
            }
        }
        expect(keys.size).toBeGreaterThan(0); // 扫描没失灵的 sanity check
        const missingZh = [...keys].filter((k) => !(k in DICTS.zh));
        const missingEn = [...keys].filter((k) => !(k in DICTS.en));
        expect(missingZh, `zh 缺 domain key: ${missingZh.join(", ")}`).toEqual([]);
        expect(missingEn, `en 缺 domain key: ${missingEn.join(", ")}`).toEqual([]);
    });
});
