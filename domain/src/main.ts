import { loadMemory, saveMemory } from "./memory";
import {
    AgentStatus,
    AgentEvent,
    ChatMessage,
    EventType,
    InteractionRequest,
} from "./type";
import { agentLoop } from "./core";
import { loadRule } from "./rule";
import { loadSkills } from "./skill";
import { EventStream } from "./eventStream";
import { SessionService, Session, SessionKey, projectKeyOf } from "./session";
import { createWorkspace, Workspace } from "./workspace";
import { mainAgent } from "./agent";
import type { AgentDefinition } from "./agent";
import type { Tool } from "./tools";
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
        // 先中断当前任务（触发内层 takeUntil(stop$) + finalize），再拆外层管线
        this.stop$.next();
        this.stop$.complete();
        this.destroy$.next();
        this.destroy$.complete();
        // per-agent eventStream，切换时清空释放内存
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
        };
        const { result } = await agentLoop(
            task,
            session.messages,
            this.definition.maxIterations,
            {},
            onMessage,
            ctx,
            this.tools
        );
        saveMemory(task, result, this.workspace);
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
        // 告知 LLM 工作根目录，让它能把工具输出里的绝对路径对应到相对路径
        // （测试框架报错含绝对路径，否则 LLM 认知断裂）。见 docs/workspace设计.md。
        let sysPrompt =
            this.definition.instruction +
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
