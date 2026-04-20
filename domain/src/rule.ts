import fs from "fs";
import path from "path";

const RULE_DIR = path.join(__dirname, "..", "/.agent/rules");

/**
 * 确保规则目录存在
 */
function ensureRuleDir(): void {
    if (!fs.existsSync(RULE_DIR)) {
        fs.mkdirSync(RULE_DIR, { recursive: true });
    }
}

/**
 * 加载所有规则目录下的markdown文件内容，并返回 Prompt 字符串
 * @returns 规则内容
 */
export function loadRule(): string {
    ensureRuleDir();

    const files = fs.readdirSync(RULE_DIR);
    const mdFiles = files.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
        return "";
    }

    // 按文件名排序，确保加载顺序一致
    mdFiles.sort();

    const contents = mdFiles.map((file) => {
        const filePath = path.join(RULE_DIR, file);
        return fs.readFileSync(filePath, "utf-8");
    });

    return `\n# Rule\n${contents.join("\n\n")}\n\n`;
}
