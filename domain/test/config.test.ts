import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Config } from "../src/config";

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

    it("AC-003 contextWindow：per-provider 可配，缺省 128000", () => {
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
        expect(cfg.providers.p1.contextWindow).toBe(128000);
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

    it("AC-007 无 models / defaultModel 不在 models → 抛错", () => {
        writeConfig(`
providers:
  p:
    apiKey: sk
    models: [{ id: m1 }]
    defaultModel: nope
default: p
`);
        expect(() => Config.load()).toThrow(/defaultModel.*未在 models 中/);
        writeConfig(`
providers:
  p:
    apiKey: sk
    models: []
    defaultModel: ""
default: p
`);
        expect(() => Config.load()).toThrow(/未定义 models/);
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
