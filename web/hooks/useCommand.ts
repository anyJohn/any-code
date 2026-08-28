import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "@/lib/api";

export interface CommandItem {
    name: string;
    desc: string;
    body?: string;
}

export const BUILTIN_COMMANDS: CommandItem[] = [
    { name: "clear", desc: "清空当前对话" },
    { name: "new", desc: "新建对话" },
    { name: "help", desc: "列出所有指令" },
    { name: "config", desc: "打开设置" },
    { name: "model", desc: "查看/切换模型（/model <id>）" },
    { name: "provider", desc: "查看/切换 provider（/provider <name>）" },
    { name: "sessions", desc: "列出最近会话" },
    { name: "compact", desc: "压缩上下文（/compact [聚焦]）" },
];

interface UseCommandDeps {
    clear: () => void;
    appendSystem: (msg: string) => void;
    submit: (msg: string) => void;
    projectKey?: string;
    rootPath: string;
    currentSessionId: string | null;
}

/**
 * 斜杠命令 hook：拉取自定义命令、过滤、执行。
 * draft 是受控的：本 hook 不持有 draft，由调用方传入。
 * runCommand(name) 从 draft 提取 args，清空 draft 后执行。
 */
export function useCommand({ clear, appendSystem, submit, projectKey, rootPath, currentSessionId }: UseCommandDeps) {
    const navigate = useNavigate();
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
                (list ?? []).map((c) => ({ name: c.name, desc: "自定义", body: c.body }))
            );
        });
        return () => {
            cancelled = true;
        };
    }, [projectKey]);

    const commandList = useMemo<CommandItem[]>(
        () => [...BUILTIN_COMMANDS, ...customCommands],
        [customCommands]
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
        const lines = BUILTIN_COMMANDS.map((c) => `/${c.name} — ${c.desc}`);
        if (customCommands.length) {
            lines.push("", "自定义:");
            lines.push(...customCommands.map((c) => `/${c.name}`));
        }
        return lines.join("\n");
    }, [customCommands]);

    // 执行斜杠指令：name=命令名（无 /），args=首个空格之后的参数串
    const executeCommand = useCallback(
        async (name: string, args: string) => {
            switch (name) {
                case "clear":
                    clear();
                    appendSystem("已清空对话");
                    return;
                case "new":
                    navigate("/chat/new");
                    return;
                case "config":
                    navigate("/settings");
                    return;
                case "help":
                    appendSystem(buildHelpText());
                    return;
                case "model":
                    if (!projectKey) {
                        appendSystem("未选择工作区");
                        return;
                    }
                    if (!args) {
                        const [st, cfg] = await Promise.all([
                            apiJson<{
                                provider: string;
                                model: string;
                                modelName: string;
                            }>(`/api/workspaces/${projectKey}/status`),
                            apiJson<{
                                providers: Record<
                                    string,
                                    { models: { id: string; name?: string }[] }
                                >;
                                default: string;
                            }>(`/api/config`),
                        ]);
                        if (!st) {
                            appendSystem("无法获取当前模型");
                            return;
                        }
                        const lines: string[] = [
                            `当前: ${st.provider} / ${st.modelName} (${st.model})`,
                        ];
                        const provider = cfg?.providers[cfg.default];
                        if (provider?.models.length) {
                            lines.push("", "可选模型:");
                            for (const m of provider.models) {
                                lines.push(
                                    `  ${m.id}${m.name ? ` (${m.name})` : ""}`
                                );
                            }
                        }
                        appendSystem(lines.join("\n"));
                    } else {
                        const res = await fetch(`/api/config`, {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ modelId: args }),
                        });
                        if (res.ok) {
                            appendSystem(`已切到模型 ${args}（下次对话生效）`);
                        } else {
                            let text = "切换失败";
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
                    }
                    return;
                case "provider":
                    if (!projectKey) {
                        appendSystem("未选择工作区");
                        return;
                    }
                    if (!args) {
                        const data = await apiJson<{ provider: string }>(
                            `/api/workspaces/${projectKey}/status`
                        );
                        if (data) {
                            appendSystem(`当前 provider: ${data.provider}`);
                        } else {
                            appendSystem("无法获取当前 provider");
                        }
                    } else {
                        const res = await fetch(`/api/config`, {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ default: args }),
                        });
                        if (res.ok) {
                            appendSystem(`已切到 provider ${args}（下次对话生效）`);
                        } else {
                            let text = "切换失败";
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
                    }
                    return;
                case "sessions":
                    if (!projectKey) {
                        appendSystem("未选择工作区");
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
                            appendSystem("会话列表:\n" + lines.join("\n"));
                        } else {
                            appendSystem("暂无会话");
                        }
                    }
                    return;
                case "compact": {
                    if (!currentSessionId) {
                        appendSystem("无会话历史可压缩");
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
                                    ? `已压缩上下文 ${r.beforeTokens}→${r.afterTokens} tokens`
                                    : "无可压缩内容（上下文已足够短）"
                            );
                        } else {
                            let text = "压缩失败";
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
                        appendSystem("未知指令: " + name);
                    }
                }
            }
        },
        [
            clear,
            appendSystem,
            navigate,
            projectKey,
            rootPath,
            currentSessionId,
            customCommands,
            submit,
            buildHelpText,
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
