import { loadMemory } from "./memory";
import {
    AgentEvent,
    ChatMessage,
    serializeError,
} from "./type";
import { agentLoop } from "./core";
import { compactMessages } from "./compact";
import { loadRule } from "./rule";
import { resolveSkills, renderSkillCatalog } from "./skill";
// 注册内置连接器能力（FE-022）：import 副作用——registry 常驻，Settings/initMcp 可枚举
import "./builtin";
import { seedBuiltinSkills } from "./seed";
import { EventStream } from "./eventStream";
import {
    SessionService,
    Session,
    SessionKey,
    projectKeyOf,
    DEFAULT_TITLE,
} from "./session";
import { createWorkspace, Workspace } from "./workspace";
import { mainAgent } from "./agent";
import type { AgentDefinition } from "./agent";
import type { Tool } from "./tools";
import { loadMcpTools, loadProjectMcp, type McpServerConfig } from "./mcp";
import { getRegisteredAbilities, isAbilityEnabled } from "./abilities";
import { Config } from "./config";
import {
    workspaceNote,
    memoryNote,
    shellNote,
    cleanSessionTitle,
} from "./prompt";
import { resolveShellKind } from "./tools/functions/bash";
import { callLLM } from "./llm";
import { detectContextWindow, resolveContextWindow } from "./config";
import {
    loadProjectPermissions,
    type PermissionContext,
    type PermissionRule,
} from "./permissions";
import {
    BehaviorSubject,
    catchError,
    concatMap,
    finalize,
    from,
    of,
    Subject,
    takeUntil,
    tap,
} from "rxjs";

interface AnyAgentOptions {
    /** 工作区根目录。Agent 的 bash cwd / 文件解析 / 配置加载都以此为锚。 */
    rootPath: string;
    sessionId?: string;
    service?: SessionService;
    /** agent 定义（instruction + tools）。默认 mainAgent。 */
    definition?: AgentDefinition;
    /** 额外工具（追加到 definition.tools 之后，如自定义 AgentTool）。 */
    extraTools?: Tool[];
}

class AnyAgent {
    pendingTasks$ = new BehaviorSubject<string[]>([]);

    private eventStream = new EventStream();
    private stop$ = new Subject<void>();
    private destroy$ = new Subject<void>();
    private task$ = new Subject<string>();
    private service: SessionService;
    private workspace: Workspace;
    private projectKey: string;
    private definition: AgentDefinition;
    private tools: Tool[];
    /** 当前任务的取消控制器。stop() 调 abort()，正在进行的 LLM 调用会抛 AbortError，
     * agentLoop 在迭代边界捕获后返回，executeTask 据 signal.aborted 发 STOPPED 而非 DONE。 */
    private abortController: AbortController | null = null;
    // session 延迟到首条用户消息时才创建，避免每次启动都落盘一个空 session
    private session: Session | null = null;
    private sessionKey: SessionKey | null = null;
    // MCP 连接清理（per-agent）：create 时建连，destroy 时清理
    private mcpCleanup: (() => Promise<void>) | null = null;
    // 会话内"允许一次"权限缓存（SPEC-032 C-004：per-agent，不跨 session）
    private permissionAllowOnce = new Set<string>();
    // 当前生效的 LLM provider 配置（多 provider + 流式开关）；create 时 initConfig 从 config.yaml 加载。
    // per-request 语义下热更 = 下一次 AnyAgent.create 重读磁盘，无需 reload 机制。
    private config!: Config;

    private constructor(opts: AnyAgentOptions) {
        this.service = opts.service ?? new SessionService();
        this.workspace = createWorkspace(opts.rootPath);
        this.projectKey = projectKeyOf(this.workspace.rootPath);
        this.definition = opts.definition ?? mainAgent;
        this.tools = [...this.definition.tools, ...(opts.extraTools ?? [])];
        // 内置技能 seed（首启部署）：随包技能目录 → ~/.anycode/skills/，幂等（已有跳过）。
        // 落地即普通全局技能，进入 resolveSkills 目录；用户可改、项目层可覆盖。
        const seeded = seedBuiltinSkills();
        if (seeded.length) {
            console.info(`[Seed] 内置技能已就位：${seeded.join(", ")}`);
        }
        this.initProcessor();
    }

    /** 异步工厂：构造 +（若给定 sessionId）恢复历史 session。无 sessionId 时不创建，等首条消息。 */
    static async create(opts: AnyAgentOptions): Promise<AnyAgent> {
        const agent = new AnyAgent(opts);
        await agent.initSession(opts.sessionId);
        await agent.initConfig();
        await agent.initMcp();
        return agent;
    }

