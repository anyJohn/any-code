import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { registerAbility } from "./abilities";

/**
 * 内置连接器注册（RR-025 D-9 / SPEC-031 B-008~B-010）——import 即注册。
 * 统一布局：src/builtin/<ability>/server.mjs——子目录即一个连接器（kind:mcp，bundled stdio MCP server）。
 * 随包自带技能不走这里：技能是纯文件（外部同标准），安装/首次启动把 SKILL.md seed 进 ~/.anycode/skills/ 即可。
 * 连接器文件随 server/desktop bundle 同目录分发为 dist/builtin/（esbuild copy 步骤）；
 * Electron 打包时 asarUnpack 解包，运行时 builtinRoot() 映射到真实路径（子进程 spawn 可执行）。
 * 文件缺失时连接失败 → mcp.ts 单 server 失败不阻断（现有行为），能力随 config 开关。
 */

/** Electron 特有属性（打包后资源目录定位用）；非 Electron 环境不存在。 */
declare global {
    namespace NodeJS {
        interface Process {
            resourcesPath?: string;
        }
    }
}

/** CJS bundle（desktop main.cjs）由 Node 提供的模块目录。ESM 环境不存在；TS 声明兼容。 */
declare const __dirname: string | undefined;

/**
 * 当前模块所在目录，兼容两种 bundle 形态：
 * - ESM（server dist/server.mjs / tsx / vitest）：import.meta.url 可用
 * - CJS（desktop dist/main/main.cjs）：import.meta 是 undefined，用 Node 的 __dirname
 */
function currentDir(): string {
    if (typeof import.meta !== "undefined" && import.meta.url) {
        return dirname(fileURLToPath(import.meta.url));
    }
    if (typeof __dirname === "string" && __dirname) return __dirname;
    return process.cwd();
}

/** 内置能力根目录（相对当前 bundle/源码位置；bundler 把整个 builtin/ 目录 emit 到同目录）。
 *  Electron asar 环境：fs 可透明读 app.asar 虚拟路径，但外部 shell/bash 与子进程 spawn
 *  读不到——映射到 app.asar.unpacked 真实路径（electron-builder asarUnpack 解包）。 */
export function builtinRoot(): string {
    let dir = join(currentDir(), "builtin");
    if (dir.includes("app.asar") && typeof process.resourcesPath === "string") {
        dir = dir.replace("app.asar", "app.asar.unpacked");
    }
    return dir;
}

/** 内置连接器的用户可见说明（Settings 面板展示——写给最终用户，不解释实现原理）。 */
const DESCRIPTION: Record<string, string> = {
    "web-fetch": "抓取网页并转为 Markdown 文本（仅 https）",
    "web-search":
        "网页搜索。默认 ddg（免 key），可换 tavily / bing（需填写对应 API Key）",
    "browser-use":
        "真实浏览器（CDP）：打开网页、点击、填表、取内容。需配置 cdpUrl（浏览器调试地址）",
};

// 扫描 builtin/ 下每个子目录：含 server.mjs → 注册为 mcp 连接器（能力名 = 目录名）。
for (const name of fs.readdirSync(builtinRoot()).sort()) {
    const dir = join(builtinRoot(), name);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!fs.existsSync(join(dir, "server.mjs"))) continue;
    registerAbility({
        name,
        kind: "mcp",
        description: DESCRIPTION[name] ?? name,
        server: {
            type: "stdio",
            command: process.execPath,
            args: [join(dir, "server.mjs")],
            env: {}, // 运行时由 main.ts 并入 abilities.<name>.config（cdpUrl/provider/apiKey）为 ABILITY_CONFIG
        },
    });
}
