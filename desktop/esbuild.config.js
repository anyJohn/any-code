// 内置能力目录（连接器 server.mjs + 未来 SKILL.md 等）随桌面 main bundle 同目录分发
// （builtin.ts / skill.ts 的 import.meta.url → dist/main → builtin/）
import { cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
await (async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    mkdirSync(join(here, "dist", "main", "builtin"), { recursive: true });
    cpSync(join(here, "..", "domain", "src", "builtin"), join(here, "dist", "main", "builtin"), { recursive: true });
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
                external: ["electron", "@vscode/ripgrep"],
            })
            .then(() => console.log(`✓ ${e.src} → ${e.out}`)),
    ),
).catch((err) => {
    console.error(err);
    process.exit(1);
});

console.log("desktop build complete → dist/main/{main,preload}.cjs");
