/**
 * AnyCode 桌面端 preload —— contextBridge 桥。
 * 主进程 contextIsolation:true / nodeIntegration:false，渲染进程不能直调 Electron。
 * 这里经 contextBridge 暴露最小窗口控制 API（window.anycode），IPC 转发到主进程。
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("anycode", {
    isElectron: true,
    minimize: () => ipcRenderer.send("anycode:win-minimize"),
    toggleMaximize: () => ipcRenderer.send("anycode:win-toggle-maximize"),
    close: () => ipcRenderer.send("anycode:win-close"),
    // 最大化状态变化回传（主进程 maximize/unmaximize 事件 → 渲染进程刷新按钮图标）
    onMaximizeChange: (cb: (maximized: boolean) => void): (() => void) => {
        const listener = (_e: unknown, maximized: boolean) => cb(maximized);
        ipcRenderer.on("anycode:win-maximized", listener);
        return () => ipcRenderer.off("anycode:win-maximized", listener);
    },
});
