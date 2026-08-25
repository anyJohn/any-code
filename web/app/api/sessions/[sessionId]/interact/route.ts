import { NextResponse } from "next/server";
import { resolveInteraction } from "@any-code/domain";

// POST /api/sessions/:sessionId/interact  body: { interactionId, answers: string[] }
// 回答 ask_question 工具阻塞等待的 pending 交互。answers 与 questions 顺序对齐。
// 不查 session 存在性 / single-flight——id-keyed 注册表 resolve 未知 id 即 404。
export async function POST(
    req: Request,
    ctx: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
    await ctx.params; // validate route shape
    let body: { interactionId?: string; answers?: string[] } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { statusMessage: "invalid json body" },
            { status: 400 }
        );
    }
    const id = body?.interactionId?.trim();
    const answers = body?.answers;
    if (!id || !Array.isArray(answers)) {
        return NextResponse.json(
            { statusMessage: "interactionId and answers[] required" },
            { status: 400 }
        );
    }
    const ok = resolveInteraction(id, answers);
    if (!ok) {
        return NextResponse.json(
            { statusMessage: "interaction not found (timed out, aborted, or already answered)" },
            { status: 404 }
        );
    }
    return NextResponse.json({ status: "answered" });
}
