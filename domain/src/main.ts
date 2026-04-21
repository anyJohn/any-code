import { loadMemory, saveMemory } from "./memory";
import {
    AgentStatus,
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

class AnyAgent {
    status$: BehaviorSubject<AgentStatus> = new BehaviorSubject<AgentStatus>(
        AgentStatus.IDLE
    );
    event$: Observable<Event> = new Observable();
    pendingTasks$ = new BehaviorSubject<string[]>([]);
    interaction$ = new Subject<InteractionRequest>();

    private eventStream = EventStream.getInstance();
    private stop$ = new Subject<void>();
    private task$ = new Subject<string>();

    constructor() {
        this.initProcessor();
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
        this.task$.pipe(
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
                        this.eventStream.submit({
                            type: EventType.ERROR,
                            message: `Error executing task: ${task}`,
                            data: err,
                        });
                        return of(null);
                    }),
                    finalize(() => {
                        const [completed, ...remaining] =
                            this.pendingTasks$.getValue();
                        this.pendingTasks$.next(remaining);
                    })
                );
            })
        );
    }

    private async executeTask(task: string) {
        const systemMessages: ChatMessage[] = this.getSystemMessage();
        const mcpTools = loadMcpTools();
        const { result } = await agentLoop(task, systemMessages, undefined, {
            tools: [...ToolKit.allTools, ...mcpTools],
        });
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

export default AnyAgent;
