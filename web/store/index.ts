import { configureStore } from "@reduxjs/toolkit";
import { workspaceReducer } from "./workspaceSlice";

/**
 * 客户端单例 store。SSR 仅渲染壳，Providers 在 'use client' 边界挂载。
 */
export const store = configureStore({
    reducer: {
        workspace: workspaceReducer,
    },
});

export type AppState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
