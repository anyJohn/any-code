"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ConfigShape } from "@any-code/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";

/** GET 响应形状（apiKey 已脱敏）。 */
interface ConfigResponse {
    providers: Record<
        string,
        {
            apiKey: string;
            baseURL?: string;
            models: { id: string; name?: string }[];
            defaultModel: string;
            streaming: boolean;
            contextWindow?: number;
        }
    >;
    default?: string;
    mcp: Record<string, Record<string, unknown>>;
}

interface ProviderForm {
    name: string;
    apiKey: string;
    baseURL: string;
    models: { id: string; name: string }[];
    defaultModel: string;
    streaming: boolean;
    /** contextWindow 输入（字符串，空=auto：探测/模型表/128000） */
    contextWindow: string;
    maskedKey: string;
}

interface McpForm {
    name: string;
    type: "stdio" | "sse";
    command: string;
    args: string;
    env: string;
    url: string;
    headers: string;
}

const emptyProvider = (): ProviderForm => ({
    name: "",
    apiKey: "",
    baseURL: "",
    models: [{ id: "", name: "" }],
    defaultModel: "",
    streaming: true,
    contextWindow: "",
    maskedKey: "",
});

const emptyMcp = (): McpForm => ({
    name: "",
    type: "stdio",
    command: "",
    args: "",
    env: "",
    url: "",
    headers: "",
});

// 把多行 KEY=VALUE / KEY:VALUE 文本解析成对象
function parsePairs(text: string, sep: RegExp): Record<string, string> {
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

function fromResponse(res: ConfigResponse): {
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
                maskedKey: p.apiKey ?? "",
            };
        }
    );
    const mcp: McpForm[] = Object.entries(res.mcp ?? {}).map(([name, s]) => {
        const type = (s.type as "stdio" | "sse") ?? "stdio";
        const form = emptyMcp();
        form.name = name;
        form.type = type;
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

function toConfigShape(
    providers: ProviderForm[],
    def: string,
    mcp: McpForm[]
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
            mOut[name] = entry;
        } else {
            const entry: Record<string, unknown> = { type: "sse" };
            if (m.url.trim()) entry.url = m.url.trim();
            const headers = parsePairs(m.headers, /:/);
            if (Object.keys(headers).length) entry.headers = headers;
            mOut[name] = entry;
        }
    }
    return {
        providers: pOut,
        default: def,
        mcp: mOut,
    };
}

