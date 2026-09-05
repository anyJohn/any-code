import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolConfig } from "../src/tools/functions/webHttp";
import type { ToolContext } from "../src/context";

// 方案 A（用户决策 2026-09-04）：工具私有配置每次调用现读 config.yaml——
// run 内改配置立即生效；坏配置回退 ctx 注入值（create 时快照）。

let home: string;
const ORIG_HOME = process.env.HOME;

const writeConfig = (yamlText: string) => {
    writeFileSync(join(home, ".anycode", "config.yaml"), yamlText, "utf-8");
};
const ctx = (toolsConfig?: Record<string, Record<string, unknown>>): ToolContext =>
    ({ workspace: {} as never, eventStream: { submit: () => {} }, signal: new AbortController().signal, toolsConfig }) as ToolContext;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "anycode-tc-"));
    process.env.HOME = home;
    mkdirSync(join(home, ".anycode"), { recursive: true });
    writeConfig(
        [
            "providers:",
            "  openai:",
            "    apiKey: sk-test",
            "    models: [{ id: m1 }]",
            "    defaultModel: m1",
            "default: openai",
        ].join("\n")
    );
});
afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
});

describe("toolConfig 现读（方案 A）", () => {
    it("config.yaml 有 tools 段 → 现读生效（优先于 ctx 快照）", () => {
        writeConfig(
            [
                "providers:",
                "  openai:",
                "    apiKey: sk-test",
                "    models: [{ id: m1 }]",
                "    defaultModel: m1",
                "default: openai",
                "tools:",
                "  web_search:",
                "    config: { provider: tavily, apiKey: tvly-1 }",
            ].join("\n")
        );
        const c = toolConfig(
            ctx({ web_search: { provider: "ddg" } }),
            "web_search"
        );
        expect(c).toEqual({ provider: "tavily", apiKey: "tvly-1" });
    });

    it("run 内改 config.yaml → 下一次调用立即读到新值", () => {
        const c1 = toolConfig(ctx(), "web_search");
        expect(c1).toEqual({});
        writeConfig(
            [
                "providers:",
                "  openai:",
                "    apiKey: sk-test",
                "    models: [{ id: m1 }]",
                "    defaultModel: m1",
                "default: openai",
                "tools:",
                "  web_search:",
                "    config: { provider: bing, apiKey: b1 }",
            ].join("\n")
        );
        const c2 = toolConfig(ctx(), "web_search");
        expect(c2).toEqual({ provider: "bing", apiKey: "b1" });
    });

    it("config.yaml 损坏 → 回退 ctx 快照（create 时值），不抛", () => {
        const fallbackCtx = ctx({ web_search: { provider: "ddg" } });
        writeConfig("providers: { broken: [");
        const c = toolConfig(fallbackCtx, "web_search");
        expect(c).toEqual({ provider: "ddg" });
    });

    it("config 无该工具条目 → 回退 ctx；都没有 → 空对象", () => {
        expect(toolConfig(ctx({ web_search: { provider: "ddg" } }), "web_search")).toEqual({ provider: "ddg" });
        expect(toolConfig(ctx(), "web_search")).toEqual({});
    });
});
