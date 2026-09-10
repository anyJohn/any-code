import { Config, createWorkspace, JobRegistry, WorkspaceRegistry, type Workspace } from "@any-code/domain";

// SPEC-038 桌模型：后台任务注册表按工作区共享（跨会话可见）；server 退出统一杀
export const workspaceJobs = new Map<string, JobRegistry>();
export function getWorkspaceJobs(projectKey: string): JobRegistry {
    let r = workspaceJobs.get(projectKey);
    if (!r) {
        r = new JobRegistry();
        workspaceJobs.set(projectKey, r);
    }
    return r;
}

/** 解析拉取/测试模型的凭据：表单 apiKey 留空=保留原值 → 用 config.yaml 已存 key（providerName 匹配）。 */
export function resolveModelCreds(
    baseURL: string | undefined,
    apiKey: string | undefined,
    providerName: string | undefined
): { key: string; base?: string } {
    let key = apiKey?.trim() ?? "";
    let base: string | undefined = baseURL?.trim() || undefined;
    const name = providerName?.trim();
    if (name && (!key || !base)) {
        try {
            const existing = Config.load().providers[name];
            if (existing) {
                if (!key) key = existing.apiKey ?? "";
                if (!base) base = existing.baseURL;
            }
        } catch {
            // 坏 config：当作无已存凭据
        }
    }
    return { key, base };
}

export function resolveWorkspace(projectKey: string): Workspace | null {
    const meta = WorkspaceRegistry.list().find((w) => w.projectKey === projectKey);
    return meta ? createWorkspace(meta.rootPath) : null;
}
