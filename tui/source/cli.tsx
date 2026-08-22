import React from "react";
import { render } from "ink";
import meow from "meow";
import App from "./components/App.js";
import { SessionService, projectKeyOf } from "@any-code/domain";

// pnpm 透传 `pnpm <script> -- <flags>` 会带前导 `--`，meow 会把后续 flag 当成 positional，
// 去掉前导 `--` 让 flag 正常解析
const rawArgv = process.argv.slice(2);
const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;

const cli = meow(
    `
  Usage
    $ anycode

  Options
    --resume      Resume a session by id
    --continue    Resume the most recent session
    --sessions    List sessions for the current project and exit

  Examples
    $ anycode
    $ anycode --continue
    $ anycode --resume=a1b2c3d4
    $ anycode --sessions
`,
    {
        importMeta: import.meta,
        argv,
        flags: {
            resume: {
                type: "string",
            },
            continue: {
                type: "boolean",
            },
            sessions: {
                type: "boolean",
            },
        },
    }
);

async function main() {
    const projectKey = projectKeyOf(process.cwd());
    const service = new SessionService();

    if (cli.flags.sessions) {
        const metas = await service.list(projectKey);
        if (metas.length === 0) {
            console.log("No sessions found for this project.");
        } else {
            console.log("Sessions:");
            for (const m of metas) {
                const when = new Date(m.updatedAt).toLocaleString();
                console.log(`  ${m.id}  ${m.title}  ${when}`);
            }
        }
        process.exit(0);
    }

    let sessionId: string | undefined;
    if (cli.flags.resume) {
        sessionId = cli.flags.resume;
    } else if (cli.flags.continue) {
        const recent = await service.continueRecent(projectKey);
        if (recent) {
            sessionId = recent.id;
        } else {
            console.log("No previous session to continue, starting a new one.");
        }
    }

    // 切换 session 时必须 unmount 旧 Ink 实例 + 清屏 + 重新 render：
    // Ink 的 fullStaticOutput 在同一实例内是 append-only，<Static> 已写入终端 scrollback
    // 的旧 session 消息，Ink 自身无法清除（unmount 只清 live region）。必须显式发
    // clearTerminal 转义码擦屏幕+scrollback，再重建实例，新 session 对话才干净显示。
    let inkInstance: { unmount: () => void } | undefined;
    const startApp = (sid?: string) => {
        if (inkInstance) {
            inkInstance.unmount();
            // \x1B[2J 擦屏幕 / \x1B[3J 擦 scrollback / \x1B[H 光标归位
            process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
        }
        inkInstance = render(
            <App sessionId={sid} onSwitchSession={startApp} />
        );
    };
    startApp(sessionId);
}

main();
