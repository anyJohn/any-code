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
        banner: {
            js: "import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);",
        },
        // 只 external 原生 rg 包；其余（hono / @hono/node-server / @any-code/domain 及其依赖）全打进 bundle
        external: ["@vscode/ripgrep"],
    })
    .then(() => console.log("server build complete → dist/server.mjs"))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
