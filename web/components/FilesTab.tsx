"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "@/lib/api";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Folder, FileText, Eye, EyeOff, Upload } from "lucide-react";

export interface FileListItem {
    path: string;
    name: string;
}

interface TreeNode {
    name: string;
    path: string;
    children: Map<string, TreeNode>;
    isFile: boolean;
}

/** 平铺路径列表 → 前缀树（SPEC-036 B-008：一次全量，前端建树） */
export function buildTree(paths: FileListItem[]): TreeNode {
    const root: TreeNode = { name: "", path: "", children: new Map(), isFile: false };
    for (const { path } of paths) {
        const parts = path.split("/");
        let cur = root;
        for (let i = 0; i < parts.length; i++) {
            const seg = parts[i];
            const isFile = i === parts.length - 1;
            const p = isFile ? path : parts.slice(0, i + 1).join("/");
            let next = cur.children.get(seg);
            if (!next) {
                next = { name: seg, path: p, children: new Map(), isFile };
                cur.children.set(seg, next);
            }
            cur = next;
        }
    }
    return root;
}

/**
 * FilesTab（SPEC-036 B-008 文件 tab）：全量文件列表 + 搜索 + gitignore 显隐开关。
 * 点文件回调 onOpenFile（父组件打开 preview modal）。
 */
export function FilesTab({
    projectKey,
    onOpenFile,
}: {
    projectKey: string;
    onOpenFile: (path: string) => void;
}) {
    const { t } = useT();
    const [files, setFiles] = useState<FileListItem[]>([]);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [showIgnored, setShowIgnored] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    // 刷新版本号：上传成功后 bump 触发重载
    const [refreshTick, setRefreshTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setError("");
        void apiJson<FileListItem[] | { statusMessage: string }>(
            `/api/workspaces/${projectKey}/files?all=1&ignored=${showIgnored ? 1 : 0}`
        ).then((data) => {
            if (cancelled) return;
            if (data && "statusMessage" in data) {
                setError(data.statusMessage);
                setFiles([]);
            } else {
                setFiles(data ?? []);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [projectKey, showIgnored, refreshTick]);

    // SPEC-043 B-004：上传文件到工作区根（multipart），成功后刷新列表
    const onUploadFiles = async (list: FileList | null) => {
        if (!list || list.length === 0) return;
        setUploading(true);
        setUploadError("");
        try {
            for (const f of Array.from(list)) {
                const fd = new FormData();
                fd.append("file", f);
                const res = await fetch(`/api/workspaces/${projectKey}/upload`, {
                    method: "POST",
                    body: fd,
                });
                if (!res.ok) {
                    const body = (await res.json().catch(() => ({}))) as { statusMessage?: string };
                    setUploadError(body.statusMessage ?? `上传失败：${f.name}`);
                }
            }
            setRefreshTick((k) => k + 1);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const q = query.trim().toLowerCase();
    const filtered = q
        ? files.filter(
              (f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
          )
        : files;
    const tree = useMemo(() => buildTree(filtered), [filtered]);

    const toggleDir = (path: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });

    const renderNode = (node: TreeNode, depth: number): React.ReactNode[] => {
        const out: React.ReactNode[] = [];
        const dirs = [...node.children.values()].filter((c) => !c.isFile);
        const fileNodes = [...node.children.values()].filter((c) => c.isFile);
        for (const dir of dirs) {
            const open = expanded.has(dir.path) || q.length > 0;
            out.push(
                <button
                    key={`d-${dir.path}`}
                    onClick={() => toggleDir(dir.path)}
                    className={cn(
                        "flex items-center gap-1.5 w-full text-left text-xs rounded px-2 py-1 hover:bg-accent",
                        q.length === 0 && !open && ""
                    )}
                    style={{ paddingLeft: depth * 14 + 8 }}
                >
                    {open ? (
                        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <Folder className="size-3.5 shrink-0 text-sky-500" />
                    <span className="truncate">{dir.name}</span>
                </button>
            );
            if (open) out.push(...renderNode(dir, depth + 1));
        }
        for (const f of fileNodes) {
            out.push(
                <button
                    key={`f-${f.path}`}
                    onClick={() => onOpenFile(f.path)}
                    className="flex items-center gap-1.5 w-full text-left text-xs rounded px-2 py-1 hover:bg-accent"
                    style={{ paddingLeft: depth * 14 + 8 + 18 }}
                >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-mono truncate">{f.name}</span>
                </button>
            );
        }
        return out;
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="w-full max-w-3xl mx-auto px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t("files.search")}
                        className="flex-1 min-w-0 text-xs rounded-md border border-input bg-background px-2 py-1.5 outline-none focus:ring-1 focus-within:ring-ring"
                    />
                    {/* 上传到工作区根（SPEC-043 B-004）：多选，成功后刷新列表 */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => void onUploadFiles(e.target.files)}
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        title={t("files.upload")}
                        className={cn(
                            "p-1.5 rounded-md border border-input hover:bg-accent shrink-0",
                            uploading && "opacity-50"
                        )}
                    >
                        <Upload className="size-3.5" />
                    </button>
                    <button
                        onClick={() => setShowIgnored((v) => !v)}
                        title={t("files.toggleIgnored")}
                        className={cn(
                            "p-1.5 rounded-md border border-input hover:bg-accent shrink-0",
                            showIgnored && "bg-accent"
                        )}
                    >
                        {showIgnored ? (
                            <Eye className="size-3.5" />
                        ) : (
                            <EyeOff className="size-3.5" />
                        )}
                    </button>
                </div>
                {uploadError && <div className="text-xs text-destructive">{uploadError}</div>}
                {error && <div className="text-xs text-destructive">{error}</div>}
                {!error && filtered.length === 0 && (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                        {t("files.empty")}
                    </div>
                )}
                <div className="flex flex-col">{renderNode(tree, 0)}</div>
            </div>
        </div>
    );
}
