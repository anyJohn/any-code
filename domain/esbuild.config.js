const esbuild = require("esbuild");
const fs = require("fs");

const isWatch = process.argv.includes("--watch");

const buildOptions = {
    entryPoints: ["src/main.ts"],
    outdir: "dist",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    minify: true,
    sourcemap: false,
    logLevel: "info",
    external: Object.keys(require("./package.json").dependencies || {}),
    treeShaking: true,
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
