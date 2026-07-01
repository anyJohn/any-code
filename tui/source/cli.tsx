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
    --api-key     OpenAI API key
    --base-url    API base URL
    --model       Model name
    --resume      Resume a session by id
    --continue    Resume the most recent session
    --sessions    List sessions for the current project and exit

  Examples
    $ anycode
    $ anycode --continue
    $ anycode --resume=a1b2c3d4
    $ anycode --sessions
    $ anycode --api-key=sk-xxx --base-url=https://api.openai.com/v1
`,
    {
        importMeta: import.meta,
        argv,
        flags: {
            apiKey: {
                type: "string",
            },
            baseUrl: {
                type: "string",
            },
            model: {
                type: "string",
            },
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

    render(
        <App
            apiKey={cli.flags.apiKey}
            baseUrl={cli.flags.baseUrl}
            model={cli.flags.model}
            sessionId={sessionId}
        />
    );
}

main();
