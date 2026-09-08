/**
 * Stage resources for electron-builder packaging.
 * 拷贝 web/dist（静态 SPA）+ rg（linux+win 平台二进制）+ busybox（win）→ desktop/resources/。
 * 由 `pnpm build` 先跑，然后 electron-builder 把 resources/ 打进 extraResources。
 */
import { cpSync, mkdirSync, existsSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", ".."); // repo root
const NODE_MODULES = join(ROOT, "node_modules");

const RESOURCES = join(__dirname, "..", "resources");

function copy(src, dst) {
    if (!src || !existsSync(src)) {
        console.warn(`  ⚠ source not found: ${src} — skipping`);
        return false;
    }
    cpSync(src, dst, { recursive: true });
    console.log(`  ✓ ${dst}`);
    return true;
}

/** 定位 ripgrep 平台二进制（isolated pnpm 布局下 require.resolve 找不到传递依赖）。
 *  纯 Node 实现——不要用 shell `find`：Windows runner 的 find.exe 语法不兼容，
 *  会导致所有平台二进制静默 skip（v0.0.2 Windows 安装包缺 rg 的根因）。 */
function findRg(pkgPart, bin) {
    // 直接依赖路径（desktop devDep → node_modules/@vscode/ripgrep-*，pnpm 下是 symlink）
    const direct = join(NODE_MODULES, "@vscode", pkgPart, "bin", bin);
    if (existsSync(direct)) return direct;
    // 兜底：遍历 node_modules 找任意布局下的 @vscode/<pkgPart>/bin/<bin>
    const stack = [NODE_MODULES];
    const want = join("@vscode", pkgPart, "bin", bin);
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            const p = join(dir, e.name);
            if (e.isDirectory()) stack.push(p);
            else if (e.isFile() && p.replaceAll("\\", "/").endsWith(want.replaceAll("\\", "/")))
                return p;
        }
        if (stack.length > 5000) break; // 防御：异常深的树
    }
    return "";
}

console.log(">> staging desktop resources →", RESOURCES);
rmSync(RESOURCES, { recursive: true, force: true });
mkdirSync(RESOURCES, { recursive: true });

// 1. web/dist → resources/web-dist（静态 SPA）
copy(join(ROOT, "web", "dist"), join(RESOURCES, "web-dist"));

// 2. ripgrep 平台二进制 → resources/rg/（linux/win/2×darwin 全拷、各自独立文件名，
//    main.ts 按 process.platform+arch 挑——一份 resources 跨平台通用）
mkdirSync(join(RESOURCES, "rg"), { recursive: true });
const rgPlatforms = [
    ["ripgrep-linux-x64", "rg", "rg"],
    ["ripgrep-win32-x64", "rg.exe", "rg.exe"],
    ["ripgrep-darwin-arm64", "rg", "rg-darwin-arm64"],
    ["ripgrep-darwin-x64", "rg", "rg-darwin-x64"],
];
for (const [pkgPart, bin, outName] of rgPlatforms) {
    const src = findRg(pkgPart, bin);
    if (src) copy(src, join(RESOURCES, "rg", outName));
    else console.warn(`  ⚠ ${pkgPart} rg not found`);
}

// 3. busybox-w32（win bash 工具）→ resources/busybox-win/sh.exe
//    从仓库 assets/busybox-win/sh.exe 拷贝（git-tracked，不依赖外部下载）。
//    来源：pierreown/busybox-w32-build GitHub releases。
//    Linux AppImage 不需要 busybox（用 /bin/sh）。
const bundledBusybox = join(__dirname, "..", "assets", "busybox-win", "sh.exe");
mkdirSync(join(RESOURCES, "busybox-win"), { recursive: true });
if (existsSync(bundledBusybox)) {
    copy(bundledBusybox, join(RESOURCES, "busybox-win", "sh.exe"));
} else {
    console.warn("  ⚠ busybox sh.exe not in assets/busybox-win/ — Windows bash 不可用");
}

// 4. app 图标（512 png）→ resources/icon.png（main.ts BrowserWindow 运行时读它）
copy(join(__dirname, "..", "assets", "icon", "icon-512.png"), join(RESOURCES, "icon.png"));

console.log(">> resources staged.");
