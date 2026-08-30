import type { ConfigShape } from "@any-code/domain";

/** GET 响应形状（apiKey 已脱敏）。 */
export interface RegisteredAbility {
    name: string;
    kind: "mcp";
    description: string;
    enabled: boolean;
}

export interface ConfigResponse {
    providers: Record<
        string,
        {
            apiKey: string;
            baseURL?: string;
            models: { id: string; name?: string }[];
            defaultModel: string;
            streaming: boolean;
            contextWindow?: number;
            maxOutputTokens?: number;
        }
    >;
    default?: string;
    mcp: Record<string, Record<string, unknown>>;
    /** 内置能力（注册器可枚举 + 当前开关态）。SPEC-031 B-012 */
    abilities?: {
        registered: RegisteredAbility[];
        config: Record<string, Record<string, unknown>>;
    };
}

export interface ProviderForm {
    name: string;
    apiKey: string;
    baseURL: string;
    models: { id: string; name: string }[];
    defaultModel: string;
    streaming: boolean;
    /** contextWindow 输入（字符串，空=auto：探测/模型表/128000） */
    contextWindow: string;
    /** maxOutputTokens 输入（空=auto：探测/模型表/不传 max_tokens） */
    maxOutputTokens: string;
    maskedKey: string;
}

export interface McpForm {
    name: string;
    type: "stdio" | "sse";
    command: string;
    args: string;
    env: string;
    url: string;
    headers: string;
    /** 启用开关（缺省 true；enabled:false 不建连——与 domain mcp.ts 一致） */
    enabled: boolean;
}

export const emptyProvider = (): ProviderForm => ({
    name: "",
    apiKey: "",
    baseURL: "",
    models: [{ id: "", name: "" }],
    defaultModel: "",
    streaming: true,
    contextWindow: "",
    maxOutputTokens: "",
    maskedKey: "",
});

export const emptyMcp = (): McpForm => ({
    name: "",
    type: "stdio",
    command: "",
    args: "",
    env: "",
    url: "",
    headers: "",
    enabled: true,
});

/** 模型测试结果（镜像 domain config.ts ModelTestResult）——Settings「测试模型」展示。 */
export interface ModelTestResult {
    requested_model: string;
    available: boolean;
    first_token_latency_ms?: number;
    total_ms?: number;
    error?: string;
}

// 把多行 KEY=VALUE / KEY:VALUE 文本解析成对象
export function parsePairs(text: string, sep: RegExp): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const idx = trimmed.search(sep);
        if (idx <= 0) continue;
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (k) out[k] = v;
    }
    return out;
}

export function fromResponse(res: ConfigResponse): {
    providers: ProviderForm[];
    default: string;
    mcp: McpForm[];
} {
    const providers: ProviderForm[] = Object.entries(res.providers ?? {}).map(
        ([name, p]) => {
            const models = (p.models ?? []).map((m) => ({
                id: m.id ?? "",
                name: m.name ?? "",
            }));
            // defaultModel 不在 models 中 → 取首个，避免下拉框初始显示空白
            const validIds = models.map((m) => m.id).filter(Boolean);
            const defaultModel =
                p.defaultModel && validIds.includes(p.defaultModel)
                    ? p.defaultModel
                    : validIds[0] ?? "";
            return {
                name,
                apiKey: "",
                baseURL: p.baseURL ?? "",
                models,
                defaultModel,
                streaming: p.streaming ?? true,
                contextWindow: p.contextWindow ? String(p.contextWindow) : "",
                maxOutputTokens: p.maxOutputTokens
                    ? String(p.maxOutputTokens)
                    : "",
                maskedKey: p.apiKey ?? "",
            };
        }
    );
    const mcp: McpForm[] = Object.entries(res.mcp ?? {}).map(([name, s]) => {
        const type = (s.type as "stdio" | "sse") ?? "stdio";
        const form = emptyMcp();
        form.name = name;
        form.type = type;
        form.enabled = s.enabled !== false; // 缺省启用
        if (type === "stdio") {
            form.command = (s.command as string) ?? "";
            form.args = Array.isArray(s.args)
                ? (s.args as string[]).join("\n")
                : "";
            form.env = s.env
                ? Object.entries(s.env as Record<string, string>)
                      .map(([k, v]) => `${k}=${v}`)
                      .join("\n")
                : "";
        } else {
            form.url = (s.url as string) ?? "";
            form.headers = s.headers
                ? Object.entries(s.headers as Record<string, string>)
                      .map(([k, v]) => `${k}:${v}`)
                      .join("\n")
                : "";
        }
        return form;
    });
    if (providers.length === 0) providers.push(emptyProvider());
    if (!res.default && providers[0]) {
        return { providers, default: providers[0].name, mcp };
    }
    return { providers, default: res.default ?? "", mcp };
}

