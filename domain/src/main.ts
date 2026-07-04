import { loadMemory, saveMemory } from "./memory";
import {
    AgentStatus,
    AgentEvent,
    ChatMessage,
    EventType,
    InteractionRequest,
} from "./type";
import { agentLoop } from "./core";
import { systemPrompt } from "./prompt";
import { ToolKit } from "./tools";
import { loadRule } from "./rule";
import { loadSkills } from "./skill";
import { loadMcpTools } from "./mcp";
import { EventStream } from "./eventStream";
import { SessionService, Session, SessionKey, projectKeyOf } from "./session";
import { createWorkspace, Workspace } from "./workspace";
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
}

class AnyAgent {
    status$: BehaviorSubject<AgentStatus> = new BehaviorSubject<AgentStatus>(
        AgentStatus.IDLE
    );
    event$: Observable<AgentEvent> = new Observable();
    pendingTasks$ = new BehaviorSubject<string[]>([]);
    interaction$ = new Subject<InteractionRequest>();

    private eventStream = EventStream.getInstance();
    private stop$ = new Subject<void>();
    private destroy$ = new Subject<void>();
    private task$ = new Subject<string>();
    private service: SessionService;
    private workspace: Workspace;
    private projectKey: string;
    // session 延迟到首条用户消息时才创建，避免每次启动都落盘一个空 session
    private session: Session | null = null;
    private sessionKey: SessionKey | null = null;

    private constructor(opts: AnyAgentOptions) {
        this.service = opts.service ?? new SessionService();
        this.workspace = createWorkspace(opts.rootPath);
        this.projectKey = projectKeyOf(this.workspace.rootPath);
        this.initProcessor();
    }

    /** 异步工厂：构造 +（若给定 sessionId）恢复历史 session。无 sessionId 时不创建，等首条消息。 */
    static async create(opts: AnyAgentOptions): Promise<AnyAgent> {
        const agent = new AnyAgent(opts);
        await agent.initSession(opts.sessionId);
        return agent;
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

    stop() {
        this.stop$.next();
    }

    /**
     * 彻底销毁 agent：中断当前任务 + 解绑 task$ 订阅 + complete stop$。
     * 切换 session / 工作区时调用，避免旧 agent 的 rxjs 订阅泄漏、阻止被 GC。
     */
    destroy() {
        // 先中断当前任务（触发内层 takeUntil(stop$) + finalize），再拆外层管线
        this.stop$.next();
        this.stop$.complete();
        this.destroy$.next();
        this.destroy$.complete();
        // EventStream 是全局单例，history$ 会无限累积事件，切换时清空释放内存
        this.eventStream.clear();
    }

    submit(task: string) {
        this.task$.next(task);
    }

    private initProcessor() {
        this.task$
            .pipe(
                tap((task) => {
                    const currentTasks = this.pendingTasks$.getValue();
                    this.pendingTasks$.next([...currentTasks, task]);
                }),
                concatMap((task: string) => {
                    this.eventStream.submit({
                        type: EventType.SYSTEM,
                        message: `Starting Task: ${task}`,
                    });
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

        const mcpTools = loadMcpTools(this.workspace);
        const onMessage = (msg: ChatMessage) =>
            this.service.appendMessage(sessionKey, msg);
        const { result } = await agentLoop(
            task,
            session.messages,
            30,
            { tools: [...ToolKit.allTools, ...mcpTools] },
            onMessage,
            this.workspace
        );
        saveMemory(task, result, this.workspace);
        // 任务完成信号：前端据此解除 pending（Error 时由 catchError 发 ERROR，前端也解除）
        this.eventStream.submit({
            type: EventType.DONE,
            message: `Task completed: ${task}`,
        });
    }

    private getSystemMessage(workspace: Workspace): ChatMessage[] {
        const memory = loadMemory(workspace);
        const rule = loadRule(workspace);
        const skills = loadSkills(workspace);
        // 告知 LLM 工作根目录，让它能把工具输出里的绝对路径对应到相对路径
        // （Jest/webpack 报错含绝对路径，否则 LLM 认知断裂）。见 docs/workspace设计.md。
        let sysPrompt =
            systemPrompt +
            `\n\n# Workspace\n你的工作根目录是 ${workspace.rootPath}。` +
            `分析工具输出中的绝对路径时，将其与该根目录对应。`;
        if (memory) {
            sysPrompt += memory;
        }
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
