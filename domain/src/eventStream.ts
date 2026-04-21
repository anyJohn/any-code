import { BehaviorSubject, Subject } from "rxjs";
import { AgentEvent, AgentEventPayload, EventType } from "./type";

export class EventStream {
    history$: BehaviorSubject<AgentEvent[]> = new BehaviorSubject<AgentEvent[]>(
        []
    );
    event$: Subject<AgentEvent> = new Subject<AgentEvent>();
    private static instance: EventStream;

    private constructor() {}

    // 单例模式获取实例
    static getInstance(): EventStream {
        if (!EventStream.instance) {
            EventStream.instance = new EventStream();
        }
        return EventStream.instance;
    }

    // 通用事件提交
    submit(event: AgentEventPayload) {
        const timestamp = new Date().getTime();
        const agentEvent: AgentEvent = { timestamp, ...event };
        this.event$.next(agentEvent);
        this.history$.next([...this.history$.getValue(), agentEvent]);
    }

    // 清空事件队列
    clear() {
        this.history$.next([]);
    }

    // 获取事件历史
    getHistory(): AgentEvent[] {
        return this.history$.getValue();
    }
}
