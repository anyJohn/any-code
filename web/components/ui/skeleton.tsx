import * as React from "react";
import { cn } from "@/lib/utils";

// Skeleton —— loading 占位骨架（animate-pulse）。三态渲染中 loading 态用。
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="skeleton"
            className={cn("animate-pulse rounded-md bg-muted", className)}
            {...props}
        />
    );
}

export { Skeleton };
