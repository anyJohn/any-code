#!/usr/bin/env node
// anycode launcher (cross-platform). Invoked via thin platform shims that the installers
// generate on the target machine (thin-shim style), so the launcher logic lives in ONE node file
// and the shims stay 2-line ASCII (no .bat/CRLF/BOM fragility, no console-codepage dependency).
// Subcommands: web | update | uninstall | help (see printHelp).
//   Windows anycode.cmd:  @echo off\r\n"<node.exe>" "<this>" %*\r\n
//   Linux   anycode:      exec "<node>" "<this>" "$@"
// Output is ASCII-only on purpose (node stdout on Windows is codepage-dependent, unlike Python).
//
// Runs the Next.js standalone server (output:"standalone") via the private node — no `next` CLI,
// no full node_modules needed at runtime. Sets HOSTNAME=127.0.0.1 (standalone server.js defaults
// to 0.0.0.0 = public! must override) + ANYCODE_RG_PATH to the vendored rg binary.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, tmpdir } from "node:os";

const win = platform() === "win32";
const ANYCODE_HOME = process.env.ANYCODE_HOME || join(homedir(), ".anycode");
const APP = join(ANYCODE_HOME, "app");
const NODE_DIR = join(ANYCODE_HOME, "runtime", "node");
const NODE_BIN = win ? join(NODE_DIR, "node.exe") : join(NODE_DIR, "bin", "node");
// standalone layout: app/web/.next/standalone/web/server.js (mirrors repo's web/ subdir)
const STANDALONE_WEB = join(APP, "web", ".next", "standalone", "web");
const SERVER_JS = join(STANDALONE_WEB, "server.js");
const RG = join(ANYCODE_HOME, "runtime", "rg", win ? "rg.exe" : "rg");

// ORG/REPO/BRANCH for update (re-fetch installer). Try app's build/versions.env first
// (single source-ish), fall back to hardcoded matching versions.env.
function readRepoRef() {
    try {
        const t = readFileSync(join(APP, "build", "versions.env"), "utf8");
        const org = /^ORG=(.+)$/m.exec(t)?.[1]?.trim();
        const repo = /^REPO=(.+)$/m.exec(t)?.[1]?.trim();
        const branch = /^BRANCH=(.+)$/m.exec(t)?.[1]?.trim();
        if (org && repo && branch) return { org, repo, branch };
    } catch {
        // versions.env missing — fall back
    }
    return { org: "anyJohn", repo: "any-code", branch: "main" };
}
const REF = readRepoRef();
const RAW_BASE = `https://raw.githubusercontent.com/${REF.org}/${REF.repo}/${REF.branch}/build`;

// Subcommand dispatch. Commands: web | update | uninstall | help. `--help`/`-h` flag → help.
// Bare `anycode` → help (CLI mode not shipped). Unknown command → error. Dispatch runs before
// install-state checks so help/update/uninstall/error work even on a mis-installed machine.
// Output is ASCII on purpose (Windows stdout is codepage-dependent).
const argv = process.argv.slice(2);
const KNOWN = ["web", "update", "uninstall", "help"];
const sub = argv.find((a) => !a.startsWith("-"));

function printHelp() {
    console.log("anycode — usage:");
    console.log("  anycode web            Start the web app (opens http://127.0.0.1:3000)");
    console.log("  anycode web --port=N   Start on a custom port");
    console.log("  anycode update         Reinstall the latest build (re-fetch + rebuild)");
    console.log("  anycode uninstall      Remove anycode (~/.anycode); prompts unless -y");
    console.log("  anycode help|--help    Show this help");
}

if (argv.includes("--help") || argv.includes("-h") || !sub || sub === "help") {
    printHelp();
    process.exit(0);
}
if (!KNOWN.includes(sub)) {
    console.error("anycode: unknown command '" + sub + "'. Try 'anycode help'.");
    process.exit(2);
}
if (sub === "update") {
    runUpdate();
} else if (sub === "uninstall") {
    const yes = argv.includes("-y") || argv.includes("--yes");
    runUninstall(yes);
}

// ===== update / uninstall =====

/** update = re-run the platform installer (idempotent: node/pnpm skip if present,
 *  re-fetches repo zip + rebuilds). Uses the same one-line install the user ran. */
function runUpdate() {
    console.log(">> anycode update — re-fetching + rebuilding via the installer...");
    const cmd = win
        ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-c",
              `iwr -useb ${RAW_BASE}/install.ps1 | iex`]]
        : ["bash", ["-c", `curl -fsSL ${RAW_BASE}/install.sh | bash`]];
    const child = spawn(cmd[0], cmd[1], { stdio: "inherit" });
    child.on("exit", (code) => {
        if (code === 0) console.log(">> update done. Run 'anycode web'.");
        else console.error(">> update failed (exit " + code + ").");
        process.exit(code ?? 0);
    });
}

function readStdinLine() {
    return new Promise((resolve) => {
        process.stdin.setEncoding("utf8");
        process.stdin.resume();
        const done = (v) => { try { process.stdin.pause(); } catch {} resolve(v); };
        process.stdin.once("data", (c) => done(String(c)));
        process.stdin.once("end", () => done(""));
    });
}

/** Strip the `# anycode` marker + following PATH export line from an rc file. */
function stripRc(rc) {
    try {
        if (!existsSync(rc)) return;
        const lines = readFileSync(rc, "utf8").split("\n");
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === "# anycode" && i + 1 < lines.length && lines[i + 1].includes(".anycode/bin")) {
                i++; // skip the export line too
                continue;
            }
            out.push(lines[i]);
        }
        writeFileSync(rc, out.join("\n"), "utf8");
    } catch {
        // best-effort
    }
}

/** uninstall = remove ~/.anycode. Deferred delete: the launcher runs on the private node
 *  under ~/.anycode; on Windows node.exe is locked while running, so the deleter runs after
 *  this process exits (uniform on Linux too). Deleter script lives in system temp (outside
 *  ANYCODE_HOME). Linux also strips the anycode PATH lines from .bashrc/.zshrc. */
async function runUninstall(yes) {
    if (!yes) {
        process.stdout.write(
            "This will remove " + ANYCODE_HOME + " (config + runtime + app + sessions). Continue? [y/N] "
        );
        const a = await readStdinLine();
        if (!/^[yY]/.test(a.trim())) {
            console.log("aborted.");
            process.exit(0);
        }
    }
    if (!win) {
        stripRc(join(homedir(), ".bashrc"));
        stripRc(join(homedir(), ".zshrc"));
    }
    const tmp = join(tmpdir(), "anycode-uninstall." + (win ? "bat" : "sh"));
    if (win) {
        writeFileSync(
            tmp,
            `@echo off\r\ntimeout /t 2 /nobreak >nul\r\nrmdir /s /q "${ANYCODE_HOME}"\r\n`,
            "ascii"
        );
        spawn("cmd", ["/c", tmp], { detached: true, stdio: "ignore" }).unref();
    } else {
        writeFileSync(
            tmp,
            `#!/bin/sh\nsleep 1\nrm -rf "${ANYCODE_HOME}"\n`,
            "utf8"
        );
        spawn("sh", [tmp], { detached: true, stdio: "ignore" }).unref();
    }
    console.log(">> anycode uninstalled (" + ANYCODE_HOME + " removed).");
    if (win) {
        console.log("   Note: the anycode entry in User PATH may remain; remove it manually if needed.");
    }
    console.log("   Re-run the one-line install to come back.");
    process.exit(0);
}

// below runs only for `anycode web` — gate so update/uninstall/help don't fall through.
if (sub === "web") {
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
}
