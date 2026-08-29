/**
 * Stage resources for electron-builder packaging.
 * 拷贝 web/dist（静态 SPA）+ rg（linux+win 平台二进制）+ busybox（win）→ desktop/resources/。
 * 由 `pnpm build` 先跑，然后 electron-builder 把 resources/ 打进 extraResources。
 */
import { cpSync, mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

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

/** 用 find 定位 ripgrep 平台二进制（跟 install.sh 一样；isolated 下 require.resolve 找不到传递依赖）。
 *  pkgPart 匹配 pnpm 目录里的包名片段（如 'ripgrep-darwin-arm64'），bin 是包内二进制名。 */
function findRg(pkgPart, bin) {
    try {
        return execSync(
            `find "${NODE_MODULES}" -path "*${pkgPart}*/bin/${bin}" -type f 2>/dev/null | head -1`,
        ).toString().trim();
    } catch {
        return "";
    }
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
