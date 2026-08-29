import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { registerAbility } from "./abilities";

/**
 * 内置能力注册（RR-025 D-9 / SPEC-031 B-008~B-010）——import 即注册。
 * web-fetch / web-search = bundled stdio MCP 连接器；browser-use = skill 编排（浏览器-lite 操作模型）。
 * 连接器 server 文件：随 server bundle（esbuild）同目录 emit 为 builtin-servers/*-server.mjs（P4 构建步骤）。
 * 文件缺失时连接失败 → mcp.ts 单 server 失败不阻断（现有行为），能力随 config 开关。
 */

/** bundled 连接器 server 文件路径（相对本 bundle 位置）。 */
function builtinServerFile(name: "web-fetch" | "web-search"): string {
    return join(
        dirname(fileURLToPath(import.meta.url)),
        "builtin-servers",
        `${name}-server.mjs`
    );
}

const webFetchServer = builtinServerFile("web-fetch");
const webSearchServer = builtinServerFile("web-search");

registerAbility({
    name: "web-fetch",
    kind: "mcp",
    description:
        "抓取网页并转成 markdown 文本。URL 必须是 https；自动处理超时/大小上限。用浏览器无法登录的页面时先试它。",
    server: {
        type: "stdio",
        command: process.execPath,
        args: [webFetchServer],
    },
});

registerAbility({
    name: "web-search",
    kind: "mcp",
    description:
        "网页搜索。返回标题/URL/摘要列表。provider 可配（ddg 无 key 默认 / tavily / bing），未配 apiKey 时用无 key 尽力模式。",
    server: {
        type: "stdio",
        command: process.execPath,
        args: [webSearchServer],
        env: {}, // 运行时由 main.ts 并入 abilities.<name>.config（provider/apiKey）
    },
});

const BROWSER_USE_CONTENT = `# browser-use 技能

用于在浏览器里"浏览网页"的任务：查找信息、阅读内容、收集链接。v1 采用浏览器-lite 操作模型
（真 CDP 浏览器为 v2 路线）——没有独立浏览器进程，用 web-search + web-fetch 组合完成。

## 何时使用

- 用户要求"上网查 / 搜索 / 打开某个网站 / 看看某页面"。
- 需要最新、非训练集内的信息。
- 需要采集多个页面或提取页面链接。

## 工作流程

1. **搜索**：调 web-search 工具，用 \`search(query)\` 定位候选页面。query 要具体（site、关键词组合）。
2. **取页**：对最相关的候选，调 web-fetch 的 \`fetch_url(url)\` 取正文（markdown）。
3. **判读**：若正文不满足，提取其中的链接 → 继续 \`fetch_url\` 追读（最多 3 层，防发散）。
4. **回答**：综合所取内容回答，标注来源 URL。

## 约束

- URL 必须是 \`https://\`；http 明文被拒绝。
- 单次任务 fetch 上限约 10 次，超出停止并说明"浏览深度受限"。
- 不代填登录表单、不执行 JS（v1 无浏览器）；需要交互式浏览时明确告知限制。
- 隐私默认：不把页面内容写入记忆/文件，除非用户要求。
`;

registerAbility({
    name: "browser-use",
    kind: "skill",
    description:
        "浏览网页（搜索 → 抓取 → 判读 → 回答）。网页信息检索、最新资料查询、链接收集。需要最新信息或访问网站时用。",
    content: BROWSER_USE_CONTENT,
});