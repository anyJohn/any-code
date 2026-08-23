import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolRow } from "@/components/ToolRow";
import type { AgentEvent } from "@/lib/sseEvents";

// SPEC-016 AC-006: ToolRow 折叠——默认折叠显示摘要，展开显示 result
describe("ToolRow（SPEC-016 AC-006）", () => {
    const toolEvent = (over: Partial<AgentEvent> = {}): AgentEvent =>
        ({
            id: "t1",
            timestamp: 0,
            type: "Tool",
            message: "bash",
            data: { name: "bash", args: { command: "ls" }, result: "file1\nfile2" },
            ...over,
        }) as AgentEvent;

    it("默认折叠——摘要可见，result 不可见", () => {
        render(<ToolRow event={toolEvent()} open={false} onToggle={() => {}} />);
        expect(screen.getByText("bash ls")).toBeTruthy();
        expect(screen.queryByText("file1")).toBeNull();
    });

    it("展开——result 可见", () => {
        render(<ToolRow event={toolEvent()} open={true} onToggle={() => {}} />);
        expect(screen.getByText(/file1/)).toBeTruthy();
    });

    it("点击触发器 → onToggle 被调", () => {
        const onToggle = vi.fn();
        const { container } = render(
            <ToolRow event={toolEvent()} open={false} onToggle={onToggle} />
        );
        const trigger = container.querySelector("button")!;
        fireEvent.click(trigger);
        expect(onToggle).toHaveBeenCalled();
    });
});
