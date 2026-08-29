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
function builtinServerFile(name: string): string {
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

registerAbility({
    name: "browser",
    kind: "mcp",
    description:
        "真实浏览器（CDP）：browser_navigate 导航并等加载、browser_content 读 URL/标题/正文、browser_eval 执行 JS（点击/填表/取元素）。需要 abilities.browser.config.cdpUrl（chrome --remote-debugging-port=9222 的 page 级 ws://.../devtools/page/<id>）。",
    server: {
        type: "stdio",
        command: process.execPath,
        args: [builtinServerFile("browser")],
        env: {}, // ABILITY_CONFIG（cdpUrl）由 main.ts 并入
    },
});

const BROWSER_USE_CONTENT = `# browser-use 技能

用于在浏览器里"浏览网页"的任务：查找信息、阅读内容、收集链接、操作页面。
v2：优先使用真浏览器连接器（browser 能力，CDP）；未配置 cdpUrl 时降级浏览器-lite
（web-search + web-fetch 组合）。

## 何时使用

- 用户要求"上网查 / 搜索 / 打开某个网站 / 看看某页面 / 点一下 / 填一下"。
- 需要最新、非训练集内的信息。
- 需要采集多个页面或提取页面链接；需要交互式浏览（点击/填表）。

## 工作流程（browser 连接器可用时）

1. **导航**：\`browser_navigate(url)\` 打开页面（等加载完成，最多 15s）。
2. **读页**：\`browser_content()\` 取 URL/标题/正文。
3. **交互**（如需要）：\`browser_eval("document.querySelector('...').click()")\` 点击/填表/取特定元素。
4. **判读**：正文不满足 → 从页面链接继续 \`browser_navigate\` 追读（最多 5 层，防发散）。
5. **回答**：综合所取内容回答，标注来源 URL。

## 降级模式（未配置 abilities.browser.config.cdpUrl）

1. **搜索**：调 web-search 的 \`search(query)\` 定位候选页面。
2. **取页**：\`fetch_url(url)\` 取正文（markdown）。
3. **判读**：提取链接继续 fetch（最多 3 层），回答并标注 URL。

## 约束

- 新导航只接受 http(s) URL；其他协议拒绝。
- 单次任务导航上限约 5 次，超出停止并说明"浏览深度受限"。
- 不代填登录凭据；敏感操作（下单/删除等）先向用户确认。
- 隐私默认：不把页面内容写入记忆/文件，除非用户要求。
`;

registerAbility({
    name: "browser-use",
    kind: "skill",
    description:
        "浏览网页（导航 → 读页 → 交互 → 回答）。网页信息检索、最新资料查询、链接收集、页面交互。需要最新信息或访问网站时用。",
    content: BROWSER_USE_CONTENT,
});