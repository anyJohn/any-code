import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

/**
 * 内置资源根目录定位（原连接器注册层已废除——用户决策 2026-09-03：
 * web_fetch/web_search/browser_* 改原生工具，见 tools/functions/）。
 * builtin/ 目录现仅存技能目录（anycode-docs / office-mcp），由 seed.ts 首启部署到 ~/.anycode/skills/。
 * Electron 打包时 asarUnpack 解包，运行时 builtinRoot() 映射到真实路径（seed fs 读取需要）。
 */

/** Electron 特有属性（打包后资源目录定位用）；非 Electron 环境不存在。 */
type ElectronProcess = NodeJS.Process & { resourcesPath?: string };

/** CJS bundle（desktop main.cjs）由 Node 提供的模块目录。ESM 环境不存在；TS 声明兼容。 */
declare const __dirname: string | undefined;

function currentDir(): string {
    if (typeof import.meta !== "undefined" && import.meta.url) {
        return dirname(fileURLToPath(import.meta.url));
    }
    if (typeof __dirname === "string" && __dirname) return __dirname;
    return process.cwd();
}

export function builtinRoot(): string {
    let dir = join(currentDir(), "builtin");
    const resourcesPath = (process as ElectronProcess).resourcesPath;
    if (dir.includes("app.asar") && typeof resourcesPath === "string") {
        dir = dir.replace("app.asar", "app.asar.unpacked");
    }
    return dir;
}
