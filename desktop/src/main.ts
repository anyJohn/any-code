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
import { app, BrowserWindow, ipcMain, Menu } from "electron";
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

// domain ripgrep.ts 读 ANYCODE_RG_PATH（server bundle externalize 了 @vscode/ripgrep，降级到此）。
// resources/rg/ 里按平台独立命名（stage-resources 拷入），按 platform+arch 挑：win→rg.exe，
// darwin→arm64/x64 分开（一份 resources 跨平台）；linux→rg。
const rgBin = isWin
    ? "rg.exe"
    : process.platform === "darwin"
      ? process.arch === "arm64" ? "rg-darwin-arm64" : "rg-darwin-x64"
      : "rg";
process.env.ANYCODE_RG_PATH = path.join(rgDir, rgBin);
// Windows: 捆绑的 busybox（sh.exe）给 domain bash.ts 用（同 ANYCODE_RG_PATH 模式）
if (isWin) {
    process.env.ANYCODE_BASH_PATH = path.join(resourcesDir, "busybox-win", "sh.exe");
}

let serverHandle: { port: number; close: () => void } | null = null;
let mainWindow: BrowserWindow | null = null;

// 窗口控制 IPC（渲染进程经 preload 的 window.anycode 调用）。模块级注册一次。
ipcMain.on("anycode:win-minimize", () => mainWindow?.minimize());
ipcMain.on("anycode:win-toggle-maximize", () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on("anycode:win-close", () => mainWindow?.close());

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
    // 防双启动：mac 关窗后 app 驻 Dock，activate 重触发 boot 时 server/窗口还在就直接返回。
    if (serverHandle || mainWindow) return;

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

    // frameless：去 OS 标题栏，窗口控件内置到 web UI（TitleBar）；杀默认菜单栏避免残栏。
    Menu.setApplicationMenu(null);

    // 窗口图标：打包后读 resources/icon.png（stage-resources 拷入），开发读 committed 源 png。
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, "icon.png")
        : path.join(__dirname, "..", "..", "assets", "icon", "icon-512.png");

    mainWindow = new BrowserWindow({
        width: 1080,
        height: 720,
        minWidth: 720,
        minHeight: 520,
        title: "AnyCode",
        frame: false, // 无边框，控件由 web TitleBar 承载
        icon: iconPath,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.cjs"),
        },
    });

    // 最大化状态变化回传渲染进程（TitleBar 切换 ▢/还原图标）。建后发一次初值。
    const sendMaxState = () =>
        mainWindow?.webContents.send(
            "anycode:win-maximized",
            mainWindow.isMaximized(),
        );
    mainWindow.on("maximize", sendMaxState);
    mainWindow.on("unmaximize", sendMaxState);

    const url = `http://127.0.0.1:${port}`;
    console.log(`>> anycode desktop -> ${url}`);
    mainWindow.loadURL(url);
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.whenReady().then(boot);

app.on("window-all-closed", () => {
    // 关窗 = 无后台残留（SPEC-029 B-002 / I-002）：非 mac 直接退出。
    // mac 关窗后 app 驻 Dock，activate 触发 boot() 重开（server 在 boot 里重启）。
    if (process.platform !== "darwin") {
        serverHandle?.close();
        app.quit();
    }
});

// mac Dock 点击重新开窗；window-all-closed 后 app 仍存活，boot() 防双启动直接重建。
app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
});
