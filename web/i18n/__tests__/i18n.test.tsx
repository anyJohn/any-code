import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LanguageProvider, useT } from "@/i18n";

// FR-29：Provider 判定序（localStorage → config.ui.language → 系统语言）、
// t 回退链（en → zh → key 本身）、插值、切换持久化（localStorage + PATCH /api/config）。
function Probe() {
    const { t, language, setLanguage } = useT();
    return (
        <div>
            <span data-testid="lang">{language}</span>
            <span data-testid="cancel">{t("common.cancel")}</span>
            <span data-testid="interp">
                {t("permissionModal.matchPattern", { pattern: "rm *" })}
            </span>
            <span data-testid="missing">{t("no.such.key")}</span>
            <button
                data-testid="toggle"
                onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
            />
        </div>
    );
}

describe("i18n（FR-29）", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
        );
    });
    afterEach(() => vi.unstubAllGlobals());

    it("缺省上下文（无 Provider）：zh 值 + {param} 插值 + 未知 key 原样回退", () => {
        render(<Probe />);
        expect(screen.getByTestId("lang").textContent).toBe("zh");
        expect(screen.getByTestId("cancel").textContent).toBe("取消");
        expect(screen.getByTestId("interp").textContent).toBe("匹配：rm *");
        expect(screen.getByTestId("missing").textContent).toBe("no.such.key");
    });

    it("切换语言：字典生效 + localStorage 缓存 + PATCH /api/config 持久化", async () => {
        localStorage.setItem("anycode:lang", "en");
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        render(<LanguageProvider>
            <Probe />
        </LanguageProvider>);
        await act(async () => {
            screen.getByTestId("toggle").click();
        });
        expect(screen.getByTestId("lang").textContent).toBe("zh");
        expect(screen.getByTestId("cancel").textContent).toBe("取消");
        expect(localStorage.getItem("anycode:lang")).toBe("zh");
        const patch = f.mock.calls.find(
            ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
        );
        expect(patch).toBeTruthy();
        expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({
            language: "zh",
        });
    });

    it("config.ui.language 优先于本地缓存（跨端同一偏好）", async () => {
        localStorage.setItem("anycode:lang", "zh");
        const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockResolvedValue(
            new Response(JSON.stringify({ ui: { language: "en" } }), { status: 200 })
        );
        render(<LanguageProvider>
            <Probe />
        </LanguageProvider>);
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByTestId("lang").textContent).toBe("en");
        expect(screen.getByTestId("cancel").textContent).toBe("Cancel");
    });

    it("config 未设语言 → 跟随系统语言（en* → en）", async () => {
        const orig = navigator.language;
        Object.defineProperty(window.navigator, "language", {
            value: "en-US",
            configurable: true,
            writable: true,
        });
        try {
            render(<LanguageProvider>
                <Probe />
            </LanguageProvider>);
            await act(async () => {
                await Promise.resolve();
            });
            expect(screen.getByTestId("lang").textContent).toBe("en");
        } finally {
            Object.defineProperty(window.navigator, "language", {
                value: orig,
                configurable: true,
                writable: true,
            });
        }
    });
});
