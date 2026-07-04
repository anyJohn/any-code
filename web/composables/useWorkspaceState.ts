import type { WorkspaceMeta } from "@any-code/domain";

/**
 * 工作区共享状态（sidebar / topbar / 页面共用）。
 * useState 是 Nuxt 的 SSR 友好共享状态，跨组件单例。
 */
export function useWorkspaceState() {
    const selected = useState<WorkspaceMeta | null>("selectedWorkspace", () => null);
    const workspaces = useState<WorkspaceMeta[]>("workspaces", () => []);

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

    return { selected, workspaces, refresh, select };
}
