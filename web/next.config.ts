import type { NextConfig } from "next";

// 安全：domain 的 bash 工具会在服务端执行 LLM 生成的 shell 命令，
// 开发/生产服务器均仅监听本地回环（dev/start 脚本 -H 127.0.0.1）。切勿暴露公网。
//
// domain exports 指向 src/index.ts（TS 源码）。transpilePackages 让 Turbopack/webpack
// 把 domain 当依赖预转译并按模块缓存（预打包一次、跨路由共享，而非逐请求重解析）。
const config: NextConfig = {
    transpilePackages: ["@any-code/domain"],
    // 反代默认缓冲 SSE；事件端点在 handler 内显式设 X-Accel-Buffering: no。
    experimental: {
        serverActions: {
            bodySizeLimit: "5mb",
        },
    },
};

export default config;
