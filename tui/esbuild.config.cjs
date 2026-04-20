const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const isWatch = process.argv.includes("--watch");
const isDev = process.argv.includes("--dev");

const baseConfig = {
    entryPoints: ["source/cli.tsx"],
    outdir: "dist",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    sourcemap: isDev,
    minify: !isDev,
    logLevel: "info",
    external: [
        ...Object.keys(require("./package.json").dependencies || {}),
        ...Object.keys(require("../package.json").devDependencies || {}),
    ],
    treeShaking: true,
    loader: {
        ".tsx": "tsx",
        ".ts": "ts",
    },
    banner: {
        js: "#!/usr/bin/env node\n",
    },
};

async function build() {
    if (fs.existsSync("dist")) {
        fs.rmSync("dist", { recursive: true, force: true });
    }

    if (isWatch) {
        const ctx = await esbuild.context(baseConfig);
        await ctx.watch();
        console.log("Watching for changes...");
    } else {
        await esbuild.build(baseConfig);
        console.log("Build complete!");

        // 确保 cli.js 有执行权限
        const cliPath = path.join(__dirname, "dist", "cli.js");
        if (fs.existsSync(cliPath)) {
            fs.chmodSync(cliPath, "755");
        }
    }
}

build().catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
});
