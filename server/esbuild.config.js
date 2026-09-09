import { cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
// 内置能力目录（连接器 server.mjs + 未来 SKILL.md 等）随 server bundle 同目录分发：dist/builtin/<name>/
mkdirSync(join(__dirname, "dist", "builtin"), { recursive: true });
cpSync(join(__dirname, "..", "domain", "src", "builtin"), join(__dirname, "dist", "builtin"), { recursive: true });
// playwright-core 打进 bundle 后，其模块 init 仍会按 packageRoot 读自己的元数据文件
// （browsers.json / package.json，registry 初始化；connectOverCDP 也要走这条 import 链）。
// 拷贝两份元数据到 dist/，配合 banner 的 __dirname shim（见下）让 packageRoot 指向 dist/。
// launch 浏览器的 registry/bin 路径不会被触碰（我们只 connectOverCDP，不下载浏览器）。
const req = createRequire(join(__dirname, "..", "domain", "package.json"));
const pwRoot = dirname(req.resolve("playwright-core/package.json"));
cpSync(join(pwRoot, "browsers.json"), join(__dirname, "dist", "browsers.json"));
cpSync(join(pwRoot, "package.json"), join(__dirname, "dist", "package.json"));
import esbuild from "esbuild";
import { createRequire } from "module";

// 把 server + @any-code/domain + 依赖打成一个自包含 server.mjs（运行时不需 node_modules）。
// 仅 external @vscode/ripgrep（原生二进制，launcher vendor 到 runtime/rg + 注入 ANYCODE_RG_PATH；
// ripgrep.ts 的 dynamic import 在无此包时 try/catch 降级，故 external 安全）。见 SPEC-028 A-005/C-005。
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
        // __dirname 同理：Node ESM 无此变量，playwright-core 的 package.ts/registry 在模块
        // init 按 packageRoot（__dirname/..）读 browsers.json / package.json（已拷到 dist/，
        // 见上）。shim 到 <dist>/__pw__ 佯目录 → packageRoot = dist/，require 命中拷贝的元数据。
        banner: {
            js: "import { createRequire } from 'module';\nimport { fileURLToPath as __anycodeF2P } from 'url';\nconst require = createRequire(import.meta.url);\nconst __dirname = __anycodeF2P(import.meta.url).replace(/[\\\\/][^\\\\/]*$/, '') + '/__pw__';",
        },
        // 只 external 原生 rg 包 + playwright-core 的可选依赖 chromium-bidi（WebDriver BiDi
        // mapper，require 在懒初始化闭包里——connectOverCDP 走 CDP 永不触发；该包未随装，
        // 不 external 则 esbuild 静态解析直接失败，CI 0.0.3 曝光）。
        // 其余（hono / @any-code/domain / playwright-core 及其依赖）全打进 bundle
        external: ["@vscode/ripgrep", "chromium-bidi"],
    })
    .then(() => console.log("server build complete → dist/server.mjs"))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