    /** 加载配置（全局 ~/.anycode/config.yaml），探测当前 provider 真实 context window，
     *  与用户配置取 min 写回（resolved）。maxOutputTokens 不探测/不 resolve——纯用户配置，
     *  callLLM 直接用（配则传 max_tokens，不配则不传，provider 默认）。SPEC-019 B-004 / SPEC-023。 */
    private async initConfig(): Promise<void> {
        this.config = Config.load();
        const provider = this.config.getCurrentProvider();
        const ctx = await detectContextWindow(provider);
        provider.contextWindow = resolveContextWindow(provider, ctx);
    }

    /** 加载 MCP 工具（真协议连接），追加到工具集，per-agent 生命周期绑定。 */
    private async initMcp(): Promise<void> {
        try {
            // 三层合并（SPEC-031 B-007，整条覆盖：后层整条替换低层同名）：
            //   内置连接器（启用的 kind:mcp abilities，最低） < 全局 config.mcpServers < 项目 mcp.yaml
            const builtinMcp: Record<string, McpServerConfig> = {};
            for (const a of getRegisteredAbilities()) {
                if (
                    a.kind !== "mcp" ||
                    !isAbilityEnabled(this.config, a.name)
                ) {
                    continue;
                }
                // 能力私有 config（provider/apiKey 等）以 ABILITY_CONFIG JSON 注入 server env
                const extra = this.config.abilities[a.name]?.config ?? {};
                builtinMcp[a.name] =
                    a.server.type === "stdio" && Object.keys(extra).length
                        ? {
                              ...a.server,
                              env: {
                                  ...a.server.env,
                                  ABILITY_CONFIG: JSON.stringify(extra),
                              },
                          }
                        : a.server;
            }
            const merged = {
                ...builtinMcp,
                ...this.config.mcpServers,
                ...loadProjectMcp(this.workspace),
            };
            const mcp = await loadMcpTools(merged);
            if (mcp.tools.length) this.tools = [...this.tools, ...mcp.tools];
            this.mcpCleanup = mcp.cleanup;
        } catch (err) {
            // MCP 加载失败不阻断 agent 启动（仅内置工具）
            console.error("[MCP] loadMcpTools failed:", err);
            this.mcpCleanup = null;
        }
    }

    private async initSession(sessionId?: string) {
        if (!sessionId) return;
        const session = await this.service.resume(this.projectKey, sessionId);
        if (session) {
            this.session = session;
            this.sessionKey = {
                projectKey: this.projectKey,
                sessionId: session.id,
            };
        } else {
            this.eventStream.submit({
                type: "System",
                message: `Session ${sessionId} not found. Send a message to start a new one.`,
            });
        }
    }

    /** 首条消息时按需创建 session（占位标题，命名由 generateSessionTitle 异步完成） */
    private async ensureSession(): Promise<void> {
        if (this.session && this.sessionKey) return;
        const session = await this.service.create(this.projectKey, DEFAULT_TITLE);
        this.session = session;
        this.sessionKey = {
            projectKey: this.projectKey,
            sessionId: session.id,
        };
    }

    get eventHistory$() {
        return this.eventStream.history$;
    }

