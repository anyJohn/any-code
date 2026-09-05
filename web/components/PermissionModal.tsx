"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    ModalFooter,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PermissionAskData } from "@/hooks/useAgent";
import type { PermissionDecision } from "@/hooks/useAgent";
import { useT } from "@/i18n";

/**
 * PermissionModal —— 权限裁决窗（SPEC-032 B-005）。
 * 工具被判定为 ask 时阻塞 agentLoop；用户在此选择 允许一次 / 永久允许 / 拒绝。
 * "永久允许"可编辑生效模式（预填服务端派生的匹配模式）并勾选应用范围（项目/全局）。
 * "拒绝"同样可选落盘为 deny 规则（防同类再问）。
 */
export function PermissionModal({
    data,
    onDecision,
}: {
    data: PermissionAskData;
    onDecision: (decision: PermissionDecision, scope: "project" | "global") => void;
}) {
    const { t } = useT();
    const [mode, setMode] = useState<"once" | "always">("once");
    const [pattern, setPattern] = useState(data.pattern ?? data.tool);
    const [scope, setScope] = useState<"project" | "global">("project");

    const summary = data.summary
        ? (() => {
              try {
                  return JSON.stringify(JSON.parse(data.summary), null, 0);
              } catch {
                  return data.summary;
              }
          })()
        : "";

    return (
        <Dialog open onOpenChange={(o) => !o && onDecision("deny", scope)}>
            <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {t("permissionModal.title")}
                        {data.danger && (
                            <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-destructive/15 text-destructive">
                                {t("permissionModal.dangerBadge")}
                            </span>
                        )}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3 py-1">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs rounded bg-muted px-1.5 py-0.5">
                            {data.tool}
                        </span>
                        <span className="text-muted-foreground text-xs">
                            {data.pattern
                                ? t("permissionModal.matchPattern", {
                                      pattern: data.pattern,
                                  })
                                : ""}
                        </span>
                    </div>
                    {summary && (
                        <pre className="text-xs bg-muted/50 rounded-md p-2.5 max-h-40 overflow-auto whitespace-pre-wrap break-all">
                            {summary}
                        </pre>
                    )}

                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                                mode === "once"
                                    ? "border-primary bg-accent"
                                    : "border-border hover:bg-accent/50"
                            }`}
                            onClick={() => setMode("once")}
                        >
                            {t("permissionModal.allowOnce")}
                        </button>
                        <button
                            type="button"
                            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                                mode === "always"
                                    ? "border-primary bg-accent"
                                    : "border-border hover:bg-accent/50"
                            }`}
                            onClick={() => setMode("always")}
                        >
                            {t("permissionModal.allowAlways")}
                        </button>
                    </div>

                    {mode === "always" && (
                        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
                            <label className="text-xs text-muted-foreground">
                                {t("permissionModal.scopeLabel")}
                            </label>
                            <Input
                                className="h-7 font-mono text-xs"
                                value={pattern}
                                onChange={(e) => setPattern(e.target.value)}
                            />
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                                        scope === "project"
                                            ? "border-primary bg-accent"
                                            : "border-border hover:bg-accent/50"
                                    }`}
                                    onClick={() => setScope("project")}
                                >
                                    {t("permissionModal.scopeProject")}
                                </button>
                                <button
                                    type="button"
                                    className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                                        scope === "global"
                                            ? "border-primary bg-accent"
                                            : "border-border hover:bg-accent/50"
                                    }`}
                                    onClick={() => setScope("global")}
                                >
                                    {t("permissionModal.scopeGlobal")}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* DesignSpec：拒绝 = 左侧 close（关闭即裁决为拒绝）；允许在右侧 */}
                <ModalFooter
                    onClose={() => onDecision("deny", scope)}
                    closeLabel={t("permissionModal.deny")}
                >
                    <Button
                        onClick={() =>
                            onDecision(
                                mode === "once" ? "allow_once" : "allow_always",
                                scope
                            )
                        }
                    >
                        {t(
                            mode === "once"
                                ? "permissionModal.allowOnce"
                                : "permissionModal.allowAlways"
                        )}
                    </Button>
                </ModalFooter>
            </DialogContent>
        </Dialog>
    );
}
