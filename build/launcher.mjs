#!/usr/bin/env node
// anycode web launcher (cross-platform). Invoked via thin platform shims that the installers
// generate on the target machine (thin-shim style), so the launcher logic lives in ONE node file
// and the shims stay 2-line ASCII (no .bat/CRLF/BOM fragility, no console-codepage dependency).
//   Windows anycode.cmd:  @echo off\r\n"<node.exe>" "<this>" %*\r\n
//   Linux   anycode:      exec "<node>" "<this>" "$@"
// Output is ASCII-only on purpose (node stdout on Windows is codepage-dependent, unlike Python).
//
// Runs the Next.js standalone server (output:"standalone") via the private node — no `next` CLI,
// no full node_modules needed at runtime. Sets HOSTNAME=127.0.0.1 (standalone server.js defaults
// to 0.0.0.0 = public! must override) + ANYCODE_RG_PATH to the vendored rg binary.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

const win = platform() === "win32";
const ANYCODE_HOME = process.env.ANYCODE_HOME || join(homedir(), ".anycode");
const APP = join(ANYCODE_HOME, "app");
const NODE_DIR = join(ANYCODE_HOME, "runtime", "node");
const NODE_BIN = win ? join(NODE_DIR, "node.exe") : join(NODE_DIR, "bin", "node");
// standalone layout: app/web/.next/standalone/web/server.js (mirrors repo's web/ subdir)
const STANDALONE_WEB = join(APP, "web", ".next", "standalone", "web");
const SERVER_JS = join(STANDALONE_WEB, "server.js");
const RG = join(ANYCODE_HOME, "runtime", "rg", win ? "rg.exe" : "rg");

// Subcommand dispatch. `anycode web` launches the web app; bare `anycode` prints
// usage (a CLI mode is not shipped yet); unknown subcommand → error. Flags like
// --port= may follow the subcommand. Dispatch happens before install-state checks so
// usage/error work even on a mis-installed machine. Output is ASCII (Windows codepage).
const argv = process.argv.slice(2);
const sub = argv.find((a) => !a.startsWith("-"));
if (sub && sub !== "web") {
    console.error("anycode: unknown command '" + sub + "'. Try 'anycode web'.");
    process.exit(2);
}
if (!sub) {
    console.log("anycode — usage:");
    console.log("  anycode web            Start the web app (opens http://127.0.0.1:3000)");
    console.log("  anycode web --port=N   Start on a custom port");
    process.exit(0);
}

// below runs only for `anycode web` — verify the install is present
if (!existsSync(NODE_BIN)) {
    console.error("anycode not installed correctly: private node missing (" + NODE_BIN + "). Reinstall.");
    process.exit(1);
}
if (!existsSync(SERVER_JS)) {
    console.error("anycode not installed correctly: web build missing (" + SERVER_JS + "). Reinstall.");
    process.exit(1);
}

// private node on PATH (for anything the server/agent spawns that resolves `node`)
process.env.PATH = [NODE_DIR, process.env.PATH].join(win ? ";" : ":");

// --port override; default 3000, auto-increment to a free port
let startPort = 3000;
for (const a of argv) {
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

// standalone server.js reads PORT + HOSTNAME from env. HOSTNAME=127.0.0.1 (localhost-only, security).
process.env.PORT = String(PORT);
process.env.HOSTNAME = "127.0.0.1";
// vendored rg path so domain ripgrep.ts finds it inside standalone (no @vscode/ripgrep binary there)
process.env.ANYCODE_RG_PATH = RG;

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

// run the standalone server in foreground via private node; Ctrl+C propagates to kill it
const child = spawn(NODE_BIN, [SERVER_JS], {
    cwd: STANDALONE_WEB,
    stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => {
    try { child.kill(); } catch {}
    process.exit(130);
});
