export enum EventType {
  SYSTEM = "System",
  USER = "User",
  TOOL = "Tool",
  ITERATION = "Iteration",
  ASSISTANT = "Assistant",
  PLANNING = "Planning",
  ERROR = "Error",
}

interface AgentEvent {
  timestamp: number;
  type: EventType;
  message: string;
  data?: any;
}

interface AgentEventPayload {
  type: EventType;
  message: string;
  data?: any;
}

export class EventStream {
  private static instance: EventStream;
  Queue: AgentEvent[] = [];

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
    this.Queue.push({ timestamp, ...event });
    const formattedMessage = `[${new Date(timestamp).toISOString()}][${event.type}]: ${event.message}`;
    console.log(formattedMessage);
    return formattedMessage;
  }

  // 清空事件队列
  clear() {
    this.Queue = [];
  }

  // 获取事件历史
  getHistory(): AgentEvent[] {
    return this.Queue;
  }
}
