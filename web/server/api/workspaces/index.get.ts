import { WorkspaceRegistry } from "@any-code/domain";

// GET /api/workspaces —— 列出所有已注册工作区（按 lastUsedAt 降序）
export default defineEventHandler(() => WorkspaceRegistry.list());
