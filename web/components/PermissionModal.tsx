"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PermissionAskData } from "@/hooks/useAgent";
import type { PermissionDecision } from "@/hooks/useAgent";

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
        <Dialog open onOpenChange={() => {}}>
            <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        需要你的许可
                        {data.danger && (
                            <span className="text-[11px] font-medium rounded px-1.5 py-0.5 bg-destructive/15 text-destructive">
                                命中危险命令基线
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
                            {data.pattern ? `匹配：${data.pattern}` : ""}
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
                            允许一次
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
                            永久允许
                        </button>
                    </div>

                    {mode === "always" && (
                        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
                            <label className="text-xs text-muted-foreground">
                                生效范围（匹配模式可编辑）
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
                                    仅当前项目
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
                                    所有项目
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button
                        variant="outline"
                        onClick={() => onDecision("deny", scope)}
                    >
                        拒绝
                    </Button>
                    <Button
                        onClick={() =>
                            onDecision(
                                mode === "once" ? "allow_once" : "allow_always",
                                scope
                            )
                        }
                    >
                        {mode === "once" ? "允许一次" : "永久允许"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
