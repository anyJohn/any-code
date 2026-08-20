"use client";

import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronUp, Folder, Check } from "lucide-react";
import { apiJson } from "@/lib/api";

interface BrowseResult {
    current: string;
    parent: string | null;
    dirs: { name: string; path: string }[];
}

/**
 * DirectoryPicker —— 服务端目录浏览器。
 * 浏览器原生 file dialog 拿不到绝对路径，只能服务端读 fs。
 */
export function DirectoryPicker({
    open,
    onOpenChange,
    onPicked,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onPicked: (path: string) => void;
}) {
    const [current, setCurrent] = useState("");
    const [parent, setParent] = useState<string | null>(null);
    const [dirs, setDirs] = useState<BrowseResult["dirs"]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const browse = async (dir?: string) => {
        setLoading(true);
        setError("");
        const r = await apiJson<BrowseResult>(
            `/api/fs/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`
        );
        if (!r) {
            setError("读取目录失败（服务端冷编译中，请重试）");
        } else {
            setCurrent(r.current);
            setParent(r.parent);
            setDirs(r.dirs);
        }
        setLoading(false);
    };

    // 打开时初始化到家目录
    useEffect(() => {
        if (open && !current) browse();
    }, [open, current]);

    const enter = (p: string) => browse(p);
    const goUp = () => parent && browse(parent);
    const confirm = () => {
        if (current) {
            onPicked(current);
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>选择工作区目录</DialogTitle>
                </DialogHeader>
                <div className="flex items-center gap-2 mb-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!parent}
                        onClick={goUp}
                    >
                        <ChevronUp className="size-4" /> 上级
                    </Button>
                    <span className="text-xs text-muted-foreground font-mono truncate flex-1">
                        {current}
                    </span>
                </div>
                <ScrollArea className="h-72 rounded-md border">
                    {error ? (
                        <div className="p-3 text-sm text-destructive">{error}</div>
                    ) : loading ? (
                        <div className="p-3 text-sm text-muted-foreground">加载中…</div>
                    ) : dirs.length === 0 ? (
                        <div className="p-3 text-sm text-muted-foreground">无子目录</div>
                    ) : (
                        dirs.map((d) => (
                            <button
                                key={d.path}
                                className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent"
                                onClick={() => enter(d.path)}
                            >
                                <Folder className="size-4 text-muted-foreground" />
                                <span className="truncate">{d.name}</span>
                            </button>
                        ))
                    )}
                </ScrollArea>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button onClick={confirm}>
                        <Check className="size-4" /> 选定此目录
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
