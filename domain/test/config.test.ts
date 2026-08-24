import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    Config,
    resolveContextWindow,
    resolveMaxOutputTokens,
} from "../src/config";
import type { LlmProvider } from "../src/config";

// Config 读全局 ~/.anycode/config.yaml；测试用临时 HOME 隔离
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-cfg-home-"));
const cfgFile = () => path.join(tmpHome, ".anycode", "config.yaml");

const writeConfig = (content: string) => {
    fs.mkdirSync(path.join(tmpHome, ".anycode"), { recursive: true });
    fs.writeFileSync(cfgFile(), content);
};

beforeEach(() => {
    process.env.HOME = tmpHome;
    fs.rmSync(path.join(tmpHome, ".anycode"), { recursive: true, force: true });
});

afterAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("resolveContextWindow（SPEC-019 AC-001）", () => {
    const P = (over: Partial<LlmProvider> = {}): LlmProvider => ({
        apiKey: "k",
        models: [{ id: "m" }],
        defaultModel: "m",
        streaming: true,
        ...over,
    });
    it("detected + user 取 min（用户更小则用用户）", () => {
        expect(resolveContextWindow(P({ contextWindow: 50000 }), 200000)).toBe(50000);
    });
    it("detected + user，detected 更小则用 detected", () => {
        expect(resolveContextWindow(P({ contextWindow: 200000 }), 50000)).toBe(50000);
    });
    it("仅 detected（无 user）→ detected", () => {
        expect(resolveContextWindow(P(), 200000)).toBe(200000);
    });
    it("仅 user（无 detected）→ user", () => {
        expect(resolveContextWindow(P({ contextWindow: 50000 }))).toBe(50000);
    });
    it("全无 → 128000", () => {
        expect(resolveContextWindow(P())).toBe(128000);
    });
    it("模型表值参与 min（gpt-4o=128000 截 detected 200000）", () => {
        expect(resolveContextWindow(P({ defaultModel: "gpt-4o" }), 200000)).toBe(128000);
    });
    it("用户配更小（gpt-4o user 50000 → 50000）", () => {
        expect(
            resolveContextWindow(
                P({ defaultModel: "gpt-4o", contextWindow: 50000 }),
                200000
            )
        ).toBe(50000);
    });
});

describe("resolveMaxOutputTokens（SPEC-023）", () => {
    const P = (over: Partial<LlmProvider> = {}): LlmProvider => ({
        apiKey: "k",
        models: [{ id: "m" }],
        defaultModel: "m",
        streaming: true,
        ...over,
    });
    it("detected + user 取 min", () => {
        expect(resolveMaxOutputTokens(P({ maxOutputTokens: 4096 }), 16384)).toBe(4096);
    });
    it("仅 detected → detected", () => {
        expect(resolveMaxOutputTokens(P(), 16384)).toBe(16384);
    });
    it("仅 user → user", () => {
        expect(resolveMaxOutputTokens(P({ maxOutputTokens: 4096 }))).toBe(4096);
    });
    it("模型表值参与 min（gpt-4o=16384 截 detected 32768）", () => {
        expect(resolveMaxOutputTokens(P({ defaultModel: "gpt-4o" }), 32768)).toBe(16384);
    });
    it("全无 → undefined（不传 max_tokens）", () => {
        expect(resolveMaxOutputTokens(P())).toBeUndefined();
    });
    it("用户配更小（gpt-4o user 4096 → 4096）", () => {
        expect(
            resolveMaxOutputTokens(
                P({ defaultModel: "gpt-4o", maxOutputTokens: 4096 }),
                32768
            )
        ).toBe(4096);
    });
});

