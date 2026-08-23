import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Config } from "../src/config";

// Config 读全局 ~/.anycode/config.yaml；测试用临时 HOME 隔离，避免污染真实 home
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

describe("Config（SPEC-008，全局 ~/.anycode/config.yaml）", () => {
    it("AC-001 config.yaml 加载：providers map + default", () => {
        writeConfig(`
providers:
  openai:
    apiKey: sk-o
    model: gpt-4o
  deepseek:
    apiKey: sk-d
    model: deepseek-chat
default: openai
`);
        const cfg = Config.load();
        expect(Object.keys(cfg.providers)).toHaveLength(2);
        expect(cfg.default).toBe("openai");
        expect(cfg.getCurrentProvider().apiKey).toBe("sk-o");
    });

    it("AC-002 provider 字段就位；streaming 缺省 true", () => {
        writeConfig(`
providers:
  p1:
    apiKey: sk
    baseURL: http://x
    model: m
  p2:
    apiKey: sk2
    model: m2
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
    model: m
default: p
mcp:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "fs-server", "/tmp"]
  remote:
    type: sse
    url: https://x/sse
    headers: { Authorization: "Bearer t" }
`);
        const cfg = Config.load();
        expect(Object.keys(cfg.mcpServers)).toHaveLength(2);
        expect(cfg.mcpServers.filesystem).toMatchObject({
            type: "stdio",
            command: "npx",
            args: ["-y", "fs-server", "/tmp"],
        });
        expect(cfg.mcpServers.remote).toMatchObject({
            type: "sse",
            url: "https://x/sse",
        });
        // 无 mcp 段时 mcpServers 为空
        writeConfig(`providers:\n  p:\n    apiKey: sk\n    model: m\ndefault: p\n`);
        expect(Object.keys(Config.load().mcpServers)).toHaveLength(0);
    });

    it("AC-003 contextWindow：per-provider 可配，缺省 128000", () => {
        writeConfig(`
providers:
  p1:
    apiKey: sk
    model: m
  p2:
    apiKey: sk2
    model: m2
    contextWindow: 200000
default: p1
`);
        const cfg = Config.load();
        expect(cfg.providers.p1.contextWindow).toBe(128000);
        expect(cfg.providers.p2.contextWindow).toBe(200000);
        expect(cfg.getCurrentProvider().contextWindow).toBe(128000);
    });

    it("AC-005 无 config.yaml → 抛错引导建配置", () => {
        // beforeEach 已清空 .anycode，无 config.yaml
        expect(() => Config.load()).toThrow(/配置文件不存在/);
    });

    it("无 providers / default 未定义 → 抛错", () => {
        writeConfig(`providers: {}\ndefault: nope\n`);
        expect(() => Config.load()).toThrow(/未定义任何 provider|未在 providers 中定义/);
    });

    it("AC-004/007 reload() 重读文件，default/provider 切换生效", () => {
        writeConfig(`
providers:
  openai:
    apiKey: sk-o
    model: gpt-4o
default: openai
`);
        const cfg = Config.load();
        expect(cfg.getCurrentProvider().model).toBe("gpt-4o");
        writeConfig(`
providers:
  openai:
    apiKey: sk-o
    model: gpt-4o
  deepseek:
    apiKey: sk-d
    model: deepseek-chat
default: deepseek
`);
        cfg.reload();
        expect(cfg.default).toBe("deepseek");
        expect(cfg.getCurrentProvider().model).toBe("deepseek-chat");
    });
});
