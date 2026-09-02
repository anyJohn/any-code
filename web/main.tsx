import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider as ReduxProvider } from "react-redux";
import { store } from "@/store";
import { AppShell } from "@/components/AppShell";
import { App } from "@/App";
import { TitleBar } from "@/components/TitleBar";
import { isElectron } from "@/lib/electron";
import { LanguageProvider } from "@/i18n";
import "@/globals.css";

// 根布局：h-screen flex-col，承载 app-shell-bg 渐变。桌面端顶部条件渲染 TitleBar
// （无边框窗口的内置控件）；浏览器模式 isElectron()=false，无 TitleBar，AppShell 占满如前。
// LanguageProvider（FR-29）：i18n 上下文，语言偏好 config.ui.language + localStorage 缓存。
createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <ReduxProvider store={store}>
                <LanguageProvider>
                    <div className="h-screen flex flex-col app-shell-bg">
                        {isElectron() && <TitleBar />}
                        <AppShell>
                            <App />
                        </AppShell>
                    </div>
                </LanguageProvider>
            </ReduxProvider>
        </BrowserRouter>
    </StrictMode>,
);
