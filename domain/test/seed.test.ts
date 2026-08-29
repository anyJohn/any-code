import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { seedBuiltinSkills } from "../src/seed";
import { builtinRoot } from "../src/builtin";
import { resolveSkills } from "../src/skill";
import { createWorkspace } from "../src/workspace";

// 内置技能 seed（首启部署 → ~/.anycode/skills/，幂等不覆盖）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anycode-seed-"));

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("seedBuiltinSkills", () => {
    it("把内置技能目录（SKILL.md + references 递归）拷贝进目标全局目录；连接器目录不 seed", () => {
        const builtin = path.join(tmp, "builtin");
        fs.mkdirSync(path.join(builtin, "akshare", "references"), {
            recursive: true,
        });
        fs.writeFileSync(
            path.join(builtin, "akshare", "SKILL.md"),
            "# akshare\n正文"
        );
        fs.writeFileSync(
            path.join(builtin, "akshare", "references", "api.md"),
            "API-LIST"
        );
        fs.mkdirSync(path.join(builtin, "web-search"));
        fs.writeFileSync(
            path.join(builtin, "web-search", "server.mjs"),
            "// connector"
        );
        const target = path.join(tmp, "global");
        const seeded = seedBuiltinSkills(builtin, target);
        expect(seeded).toEqual(["akshare"]);
        expect(
            fs.readFileSync(path.join(target, "akshare", "SKILL.md"), "utf-8")
        ).toContain("akshare");
        expect(
            fs.readFileSync(
                path.join(target, "akshare", "references", "api.md"),
                "utf-8"
            )
        ).toBe("API-LIST");
        expect(fs.existsSync(path.join(target, "web-search"))).toBe(false);
    });

    it("目标已存在 → 跳过（幂等，不覆盖用户修改）", () => {
        const builtin = path.join(tmp, "builtin2");
        fs.mkdirSync(path.join(builtin, "akshare"), { recursive: true });
        fs.writeFileSync(
            path.join(builtin, "akshare", "SKILL.md"),
            "NEW-VERSION"
        );
        const target = path.join(tmp, "global2");
        fs.mkdirSync(path.join(target, "akshare"), { recursive: true });
        fs.writeFileSync(
            path.join(target, "akshare", "SKILL.md"),
            "USER-EDITED"
        );
        const seeded = seedBuiltinSkills(builtin, target);
        expect(seeded).toEqual([]);
        expect(
            fs.readFileSync(path.join(target, "akshare", "SKILL.md"), "utf-8")
        ).toBe("USER-EDITED");
    });

    it("真实内置目录：连接器目录永不 seed（其余随包技能存在与否不设断言，随仓库演进）", () => {
        const target = path.join(tmp, "home", ".anycode", "skills");
        const seeded = seedBuiltinSkills(builtinRoot(), target);
        // 连接器目录（server.mjs、无 SKILL.md）必须被跳过——无论仓库有哪些随包技能
        for (const name of ["web-fetch", "web-search", "browser-use"]) {
            expect(seeded).not.toContain(name);
        }
    });
});
