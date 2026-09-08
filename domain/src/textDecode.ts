import iconv from "iconv-lite";
import { StringDecoder } from "node:string_decoder";

/**
 * 流式子进程输出解码器。优先 UTF-8（StringDecoder 处理跨 chunk 多字节截断），
 * 检出 U+FFFD（非法序列）时按 GBK 重解该 chunk、取替换符更少的结果——
 * Windows 中文系统的控制台工具（cmd 内建命令等）以 cp936 输出，
 * UTF-8 硬解会满屏乱码（bugfix：桌面版工具输出中文全是 ？?）。
 * 混合编码流只能 best-effort，不承诺逐字节无损。
 */
export function createStreamDecoder() {
    const utf8 = new StringDecoder("utf8");
    const badCount = (s: string) => (s.match(/�/g) ?? []).length;
    return {
        decode(chunk: Buffer): string {
            const text = utf8.write(chunk);
            if (!text.includes("�")) return text;
            const gbk = iconv.decode(chunk, "gbk");
            return badCount(gbk) < badCount(text) ? gbk : text;
        },
        end(): string {
            return utf8.end();
        },
    };
}
