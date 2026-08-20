import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        setupFiles: ["./vitest.setup.ts"],
        globals: true,
        css: false,
        include: ["**/*.test.ts", "**/*.test.tsx"],
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname),
            "server-only": path.resolve(__dirname, "lib/__mocks__/server-only.ts"),
        },
    },
});
