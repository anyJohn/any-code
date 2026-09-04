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
import { Tool, filterEnabledTools } from "./tools";
import { loadMcpTools, loadProjectMcp, type McpServerConfig } from "./mcp";
import { Config } from "./config";
import { applyProxyConfig } from "./netProxy";
import {
    workspaceNote,
    memoryNote,
    shellNote,
    cleanSessionTitle,
    systemFingerprint,
} from "./prompt";
import { resolveShellKind } from "./shell";
import { callLLM } from "./llm";
import { detectContextWindow, resolveContextWindow } from "./config";
import {
    loadProjectPermissions,
    type PermissionContext,
    type PermissionRule,
} from "./permissions";
import { createSnapshotService } from "./snapshot";
import { loadWorkspaceExtensions, type ExtensionHooks } from "./extensions";
import { JobRegistry } from "./jobs";
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
    // 工作区快照服务（AR-4）：per-agent，写类工具执行前自动快照
    private snapshots: ReturnType<typeof createSnapshotService>;
    // bash 后台任务注册表（FR-13）：per-agent，destroy 时 killAll
    private jobRegistry = new JobRegistry();
    // 项目扩展（AR-16）：自定义工具 + 生命周期钩子
    private extensionTools: Tool[] = [];
    private extensionHooks: ExtensionHooks = {};

    /** AR-23：已确认落盘的消息身份集（onMessage / 压缩回调 / resume 标记；不变式断言用） */
    private loggedMessages = new WeakSet<object>();
    /** AR-23：上次写入日志的 system prompt 指纹（装配结果变化才写新条目） */
    private lastSysFp: string | undefined;
    // 当前生效的 LLM provider 配置（多 provider + 流式开关）；create 时 initConfig 从 config.yaml 加载。
    // per-request 语义下热更 = 下一次 AnyAgent.create 重读磁盘，无需 reload 机制。
    private config!: Config;

    private constructor(opts: AnyAgentOptions) {
        this.service = opts.service ?? new SessionService();
        this.workspace = createWorkspace(opts.rootPath);
        // AR-4：快照服务（git 解析带 gitBashPath 提示；exclude 对齐 workspace ignore）
        this.snapshots = createSnapshotService(
            opts.rootPath,
            this.workspace.ignoredPatterns,
            this.config?.gitBashPath
        );
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
        // 全局出网代理（用户决策 2026-09-03）：config.proxy > 环境变量；幂等（key 不变不重建）
        applyProxyConfig(this.config.proxy, this.config.noProxy);
        const provider = this.config.getCurrentProvider();
        const ctx = await detectContextWindow(provider);
        provider.contextWindow = resolveContextWindow(provider, ctx);
        // gitBashPath 就绪后重建快照服务（git 二进制解析需要提示；AR-4）
        this.snapshots = createSnapshotService(
            this.workspace.rootPath,
            this.workspace.ignoredPatterns,
            this.config.gitBashPath
        );
        // AR-16：加载项目扩展（自定义工具 + 钩子）；保留名 = 当前工具集 + plan
        const reserved = new Set(
            [...this.tools].map(
                (t) => (t.schema as { function?: { name?: string } }).function?.name ?? ""
            )
        );
        const ext = await loadWorkspaceExtensions(this.workspace, reserved);
        this.extensionTools = ext.tools;
        this.extensionHooks = ext.hooks;
        if (ext.tools.length) {
            this.tools = [...this.tools, ...ext.tools];
        }
        for (const w of ext.warnings) {
            this.eventStream.submit({ type: "Warning", message: w });
        }
        // 通用工具开关（用户决策 2026-09-03）：enabled=false 的工具从注册表剔除；
        // toolsConfig 注入 ctx 供 handler 读取私有配置。ext.tools 在过滤前并入，同样受开关约束。
        this.tools = filterEnabledTools(this.tools, this.config.tools);
    }

    /** 加载 MCP 工具（真协议连接），追加到工具集，per-agent 生命周期绑定。 */
    private async initMcp(): Promise<void> {
        try {
            const merged = {
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
            // AR-23：resume 出来的消息全部视为已落盘（日志即真值）
            for (const m of session.messages) {
                this.loggedMessages.add(m as unknown as object);
            }
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
        // FR-13：终止全部后台任务（不留孤儿进程）
        this.jobRegistry.killAll();
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
            // AR-23：压缩产物（摘要消息等）视为已落盘
            for (const m of res.messages) this.loggedMessages.add(m as unknown as object);
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
        // AR-23：system prompt 指纹——动态装配内容不入盘，哈希留日志作审计锚点
        const sysFp = systemFingerprint(
            (session.messages[0]?.content as string) ?? ""
        );
        if (sysFp !== this.lastSysFp) {
            this.lastSysFp = sysFp;
            try {
                await this.service.appendSysFp(sessionKey, {
                    hash: sysFp,
                    model: this.config.getCurrentProvider().defaultModel,
                });
            } catch {
                // 指纹写入失败不阻断任务
            }
        }

        // AR-23：onMessage 标记"已落盘"身份（断言用）；onMessage 失败仍标记？
        // 标记语义 = "已确认落盘"——appendMessage 抛错时不应标记，让断言能捕获。
        const seen = this.loggedMessages;
        const onMessage = async (msg: ChatMessage) => {
            await this.service.appendMessage(sessionKey, msg);
            seen.add(msg as unknown as object);
        };
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
            // FR-11：provider 表供 sub-agent 定义覆盖（def.provider/def.model）
            providers: this.config.providers,
            // FR-13：bash 后台任务注册表
            jobs: this.jobRegistry,
            // AR-16：项目生命周期钩子
            hooks: this.extensionHooks,
            // 通用工具私有配置（用户决策 2026-09-03）：web_search provider/apiKey、browser_* cdpUrl 等
            toolsConfig: this.config.tools
                ? Object.fromEntries(
                      Object.entries(this.config.tools)
                          .filter(([, e]) => e.config && typeof e.config === "object")
                          .map(([k, e]) => [k, e.config as Record<string, unknown>])
                  )
                : undefined,
            // AR-23：日志不变式断言（seen 由 onMessage/压缩/resume 标记）
            logInvariant: { seen: this.loggedMessages },
            // AR-4：写类工具执行前自动快照（label 带会话锚点）
            snapshot: {
                snapshot: async (label: string) =>
                    this.snapshots.snapshot(
                        `session ${this.session?.id ?? "-"} | ${label}`
                    ),
            },
        };
        await agentLoop(
            task,
            session.messages,
            this.definition.maxIterations,
            {},
            onMessage,
            ctx,
            this.tools,
            // 自动压缩落盘：agentLoop 原地替换 messages 后回调重写 session.jsonl（AR-23：并标记已落盘）
            async (msgs) => {
                await this.service.replaceMessages(sessionKey, msgs);
                for (const m of msgs) {
                    this.loggedMessages.add(m as unknown as object);
                }
            }
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
        // AR-7：只读集合从工具元数据推导（MCP/无 meta 工具不在集合内 = 保守 ask）
        const readOnlyTools = new Set(
            this.tools
                .filter((t) => t.meta?.readOnly === true)
                .map((t) => (t.schema as { function?: { name: string } }).function?.name ?? "")
                .filter(Boolean)
        );
        return {
            mode: cfg.mode,
            rules: [...cfg.rules, ...projectRules],
            dangerPatterns: cfg.dangerPatterns,
            readOnlyTools,
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
