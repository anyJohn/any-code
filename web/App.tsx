import { Routes, Route, Navigate } from "react-router-dom";
import Home from "@/pages/Home";
import Chat from "@/pages/Chat";
import Settings from "@/pages/Settings";

// 客户端路由（react-router v7）。路由路径与 Next 版一致：/ /chat/:sessionId /settings。
export function App() {
    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/chat/:sessionId" element={<Chat />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
