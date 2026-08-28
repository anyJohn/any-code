// CLI 入口：launcher spawn `node dist/server.mjs` 走这里。
// 库用法（Electron main / 测试）import "@any-code/server" 的 createApp/start（见 index.ts）。
import { start } from "./index.js";

const staticDir = process.env.ANYCODE_WEB_DIST;
start({ staticDir }).then(
    ({ port, hostname }) => {
        console.log(`>> anycode server on http://${hostname}:${port}`);
    },
    (err) => {
        console.error(">> anycode server failed:", err);
        process.exit(1);
    },
);
