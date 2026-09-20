import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProviderItem } from "../ProviderItem";
import { emptyProvider } from "../model";

/** 渲染单个 provider 卡片（折叠体默认展开）。 */
function renderItem(over: Partial<ReturnType<typeof emptyProvider>> = {}) {
    const p = { ...emptyProvider(), ...over };
    return render(
        <ProviderItem
            p={p}
            index={0}
            open
            onToggle={vi.fn()}
            nameCommitted="openai"
            nameError={false}
            patchProvider={vi.fn()}
            commitName={vi.fn()}
            removeProvider={vi.fn()}
        />
    );
}

describe("ProviderItem 开关（streaming / vision）", () => {
    it("streaming 用 Switch 渲染（不再是原生 checkbox）", () => {
        renderItem({ streaming: true });
        const sw = screen.getByRole("switch", { name: "流式输出" });
        expect(sw.getAttribute("data-state")).toBe("checked");
    });

    it("streaming=false → Switch 呈未选中态", () => {
        renderItem({ streaming: false });
        expect(
            screen.getByRole("switch", { name: "流式输出" }).getAttribute(
                "data-state"
            )
        ).toBe("unchecked");
    });

    it("每个模型行一个 vision 开关，按模型 vision 值反映选中态", () => {
        renderItem({
            models: [
                { id: "gpt-4o", name: "", vision: true },
                { id: "deepseek-chat", name: "", vision: false },
            ],
        });
        const switches = screen.getAllByRole("switch", { name: "视觉能力" });
        expect(switches).toHaveLength(2);
        expect(switches[0].getAttribute("data-state")).toBe("checked");
        expect(switches[1].getAttribute("data-state")).toBe("unchecked");
    });

    it("DEC-159 缺省开：新增模型行的 vision 开关默认选中", () => {
        renderItem(); // emptyProvider 的默认模型
        expect(
            screen
                .getAllByRole("switch", { name: "视觉能力" })[0]
                .getAttribute("data-state")
        ).toBe("checked");
    });
});
