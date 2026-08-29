import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { TitleBar } from "@/components/TitleBar";

// TitleBar 经 window.anycode（preload contextBridge）调窗口控制。mock 桥验证接线。
describe("TitleBar", () => {
    let api: {
        isElectron: true;
        minimize: ReturnType<typeof vi.fn>;
        toggleMaximize: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        onMaximizeChange: ReturnType<typeof vi.fn>;
    };
    let maximizeCb: ((m: boolean) => void) | null;

    beforeEach(() => {
        maximizeCb = null;
        api = {
            isElectron: true,
            minimize: vi.fn(),
            toggleMaximize: vi.fn(),
            close: vi.fn(),
            onMaximizeChange: vi.fn((cb: (m: boolean) => void) => {
                maximizeCb = cb;
                return () => {};
            }),
        };
        (window as unknown as { anycode?: unknown }).anycode = api;
    });

    afterEach(() => {
        delete (window as unknown as { anycode?: unknown }).anycode;
        cleanup();
    });

    it("渲染 logo 字标 + 三按钮", () => {
        render(<TitleBar />);
        expect(screen.getByText("AnyCode")).toBeTruthy();
        expect(screen.getByTitle("最小化")).toBeTruthy();
        expect(screen.getByTitle("最大化")).toBeTruthy();
        expect(screen.getByTitle("关闭")).toBeTruthy();
    });

    it("点击最小化/最大化/关闭 → 调对应 API", () => {
        render(<TitleBar />);
        fireEvent.click(screen.getByTitle("最小化"));
        expect(api.minimize).toHaveBeenCalled();
        fireEvent.click(screen.getByTitle("关闭"));
        expect(api.close).toHaveBeenCalled();
        fireEvent.click(screen.getByTitle("最大化"));
        expect(api.toggleMaximize).toHaveBeenCalled();
    });

    it("最大化状态回传 → 按钮切还原/最大化图标", () => {
        render(<TitleBar />);
        expect(screen.getByTitle("最大化")).toBeTruthy();
        expect(maximizeCb).not.toBeNull();
        act(() => (maximizeCb as (m: boolean) => void)(true)); // 模拟主进程回传：已最大化
        expect(screen.getByTitle("还原")).toBeTruthy();
        act(() => (maximizeCb as (m: boolean) => void)(false)); // 还原
        expect(screen.getByTitle("最大化")).toBeTruthy();
    });

    it("无 window.anycode（浏览器模式）→ 不渲染", () => {
        delete (window as unknown as { anycode?: unknown }).anycode;
        const { container } = render(<TitleBar />);
        expect(container.firstChild).toBeNull();
    });
});
