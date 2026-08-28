import esbuild from "esbuild";

// 打包 Electron main（src/main.ts → dist/main/main.cjs）
// bundle @any-code/server + domain + 所有依赖；external 仅 electron（Electron runtime 提供）
// + @vscode/ripgrep（原生二进制，vendored 到 resources/rg，靠 ANYCODE_RG_PATH）。
// CJS 输出：cross-spawn 等 CJS 依赖的 require 原生可用（不像 ESM 需 createRequire banner）。
await esbuild
    .build({
        entryPoints: ["src/main.ts"],
        outfile: "dist/main/main.cjs",
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node22",
        minify: false,
        sourcemap: false,
        logLevel: "info",
        external: ["electron", "@vscode/ripgrep"],
    })
    .then(() => console.log("desktop main build complete → dist/main/main.cjs"))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
