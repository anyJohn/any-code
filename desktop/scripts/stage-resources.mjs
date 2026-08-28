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

/** 用 find 定位 ripgrep 平台二进制（跟 install.sh 一样；isolated 下 require.resolve 找不到传递依赖） */
function findRg(name) {
    try {
        return execSync(`find "${NODE_MODULES}" -type f -name '${name}' -path '*ripgrep*' 2>/dev/null | head -1`)
            .toString().trim();
    } catch {
        return "";
    }
}

console.log(">> staging desktop resources →", RESOURCES);
rmSync(RESOURCES, { recursive: true, force: true });
mkdirSync(RESOURCES, { recursive: true });

// 1. web/dist → resources/web-dist（静态 SPA）
copy(join(ROOT, "web", "dist"), join(RESOURCES, "web-dist"));

// 2. ripgrep 平台二进制 → resources/rg/（domain 同时 pin 了 linux + win32，都拷进来跨平台打包用）
mkdirSync(join(RESOURCES, "rg"), { recursive: true });
const rgLinux = findRg("rg");
if (rgLinux) copy(rgLinux, join(RESOURCES, "rg", "rg"));
else console.warn("  ⚠ linux rg not found");
const rgWin = findRg("rg.exe");
if (rgWin) copy(rgWin, join(RESOURCES, "rg", "rg.exe"));
else console.warn("  ⚠ win rg.exe not found");

// 3. busybox-w32（win bash 工具）→ resources/busybox-win/sh.exe
//    无 npm 包；从 frippery.org 下载（同 install.ps1），或从 ~/.anycode 拷（已装的）。
//    自包含，不依赖 prior install。Linux AppImage 不需要 busybox（用 /bin/sh）。
mkdirSync(join(RESOURCES, "busybox-win"), { recursive: true });
const busyboxDest = join(RESOURCES, "busybox-win", "sh.exe");
const busyboxLocal = join(process.env.HOME || process.env.USERPROFILE || "", ".anycode", "runtime", "busybox", "sh.exe");
if (existsSync(busyboxLocal)) {
    copy(busyboxLocal, busyboxDest);
} else {
    console.log("  下载 busybox-w32（frippery.org）…");
    try {
        const res = await fetch("https://frippery.org/files/busybox/busybox64.exe", { redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(busyboxDest, buf);
        console.log(`  ✓ ${busyboxDest} (${buf.length} bytes)`);
    } catch (e) {
        console.warn(`  ⚠ busybox 下载失败（${e.message}）— Windows bash 在桌面端将不可用（Linux 不受影响）`);
    }
}

console.log(">> resources staged.");