export default function SettingsPage() {
    const [providers, setProviders] = useState<ProviderForm[]>([]);
    const [def, setDef] = useState("");
    const [mcp, setMcp] = useState<McpForm[]>([]);
    const [status, setStatus] = useState<"loading" | "ready" | "error">(
        "loading"
    );
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setStatus("loading");
        apiJson<ConfigResponse>(`/api/config`).then((res) => {
            if (res === null) {
                setStatus("error");
                return;
            }
            const { providers: ps, default: d, mcp: ms } = fromResponse(res);
            setProviders(ps);
            setDef(d);
            setMcp(ms);
            setStatus("ready");
        });
    }, []);

    const patchProvider = (i: number, patch: Partial<ProviderForm>) =>
        setProviders((p) =>
            p.map((x, idx) => (idx === i ? { ...x, ...patch } : x))
        );
    const addProvider = () =>
        setProviders((p) => [...p, emptyProvider()]);
    const removeProvider = (i: number) =>
        setProviders((p) => p.filter((_, idx) => idx !== i));

    const patchMcp = (i: number, patch: Partial<McpForm>) =>
        setMcp((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
    const addMcp = () => setMcp((p) => [...p, emptyMcp()]);
    const removeMcp = (i: number) =>
        setMcp((p) => p.filter((_, idx) => idx !== i));

    const save = async () => {
        setSaving(true);
        const body = toConfigShape(providers, def, mcp);
        try {
            const res = await fetch(`/api/config`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                toast.success("已保存，下次对话生效");
            } else {
                let text = "保存失败";
                try {
                    const j = (await res.json()) as { statusMessage?: string };
                    if (j.statusMessage) text = j.statusMessage;
                } catch {
                    // body 非 json，忽略
                }
                toast.error(text);
            }
        } catch {
            toast.error("网络错误，保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="w-full max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-bold text-foreground">
                        设置
                    </h1>
                    <span className="text-xs text-muted-foreground font-mono">
                        全局配置 ~/.anycode/config.yaml
                    </span>
                </div>

                {status === "loading" && (
                    <p className="text-sm text-muted-foreground">加载配置中…</p>
                )}
                {status === "error" && (
                    <p className="text-sm text-destructive">
                        加载配置失败，请重试
                    </p>
                )}

                {status === "ready" && (
                    <>
                        {/* Providers */}
                        <Card>
                            <CardHeader className="flex-row items-center justify-between">
                                <CardTitle>模型提供方</CardTitle>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={addProvider}
                                >
                                    <Plus className="size-3.5" /> 添加
                                </Button>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3">
                                {providers.map((p, i) => (
                                    <div
                                        key={i}
                                        className="flex flex-col gap-2 rounded-lg border border-border p-3"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Input
                                                className="h-8 flex-1"
                                                placeholder="名称（如 openai）"
                                                value={p.name}
                                                onChange={(e) =>
                                                    patchProvider(i, {
                                                        name: e.target.value,
                                                    })
                                                }
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-8"
                                                onClick={() => removeProvider(i)}
                                                title="删除"
                                            >
                                                <Trash2 className="size-3.5 text-muted-foreground" />
                                            </Button>
                                        </div>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs text-muted-foreground">
                                                API Key
                                                {p.maskedKey &&
                                                    ` （当前 ${p.maskedKey}，留空不改）`}
                                            </span>
                                            <Input
                                                className="h-8 font-mono"
                                                type="password"
                                                placeholder="留空保留原值"
                                                value={p.apiKey}
                                                onChange={(e) =>
                                                    patchProvider(i, {
                                                        apiKey: e.target.value,
                                                    })
                                                }
                                            />
                                        </label>
                                        <div className="grid grid-cols-1 gap-2">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-muted-foreground">
                                                    Base URL（可选）
                                                </span>
                                                <Input
                                                    className="h-8"
                                                    placeholder="https://..."
                                                    value={p.baseURL}
                                                    onChange={(e) =>
                                                        patchProvider(i, {
                                                            baseURL:
                                                                e.target.value,
                                                        })
                                                    }
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-muted-foreground">
                                                    上下文窗口（留空=自动探测）
                                                </span>
                                                <Input
                                                    className="h-8 font-mono"
                                                    type="number"
                                                    placeholder="留空自动，或填上限（与探测取最小）"
                                                    value={p.contextWindow}
                                                    onChange={(e) =>
                                                        patchProvider(i, {
                                                            contextWindow:
                                                                e.target.value,
                                                        })
                                                    }
                                                />
                                            </label>
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-xs text-muted-foreground">
                                                模型列表
                                            </span>
                                            {p.models.map((m, mi) => (
                                                <div
                                                    key={mi}
                                                    className="flex items-center gap-2"
                                                >
                                                    <Input
                                                        className="h-8 font-mono"
                                                        placeholder="model id（如 gpt-4o）"
                                                        value={m.id}
                                                        onChange={(e) =>
                                                            patchProvider(i, {
                                                                models: p.models.map(
                                                                    (x, xidx) =>
                                                                        xidx === mi
                                                                            ? {
                                                                                  ...x,
                                                                                  id: e.target.value,
                                                                              }
                                                                            : x
                                                                ),
                                                            })
                                                        }
                                                    />
                                                    <Input
                                                        className="h-8"
                                                        placeholder="展示名（可选）"
                                                        value={m.name}
                                                        onChange={(e) =>
                                                            patchProvider(i, {
                                                                models: p.models.map(
                                                                    (x, xidx) =>
                                                                        xidx === mi
                                                                            ? {
                                                                                  ...x,
                                                                                  name: e.target.value,
                                                                              }
                                                                            : x
                                                                ),
                                                            })
                                                        }
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="size-8"
                                                        onClick={() =>
                                                            patchProvider(i, {
                                                                models: p.models.filter(
                                                                    (_, xidx) =>
                                                                        xidx !== mi
                                                                ),
                                                            })
                                                        }
                                                        title="删除模型"
                                                    >
                                                        <Trash2 className="size-3.5 text-muted-foreground" />
                                                    </Button>
                                                </div>
                                            ))}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-fit"
                                                onClick={() =>
                                                    patchProvider(i, {
                                                        models: [
                                                            ...p.models,
                                                            { id: "", name: "" },
                                                        ],
                                                    })
                                                }
                                            >
                                                <Plus className="size-3.5" /> 添加模型
                                            </Button>
                                        </div>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs text-muted-foreground">
                                                默认模型
                                            </span>
                                            <select
                                                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                value={p.defaultModel}
                                                onChange={(e) =>
                                                    patchProvider(i, {
                                                        defaultModel:
                                                            e.target.value,
                                                    })
                                                }
                                            >
                                                {p.models
                                                    .map((m) => m.id.trim())
                                                    .filter(Boolean)
                                                    .map((id) => (
                                                        <option
                                                            key={id}
                                                            value={id}
                                                        >
                                                            {id}
                                                        </option>
                                                    ))}
                                            </select>
                                        </label>
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                className="size-3.5 accent-primary"
                                                checked={p.streaming}
                                                onChange={(e) =>
                                                    patchProvider(i, {
                                                        streaming:
                                                            e.target.checked,
                                                    })
                                                }
                                            />
                                            <span className="text-xs text-muted-foreground">
                                                流式输出
                                            </span>
                                        </label>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        {/* Default provider */}
                        <Card>
                            <CardHeader>
                                <CardTitle>默认提供方</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <select
                                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    value={def}
                                    onChange={(e) => setDef(e.target.value)}
                                >
                                    {providers
                                        .map((p) => p.name.trim())
                                        .filter(Boolean)
                                        .map((name) => (
                                            <option key={name} value={name}>
                                                {name}
                                            </option>
                                        ))}
                                </select>
                            </CardContent>
                        </Card>

                        {/* MCP servers */}
                        <Card>
                            <CardHeader className="flex-row items-center justify-between">
                                <CardTitle>MCP 服务</CardTitle>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={addMcp}
                                >
                                    <Plus className="size-3.5" /> 添加
                                </Button>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3">
                                {mcp.map((m, i) => (
                                    <div
                                        key={i}
                                        className="flex flex-col gap-2 rounded-lg border border-border p-3"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Input
                                                className="h-8 flex-1"
                                                placeholder="服务名称"
                                                value={m.name}
                                                onChange={(e) =>
                                                    patchMcp(i, {
                                                        name: e.target.value,
                                                    })
                                                }
                                            />
                                            <select
                                                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                                                value={m.type}
                                                onChange={(e) =>
                                                    patchMcp(i, {
                                                        type: e.target
                                                            .value as
                                                            | "stdio"
                                                            | "sse",
                                                    })
                                                }
                                            >
                                                <option value="stdio">
                                                    stdio
                                                </option>
                                                <option value="sse">sse</option>
                                            </select>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-8"
                                                onClick={() => removeMcp(i)}
                                                title="删除"
                                            >
                                                <Trash2 className="size-3.5 text-muted-foreground" />
                                            </Button>
                                        </div>
                                        {m.type === "stdio" ? (
                                            <>
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-muted-foreground">
                                                        command
                                                    </span>
                                                    <Input
                                                        className="h-8 font-mono"
                                                        placeholder="npx"
                                                        value={m.command}
                                                        onChange={(e) =>
                                                            patchMcp(i, {
                                                                command:
                                                                    e.target
                                                                        .value,
                                                            })
                                                        }
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-muted-foreground">
                                                        args（每行一个）
                                                    </span>
                                                    <textarea
                                                        className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        rows={3}
                                                        placeholder={"-y\n@modelcontextprotocol/server-filesystem"}
                                                        value={m.args}
                                                        onChange={(e) =>
                                                            patchMcp(i, {
                                                                args: e.target
                                                                    .value,
                                                            })
                                                        }
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-muted-foreground">
                                                        env（每行 KEY=VALUE）
                                                    </span>
                                                    <textarea
                                                        className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        rows={3}
                                                        placeholder={"FOO=bar"}
                                                        value={m.env}
                                                        onChange={(e) =>
                                                            patchMcp(i, {
                                                                env: e.target
                                                                    .value,
                                                            })
                                                        }
                                                    />
                                                </label>
                                            </>
                                        ) : (
                                            <>
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-muted-foreground">
                                                        url
                                                    </span>
                                                    <Input
                                                        className="h-8 font-mono"
                                                        placeholder="https://..."
                                                        value={m.url}
                                                        onChange={(e) =>
                                                            patchMcp(i, {
                                                                url: e.target
                                                                    .value,
                                                            })
                                                        }
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-muted-foreground">
                                                        headers（每行 KEY:VALUE）
                                                    </span>
                                                    <textarea
                                                        className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        rows={3}
                                                        placeholder={"Authorization:Bearer xxx"}
                                                        value={m.headers}
                                                        onChange={(e) =>
                                                            patchMcp(i, {
                                                                headers:
                                                                    e.target
                                                                        .value,
                                                            })
                                                        }
                                                    />
                                                </label>
                                            </>
                                        )}
                                    </div>
                                ))}
                                {mcp.length === 0 && (
                                    <p className="text-sm text-muted-foreground px-1">
                                        暂无 MCP 服务
                                    </p>
                                )}
                            </CardContent>
                        </Card>

                        <div className="flex justify-end">
                            <Button onClick={save} disabled={saving}>
                                {saving ? "保存中…" : "保存"}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
