import "@testing-library/jest-dom/vitest";

// jsdom 无原生 EventSource；测试里按需 mock（见 useAgent 测试）。