describe("Config（SPEC-014，多模型 models+defaultModel）", () => {
    it("AC-001 config.yaml 加载：providers + models + defaultModel", () => {
        writeConfig(`
providers:
  openai:
    apiKey: sk-o
    models:
      - id: gpt-4o
        name: GPT-4o
      - id: gpt-4o-mini
    defaultModel: gpt-4o
  deepseek:
    apiKey: sk-d
    models:
      - id: deepseek-chat
    defaultModel: deepseek-chat
default: openai
`);
        const cfg = Config.load();
        expect(Object.keys(cfg.providers)).toHaveLength(2);
        expect(cfg.default).toBe("openai");
        expect(cfg.getCurrentProvider().defaultModel).toBe("gpt-4o");
        expect(cfg.providers.openai.models).toHaveLength(2);
        expect(cfg.providers.openai.models[0]).toMatchObject({ id: "gpt-4o", name: "GPT-4o" });
    });

    it("AC-002 provider 字段；streaming 缺省 true", () => {
        writeConfig(`
providers:
  p1:
    apiKey: sk
    baseURL: http://x
    models: [{ id: m1 }]
    defaultModel: m1
  p2:
    apiKey: sk2
    models: [{ id: m2 }]
    defaultModel: m2
    streaming: false
default: p2
`);
        const cfg = Config.load();
        expect(cfg.providers.p1.streaming).toBe(true);
        expect(cfg.providers.p1.baseURL).toBe("http://x");
        expect(cfg.providers.p2.streaming).toBe(false);
    });

    it("AC-001b config mcp 段解析 → mcpServers", () => {
        writeConfig(`
providers:
  p:
    apiKey: sk
    models: [{ id: m }]
    defaultModel: m
default: p
mcp:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "fs-server", "/tmp"]
  remote:
    type: sse
    url: https://x/sse
`);
        const cfg = Config.load();
        expect(Object.keys(cfg.mcpServers)).toHaveLength(2);
        expect(cfg.mcpServers.filesystem).toMatchObject({
            type: "stdio",
            command: "npx",
            args: ["-y", "fs-server", "/tmp"],
        });
        writeConfig(`providers:\n  p:\n    apiKey: sk\n    models: [{ id: m }]\n    defaultModel: m\ndefault: p\n`);
        expect(Object.keys(Config.load().mcpServers)).toHaveLength(0);
    });

    it("AC-003 contextWindow optional：未配 → undefined（resolved 由探测/表/128000 兜底）", () => {
        writeConfig(`
providers:
  p1:
    apiKey: sk
    models: [{ id: m }]
    defaultModel: m
  p2:
    apiKey: sk2
    models: [{ id: m2 }]
    defaultModel: m2
    contextWindow: 200000
default: p1
`);
        const cfg = Config.load();
        expect(cfg.providers.p1.contextWindow).toBeUndefined();
        expect(cfg.providers.p2.contextWindow).toBe(200000);
    });

    it("AC-005 无 config.yaml → 自动创建默认配置 + 加载成功", () => {
        const cfg = Config.load();
        expect(cfg.default).toBe("default");
        expect(cfg.providers.default.apiKey).toBe("");
        expect(cfg.providers.default.defaultModel).toBe("gpt-4o");
        expect(cfg.providers.default.models[0]).toMatchObject({ id: "gpt-4o", name: "GPT-4o" });
        expect(fs.existsSync(cfgFile())).toBe(true);
    });

    it("AC-007 lenient: defaultModel 不在 models → 自动用首个 model；无 models 不抛错", () => {
        writeConfig(`
providers:
  p:
    apiKey: sk
    models: [{ id: m1 }]
    defaultModel: nope
default: p
`);
        const cfg = Config.load();
        expect(cfg.providers.p.defaultModel).toBe("m1"); // 自动修正为首个 model
        writeConfig(`
providers:
  p:
    apiKey: sk
    models: []
    defaultModel: ""
default: p
`);
        const cfg2 = Config.load(); // 不抛错
        expect(cfg2.providers.p.models).toHaveLength(0);
    });

    it("Config.save 完整校验：一次返回所有错误", () => {
        // default 不在 providers + provider 无 models → 两条错误一次抛
        expect(() =>
            Config.save({
                providers: { p: { apiKey: "sk", models: [], defaultModel: "" } },
                default: "nope",
            })
        ).toThrow(/default="nope" 未在 providers 中定义[\s\S]*provider "p" 的 models 不能为空/);
        // 无 providers
        expect(() => Config.save({ providers: {} })).toThrow(/providers 不能为空/);
    });

    it("AC-004/007 reload() 重读文件，default/provider 切换生效", () => {
        writeConfig(`
providers:
  openai:
    apiKey: sk-o
    models: [{ id: gpt-4o }]
    defaultModel: gpt-4o
default: openai
`);
        const cfg = Config.load();
        expect(cfg.getCurrentProvider().defaultModel).toBe("gpt-4o");
        writeConfig(`
providers:
  openai:
    apiKey: sk-o
    models: [{ id: gpt-4o }, { id: gpt-4o-mini }]
    defaultModel: gpt-4o-mini
  deepseek:
    apiKey: sk-d
    models: [{ id: deepseek-chat }]
    defaultModel: deepseek-chat
default: deepseek
`);
        cfg.reload();
        expect(cfg.default).toBe("deepseek");
        expect(cfg.getCurrentProvider().defaultModel).toBe("deepseek-chat");
    });
});
