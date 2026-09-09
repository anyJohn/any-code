import { cpSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
// 内置能力目录（连接器 server.mjs + 未来 SKILL.md 等）随 server bundle 同目录分发：dist/builtin/<name>/
mkdirSync(join(__dirname, "dist", "builtin"), { recursive: true });
cpSync(join(__dirname, "..", "domain", "src", "builtin"), join(__dirname, "dist", "builtin"), { recursive: true });
// playwright-core external + 整包 vendor 到 dist/node_modules/（bundle 它会踩 chromium-bidi
// 解析 / ESM 无 __dirname / 元数据读取三连坑；external 后以真实 CJS 文件运行，全部自然正确）。
// 整包无运行时依赖，单目录自包含；core tar（server/dist 整目录）就近解析。
{
    const req = createRequire(join(__dirname, "..", "domain", "package.json"));
    const pwRoot = dirname(req.resolve("playwright-core/package.json"));
    const dest = join(__dirname, "dist", "node_modules", "playwright-core");
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(pwRoot, dest, { recursive: true });
    if (!existsSync(join(dest, "package.json"))) {
        console.error("playwright-core vendor 失败：dist/node_modules 缺 package.json");
        process.exit(1);
    }
}

import esbuild from "esbuild";

// 自包含 server.mjs；external @vscode/ripgrep（原生二进制，launcher vendor + 注入
// ANYCODE_RG_PATH，dynamic import 无此包时 try/catch 降级）与 playwright-core（上方 vendor）。
const require = createRequire(import.meta.url);
const pkg = require("./package.json");

await esbuild
    .build({
        entryPoints: ["src/main.ts"],
        outfile: "dist/server.mjs",
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22",
        minify: false,
        sourcemap: false,
        logLevel: "info",
        // ESM bundle 里 require 是 undefined（cross-spawn 等动态 require("child_process") 会抛
        // "Dynamic require of X is not supported"）。注入 createRequire 让 require 可用。
        banner: {
            js: "import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);",
        },
        external: ["@vscode/ripgrep", "playwright-core"],
    })
    .then(() => console.log("server build complete → dist/server.mjs"))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
