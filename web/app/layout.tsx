import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
    title: "AnyCode Web",
};

// 默认布局：左 sidebar + 右 main(topbar + content)，圆角卡片 + 中间可拖拽分割栏（见 AppShell）。
export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="zh">
            <body>
                <Providers>
                    <AppShell>{children}</AppShell>
                </Providers>
            </body>
        </html>
    );
}
