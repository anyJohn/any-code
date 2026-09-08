import "@testing-library/jest-dom/vitest";

// jsdom 无原生 EventSource；测试里按需 mock（见 useAgent 测试）。

// jsdom 无 scrollIntoView（InputBox 命令弹层键盘导航用）
Element.prototype.scrollIntoView = () => {};
