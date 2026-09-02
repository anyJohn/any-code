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
import { ChevronsUpDown, Plus, FolderOpen, Languages } from "lucide-react";
import { DirectoryPicker } from "./DirectoryPicker";
import { Logo } from "./Logo";
import { apiJson } from "@/lib/api";
import { useT, type Language } from "@/i18n";

/**
 * AppTopbar —— 当前工作区名 + 下拉（切换最近 / 添加工作区）。
 */
export function AppTopbar() {
    const { selected, workspaces } = useAppSelector(selectWorkspace);
    const dispatch = useAppDispatch();
    const { language, setLanguage, t } = useT();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [addError, setAddError] = useState("");

    // 一键切换（FR-29）：本地即时生效 + localStorage + PATCH config 持久化（Provider 内处理）
    const toggleLanguage = () =>
        setLanguage((language === "zh" ? "en" : "zh") as Language);

    useEffect(() => {
        dispatch(refreshWorkspaces());
    }, [dispatch]);

    const onPicked = async (path: string) => {
        setAddError("");
        const meta = await apiJson<WorkspaceMeta>("/api/workspaces", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
        });
        if (!meta) {
            setAddError(t("topbar.addWorkspaceFailed"));
            return;
        }
        await dispatch(refreshWorkspaces());
        dispatch(setSelected(meta));
    };

    const switchTo = (meta: WorkspaceMeta) => dispatch(setSelected(meta));

    return (
        <div className="flex items-center gap-3 px-4 h-12">
            <Logo size={20} className="shrink-0" />
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2">
                        <FolderOpen className="size-4" />
                        <span className="truncate max-w-[200px]">
                            {selected?.name || t("topbar.selectWorkspace")}
                        </span>
                        <ChevronsUpDown className="size-3 text-muted-foreground" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel>{t("topbar.recentWorkspaces")}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {workspaces.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground">
                            {t("topbar.noWorkspaces")}
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
                        <Plus className="size-4" /> {t("topbar.addWorkspace")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {selected && (
                <span className="text-xs text-muted-foreground font-mono truncate">
                    {selected.rootPath}
                </span>
            )}
            {addError && (
                <span className="text-xs text-destructive truncate">
                    {addError}
                </span>
            )}

            {/* 语言切换（FR-29）：显目标语言 */}
            <Button
                variant="ghost"
                size="sm"
                className="ml-auto shrink-0 gap-1.5 px-2"
                title={t("topbar.switchLanguage")}
                onClick={toggleLanguage}
            >
                <Languages className="size-4" />
                <span className="text-xs">{language === "zh" ? "EN" : "中文"}</span>
            </Button>

            <DirectoryPicker
                open={pickerOpen}
                onOpenChange={(v) => {
                    setPickerOpen(v);
                    if (!v) setAddError("");
                }}
                onPicked={onPicked}
            />
        </div>
    );
}
