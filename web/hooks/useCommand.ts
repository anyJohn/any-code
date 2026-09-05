import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";

export interface CommandItem {
    name: string;
    desc: string;
    body?: string;
}

// desc 存 i18n key（command.*）：useCommand 内经 t() 渲染成当前语言文案
// web 自持命令清单（用户决策 2026-09-04：命令定义归各 interface，domain 只持有方法）。
// model/provider 切换改为输入框左下角 ModelPicker（不再是斜杠命令）；/clear 与 /new 重叠已删。
export const BUILTIN_COMMANDS: CommandItem[] = [
    { name: "new", desc: "command.newDesc" },
    { name: "help", desc: "command.helpDesc" },
    { name: "config", desc: "command.configDesc" },
    { name: "sessions", desc: "command.sessionsDesc" },
    { name: "compact", desc: "command.compactDesc" },
    { name: "rewind", desc: "command.rewindDesc" },
];

interface UseCommandDeps {
    appendSystem: (msg: string) => void;
    submit: (msg: string) => void;
    projectKey?: string;
    rootPath: string;
    currentSessionId: string | null;
    /** 打开快照回滚窗（AR-4 /rewind） */
    openSnapshots?: () => void;
}

/**
 * 斜杠命令 hook：拉取自定义命令、过滤、执行。
 * draft 是受控的：本 hook 不持有 draft，由调用方传入。
 * runCommand(name) 从 draft 提取 args，清空 draft 后执行。
 */
export function useCommand({ appendSystem, submit, projectKey, rootPath, currentSessionId, openSnapshots }: UseCommandDeps) {
    const navigate = useNavigate();
    const { t } = useT();
    const [customCommands, setCustomCommands] = useState<CommandItem[]>([]);
    const [draft, setDraft] = useState("");
    // /compact 进行中（调摘要 LLM 数秒）：驱动 indeterminate 进度条
    const [compacting, setCompacting] = useState(false);

    useEffect(() => {
        if (!projectKey) return;
        let cancelled = false;
        apiJson<{ name: string; body: string }[]>(
            `/api/workspaces/${projectKey}/commands`
        ).then((list) => {
            if (cancelled) return;
            setCustomCommands(
                (list ?? []).map((c) => ({ name: c.name, desc: "command.customDesc", body: c.body }))
            );
        });
        return () => {
            cancelled = true;
        };
    }, [projectKey]);

    // desc 是 i18n key：统一在此经 t() 翻译成当前语言（命令弹层 filtered 与 /help 共用）
    const commandList = useMemo<CommandItem[]>(
        () => [
            ...BUILTIN_COMMANDS.map((c) => ({ ...c, desc: t(c.desc) })),
            ...customCommands.map((c) => ({ ...c, desc: t(c.desc) })),
        ],
        [t, customCommands]
    );

    const commandMode = draft.startsWith("/");
    const query = commandMode ? draft.slice(1).split(/\s/)[0] : "";
    const filtered = useMemo(
        () =>
            commandMode
                ? commandList.filter((c) =>
                      c.name.toLowerCase().startsWith(query.toLowerCase())
                  )
                : [],
        [commandMode, commandList, query]
    );

    const buildHelpText = useCallback(() => {
        const lines = BUILTIN_COMMANDS.map((c) => `/${c.name} — ${t(c.desc)}`);
        if (customCommands.length) {
            lines.push("", t("command.helpCustomHeader"));
            lines.push(...customCommands.map((c) => `/${c.name}`));
        }
        return lines.join("\n");
    }, [customCommands, t]);

    // 执行斜杠指令：name=命令名（无 /），args=首个空格之后的参数串
    const executeCommand = useCallback(
        async (name: string, args: string) => {
            switch (name) {
                case "new":
                    navigate("/chat/new");
                    return;
                case "config":
                    navigate("/settings");
                    return;
                case "rewind":
                    if (openSnapshots) openSnapshots();
                    else appendSystem(t("command.rewindUnsupported"));
                    return;
                case "help":
                    appendSystem(buildHelpText());
                    return;
                case "sessions":
                    if (!projectKey) {
                        appendSystem(t("command.noWorkspace"));
                        return;
                    }
                    {
                        const list = await apiJson<
                            { id: string; title: string; updatedAt: number }[]
                        >(`/api/workspaces/${projectKey}/sessions`);
                        if (list && list.length) {
                            const lines = list.map(
                                (s) =>
                                    `- ${s.title} (${new Date(
                                        s.updatedAt
                                    ).toLocaleString()})`
                            );
                            appendSystem(
                                t("command.sessionList") +
                                    "\n" +
                                    lines.join("\n")
                            );
                        } else {
                            appendSystem(t("command.noSessions"));
                        }
                    }
                    return;
                case "compact": {
                    if (!currentSessionId) {
                        appendSystem(t("command.compactNoHistory"));
                        return;
                    }
                    setCompacting(true);
                    try {
                        const res = await fetch(
                            `/api/sessions/${currentSessionId}/compact`,
                            {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({
                                    workspacePath: rootPath,
                                    focus: args || undefined,
                                }),
                            }
                        );
                        if (res.ok) {
                            const r = (await res.json()) as {
                                beforeTokens: number;
                                afterTokens: number;
                                compacted: boolean;
                            };
                            appendSystem(
                                r.compacted
                                    ? t("command.compacted", {
                                          before: r.beforeTokens,
                                          after: r.afterTokens,
                                      })
                                    : t("command.compactNotNeeded")
                            );
                        } else {
                            let text = t("command.compactFailed");
                            try {
                                const j = (await res.json()) as {
                                    statusMessage?: string;
                                };
                                if (j.statusMessage) text = j.statusMessage;
                            } catch {
                                // body 非 json
                            }
                            appendSystem(text);
                        }
                    } finally {
                        setCompacting(false);
                    }
                    return;
                }
                default: {
                    const custom = customCommands.find((c) => c.name === name);
                    if (custom && custom.body != null) {
                        submit(custom.body + (args ? "\n" + args : ""));
                    } else {
                        appendSystem(t("command.unknownCommand", { name }));
                    }
                }
            }
        },
        [
            appendSystem,
            navigate,
            projectKey,
            rootPath,
            currentSessionId,
            customCommands,
            submit,
            buildHelpText,
            t,
        ]
    );

    // 从当前 draft 提取参数并执行某条命令，清空 draft
    const runCommand = useCallback(
        (name: string) => {
            const parts = draft.split(/\s+/);
            const args = parts.length > 1 ? parts.slice(1).join(" ") : "";
            setDraft("");
            void executeCommand(name, args);
        },
        [draft, executeCommand]
    );

    // 未匹配指令的 Enter 路径：从 draft 直接解析并执行
    const runRawCommand = useCallback(
        (rawDraft: string) => {
            const rest = rawDraft.slice(1).trim();
            const [name, ...argParts] = rest.split(/\s+/);
            setDraft("");
            void executeCommand(name ?? "", argParts.join(" "));
        },
        [executeCommand]
    );

    return {
        draft,
        setDraft,
        commandMode,
        query,
        filtered,
        commandOpen: commandMode && filtered.length > 0,
        customCommands,
        runCommand,
        runRawCommand,
        compacting,
    };
}
