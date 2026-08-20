import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import {
    workspaceReducer,
    setSelected,
    setWorkspaces,
    setActiveSession,
    refreshWorkspaces,
} from "@/store/workspaceSlice";
import type { WorkspaceMeta } from "@any-code/domain";

const W = (pk: string, root = "/" + pk): WorkspaceMeta => ({
    projectKey: pk,
    rootPath: root,
    name: pk,
} as WorkspaceMeta);

describe("workspaceSlice reducers (TEST-003 TC-003.1/.2)", () => {
    it("setSelected / setActiveSession", () => {
        let s = workspaceReducer(undefined, setSelected(W("p1")));
        expect(s.selected?.projectKey).toBe("p1");
        s = workspaceReducer(s, setActiveSession("s1"));
        expect(s.activeSessionId).toBe("s1");
        s = workspaceReducer(s, setActiveSession(null));
        expect(s.activeSessionId).toBeNull();
    });

    it("setWorkspaces 清理已删选中项", () => {
        let s = workspaceReducer(undefined, setSelected(W("p1")));
        s = workspaceReducer(s, setWorkspaces([W("p2")]));
        expect(s.workspaces).toHaveLength(1);
        expect(s.selected).toBeNull(); // p1 不在列表 → 清空
    });

    it("setWorkspaces 保留仍存在的选中", () => {
        let s = workspaceReducer(undefined, setSelected(W("p1")));
        s = workspaceReducer(s, setWorkspaces([W("p1"), W("p2")]));
        expect(s.selected?.projectKey).toBe("p1");
    });
});

describe("refreshWorkspaces thunk (TEST-003 TC-003.1)", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => vi.unstubAllGlobals());

    function makeStore(selectedPk: string | null = "p1") {
        const store = configureStore({
            reducer: { workspace: workspaceReducer },
        });
        if (selectedPk) store.dispatch(setSelected(W(selectedPk)));
        return store;
    }

    it("fulfilled：清理已删选中", async () => {
        (globalThis.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => [W("p2")],
        });
        const store = makeStore();
        await store.dispatch(refreshWorkspaces());
        const s = store.getState().workspace;
        expect(s.workspaces.map((w) => w.projectKey)).toEqual(["p2"]);
        expect(s.selected).toBeNull();
    });

    it("降级：5xx 经重试仍失败 → fulfilled 返回空数组（不抛未捕获 rejection）", async () => {
        // 新契约：refreshWorkspaces 用 apiJson，对 dev 冷编译 5xx 重试一次，
        // 仍失败则返回 [] 优雅降级（侧栏空），而非 reject。
        (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 500 });
        const store = makeStore();
        const action = await store.dispatch(refreshWorkspaces());
        expect(action.type).toMatch(/fulfilled$/);
        expect(action.payload).toEqual([]);
    });

    it("降级：网络异常 → fulfilled 返回空数组", async () => {
        (globalThis.fetch as any).mockRejectedValue(new Error("network"));
        const store = makeStore();
        const action = await store.dispatch(refreshWorkspaces());
        expect(action.type).toMatch(/fulfilled$/);
        expect(action.payload).toEqual([]);
    });
});
