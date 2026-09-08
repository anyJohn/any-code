import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";

export interface CommandItem {
    name: string;
    desc: string;
    body?: string;
    /** true = 技能指令（/skill_name，弹层分组在 Skills 标题下） */
    skill?: boolean;
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
    { name: "init", desc: "command.initDesc" },
];

// /init 的任务文本：让 agent 分析代码库生成 <root>/AGENTS.md（规则加载已支持，即刻生效）
const INIT_TASK = [
    "请分析这个代码库，为 agent 协作生成 AGENTS.md 规则文件，写入当前工作区根目录。",
    "内容包含：",
    "1. 项目概述（一句话说清是什么）",
    "2. 常用命令（构建 / 测试 / 类型检查 / 运行，逐条给出可复制执行的命令）",
    "3. 架构要点（关键模块与数据流，简明）",
    "4. 代码约定（语言风格、命名、目录规则、提交规范等，以现有代码为准归纳）",
    "要求：只写当前事实，不写修订记录；已有 AGENTS.md 则在其基础上补充完善，不要盲目覆盖。",
].join("\n");

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
    const [skillCommands, setSkillCommands] = useState<CommandItem[]>([]);
    const [draft, setDraft] = useState("");
    // /compact 进行中（调摘要 LLM 数秒）：驱动进度条（阶段 + 流式已生成计数）
    const [compacting, setCompacting] = useState(false);
    const [compactProgress, setCompactProgress] = useState<{
        phase: "preparing" | "summarizing" | "persisting";
        generatedTokens?: number;
    } | null>(null);

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

    // 已安装技能以 /<name> 暴露为斜杠指令，desc = 技能描述
    useEffect(() => {
        if (!projectKey) return;
        let cancelled = false;
        apiJson<{ name: string; description: string; content: string }[]>(
            `/api/workspaces/${projectKey}/skills`
        ).then((list) => {
            if (cancelled) return;
            setSkillCommands(
                (list ?? []).map((s) => ({
                    name: s.name,
                    desc: s.description,
                    body: s.content,
                    skill: true,
                }))
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
            ...skillCommands,
        ],
        [t, customCommands, skillCommands]
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
                case "init":
                    submit(INIT_TASK);
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
                    setCompactProgress({ phase: "preparing" });
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
                        if (!res.ok || !res.body) {
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
                            return;
                        }
                        // SSE 帧：progress（阶段+计数）→ result（终态）
                        const reader = res.body.getReader();
                        const dec = new TextDecoder();
                        let buf = "";
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            buf += dec.decode(value, { stream: true });
                            let idx;
                            while ((idx = buf.indexOf("\n\n")) !== -1) {
                                const frame = buf.slice(0, idx);
                                buf = buf.slice(idx + 2);
                                for (const line of frame.split("\n")) {
                                    if (!line.startsWith("data:")) continue;
                                    try {
                                        const f = JSON.parse(
                                            line.slice(5).trim()
                                        ) as {
                                            type?: string;
                                            phase?: "preparing" | "summarizing" | "persisting";
                                            generatedTokens?: number;
                                            beforeTokens?: number;
                                            afterTokens?: number;
                                            compacted?: boolean;
                                            text?: string;
                                        };
                                        if (f.type === "progress") {
                                            setCompactProgress({
                                                phase: f.phase ?? "preparing",
                                                generatedTokens: f.generatedTokens,
                                            });
                                        } else if (f.type === "result") {
                                            appendSystem(
                                                f.compacted
                                                    ? t("command.compacted", {
                                                          before: f.beforeTokens ?? 0,
                                                          after: f.afterTokens ?? 0,
                                                      })
                                                    : t("command.compactNotNeeded")
                                            );
                                        } else if (f.type === "error") {
                                            appendSystem(
                                                f.text ?? t("command.compactFailed")
                                            );
                                        }
                                    } catch {
                                        // 损坏帧跳过
                                    }
                                }
                            }
                        }
                    } finally {
                        setCompacting(false);
                        setCompactProgress(null);
                    }
                    return;
                }
                default: {
                    // 技能指令：正文展开注入 + 参数追加（业界 /skill 语义）
                    const skill = skillCommands.find((c) => c.name === name);
                    if (skill && skill.body != null) {
                        // 首行 "/name args" 是渲染标记（UserBubble 显示徽标）；
                        // trim：server 会 trim 任务，须与回显一致（去重依赖）
                        submit(
                            `/${name}${args ? ` ${args}` : ""}\n\n${skill.body}`.trim()
                        );
                        return;
                    }
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
            skillCommands,
            submit,
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
        compactProgress,
    };
}
