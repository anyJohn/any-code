import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import {
    selectWorkspace,
    setSelected,
    setActiveSession,
    refreshWorkspaces,
} from "@/store/workspaceSlice";
import type { SessionMeta } from "@any-code/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiJson } from "@/lib/api";

type SessionsStatus = "loading" | "ready" | "error";

// 中央：展示当前选中工作区的会话列表（或空状态引导选工作区）
export default function Page() {
    const { selected, workspaces } = useAppSelector(selectWorkspace);
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const [sessions, setSessions] = useState<SessionMeta[]>([]);
    const [status, setStatus] = useState<SessionsStatus>("loading");
    const [busy, setBusy] = useState(false); // newChat/resume 按钮态
    const [actionErr, setActionErr] = useState("");

    useEffect(() => {
        dispatch(refreshWorkspaces());
    }, [dispatch]);
    useEffect(() => {
        const pk = selected?.projectKey;
        if (!pk) {
            setSessions([]);
            setStatus("ready");
            return;
        }
        setStatus("loading");
        // apiJson 对 dev 冷编译 5xx 重试一次；失败返回 null → error 态
        apiJson<SessionMeta[]>(`/api/workspaces/${pk}/sessions`).then((list) => {
            if (list === null) {
                setStatus("error");
                return;
            }
            setSessions(list);
            setStatus("ready");
        });
    }, [selected?.projectKey]);

    // 目标 C：newChat/resume 只导航，不 POST 建 agent（chat 页 + useAgent 负责）
    const newChat = () => {
        if (!selected) return;
        dispatch(setActiveSession(null));
        navigate(`/chat/new`);
    };

    const resume = (sessionId: string) => {
        if (!selected) return;
        dispatch(setActiveSession(sessionId));
        navigate(`/chat/${sessionId}`);
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
                                在侧栏「添加工作区」选一个本地目录开始
                            </span>
                        )}
                    </div>
                    {selected && (
                        <Button className="shrink-0" onClick={newChat} disabled={busy}>
                            {busy ? "创建中…" : "＋ 新建对话"}
                        </Button>
                    )}
                </div>
                {actionErr && (
                    <p className="text-sm text-destructive">{actionErr}</p>
                )}
                {selected && (
                    <Card>
                        <CardHeader>
                            <CardTitle>会话</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-2">
                            {status === "loading" &&
                                Array.from({ length: 4 }).map((_, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl border border-border"
                                    >
                                        <Skeleton className="h-4 w-1/2" />
                                        <Skeleton className="h-3 w-24" />
                                    </div>
                                ))}
                            {status === "error" && (
                                <p className="text-sm text-destructive px-3 py-2">
                                    加载会话失败，请重试
                                </p>
                            )}
                            {status === "ready" &&
                                sessions.map((s) => (
                                    <button
                                        key={s.id}
                                        className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl border border-border hover:bg-accent text-left transition-colors disabled:opacity-50"
                                        onClick={() => resume(s.id)}
                                        disabled={busy}
                                    >
                                        <span className="text-sm text-accent-foreground truncate">
                                            {s.title || "（无标题）"}
                                        </span>
                                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                                            {new Date(s.updatedAt).toLocaleString()}
                                        </span>
                                    </button>
                                ))}
                            {status === "ready" && sessions.length === 0 && (
                                <p className="text-sm text-muted-foreground px-3 py-2">
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