    /**
     * 首条任务用 LLM 起简短会话名（独立短 LLM 调用，不阻塞 agentLoop、不进事件流）。
     * 仅默认标题（"New Session"）才起；独立 8s 超时（不绑 agentLoop abort——用户停任务/destroy
     * 不应中止起名，落盘后下次 reload 仍可见）；失败回退任务文本截断。只落盘，不发事件。
     */
    private async generateSessionTitle(
        task: string,
        sessionKey: SessionKey,
        session: Session
    ): Promise<void> {
        if (session.title && session.title !== DEFAULT_TITLE) return;
        if (!task.trim()) return;
        const fallback = task.trim().slice(0, 40);
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 8000);
        let title = fallback;
        try {
            const res = await callLLM(
                [
                    {
                        role: "system",
                        content:
                            "Generate a concise session title (≤12 characters, same language as the user task). Output ONLY the title text — no quotes, no punctuation, no explanation.",
                    },
                    { role: "user", content: task.slice(0, 500) },
                ],
                { max_tokens: 24, temperature: 0.3, tools: undefined },
                ac.signal,
                undefined,
                this.config.getCurrentProvider()
            );
            const cleaned = cleanSessionTitle(res.content ?? "");
            if (cleaned) title = cleaned;
        } catch {
            // 超时/网络/模型错误（含 401/400）：回退任务文本截断
        } finally {
            clearTimeout(timer);
        }
        session.title = title;
        try {
            await this.service.setTitle(sessionKey, title);
        } catch {
            // 落盘失败不阻断——内存 title 已设
        }
    }

    get eventStream$() {
        return this.eventStream.event$;
    }

    getSession(): Session | null {
        return this.session;
    }

    getService(): SessionService {
        return this.service;
    }

    getProjectKey(): string {
        return this.projectKey;
    }

    stop() {
        // 1) abort 当前 LLM 调用（真正中断推理，不只是断 rxjs 订阅）
        this.abortController?.abort();
        // 2) 断外层管线订阅（兼容旧路径 + finalize 清 pending）
        this.stop$.next();
    }

    /**
     * 彻底销毁 agent：中断当前任务 + 解绑 task$ 订阅 + complete stop$。
     * 切换 session / 工作区时调用，避免旧 agent 的 rxjs 订阅泄漏、阻止被 GC。
     */
    destroy() {
        // 先 abort 在途 LLM 调用（真正中断推理），再拆订阅——使"关连接=真停"语义闭合。
        // web 目标C：客户端断开 → handler 调 destroy() → 在途 LLM 立即停，不在后台继续跑。
        this.abortController?.abort();
        // 断外层管线订阅（兼容旧路径 + finalize 清 pending）
        this.stop$.next();
        this.stop$.complete();
        this.destroy$.next();
        this.destroy$.complete();
        // per-agent eventStream，切换时清空释放内存
        this.eventStream.clear();
        // MCP 连接清理（per-agent）：kill stdio 子进程 / 关 SSE 连接
        this.mcpCleanup?.().catch(() => {});
        this.mcpCleanup = null;
    }

    submit(task: string) {
        this.task$.next(task);
    }

    /**
     * 手动压缩当前 session 上下文：旧消息→一条摘要 + 保留尾部原文。
     * 压缩后整体重写 session.jsonl（保留 title/createdAt）。返回压缩前后 token 数。
     * 与 submit 驱动的 agentLoop 自动压缩共用 compactMessages，仅触发方式不同（手动 vs 75% 阈值）。
     */
    async compact(focus?: string): Promise<{
        beforeTokens: number;
        afterTokens: number;
        compacted: boolean;
    }> {
        const session = this.session;
        const sessionKey = this.sessionKey;
        if (!session || !sessionKey) {
            throw new Error("compact 需要已存在的 session");
        }
        // compactMessages 保护 messages[0]=system；先确保 [0] 是 system（executeTask 每任务重建，此处补以防未跑过任务）
        this.ensureSystemHead(session.messages);
        const res = await compactMessages(
            session.messages,
            this.config.getCurrentProvider(),
            focus != null ? { focus } : undefined
        );
        if (res.compacted) {
            session.messages.length = 0;
            session.messages.push(...res.messages);
            await this.service.replaceMessages(sessionKey, res.messages);
            this.eventStream.submit({
                type: "Compact",
                message: `已压缩上下文 ${res.beforeTokens}→${res.afterTokens} tokens`,
                data: {
                    beforeTokens: res.beforeTokens,
                    afterTokens: res.afterTokens,
                    auto: false,
                    focus: focus ?? null,
                },
            });
        }
        return {
            beforeTokens: res.beforeTokens,
            afterTokens: res.afterTokens,
            compacted: res.compacted,
        };
    }

    private initProcessor() {
        this.task$
            .pipe(
                tap((task) => {
                    const currentTasks = this.pendingTasks$.getValue();
                    this.pendingTasks$.next([...currentTasks, task]);
                }),
                concatMap((task: string) => {
                    return from(this.executeTask(task)).pipe(
                        takeUntil(this.stop$),
                        catchError((err) => {
                            console.error("Error processing task:", err);
                            // domain 发出即 plain ErrorPayload（serializeError），raw Error 不离开内核；
                            // live==persisted by construction，adapter 不再 replacer（SPEC-030 B-002/I-001）。
                            this.eventStream.submit({
                                type: "Error",
                                message: `Error executing task: ${task}`,
                                error: serializeError(err),
                            });
                            return of(null);
                        }),
                        finalize(() => {
                            const [, ...remaining] =
                                this.pendingTasks$.getValue();
                            this.pendingTasks$.next(remaining);
                        })
                    );
                }),
                takeUntil(this.destroy$)
            )
            .subscribe();
    }

    private async executeTask(task: string) {
        // 首条消息时创建 session（延迟创建，避免空 session 落盘）
        await this.ensureSession();
        const session = this.session!;
        const sessionKey = this.sessionKey!;

        // 重建 system prompt 放 messages[0]（不入盘，每次保持最新）
        this.ensureSystemHead(session.messages);

        const onMessage = (msg: ChatMessage) =>
            this.service.appendMessage(sessionKey, msg);
        // 每个任务一个独立的 AbortController，stop() abort 它
        const abortController = new AbortController();
        this.abortController = abortController;
        // 首条任务异步用 LLM 起会话名（独立短调用，不阻塞 agentLoop、不进事件流；只落盘）
        void this.generateSessionTitle(task, sessionKey, session);
        const ctx = {
            workspace: this.workspace,
            eventStream: this.eventStream,
            signal: abortController.signal,
            llm: this.config.getCurrentProvider(),
            fileState: new Map<string, number>(),
            gitBashPath: this.config.gitBashPath,
            // 技能目录合并表：use_skill 工具按 name 取全文（SPEC-031 B-005）
            skills: resolveSkills(this.workspace),
            permissions: this.buildPermissionContext(),
        };
        await agentLoop(
            task,
            session.messages,
            this.definition.maxIterations,
            {},
            onMessage,
            ctx,
            this.tools,
            // 自动压缩落盘：agentLoop 原地替换 messages 后回调重写 session.jsonl
            async (msgs) => this.service.replaceMessages(sessionKey, msgs)
        );
        this.abortController = null;
        // 终态信号：被 stop 中断 → STOPPED（前端显示"已停止任务"）；否则 DONE。
        // Error 由 catchError 发 ERROR，前端同样解除 pending。
        if (abortController.signal.aborted) {
            this.eventStream.submit({
                type: "Stopped",
                message: "已停止任务",
            });
        } else {
            this.eventStream.submit({
                type: "Done",
                message: `任务完成`,
            });
        }
    }

    /** 构建 per-task 权限上下文（SPEC-032）：全局 config + 项目级 rules 合并（项目在后，
     *  后匹配覆盖）；会话缓存跨任务共享。项目规则损坏 → Warning + 仅全局规则（C-003，AC-009）。 */
    private buildPermissionContext(): PermissionContext {
        const cfg = this.config.permissions;
        let projectRules: PermissionRule[] = [];
        try {
            projectRules = loadProjectPermissions(this.workspace);
        } catch (err) {
            this.eventStream.submit({
                type: "Warning",
                message: `项目级权限规则加载失败，已忽略（仅用全局规则）：${
                    err instanceof Error ? err.message : String(err)
                }`,
            });
        }
        return {
            mode: cfg.mode,
            rules: [...cfg.rules, ...projectRules],
            dangerPatterns: cfg.dangerPatterns,
            allowOnce: this.permissionAllowOnce,
        };
    }

    /** 确保 messages[0] 是最新 system prompt（compact 与 executeTask 共用的前置保障） */
    private ensureSystemHead(messages: ChatMessage[]): void {
        const sys = this.getSystemMessage(this.workspace);
        if (messages[0]?.role === "system") {
            messages[0] = sys[0];
        } else {
            messages.unshift(sys[0]);
        }
    }

    private getSystemMessage(workspace: Workspace): ChatMessage[] {
        const memory = loadMemory(workspace);
        const rule = loadRule(workspace);
        // 技能目录注入（SPEC-031 B-004）：只注入 name+description 的 <available_skills>，不加正文。
        const skills = renderSkillCatalog(resolveSkills(workspace).values());
        // 拼装 system prompt：instruction + workspace/memory 注入段 + memory/skills/rule。
        // 所有 prompt 文本集中存于 ./prompt.ts，此处只拼装。
        let sysPrompt =
            this.definition.instruction + workspaceNote(workspace.rootPath);
        if (memory) {
            sysPrompt += memory;
        }
        sysPrompt += memoryNote;
        // shell 兼容性提示（Windows busybox/git-bash 告知 LLM 命令边界；unix 静默）
        sysPrompt += shellNote(resolveShellKind(this.config.gitBashPath));
        if (skills) {
            sysPrompt += skills;
        }
        if (rule) {
            sysPrompt += rule;
        }
        return [
            {
                role: "system",
                content: sysPrompt,
            },
        ];
    }
}

export { AnyAgent };
export * from "./type";
