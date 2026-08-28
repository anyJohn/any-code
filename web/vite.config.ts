import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// dev：Vite dev server (5173) + proxy /api → hono server (默认 3000，pnpm --filter @any-code/server dev)。
// prod：vite build → 静态 dist/（无 node_modules、无 junction）；launcher 起 hono server serve dist。
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": path.resolve(__dirname) },
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
