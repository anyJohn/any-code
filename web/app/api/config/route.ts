import { NextResponse } from "next/server";
import { Config, maskApiKey, type ConfigShape } from "@any-code/domain";

// GET /api/config —— 读全局配置（apiKey 脱敏）
export async function GET() {
    try {
        const cfg = Config.load();
        const providers: Record<string, unknown> = {};
        for (const [name, p] of Object.entries(cfg.providers)) {
            providers[name] = { ...p, apiKey: maskApiKey(p.apiKey) };
        }
        return NextResponse.json({
            providers,
            default: cfg.default,
            mcp: cfg.mcpServers,
        });
    } catch {
        // 无配置 → 返回空骨架，/settings 展示空表单
        return NextResponse.json({ providers: {}, default: undefined, mcp: {} });
    }
}

// POST /api/config —— 写全局配置（校验 + 空 apiKey 保留原值）
export async function POST(req: Request) {
    let body: ConfigShape;
    try {
        body = (await req.json()) as ConfigShape;
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    // 合并：apiKey 空值保留原配置（前端编辑留空=不改）
    let existing: Config | null = null;
    try {
        existing = Config.load();
    } catch {
        // 无现有配置（首次写入）
    }
    const merged: ConfigShape = {
        providers: Object.fromEntries(
            Object.entries(body.providers ?? {}).map(([name, p]) => {
                const keep = p.apiKey?.trim()
                    ? p.apiKey
                    : existing?.providers[name]?.apiKey ?? "";
                return [name, { ...p, apiKey: keep }];
            })
        ),
        default: body.default,
        mcp: body.mcp,
    };
    try {
        Config.save(merged);
        return NextResponse.json({ statusMessage: "saved" });
    } catch (e) {
        return NextResponse.json(
            { statusMessage: (e as Error).message },
            { status: 400 }
        );
    }
}

// PATCH /api/config —— 切换默认 provider（服务端读到的 apiKey 未脱敏，原样写回）
export async function PATCH(req: Request) {
    let body: { default?: string };
    try {
        body = (await req.json()) as { default?: string };
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    const newDefault = body.default?.trim();
    if (!newDefault) {
        return NextResponse.json(
            { statusMessage: "default 不能为空" },
            { status: 400 }
        );
    }
    let cfg: Config;
    try {
        cfg = Config.load();
    } catch (e) {
        return NextResponse.json(
            { statusMessage: (e as Error).message },
            { status: 400 }
        );
    }
    if (!cfg.providers[newDefault]) {
        return NextResponse.json(
            { statusMessage: `provider "${newDefault}" 不存在` },
            { status: 400 }
        );
    }
    try {
        Config.save({
            providers: cfg.providers,
            default: newDefault,
            mcp: cfg.mcpServers,
        });
        return NextResponse.json({ statusMessage: "switched" });
    } catch (e) {
        return NextResponse.json(
            { statusMessage: (e as Error).message },
            { status: 400 }
        );
    }
}
