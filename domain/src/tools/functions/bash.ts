import { promisify } from "util";
import { exec } from "child_process";
import { EventStream } from "../../eventStream";
import { EventType } from "../../type";
import type { Workspace } from "../../workspace";

const eventStream = EventStream.getInstance();

interface ExecuteBashArgs {
    command: string;
}

/** exec 默认 maxBuffer 1MB、无超时。长命令/挂起命令（tail -f、等待 stdin）会永久阻塞 agentLoop */
const execAsync = promisify(exec);
const BASH_TIMEOUT_MS = 120_000;
const BASH_MAX_BUFFER = 10 * 1024 * 1024;

export const executeBashFunc = async (
    args: ExecuteBashArgs,
    workspace: Workspace
): Promise<string> => {
    try {
        eventStream.submit({
            type: EventType.TOOL,
            message: `Executing bash command`,
            data: { command: args.command, cwd: workspace.rootPath },
        });
        // cwd 锚定到 workspace 根：agent 说"跑测试"天然落在项目里。
        // 这是上下文锚定，不是安全隔离——bash 能力极大，安全交给将来的 Permission。
        const { stdout, stderr } = await execAsync(args.command, {
            cwd: workspace.rootPath,
            timeout: BASH_TIMEOUT_MS,
            maxBuffer: BASH_MAX_BUFFER,
        });
        return stdout + stderr;
    } catch (error) {
        // 非零退出码（grep 无匹配、ls 目标不存在等）也会走这里，
        // exec 抛出的 error 携带 stdout/stderr/code —— 不能丢弃，否则 agent 看不到有用输出
        const e = error as {
            stdout?: string;
            stderr?: string;
            code?: number | string;
            message?: string;
            signal?: string;
        };
        const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
        if (out) {
            return e.signal === "SIGTERM"
                ? `[Timed out after ${BASH_TIMEOUT_MS}ms]\n${out}`
                : out;
        }
        return `Error: ${e.message ?? String(error)}`;
    }
};
