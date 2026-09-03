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

    // bugfix：时长从事件时间戳推导——中途退出再进入（重放/历史恢复）显示真实时长，
    // 且已结束的思考纯静态渲染，不再从挂载时刻重跑计时窗口。
    it("finished + 起止时间戳 → 静态显示真实时长（不随挂载时刻漂移）", () => {
        const start = Date.now() - 60_000;
        render(
            <ThinkingBlock
                content="think-x"
                finished
                startedAt={start}
                endedAt={start + 4200}
            />
        );
        expect(screen.getByText("4.2s")).toBeTruthy();
    });

    it("进行中（未 finished，live）→ 从 startedAt 实时计时", () => {
        const start = Date.now() - 3000;
        render(<ThinkingBlock content="think-x" startedAt={start} live />);
        const el = screen.getByText(/s$/);
        const v = parseFloat(el.textContent ?? "0");
        expect(v).toBeGreaterThanOrEqual(3);
    });

    it("孤儿开思考（非 live 且无结束戳）→ 静态 0.0s，不跳表", () => {
        const start = Date.now() - 60_000;
        render(<ThinkingBlock content="think-x" startedAt={start} />);
        expect(screen.getByText("0.0s")).toBeTruthy();
    });
});
