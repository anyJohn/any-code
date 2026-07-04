import type { WorkspaceMeta } from "@any-code/domain";

/**
 * 工作区共享状态（sidebar / topbar / 页面共用）。
 * useState 是 Nuxt 的 SSR 友好共享状态，跨组件单例。
 *
 * selected：当前高亮的工作区（chat 页加载时按 agent 的 projectKey 设定）
 * activeSessionId：当前高亮的会话（chat 页加载 / 点 resume 时设定）。
 *   两者搭配，让 sidebar 同时高亮"工作区 + 其下的会话"。
 */
export function useWorkspaceState() {
    const selected = useState<WorkspaceMeta | null>("selectedWorkspace", () => null);
    const workspaces = useState<WorkspaceMeta[]>("workspaces", () => []);
    const activeSessionId = useState<string | null>("activeSessionId", () => null);

    async function refresh() {
        workspaces.value = await $fetch<WorkspaceMeta[]>("/api/workspaces");
        // 当前选中的若已被移除，清空
        if (
            selected.value &&
            !workspaces.value.some((w) => w.projectKey === selected.value!.projectKey)
        ) {
            selected.value = null;
        }
    }

    function select(meta: WorkspaceMeta | null) {
        selected.value = meta;
    }

    function setActiveSession(id: string | null) {
        activeSessionId.value = id;
    }

    return { selected, workspaces, refresh, select, activeSessionId, setActiveSession };
}
