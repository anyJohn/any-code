import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import {
    selectWorkspace,
    setActiveSession,
    refreshWorkspaces,
} from "@/store/workspaceSlice";
import type { SessionMeta } from "@any-code/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/Logo";
import { FolderOpen } from "lucide-react";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";

type SessionsStatus = "loading" | "ready" | "error";

// 中央：品牌 hero + 当前选中工作区的会话列表（或空状态引导选工作区）
export default function Page() {
    const { t } = useT();
    const { selected, workspaces } = useAppSelector(selectWorkspace);
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const [sessions, setSessions] = useState<SessionMeta[]>([]);
    const [status, setStatus] = useState<SessionsStatus>("loading");
    const [busy] = useState(false); // newChat/resume 按钮态
    const [actionErr] = useState("");

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
                {/* 品牌 hero：logo + AnyCode + tagline */}
                <div className="flex items-center gap-3">
                    <Logo size={40} />
                    <div className="flex flex-col">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">
                            AnyCode
                        </h1>
                        <span className="text-xs text-muted-foreground">
                            A Simple AI Agent
                        </span>
                    </div>
                </div>

                {actionErr && (
                    <p className="text-sm text-destructive">{actionErr}</p>
                )}

                {selected ? (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <span className="text-base font-semibold text-foreground truncate">
                                        {selected.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground font-mono truncate">
                                        📁 {selected.rootPath}
                                    </span>
                                </div>
                                <Button
                                    size="sm"
                                    className="shrink-0"
                                    onClick={newChat}
                                    disabled={busy}
                                >
                                    {busy ? t("home.creating") : t("home.newChat")}
                                </Button>
                            </div>
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
                                    {t("home.loadSessionsFailed")}
                                </p>
                            )}
                            {status === "ready" &&
                                sessions.map((s) => (
                                    <button
                                        key={s.id}
                                        className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl border border-border hover:bg-accent hover:border-primary/40 text-left transition-colors disabled:opacity-50"
                                        onClick={() => resume(s.id)}
                                        disabled={busy}
                                    >
                                        <span className="text-sm text-accent-foreground truncate">
                                            {s.title || t("home.untitled")}
                                        </span>
                                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                                            {new Date(s.updatedAt).toLocaleString()}
                                        </span>
                                    </button>
                                ))}
                            {status === "ready" && sessions.length === 0 && (
                                <p className="text-sm text-muted-foreground px-3 py-2">
                                    {t("home.emptySessions")}
                                </p>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="rounded-xl border border-dashed border-border p-8 flex flex-col items-center gap-2 text-center">
                        <FolderOpen className="size-6 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                            {t("home.noWorkspace")}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
