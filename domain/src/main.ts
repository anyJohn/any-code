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
    private task$ = new Subject<string>();
    private service: SessionService;
    private projectKey: string;
    private session!: Session;
    private sessionKey!: SessionKey;

    private constructor(opts: AnyAgentOptions = {}) {
        this.service = opts.service ?? new SessionService();
        this.projectKey = projectKeyOf(process.cwd());
        this.initProcessor();
    }

    /** 异步工厂：构造 + 加载/新建 session。调用方必须 await 后再 submit。 */
    static async create(opts: AnyAgentOptions = {}): Promise<AnyAgent> {
        const agent = new AnyAgent(opts);
        await agent.initSession(opts.sessionId);
        return agent;
    }

    private async initSession(sessionId?: string) {
        let session: Session | null = null;
        if (sessionId) {
            session = await this.service.resume(this.projectKey, sessionId);
            if (!session) {
                this.eventStream.submit({
                    type: EventType.SYSTEM,
                    message: `Session ${sessionId} not found, creating a new one.`,
                });
            }
        }
        if (!session) {
            session = await this.service.create(this.projectKey);
        }
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

    stop() {
        this.stop$.next();
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
                })
            )
            .subscribe();
    }

    private async executeTask(task: string) {
        // 重建 system prompt 放 messages[0]（不入盘，每次保持最新）
        const sys = this.getSystemMessage();
        if (this.session.messages[0]?.role === "system") {
            this.session.messages[0] = sys[0];
        } else {
            this.session.messages.unshift(sys[0]);
        }

        // 首条任务自动设标题
        if (this.session.title === "New Session" && task) {
            this.session.title = task.slice(0, 40);
            await this.service.setTitle(this.sessionKey, this.session.title);
        }

        const mcpTools = loadMcpTools();
        const onMessage = (msg: ChatMessage) =>
            this.service.appendMessage(this.sessionKey, msg);
        const { result } = await agentLoop(
            task,
            this.session.messages,
            30,
            { tools: [...ToolKit.allTools, ...mcpTools] },
            onMessage
        );
        saveMemory(task, result);
    }

    private getSystemMessage(): ChatMessage[] {
        const memory = loadMemory();
        const rule = loadRule();
        const skills = loadSkills();
        let sysPrompt = systemPrompt;
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
