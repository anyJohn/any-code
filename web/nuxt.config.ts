// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
    compatibilityVersion: 4,
    devtools: { enabled: false },

    // Tailwind v4（shadcn-vue 依赖）。CSS 入口在 assets/css/main.css。
    css: ["~/assets/css/main.css"],
    vite: {
        plugins: [tailwindcss()],
    },

    // shadcn-vue 组件用显式 import（来自 @/components/ui/* 的 barrel index.ts）。
    // 让 Nuxt 组件扫描只认 .vue，避免 index.ts 与 Button.vue 撞名 UiButton 的告警。
    components: {
        dirs: [{ path: "~/components", extensions: ["vue"] }],
    },

    // ⚠️ 安全：domain 的 bash 工具会在服务端执行 LLM 生成的 shell 命令。
    // 仅监听本地回环，切勿直接暴露公网。详见 docs/web设计.md §6。
    devServer: {
        host: "127.0.0.1",
        port: 3000,
    },

    app: {
        head: {
            title: "AnyCode Web",
            meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
        },
    },

    // @any-code/domain 是 workspace 里的 TS 源码包（exports 指向 src/index.ts），
    // Nitro 默认 externalize node_modules，会让 Node 直接 require .ts 而失败。
    // 这里强制 inline，让 Nitro 打包时一起转译。
    nitro: {
        externals: {
            inline: ["@any-code/domain"],
        },
        // 反代默认缓冲 SSE，关闭以让事件实时下发
        routeRules: {
            "/api/agents/*/events": { headers: { "X-Accel-Buffering": "no" } },
        },
    },

    // 前端只 import domain 的类型（import type），不把 domain 的 Node 代码打进客户端
    typescript: {
        strict: true,
    },
});
