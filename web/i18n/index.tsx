import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { zh } from "./zh";
import { en } from "./en";

/**
 * 轻量 i18n（FR-29 / SPEC）：扁平字典 + Context + useT()。
 * - 判定序：localStorage 首屏缓存 → config.ui.language（跨端同一偏好，异步拉取后覆盖）
 *   → 系统语言（navigator.language，en* → en，其余 → zh）。
 * - setLanguage：本地即时切换 + localStorage 缓存 + PATCH /api/config 持久化（失败静默）。
 * - t(key, params)：当前语言 → zh 回退 → key 本身；{name} 插值。
 * - 桌面端共享 web 包自动生效；TUI 后续跟进（读同一 config.ui.language）。
 */

export type Language = "zh" | "en";

const DICTS: Record<Language, Record<string, string>> = { zh, en };
const STORAGE_KEY = "anycode:lang";

export type TFn = (key: string, params?: Record<string, string | number>) => string;

function systemLanguage(): Language {
    try {
        return (navigator.language ?? "").toLowerCase().startsWith("en") ? "en" : "zh";
    } catch {
        return "zh";
    }
}

function cachedLanguage(): Language | null {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved === "en" || saved === "zh" ? saved : null;
    } catch {
        return null;
    }
}

function translate(lang: Language): TFn {
    return (key, params) => {
        let s = DICTS[lang][key] ?? DICTS.zh[key] ?? key;
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                s = s.replaceAll(`{${k}}`, String(v));
            }
        }
        return s;
    };
}

interface LanguageContextValue {
    language: Language;
    setLanguage: (l: Language) => void;
    t: TFn;
}

// 缺省值 = zh 直通：未包 Provider 的测试/边缘渲染仍得到与旧文案一致的中文输出
const DefaultValue: LanguageContextValue = {
    language: "zh",
    setLanguage: () => {},
    t: translate("zh"),
};

const LanguageContext = createContext<LanguageContextValue>(DefaultValue);

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [language, setLang] = useState<Language>(
        () => cachedLanguage() ?? systemLanguage()
    );

    // 服务端 config.ui.language 为准（跨端同一偏好）；无配置保持系统语言判定
    useEffect(() => {
        void (async () => {
            try {
                const cfg = (await (await fetch("/api/config")).json()) as {
                    ui?: { language?: Language };
                };
                const lang = cfg?.ui?.language;
                if (lang === "zh" || lang === "en") {
                    try {
                        localStorage.setItem(STORAGE_KEY, lang);
                    } catch {
                        // 存储不可用忽略
                    }
                    setLang((prev) => (prev === lang ? prev : lang));
                }
            } catch {
                // 服务端不可达：保持本地判定
            }
        })();
    }, []);

    const setLanguage = useCallback((l: Language) => {
        setLang(l);
        try {
            localStorage.setItem(STORAGE_KEY, l);
        } catch {
            // 存储不可用忽略
        }
        // 持久化到用户配置（跨端生效）；失败静默——localStorage 已兜底本浏览器
        void fetch("/api/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ language: l }),
        }).catch(() => {});
    }, []);

    const t = useMemo(() => translate(language), [language]);
    const value = useMemo(
        () => ({ language, setLanguage, t }),
        [language, setLanguage, t]
    );
    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** 取当前语言与翻译函数。 */
export function useT(): LanguageContextValue {
    return useContext(LanguageContext);
}
