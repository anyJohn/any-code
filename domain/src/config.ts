import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

/**
 * 从 cwd 向上查找 .env：monorepo 开发时 cwd 在子包目录、.env 在仓库根，
 * 也能找到；打包后在用户项目 cwd 同样适用。
 */
function findEnvUp(startDir: string): string | null {
    let dir = startDir;
    for (;;) {
        const candidate = resolve(dir, ".env");
        if (existsSync(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

const envPath = findEnvUp(process.cwd());
if (envPath) {
    dotenv.config({ path: envPath });
}

export class Config {
    apiKey: string = process.env.OPENAI_API_KEY || "";
    baseURL: string = process.env.OPENAI_BASE_URL || "";
    model: string = process.env.OPENAI_MODEL || "";

    constructor() {}
}
