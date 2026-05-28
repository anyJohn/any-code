import dotenv from "dotenv";
import { resolve } from "node:path";

// 加载用户工作目录下的 .env 文件
dotenv.config({ path: resolve(process.cwd(), ".env") });

export class Config {
    apiKey: string = process.env.OPENAI_API_KEY || "";
    baseURL: string = process.env.OPENAI_BASE_URL || "";
    model: string = process.env.OPENAI_MODEL || "";

    constructor() {}
}
