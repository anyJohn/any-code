/**
 * 桌面端（Electron）桥类型与探测。
 * preload 经 contextBridge 暴露 window.anycode；浏览器模式（anycode web）无此对象。
 * 用 isElectron() 判断是否跑在桌面壳内，决定是否渲染 TitleBar 等壳层 UI。
 */
export interface AnycodeDesktopApi {
    isElectron: true;
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    /** 订阅最大化状态变化，返回取消订阅。 */
    onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
}

declare global {
    interface Window {
        anycode?: AnycodeDesktopApi;
    }
}

/** 跑在桌面壳内？浏览器模式 window.anycode 为 undefined。 */
export const isElectron = (): boolean => !!window.anycode?.isElectron;
