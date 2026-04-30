import esbuild from "esbuild";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const isWatch = process.argv.includes("--watch");

const buildOptions = {
    entryPoints: ["src/index.ts"],
    outdir: "dist",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    minify: false,
    sourcemap: false,
    logLevel: "info",
    external: Object.keys(require("./package.json").dependencies || {}),
    treeShaking: true,
    outExtension: { ".js": ".mjs" },
};

async function build() {
    if (fs.existsSync("dist")) {
        fs.rmSync("dist", { recursive: true, force: true });
    }

    if (isWatch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log("Watching...");
    } else {
        await esbuild.build(buildOptions);
        console.log("Build complete!");
    }
}

build();
