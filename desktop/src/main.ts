/**
 * AnyCode 桌面端 Electron 主进程（DEC-007 / SPEC-029 / DEC-008）。
 *
 * 启动流：
 * 1. 嵌入 hono server（import @any-code/server → start()）—— 不 spawn 子进程，用 Electron 自带 node 跑
 * 2. BrowserWindow.loadURL('http://127.0.0.1:<port>') —— 同源、无 CORS、100% 复用 web 流
 * 3. 关窗 = server.stop() —— 无后台残留
 *
 * 自包含：web/dist + rg + (win) busybox 全 bundle 进 resources/，双击即用、不依赖 prior install。
 */
import { app, BrowserWindow } from "electron";
import { createServer } from "node:net";
import path from "node:path";
import { start } from "@any-code/server";

// CJS bundle：__dirname 由 Node CJS 提供（不用 fileURLToPath(import.meta.url)——CJS 里 import.meta.url 是 undefined）。
declare const __dirname: string;

// 资源目录：开发 = desktop/resources；打包后 = process.resourcesPath（electron-builder extraResources）
const resourcesDir = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "..", "resources"); // dist/main/ → ../../ → desktop/resources/

const isWin = process.platform === "win32";
const webDist = path.join(resourcesDir, "web-dist");
const rgDir = path.join(resourcesDir, "rg");

// domain ripgrep.ts 读 ANYCODE_RG_PATH（server bundle externalize 了 @vscode/ripgrep，降级到此）
process.env.ANYCODE_RG_PATH = path.join(rgDir, isWin ? "rg.exe" : "rg");
// Windows: 捆绑的 busybox（sh.exe）给 domain bash.ts 用（同 ANYCODE_RG_PATH 模式）
if (isWin) {
    process.env.ANYCODE_BASH_PATH = path.join(resourcesDir, "busybox-win", "sh.exe");
}

let serverHandle: { port: number; close: () => void } | null = null;
let mainWindow: BrowserWindow | null = null;

/** 从 startPort 试到空闲端口（复用 launcher freePort 思路） */
function freePort(startPort: number): Promise<number> {
    return new Promise((resolve) => {
        const tryBind = (p: number, tries: number) => {
            if (tries <= 0) return resolve(startPort);
            const s = createServer();
            s.once("error", () => tryBind(p + 1, tries - 1));
            s.listen(p, "127.0.0.1", () => s.close(() => resolve(p)));
        };
        tryBind(startPort, 20);
    });
}

async function boot() {
    const port = await freePort(3000);
    try {
        serverHandle = await start({
            port,
            hostname: "127.0.0.1",
            staticDir: webDist,
        });
    } catch (err) {
        console.error(">> anycode desktop: server failed:", err);
        app.quit();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 1080,
        height: 720,
        minWidth: 720,
        minHeight: 520,
        title: "AnyCode",
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    const url = `http://127.0.0.1:${port}`;
    console.log(`>> anycode desktop -> ${url}`);
    mainWindow.loadURL(url);
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.whenReady().then(boot);

app.on("window-all-closed", () => {
    // 关窗 = stop server（无后台残留，SPEC-029 B-002 / I-002）。macOS 会保留，但本 RR 无 mac。
    serverHandle?.close();
    app.quit();
});

// macOS dock 点击重新开窗（本 RR 不发 mac，但标准 Electron 写法）
app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
});
