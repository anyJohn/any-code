import { loadMemory } from "./memory";
import {
    AgentStatus,
    AgentEvent,
    ChatMessage,
    EventType,
    InteractionRequest,
} from "./type";
import { agentLoop } from "./core";
import { compactMessages } from "./compact";
import { loadRule } from "./rule";
import { loadSkills } from "./skill";
import { EventStream } from "./eventStream";
import { SessionService, Session, SessionKey, projectKeyOf } from "./session";
import { createWorkspace, Workspace } from "./workspace";
import { mainAgent } from "./agent";
import type { AgentDefinition } from "./agent";
import type { Tool } from "./tools";
import { loadMcpTools, loadProjectMcp } from "./mcp";
import { Config, type LlmProvider } from "./config";
import { workspaceNote, memoryNote } from "./prompt";
import {
    detectContextWindow,
    resolveContextWindow,
} from "./config";
import {
    BehaviorSubject,
    catchError,
    concatMap,
    finalize,
    from,
    Observable,
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
    status$: BehaviorSubject<AgentStatus> = new BehaviorSubject<AgentStatus>(
        AgentStatus.IDLE
    );
    event$: Observable<AgentEvent> = new Observable();
    pendingTasks$ = new BehaviorSubject<string[]>([]);
    interaction$ = new Subject<InteractionRequest>();

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
    // 当前生效的 LLM provider 配置（多 provider + 流式开关）；create 时 initConfig 从 config.yaml 加载，web 改配置后 reload
    private config!: Config;

    private constructor(opts: AnyAgentOptions) {
        this.service = opts.service ?? new SessionService();
        this.workspace = createWorkspace(opts.rootPath);
        this.projectKey = projectKeyOf(this.workspace.rootPath);
        this.definition = opts.definition ?? mainAgent;
        this.tools = [...this.definition.tools, ...(opts.extraTools ?? [])];
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

    /** 热更新配置：重读 config.yaml + 重新探测 context window（命中缓存则无网络）。
     *  新 default/provider 生效（下次 callLLM 用新值）。maxOutputTokens 纯用户配置不探测。 */
    async reloadConfig(): Promise<void> {
        this.config.reload();
        const provider = this.config.getCurrentProvider();
        const ctx = await detectContextWindow(provider);
        provider.contextWindow = resolveContextWindow(provider, ctx);
    }

    /** 当前生效 provider（供 web 状态面板读 model/provider） */
    getCurrentProvider(): LlmProvider {
        return this.config.getCurrentProvider();
    }

    /** 加载 MCP 工具（真协议连接），追加到工具集，per-agent 生命周期绑定。 */
    private async initMcp(): Promise<void> {
        try {
            // 合并全局 config.mcpServers + 项目 mcp.yaml（项目覆盖全局同名）
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
        } else {
            this.eventStream.submit({
                type: EventType.SYSTEM,
                message: `Session ${sessionId} not found. Send a message to start a new one.`,
            });
        }
    }

    /** 首条消息时按需创建 session 并以任务文本设标题 */
    private async ensureSession(firstTask: string): Promise<void> {
        if (this.session && this.sessionKey) return;
        const title = firstTask.trim().slice(0, 40) || "New Session";
        const session = await this.service.create(this.projectKey, title);
        this.session = session;
        this.sessionKey = {
            projectKey: this.projectKey,
            sessionId: session.id,
        };
    }

    get eventHistory$() {
        return this.eventStream.history$;
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

    getWorkspace(): Workspace {
        return this.workspace;
    }

    getTools(): Tool[] {
        return this.tools;
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
    async compact(
        focus?: string
    ): Promise<{
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
        const sys = this.getSystemMessage(this.workspace);
        if (session.messages[0]?.role === "system") {
            session.messages[0] = sys[0];
        } else {
            session.messages.unshift(sys[0]);
        }
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
                type: EventType.COMPACT,
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
                            this.eventStream.submit({
                                type: EventType.ERROR,
                                message: `Error executing task: ${task}`,
                                data: err,
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
        await this.ensureSession(task);
        const session = this.session!;
        const sessionKey = this.sessionKey!;

        // 重建 system prompt 放 messages[0]（不入盘，每次保持最新）
        const sys = this.getSystemMessage(this.workspace);
        if (session.messages[0]?.role === "system") {
            session.messages[0] = sys[0];
        } else {
            session.messages.unshift(sys[0]);
        }

        // 兼容历史空 session：首条任务自动设标题
        if (session.title === "New Session" && task) {
            session.title = task.slice(0, 40);
            await this.service.setTitle(sessionKey, session.title);
        }

        const onMessage = (msg: ChatMessage) =>
            this.service.appendMessage(sessionKey, msg);
        // 每个任务一个独立的 AbortController，stop() abort 它
        const abortController = new AbortController();
        this.abortController = abortController;
        const ctx = {
            workspace: this.workspace,
            eventStream: this.eventStream,
            signal: abortController.signal,
            llm: this.config.getCurrentProvider(),
            fileState: new Map<string, number>(),
            gitBashPath: this.config.gitBashPath,
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
            async (msgs) =>
                this.service.replaceMessages(sessionKey, msgs)
        );
        // 记忆由 save_memory 工具触发（LLM 在循环内主动调用）
        this.abortController = null;
        // 终态信号：被 stop 中断 → STOPPED（前端显示"已停止任务"）；否则 DONE。
        // Error 由 catchError 发 ERROR，前端同样解除 pending。
        if (abortController.signal.aborted) {
            this.eventStream.submit({
                type: EventType.STOPPED,
                message: "已停止任务",
            });
        } else {
            this.eventStream.submit({
                type: EventType.DONE,
                message: `任务完成`,
            });
        }
    }

    private getSystemMessage(workspace: Workspace): ChatMessage[] {
        const memory = loadMemory(workspace);
        const rule = loadRule(workspace);
        const skills = loadSkills(workspace);
        // 拼装 system prompt：instruction + workspace/memory 注入段 + memory/skills/rule。
        // 所有 prompt 文本集中存于 ./prompt.ts，此处只拼装。
        let sysPrompt =
            this.definition.instruction +
            workspaceNote(workspace.rootPath);
        if (memory) {
            sysPrompt += memory;
        }
        sysPrompt += memoryNote;
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
