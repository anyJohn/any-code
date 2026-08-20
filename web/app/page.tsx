"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import {
    selectWorkspace,
    setSelected,
    refreshWorkspaces,
} from "@/store/workspaceSlice";
import type { SessionMeta } from "@any-code/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "@/lib/api";

// 中央：展示当前选中工作区的会话列表（或空状态引导选工作区）
export default function Page() {
    const { selected, workspaces } = useAppSelector(selectWorkspace);
    const dispatch = useAppDispatch();
    const router = useRouter();
    const [sessions, setSessions] = useState<SessionMeta[]>([]);

    // 选中工作区变化时拉它的 sessions
    useEffect(() => {
        dispatch(refreshWorkspaces());
    }, [dispatch]);
    useEffect(() => {
        const pk = selected?.projectKey;
        if (!pk) {
            setSessions([]);
            return;
        }
        // apiJson 对 dev 冷编译 5xx 重试一次；失败返回 null → 空列表
        apiJson<SessionMeta[]>(`/api/workspaces/${pk}/sessions`).then((list) =>
            setSessions(list ?? [])
        );
    }, [selected?.projectKey]);

    const newChat = async () => {
        if (!selected) return;
        const data = await apiJson<{ id: string }>("/api/agents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ workspacePath: selected.rootPath }),
        });
        if (data) router.push(`/chat/${data.id}`);
    };

    const resume = async (sessionId: string) => {
        if (!selected) return;
        const data = await apiJson<{ id: string }>("/api/agents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                workspacePath: selected.rootPath,
                sessionId,
            }),
        });
        if (data) router.push(`/chat/${data.id}`);
    };

    void workspaces; // 触发 refresh 后 workspaces 更新

    return (
        <div className="h-full overflow-y-auto">
            <div className="w-full max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1 min-w-0">
                        <h1 className="text-2xl font-bold text-foreground">
                            {selected?.name || "AnyCode Web"}
                        </h1>
                        {selected ? (
                            <span className="text-xs text-muted-foreground font-mono truncate">
                                📁 {selected.rootPath}
                            </span>
                        ) : (
                            <span className="text-xs text-muted-foreground">
                                在顶栏「添加工作区」选一个本地目录开始
                            </span>
                        )}
                    </div>
                    {selected && (
                        <Button className="shrink-0" onClick={newChat}>
                            ＋ 新建对话
                        </Button>
                    )}
                </div>
                {selected && (
                    <Card>
                        <CardHeader>
                            <CardTitle>会话</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-1">
                            {sessions.map((s) => (
                                <button
                                    key={s.id}
                                    className="flex items-center justify-between gap-3 px-2 py-2 rounded-md hover:bg-accent text-left"
                                    onClick={() => resume(s.id)}
                                >
                                    <span className="text-sm text-accent-foreground truncate">
                                        {s.title || "（无标题）"}
                                    </span>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        {new Date(s.updatedAt).toLocaleString()}
                                    </span>
                                </button>
                            ))}
                            {sessions.length === 0 && (
                                <p className="text-sm text-muted-foreground px-2 py-2">
                                    暂无会话，点「新建对话」开始
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
