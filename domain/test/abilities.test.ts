import { describe, it, expect } from "vitest";
import { registerAbility, getRegisteredAbilities, isAbilityEnabled, getAbility } from "../src/abilities";
import type { Config } from "../src/config";
// import builtin.ts 触发三能力注册（SPEC-031 B-008~B-010）
import "../src/builtin";

// SPEC-031 AC-001 / AC-002 / AC-003 / B-001 / B-002 / C-001
describe("abilities 注册器（SPEC-031）", () => {
    it("builtin 注册三能力：web-fetch/web-search 为 mcp、browser-use 为 skill", () => {
        const names = getRegisteredAbilities().map((a) => a.name);
        expect(names).toContain("web-fetch");
        expect(names).toContain("web-search");
        expect(names).toContain("browser-use");

        const fetchA = getAbility("web-fetch");
        expect(fetchA?.kind).toBe("mcp");
        const srv = (fetchA as { server?: { type?: string; command?: string } })
            ?.server;
        expect(srv?.type).toBe("stdio");
        expect(srv?.command).toBe(process.execPath);

        const browse = getAbility("browser-use");
        expect(browse?.kind).toBe("skill");
        expect((browse as { content?: string })?.content?.length).toBeGreaterThan(
            200
        );
        expect(fetchA?.description).toBeTruthy();
    });

    it("AC-001：同层重名注册 → fail-fast throw（能力名唯一）", () => {
        expect(() =>
            registerAbility({
                name: "web-search",
                kind: "mcp",
                description: "重复",
                server: { type: "stdio", command: "x", args: ["y"] },
            })
        ).toThrow(/已注册/);
    });
});

describe("isAbilityEnabled（B-002 / C-004）", () => {
    const cfg = (abilities: Config["abilities"]) =>
        ({ abilities } as unknown as Config);

    it("未配置 = 不启用（AC-002：config 无 abilities → 全关）", () => {
        expect(isAbilityEnabled(cfg({}), "web-search")).toBe(false);
        expect(isAbilityEnabled(cfg(undefined as never), "web-search")).toBe(
            false
        );
    });

    it("显式 enabled:true → 启用；enabled:false → 不启用（AC-011 语义）", () => {
        expect(
            isAbilityEnabled(cfg({ "web-search": { enabled: true } }), "web-search")
        ).toBe(true);
        expect(
            isAbilityEnabled(
                cfg({ "web-search": { enabled: false } }),
                "web-search"
            )
        ).toBe(false);
    });
});