import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

/**
 * 外观主题（暗黑模式）：三态 light / dark / system。
 * - 判定序：localStorage 首屏缓存 → config.ui.theme（跨端同一偏好，异步拉取后覆盖）
 *   → 跟随系统（matchMedia prefers-color-scheme，system 态实时监听变化）。
 * - dark 应用方式：documentElement 加 .dark 类（Tailwind v4 @custom-variant dark 已配类策略）。
 * - setTheme：本地即时切换 + localStorage 缓存 + PATCH /api/config 持久化（失败静默）。
 * - 与 LanguageProvider 同管道（config.ui 段）；桌面端共享 web 包自动生效。
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "anycode:theme";

function cachedTheme(): Theme | null {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved === "light" || saved === "dark" || saved === "system"
            ? saved
            : null;
    } catch {
        return null;
    }
}

interface ThemeContextValue {
    theme: Theme;
    setTheme: (t: Theme) => void;
}

// 缺省 = system 直通：未包 Provider 的测试/边缘渲染不改变文档类
const DefaultValue: ThemeContextValue = { theme: "system", setTheme: () => {} };

const ThemeContext = createContext<ThemeContextValue>(DefaultValue);

/** theme 值 → documentElement 的 .dark 类（system 每次重算当前偏好）。 */
function applyTheme(theme: Theme) {
    const dark =
        theme === "dark" ||
        (theme === "system" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(() => cachedTheme() ?? "system");

    // 跟随系统：媒体查询变化实时反映（仅 system 态需要）
    useEffect(() => {
        if (theme !== "system") return;
        applyTheme("system");
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => applyTheme("system");
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [theme]);

    // theme 变化（含首挂载）应用类
    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    // 服务端 config.ui.theme 为准（跨端同一偏好）
    useEffect(() => {
        void (async () => {
            try {
                const cfg = (await (await fetch("/api/config")).json()) as {
                    ui?: { theme?: Theme };
                };
                const t = cfg?.ui?.theme;
                if (t === "light" || t === "dark" || t === "system") {
                    try {
                        localStorage.setItem(STORAGE_KEY, t);
                    } catch {
                        // 存储不可用忽略
                    }
                    setThemeState((prev) => (prev === t ? prev : t));
                }
            } catch {
                // 服务端不可达：保持本地判定
            }
        })();
    }, []);

    const setTheme = useCallback((t: Theme) => {
        setThemeState(t);
        try {
            localStorage.setItem(STORAGE_KEY, t);
        } catch {
            // 存储不可用忽略
        }
        void fetch("/api/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ theme: t }),
        }).catch(() => {});
    }, []);

    const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** 取当前主题与设置函数。 */
export function useTheme(): ThemeContextValue {
    return useContext(ThemeContext);
}
