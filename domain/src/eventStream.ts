import { BehaviorSubject, Subject } from "rxjs";
import { AgentEvent, AgentEventPayload } from "./type";

/**
 * 每个 AnyAgent 持有自己的 EventStream 实例（不再全局单例）。
 * 多 agent 并发时事件不再串流。生命周期绑在 agent 上：agent.destroy() 后随 GC。
 */
export class EventStream {
    history$: BehaviorSubject<AgentEvent[]> = new BehaviorSubject<AgentEvent[]>(
        []
    );
    event$: Subject<AgentEvent> = new Subject<AgentEvent>();

    submit(event: AgentEventPayload) {
        const timestamp = new Date().getTime();
        const agentEvent: AgentEvent = { timestamp, ...event };
        this.event$.next(agentEvent);
        this.history$.next([...this.history$.getValue(), agentEvent]);
    }

    clear() {
        this.history$.next([]);
    }

    getHistory(): AgentEvent[] {
        return this.history$.getValue();
    }
}
