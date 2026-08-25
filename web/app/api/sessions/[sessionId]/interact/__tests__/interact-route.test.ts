import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();

vi.mock("@any-code/domain", () => ({
    resolveInteraction: (...a: unknown[]) => resolveMock(...a),
}));

import { POST as interactPost } from "@/app/api/sessions/[sessionId]/interact/route";

function req(body?: unknown) {
    return new Request("http://x", {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json" },
    });
}
const ctx = () => ({ params: Promise.resolve({ sessionId: "s1" }) });

describe("interact route (AC-004)", () => {
    beforeEach(() => resolveMock.mockReset());

    it("有 id+answers → resolveInteraction 调 + 200 answered", async () => {
        resolveMock.mockReturnValue(true);
        const r = await interactPost(
            req({ interactionId: "i1", answers: ["a1", "a2"] }),
            ctx()
        );
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ status: "answered" });
        expect(resolveMock).toHaveBeenCalledWith("i1", ["a1", "a2"]);
    });

    it("resolveInteraction 返 false（未知/超时/已答）→ 404", async () => {
        resolveMock.mockReturnValue(false);
        const r = await interactPost(
            req({ interactionId: "i1", answers: ["a"] }),
            ctx()
        );
        expect(r.status).toBe(404);
    });

    it("缺 interactionId 或 answers → 400", async () => {
        expect(
            (await interactPost(req({ answers: ["a"] }), ctx())).status
        ).toBe(400);
        expect(
            (await interactPost(req({ interactionId: "i1" }), ctx())).status
        ).toBe(400);
        expect(resolveMock).not.toHaveBeenCalled();
    });

    it("非法 json → 400", async () => {
        const r = await interactPost(
            new Request("http://x", {
                method: "POST",
                body: "not json",
                headers: { "content-type": "application/json" },
            }),
            ctx()
        );
        expect(r.status).toBe(400);
    });
});
