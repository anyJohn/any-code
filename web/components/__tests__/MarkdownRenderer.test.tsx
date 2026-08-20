import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

describe("MarkdownRenderer (TEST-006 TC-006.3, B-014, I-002)", () => {
    it("不执行裸 HTML（script 原样文本）", () => {
        const { container } = render(
            <MarkdownRenderer content={'<script>alert(1)</script>'} />
        );
        // react-markdown 默认不渲染裸 HTML：script 标签不应作为 DOM 节点存在
        expect(container.querySelector("script")).toBeNull();
    });

    it("渲染 markdown 基本元素", () => {
        const { container } = render(
            <MarkdownRenderer content={"# h1\n\n**bold** and `code`"} />
        );
        expect(container.querySelector("h1")).not.toBeNull();
        expect(container.querySelector("strong")).not.toBeNull();
        expect(container.querySelector("code")).not.toBeNull();
    });

    it("渲染 GFM 表格", () => {
        const md = "| a | b |\n| - | - |\n| 1 | 2 |";
        const { container } = render(<MarkdownRenderer content={md} />);
        expect(container.querySelector("table")).not.toBeNull();
        expect(container.querySelectorAll("td")).toHaveLength(2);
    });
});
