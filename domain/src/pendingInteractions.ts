/**
 * 上下文交互注册表：ask_question 工具 handler 阻塞等答案的 pending primitive。
 *
 * 机制：handler 注册一个 resolve 到此 Map（id-keyed）→ 发 INTERACTION 事件 → 阻塞
 * `Promise.race`([answers, abort, timeout])。web 的 POST /interact 用 id 找到 resolve
 * 唤醒。module 单例——server 单进程下 /run（handler 所在）与 /interact（答案 POST）共享。
 */

export interface PendingInteraction {
    resolve: (answers: string[]) => void;
}

const interactions = new Map<string, PendingInteraction>();

/** 注册一个 pending 交互。handler 在此 await 其 resolve。 */
export function registerInteraction(id: string, p: PendingInteraction): void {
    interactions.set(id, p);
}

/** web /interact 调：按 id 唤醒 handler。未知 id（abort 已清）→ false，无副作用。 */
export function resolveInteraction(id: string, answers: string[]): boolean {
    const p = interactions.get(id);
    if (!p) return false;
    interactions.delete(id);
    p.resolve(answers);
    return true;
}

/** handler race 落败（abort）后清自己的注册，防泄漏 + 防迟到的 POST 唤醒。 */
export function unregisterInteraction(id: string): void {
    interactions.delete(id);
}

/** 真值查询：id 是否仍在等待答案。server 组装会话状态（waiting_ask）用。 */
export function hasInteraction(id: string): boolean {
    return interactions.has(id);
}
