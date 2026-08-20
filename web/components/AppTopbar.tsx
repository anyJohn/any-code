"use client";

import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import {
    selectWorkspace,
    setSelected,
    refreshWorkspaces,
} from "@/store/workspaceSlice";
import type { WorkspaceMeta } from "@any-code/domain";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDown, Plus, FolderOpen } from "lucide-react";
import { DirectoryPicker } from "./DirectoryPicker";
import { apiJson } from "@/lib/api";

/**
 * AppTopbar —— 当前工作区名 + 下拉（切换最近 / 添加工作区）。
 */
export function AppTopbar() {
    const { selected, workspaces } = useAppSelector(selectWorkspace);
    const dispatch = useAppDispatch();
    const [pickerOpen, setPickerOpen] = useState(false);

    useEffect(() => {
        dispatch(refreshWorkspaces());
    }, [dispatch]);

    const onPicked = async (path: string) => {
        const meta = await apiJson<WorkspaceMeta>("/api/workspaces", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
        });
        if (!meta) return; // 添加失败：不切换选中，交给下拉刷新
        await dispatch(refreshWorkspaces());
        dispatch(setSelected(meta));
    };

    const switchTo = (meta: WorkspaceMeta) => dispatch(setSelected(meta));

    return (
        <div className="flex items-center gap-3 px-4 h-12">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2">
                        <FolderOpen className="size-4" />
                        <span className="truncate max-w-[200px]">
                            {selected?.name || "选择工作区"}
                        </span>
                        <ChevronsUpDown className="size-3 text-muted-foreground" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel>最近工作区</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {workspaces.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground">
                            尚未添加任何工作区
                        </div>
                    )}
                    {workspaces.map((w) => (
                        <DropdownMenuItem
                            key={w.projectKey}
                            className="flex flex-col items-start gap-0.5"
                            onClick={() => switchTo(w)}
                        >
                            <span className="text-sm">{w.name}</span>
                            <span className="text-[11px] text-muted-foreground font-mono truncate w-full">
                                {w.rootPath}
                            </span>
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setPickerOpen(true)}>
                        <Plus className="size-4" /> 添加工作区
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {selected && (
                <span className="text-xs text-muted-foreground font-mono truncate">
                    {selected.rootPath}
                </span>
            )}

            <DirectoryPicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onPicked={onPicked}
            />
        </div>
    );
}
