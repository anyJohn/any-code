import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";

export const metadata: Metadata = {
    title: "AnyCode Web",
};

// 默认布局：左 sidebar + 右 main(topbar + content)。VS Code 式。
export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="zh">
            <body>
                <Providers>
                    <div className="h-screen flex">
                        <aside className="w-64 shrink-0 border-r border-border bg-background">
                            <AppSidebar />
                        </aside>
                        <div className="flex-1 flex flex-col min-w-0">
                            <header className="shrink-0 border-b border-border bg-background">
                                <AppTopbar />
                            </header>
                            <main className="flex-1 min-h-0 overflow-hidden">
                                {children}
                            </main>
                        </div>
                    </div>
                </Providers>
            </body>
        </html>
    );
}
