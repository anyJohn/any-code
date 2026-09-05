"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    ModalFooter,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { InteractionData } from "@/hooks/useAgent";
import { useT } from "@/i18n";

/**
 * InteractionModal —— ask_question 工具阻塞时弹的模态。
 * 服务端 agentLoop 阻塞等答案；用户在此选/输入→提交→POST /interact 解除。
 * 每个问题：header + 问题 + 选项（单选按钮行 / 多选 toggle）+ Other 自由输入；无选项→纯输入。
 */
export function InteractionModal({
    data,
    onSubmit,
    onClose,
}: {
    data: InteractionData;
    onSubmit: (answers: string[]) => void;
    onClose: () => void;
}) {
    const { t } = useT();
    const n = data.questions.length;
    const [answers, setAnswers] = useState<string[]>(() =>
        Array.from({ length: n }, () => "")
    );
    // 数据切换（新问题）时重置
    useEffect(() => {
        setAnswers(Array.from({ length: n }, () => ""));
    }, [n, data.id]);

    const setAns = (i: number, v: string) =>
        setAnswers((prev) => prev.map((a, j) => (j === i ? v : a)));

    const allAnswered = answers.every((a) => a.trim() !== "");

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t("interactionModal.title")}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto py-1">
                    {data.questions.map((q, i) => (
                        <div key={i} className="flex flex-col gap-1.5">
                            {q.header && (
                                <span className="text-[11px] font-mono uppercase text-muted-foreground">
                                    {q.header}
                                </span>
                            )}
                            <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                                {q.question}
                            </p>
                            {q.options && q.options.length > 0 ? (
                                <>
                                    <div className="flex flex-col gap-1">
                                        {q.options.map((opt) => {
                                            const selected =
                                                !q.multiSelect
                                                    ? answers[i] === opt
                                                    : (answers[i] || "")
                                                          .split(", ")
                                                          .includes(opt);
                                            return (
                                                <button
                                                    key={opt}
                                                    type="button"
                                                    className={cn(
                                                        "text-left text-sm px-2.5 py-1.5 rounded-md border transition-colors",
                                                        selected
                                                            ? "border-primary bg-accent"
                                                            : "border-border hover:bg-accent/50"
                                                    )}
                                                    onClick={() => {
                                                        if (q.multiSelect) {
                                                            const cur = (
                                                                answers[i] || ""
                                                            )
                                                                .split(", ")
                                                                .filter(Boolean);
                                                            const next = cur.includes(
                                                                opt
                                                            )
                                                                ? cur.filter(
                                                                      (x) =>
                                                                          x !== opt
                                                                  )
                                                                : [...cur, opt];
                                                            setAns(
                                                                i,
                                                                next.join(", ")
                                                            );
                                                        } else {
                                                            setAns(i, opt);
                                                        }
                                                    }}
                                                >
                                                    {opt}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs text-muted-foreground shrink-0">
                                            Other:
                                        </span>
                                        <Input
                                            className="h-7 text-sm"
                                            placeholder={t(
                                                "interactionModal.otherPlaceholder"
                                            )}
                                            value={
                                                // 若 answers[i] 不在 options 里 → 它是 Other 文本
                                                q.options.includes(answers[i])
                                                    ? ""
                                                    : q.multiSelect
                                                    ? ""
                                                    : answers[i]
                                            }
                                            onChange={(e) =>
                                                setAns(i, e.target.value)
                                            }
                                        />
                                    </div>
                                </>
                            ) : (
                                <Input
                                    className="h-8 text-sm"
                                    placeholder={t(
                                        "interactionModal.answerPlaceholder"
                                    )}
                                    value={answers[i]}
                                    onChange={(e) =>
                                        setAns(i, e.target.value)
                                    }
                                    autoFocus={i === 0}
                                />
                            )}
                        </div>
                    ))}
                </div>
                <ModalFooter onClose={onClose} closeLabel={t("interactionModal.stopTask")}>
                    <Button
                        disabled={!allAnswered}
                        onClick={() => onSubmit(answers)}
                    >
                        {t("interactionModal.submit")}
                    </Button>
                </ModalFooter>
            </DialogContent>
        </Dialog>
    );
}
