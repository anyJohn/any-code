import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

// 构建期注入版本号（侧栏品牌头显示）：读根 package.json，__APP_VERSION__ 全量替换。
// dev 与 build 同源，无需运行时请求。
const appVersion = JSON.parse(
    readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")
).version as string;

// dev：Vite dev server (5173) + proxy /api → hono server (默认 3000，pnpm --filter @any-code/server dev)。
// prod：vite build → 静态 dist/（无 node_modules、无 junction）；launcher 起 hono server serve dist。
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": path.resolve(__dirname) },
    },
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: {
        port: 5173,
        proxy: {
            "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
        },
    },
    build: {
        outDir: "dist",
    },
});
