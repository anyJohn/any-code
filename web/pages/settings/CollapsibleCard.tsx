"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** 设置卡片：整 Header 点击折叠（Chevron 旋转指示）；action（添加等）不触发折叠。 */
export function CollapsibleCard({
    title,
    action,
    children,
    defaultOpen = true,
}: {
    title: string;
    action?: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <Card>
                <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer select-none flex-row items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                            <ChevronRight
                                className={cn(
                                    "size-4 shrink-0 text-muted-foreground transition-transform",
                                    open && "rotate-90"
                                )}
                            />
                            <CardTitle className="text-base">{title}</CardTitle>
                        </span>
                        {action && (
                            <span
                                className="shrink-0"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {action}
                            </span>
                        )}
                    </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <CardContent className="flex flex-col gap-3">
                        {children}
                    </CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    );
}