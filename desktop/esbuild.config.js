// 内置能力目录（连接器 server.mjs + 未来 SKILL.md 等）随桌面 main bundle 同目录分发
// （builtin.ts / skill.ts 的 import.meta.url → dist/main → builtin/）
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
await (async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    mkdirSync(join(here, "dist", "main", "builtin"), { recursive: true });
    cpSync(join(here, "..", "domain", "src", "builtin"), join(here, "dist", "main", "builtin"), { recursive: true });
    // playwright-core 打进 main bundle 后，模块 init 按 packageRoot（__dirname/.. = dist/）
    // 读自己的元数据（browsers.json / package.json，registry 初始化；connectOverCDP 也要走
    // 这条 import 链）。CJS 输出运行期 __dirname = main.cjs 所在目录（dist/main）→
    // packageRoot = dist/——两份元数据落 dist/，并经 electron-builder files 进 asar。
    // launch 浏览器的 registry/bin 路径不会被触碰（只 connectOverCDP，不下载浏览器）。
    const req = createRequire(join(here, "..", "domain", "package.json"));
    const pwRoot = dirname(req.resolve("playwright-core/package.json"));
    cpSync(join(pwRoot, "browsers.json"), join(here, "dist", "browsers.json"));
    cpSync(join(pwRoot, "package.json"), join(here, "dist", "package.json"));
})();

import esbuild from "esbuild";

// 打包 Electron main + preload（src/*.ts → dist/main/*.cjs）
// bundle @any-code/server + domain + 所有依赖；external 仅 electron（Electron runtime 提供）
// + @vscode/ripgrep（原生二进制，vendored 到 resources/rg，靠 ANYCODE_RG_PATH）。
// CJS 输出：cross-spawn 等 CJS 依赖的 require 原生可用（不像 ESM 需 createRequire banner）。
const entries = [
    { src: "src/main.ts", out: "dist/main/main.cjs" },
    { src: "src/preload.ts", out: "dist/main/preload.cjs" },
];

await Promise.all(
    entries.map((e) =>
        esbuild
            .build({
                entryPoints: [e.src],
                outfile: e.out,
                bundle: true,
                platform: "node",
                format: "cjs",
                target: "node22",
                minify: false,
                sourcemap: false,
                logLevel: "info",
                // chromium-bidi：playwright-core 的可选依赖（WebDriver BiDi mapper，懒加载
                // 闭包内 require——connectOverCDP 走 CDP 永不触发；包未随装，不 external
                // 则 esbuild 静态解析失败，CI 0.0.3 曝光）
                external: ["electron", "@vscode/ripgrep", "chromium-bidi"],
            })
            .then(() => console.log(`✓ ${e.src} → ${e.out}`)),
    ),
).catch((err) => {
    console.error(err);
    process.exit(1);
});

console.log("desktop build complete → dist/main/{main,preload}.cjs");
