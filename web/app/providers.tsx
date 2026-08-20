"use client";

import { Provider } from "react-redux";
import { store } from "@/store";

/**
 * Providers —— 客户端单例 Redux store。SSR 仅渲染壳，状态在客户端 mount 后拉取
 * （等价现版 useWorkspaceState 的 onMounted refresh）。
 */
export function Providers({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
}
