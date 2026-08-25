#!/usr/bin/env node
// anycode web launcher (cross-platform). Invoked via thin platform shims that the installers
// generate on the target machine (thin-shim style), so the launcher logic lives in ONE node file
// and the shims stay 2-line ASCII (no .bat/CRLF/BOM fragility, no console-codepage dependency).
//   Windows anycode.cmd:  @echo off\r\n"<node.exe>" "<this>" %*\r\n
//   Linux   anycode:      exec "<node>" "<this>" "$@"
// Output is ASCII-only on purpose (node stdout on Windows is codepage-dependent, unlike Python).
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

const win = platform() === "win32";
const ANYCODE_HOME = process.env.ANYCODE_HOME || join(homedir(), ".anycode");
const APP = join(ANYCODE_HOME, "app");
const WEB = join(APP, "web");
const NODE_DIR = join(ANYCODE_HOME, "runtime", "node");
const NODE_BIN = win ? join(NODE_DIR, "node.exe") : join(NODE_DIR, "bin", "node");
const NEXT_ENTRY = join(WEB, "node_modules", "next", "dist", "bin", "next");

if (!existsSync(NODE_BIN)) {
    console.error("anycode not installed correctly: private node missing (" + NODE_BIN + "). Reinstall.");
    process.exit(1);
}
if (!existsSync(NEXT_ENTRY)) {
    console.error("anycode not installed correctly: web build missing (" + NEXT_ENTRY + "). Reinstall.");
    process.exit(1);
}

// private node + web's bin on PATH so spawned next resolves its deps
const PATH_PRE = [join(WEB, "node_modules", ".bin"), NODE_DIR];
process.env.PATH = [...PATH_PRE, process.env.PATH].join(win ? ";" : ":");

// --port override; default 3000, auto-increment to a free port
let startPort = 3000;
for (const a of process.argv.slice(2)) {
    if (a.startsWith("--port=")) startPort = parseInt(a.slice(7), 10) || 3000;
}

function freePort(start) {
    return new Promise((resolve) => {
        const tryBind = (p, tries) => {
            if (tries <= 0) return resolve(start);
            const s = createServer();
            s.once("error", () => tryBind(p + 1, tries - 1));
            s.listen(p, "127.0.0.1", () => s.close(() => resolve(p)));
        };
        tryBind(start, 20);
    });
}

const PORT = await freePort(startPort);
const URL = "http://127.0.0.1:" + PORT;
console.log(">> Starting anycode web -> " + URL + " (Ctrl+C to stop)");

function openBrowser(url) {
    const cmd = win
        ? ["cmd", ["/c", "start", "", url]]
        : platform() === "darwin"
            ? ["open", [url]]
            : ["xdg-open", [url]];
    try {
        spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
    } catch {
        // best-effort; user can open the URL manually
    }
}

// poll until the server is up, then open the browser (best-effort, background)
(async () => {
    for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
            const res = await fetch(URL);
            if (res) {
                openBrowser(URL);
                return;
            }
        } catch {
            // not up yet
        }
    }
})();

// run `next start` in foreground via the private node; Ctrl+C propagates to kill it
const child = spawn(NODE_BIN, [NEXT_ENTRY, "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: WEB,
    stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => {
    try { child.kill(); } catch {}
    process.exit(130);
});
