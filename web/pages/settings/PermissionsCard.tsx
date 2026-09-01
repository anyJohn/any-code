"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "./CollapsibleCard";
import { apiJson } from "@/lib/api";
import { useAppSelector } from "@/hooks/useRedux";
import type { PermissionRuleForm } from "./model";

/** 预设模式三档（SPEC-032 B-009/D-008）。 */
const MODES: { value: "standard" | "accept_edits" | "trusted"; label: string; desc: string }[] = [
    { value: "standard", label: "标准", desc: "命令 / 写文件 / MCP 都先询问（出厂默认）" },
    { value: "accept_edits", label: "编辑放行", desc: "写文件自动放行，命令与 MCP 仍询问" },
    { value: "trusted", label: "信任", desc: "全部直通（危险命令基线仍拦截）" },
];

const ACTIONS: { value: PermissionRuleForm["action"]; label: string }[] = [
    { value: "allow", label: "允许" },
    { value: "ask", label: "询问" },
    { value: "deny", label: "拒绝" },
];

/**
 * 权限卡片（SPEC-032 B-010）：模式三档切换 + 全局规则增删 + 危险命令基线增删；
 * 选中工作区时展示项目级规则（只读来源 .anycode/permissions.yaml，可删除）。
 */
export function PermissionsCard({
    mode,
    rules,
    dangerPatterns,
    onMode,
    onRules,
    onDangerPatterns,
}: {
    mode: "standard" | "accept_edits" | "trusted";
    rules: PermissionRuleForm[];
    dangerPatterns: string[];
    onMode: (m: "standard" | "accept_edits" | "trusted") => void;
    onRules: (rules: PermissionRuleForm[]) => void;
    onDangerPatterns: (patterns: string[]) => void;
}) {
    const workspace = useAppSelector((s) => s.workspace.selected);
    const [projectRules, setProjectRules] = useState<PermissionRuleForm[]>([]);
    // 新增规则草稿
    const [draft, setDraft] = useState<PermissionRuleForm>({
        tool: "",
        pattern: "",
        action: "allow",
    });
    const [newDanger, setNewDanger] = useState("");

    useEffect(() => {
        if (!workspace?.projectKey) {
            setProjectRules([]);
            return;
        }
        apiJson<{ rules: PermissionRuleForm[] }>(
            `/api/workspaces/${workspace.projectKey}/permissions`
        ).then((res) => setProjectRules(res?.rules ?? []));
    }, [workspace?.projectKey]);

    const removeProjectRule = async (idx: number) => {
        if (!workspace?.projectKey) return;
        const next = projectRules.filter((_, i) => i !== idx);
        setProjectRules(next);
        await fetch(`/api/workspaces/${workspace.projectKey}/permissions`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ rules: next }),
        });
    };

    const addRule = () => {
        const tool = draft.tool.trim();
        if (!tool) return;
        onRules([...rules, { tool, pattern: draft.pattern.trim(), action: draft.action }]);
        setDraft({ tool: "", pattern: "", action: "allow" });
    };

    const addDanger = () => {
        const p = newDanger.trim();
        if (!p || dangerPatterns.includes(p)) return;
        onDangerPatterns([...dangerPatterns, p]);
        setNewDanger("");
    };

    const ruleLabel = (r: { tool: string; pattern?: string; action: string }) =>
        `${r.tool}${r.pattern ? `(${r.pattern})` : ""} → ${r.action}`;

    return (
        <CollapsibleCard title="工具权限">
            <div className="flex flex-col gap-4 px-1">
                {/* 模式三档 */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">预设模式</span>
                    <div className="flex flex-col gap-1.5">
                        {MODES.map((m) => (
                            <button
                                key={m.value}
                                type="button"
                                className={`text-left text-sm px-2.5 py-1.5 rounded-md border transition-colors ${
                                    mode === m.value
                                        ? "border-primary bg-accent"
                                        : "border-border hover:bg-accent/50"
                                }`}
                                onClick={() => onMode(m.value)}
                            >
                                <span className="font-medium">{m.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {m.desc}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 全局规则 */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                        全局规则（所有项目生效；按顺序匹配，后面的覆盖前面的）
                    </span>
                    {rules.map((r, i) => (
                        <div
                            key={i}
                            className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
                        >
                            <span className="font-mono text-xs truncate">
                                {ruleLabel(r)}
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs text-destructive"
                                onClick={() => onRules(rules.filter((_, j) => j !== i))}
                            >
                                删除
                            </Button>
                        </div>
                    ))}
                    <div className="flex items-center gap-1.5">
                        <Input
                            className="h-7 text-xs font-mono w-28"
                            placeholder="工具名（bash）"
                            value={draft.tool}
                            onChange={(e) => setDraft({ ...draft, tool: e.target.value })}
                        />
                        <Input
                            className="h-7 text-xs font-mono flex-1"
                            placeholder="匹配模式（可选，如 npm * / src/**）"
                            value={draft.pattern}
                            onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
                        />
                        <select
                            className="h-7 text-xs rounded-md border border-border bg-background px-1"
                            value={draft.action}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    action: e.target.value as PermissionRuleForm["action"],
                                })
                            }
                        >
                            {ACTIONS.map((a) => (
                                <option key={a.value} value={a.value}>
                                    {a.label}
                                </option>
                            ))}
                        </select>
                        <Button size="sm" className="h-7 px-2 text-xs" onClick={addRule}>
                            添加
                        </Button>
                    </div>
                </div>

                {/* 项目级规则（选中工作区时展示） */}
                {workspace?.projectKey && (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-muted-foreground">
                            项目级规则（{workspace.name} /.anycode/permissions.yaml）
                        </span>
                        {projectRules.length === 0 && (
                            <span className="text-xs text-muted-foreground px-1">
                                （无——裁决"永久允许"时自动产生）
                            </span>
                        )}
                        {projectRules.map((r, i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
                            >
                                <span className="font-mono text-xs truncate">
                                    {ruleLabel(r)}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs text-destructive"
                                    onClick={() => removeProjectRule(i)}
                                >
                                    删除
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                {/* 危险命令基线 */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                        危险命令基线（命中即询问，任何模式不可越过）
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                        {dangerPatterns.map((p) => (
                            <span
                                key={p}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-xs"
                            >
                                {p}
                                <button
                                    type="button"
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={() =>
                                        onDangerPatterns(dangerPatterns.filter((x) => x !== p))
                                    }
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Input
                            className="h-7 text-xs font-mono w-48"
                            placeholder="新增基线模式（子串匹配）"
                            value={newDanger}
                            onChange={(e) => setNewDanger(e.target.value)}
                        />
                        <Button size="sm" className="h-7 px-2 text-xs" onClick={addDanger}>
                            添加
                        </Button>
                    </div>
                </div>
            </div>
        </CollapsibleCard>
    );
}
