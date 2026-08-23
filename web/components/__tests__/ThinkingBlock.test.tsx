import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThinkingBlock } from "@/components/ThinkingBlock";

// SPEC-015 AC-004: 默认折叠 + 可展开；计时器首段到达开始
describe("ThinkingBlock（SPEC-015）", () => {
    it("AC-004 默认折叠——内容不可见，触发器可见", () => {
        render(<ThinkingBlock content="think-secret" />);
        // 触发器渲染
        expect(screen.getByText("思考")).toBeTruthy();
        // 内容折叠不可见
        expect(screen.queryByText("think-secret")).toBeNull();
    });

    it("AC-004 点击触发器展开——内容可见", () => {
        render(<ThinkingBlock content="think-secret" />);
        const trigger = screen.getByText("思考").closest("button")!;
        fireEvent.click(trigger);
        expect(screen.getByText("think-secret")).toBeTruthy();
    });

    it("B-007 content 空 → 不渲染", () => {
        const { container } = render(<ThinkingBlock content="" />);
        expect(container.firstChild).toBeNull();
    });

    it("AC-004 计时器初始显示 0.0s", () => {
        render(<ThinkingBlock content="think-x" />);
        expect(screen.getByText("0.0s")).toBeTruthy();
    });
});
