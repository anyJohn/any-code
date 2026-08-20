import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Providers } from "@/app/providers";

describe("Providers (TEST-003 TC-003.3 SSR 壳)", () => {
    it("渲染子内容不阻塞（空 store 初始 state 可渲染壳）", () => {
        render(
            <Providers>
                <div>shell-content</div>
            </Providers>
        );
        expect(screen.getByText("shell-content")).toBeInTheDocument();
    });
});
