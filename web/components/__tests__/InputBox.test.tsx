import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InputBox } from "@/components/InputBox";
import type { CommandItem } from "@/hooks/useCommand";
import type { FileEntry } from "@/hooks/useFileReference";

// 构造最小可用 props
function makeProps(over: Record<string, unknown> = {}) {
    return {
        draft: "",
        setDraft: vi.fn(),
        pending: false,
        chips: [] as FileEntry[],
        removeChip: vi.fn(),
        popLastChip: vi.fn(),
        commandOpen: false,
        filtered: [] as CommandItem[],
        highlight: 0,
        setHighlight: vi.fn(),
        runCommand: vi.fn(),
        filePopoverOpen: false,
        fileItems: [] as FileEntry[],
        fileHighlight: 0,
        setFileHighlight: vi.fn(),
        selectFile: vi.fn(),
        send: vi.fn(),
        stop: vi.fn(),
        runRawCommand: vi.fn(),
        ...over,
    };
}

describe("InputBox 命令弹层（SPEC-016 AC-004）", () => {
    it("commandOpen → 渲染匹配命令项", () => {
        render(
            <InputBox
                {...makeProps({
                    draft: "/mo",
                    commandOpen: true,
                    filtered: [{ name: "model", desc: "切模型" }],
                })}
            />
        );
        expect(screen.getByText("/model")).toBeTruthy();
        expect(screen.getByText("切模型")).toBeTruthy();
    });

    it("commandOpen + Enter → runCommand(filtered[highlight].name)", () => {
        const props = makeProps({
            draft: "/mo",
            commandOpen: true,
            highlight: 0,
            filtered: [{ name: "model", desc: "" }],
        });
        const { container } = render(<InputBox {...props} />);
        const input = container.querySelector("textarea")!;
        fireEvent.keyDown(input, { key: "Enter" });
        expect(props.runCommand).toHaveBeenCalledWith("model");
    });

    it("commandOpen + ArrowDown → setHighlight 移动", () => {
        const props = makeProps({
            draft: "/mo",
            commandOpen: true,
            filtered: [
                { name: "model", desc: "" },
                { name: "new", desc: "" },
            ],
        });
        const { container } = render(<InputBox {...props} />);
        const input = container.querySelector("textarea")!;
        fireEvent.keyDown(input, { key: "ArrowDown" });
        expect(props.setHighlight).toHaveBeenCalled();
    });

    it("commandOpen + Escape → setDraft(\"\")", () => {
        const props = makeProps({
            draft: "/mo",
            commandOpen: true,
            filtered: [{ name: "model", desc: "" }],
        });
        const { container } = render(<InputBox {...props} />);
        const input = container.querySelector("textarea")!;
        fireEvent.keyDown(input, { key: "Escape" });
        expect(props.setDraft).toHaveBeenCalledWith("");
    });
});

describe("InputBox 文件弹层 + chips（SPEC-016 AC-005）", () => {
    it("filePopoverOpen → 渲染文件项", () => {
        render(
            <InputBox
                {...makeProps({
                    draft: "@rea",
                    filePopoverOpen: true,
                    fileItems: [{ path: "/a/readme.md", name: "readme.md" }],
                })}
            />
        );
        expect(screen.getByText("readme.md")).toBeTruthy();
    });

    it("filePopoverOpen + Enter → selectFile(fileItems[highlight])", () => {
        const props = makeProps({
            draft: "@rea",
            filePopoverOpen: true,
            fileHighlight: 0,
            fileItems: [{ path: "/a/readme.md", name: "readme.md" }],
        });
        const { container } = render(<InputBox {...props} />);
        const input = container.querySelector("textarea")!;
        fireEvent.keyDown(input, { key: "Enter" });
        expect(props.selectFile).toHaveBeenCalledWith({
            path: "/a/readme.md",
            name: "readme.md",
        });
    });

    it("空 draft + chips + Backspace → popLastChip", () => {
        const props = makeProps({
            draft: "",
            chips: [{ path: "/x", name: "x" }],
        });
        const { container } = render(<InputBox {...props} />);
        const input = container.querySelector("textarea")!;
        fireEvent.keyDown(input, { key: "Backspace" });
        expect(props.popLastChip).toHaveBeenCalled();
    });

    it("chips 渲染 + 删除按钮调 removeChip", () => {
        const props = makeProps({
            chips: [{ path: "/x.ts", name: "x.ts" }],
        });
        render(<InputBox {...props} />);
        const delBtn = screen.getByText("×");
        fireEvent.click(delBtn);
        expect(props.removeChip).toHaveBeenCalledWith("/x.ts");
    });
});

describe("InputBox 发送（SPEC-016）", () => {
    it("非弹层 Enter → send()", () => {
        const props = makeProps({ draft: "hello" });
        const { container } = render(<InputBox {...props} />);
        const input = container.querySelector("textarea")!;
        fireEvent.keyDown(input, { key: "Enter" });
        expect(props.send).toHaveBeenCalled();
    });

    it("pending → 显示停止按钮，点击 → stop()", () => {
        const props = makeProps({ pending: true });
        render(<InputBox {...props} />);
        const stopBtn = screen.getByText("停止");
        fireEvent.click(stopBtn);
        expect(props.stop).toHaveBeenCalled();
    });
});

describe("InputBox 多行换行", () => {
    it("Alt+Enter → 插入换行（不 send）", () => {
        const props = makeProps({ draft: "hello" });
        const { container } = render(<InputBox {...props} />);
        const ta = container.querySelector("textarea")!;
        fireEvent.keyDown(ta, { key: "Enter", altKey: true });
        expect(props.setDraft).toHaveBeenCalledWith(
            expect.stringContaining("\n")
        );
        expect(props.send).not.toHaveBeenCalled();
    });

    it("Enter（无修饰）→ send，不插换行", () => {
        const props = makeProps({ draft: "hello" });
        const { container } = render(<InputBox {...props} />);
        const ta = container.querySelector("textarea")!;
        fireEvent.keyDown(ta, { key: "Enter" });
        expect(props.send).toHaveBeenCalled();
        expect(props.setDraft).not.toHaveBeenCalled();
    });
});
