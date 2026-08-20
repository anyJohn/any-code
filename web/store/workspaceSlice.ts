import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { WorkspaceMeta } from "@any-code/domain";
import type { AppState } from "./index";
import { apiJson } from "@/lib/api";

/**
 * workspaceSlice —— 跨页面共享 selected / workspaces / activeSessionId；事件流不在此。
 */
interface WorkspaceState {
    selected: WorkspaceMeta | null;
    workspaces: WorkspaceMeta[];
    activeSessionId: string | null;
}

const initialState: WorkspaceState = {
    selected: null,
    workspaces: [],
    activeSessionId: null,
};

export const refreshWorkspaces = createAsyncThunk<WorkspaceMeta[]>(
    "workspace/refresh",
    async () => {
        // apiJson 对 dev 冷编译 5xx 重试一次，避免首屏因瞬时 500 拿不到工作区
        const list = await apiJson<WorkspaceMeta[]>("/api/workspaces");
        return list ?? [];
    }
);

const workspaceSlice = createSlice({
    name: "workspace",
    initialState,
    reducers: {
        setSelected(state, action: PayloadAction<WorkspaceMeta | null>) {
            state.selected = action.payload;
        },
        setWorkspaces(state, action: PayloadAction<WorkspaceMeta[]>) {
            state.workspaces = action.payload;
            // 当前选中若已被移除，清空（等价现版 refresh 里的清理）
            if (
                state.selected &&
                !state.workspaces.some(
                    (w) => w.projectKey === state.selected!.projectKey
                )
            ) {
                state.selected = null;
            }
        },
        setActiveSession(state, action: PayloadAction<string | null>) {
            state.activeSessionId = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder.addCase(refreshWorkspaces.fulfilled, (state, action) => {
            state.workspaces = action.payload;
            if (
                state.selected &&
                !state.workspaces.some(
                    (w) => w.projectKey === state.selected!.projectKey
                )
            ) {
                state.selected = null;
            }
        });
    },
});

export const { setSelected, setWorkspaces, setActiveSession } =
    workspaceSlice.actions;
export const selectWorkspace = (s: AppState) => s.workspace;
export const workspaceReducer = workspaceSlice.reducer;