export function toConfigShape(
    providers: ProviderForm[],
    def: string,
    mcp: McpForm[],
    abilityCfg?: Record<string, Record<string, unknown>>,
    abilityOn?: Record<string, boolean>
): ConfigShape {
    const pOut: Record<string, Record<string, unknown>> = {};
    for (const p of providers) {
        const name = p.name.trim();
        if (!name) continue;
        const models = p.models
            .map((m) => ({ id: m.id.trim(), name: m.name.trim() }))
            .filter((m) => m.id);
        // defaultModel 空 + models 非空 → 取首个，避免表单未选导致后端校验失败
        const defaultModel =
            p.defaultModel && models.some((m) => m.id === p.defaultModel)
                ? p.defaultModel
                : models[0]?.id ?? "";
        const entry: Record<string, unknown> = {
            apiKey: p.apiKey,
            models,
            defaultModel,
            streaming: p.streaming,
        };
        if (p.baseURL.trim()) entry.baseURL = p.baseURL.trim();
        // contextWindow：空=auto（不写 yaml，由探测/表/128000 兜底）；填了才写
        if (p.contextWindow.trim()) {
            const n = Number(p.contextWindow);
            if (Number.isFinite(n) && n > 0) entry.contextWindow = n;
        }
        // maxOutputTokens：空=auto（不写 yaml，探测/表/不传 max_tokens）；填了才写
        if (p.maxOutputTokens.trim()) {
            const n = Number(p.maxOutputTokens);
            if (Number.isFinite(n) && n > 0) entry.maxOutputTokens = n;
        }
        pOut[name] = entry;
    }
    const mOut: Record<string, Record<string, unknown>> = {};
    for (const m of mcp) {
        const name = m.name.trim();
        if (!name) continue;
        if (m.type === "stdio") {
            const entry: Record<string, unknown> = { type: "stdio" };
            if (m.command.trim()) entry.command = m.command.trim();
            const args = m.args
                .split("\n")
                .map((a) => a.trim())
                .filter(Boolean);
            if (args.length) entry.args = args;
            const env = parsePairs(m.env, /=/);
            if (Object.keys(env).length) entry.env = env;
            entry.enabled = m.enabled;
            mOut[name] = entry;
        } else {
            const entry: Record<string, unknown> = { type: "sse" };
            if (m.url.trim()) entry.url = m.url.trim();
            const headers = parsePairs(m.headers, /:/);
            if (Object.keys(headers).length) entry.headers = headers;
            entry.enabled = m.enabled;
            mOut[name] = entry;
        }
    }
    return {
        providers: pOut,
        default: def,
        mcp: mOut,
        // 内置能力：只写开关过的条目（保留原始 config 字段：provider/apiKey 等）
        abilities: Object.fromEntries(
            Object.entries(abilityOn ?? {}).map(([name, on]) => [
                name,
                { ...(abilityCfg?.[name] ?? {}), enabled: on },
            ])
        ),
    };
}
