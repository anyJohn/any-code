import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { createStreamDecoder } from "../src/textDecode";

describe("createStreamDecoder（Windows 控制台 GBK 输出兜底）", () => {
    it("UTF-8 中文正常解码", () => {
        const d = createStreamDecoder();
        expect(d.decode(Buffer.from("你好 world", "utf8"))).toBe("你好 world");
        expect(d.end()).toBe("");
    });

    it("GBK 字节自动回退解码（cmd 工具输出 cp936）", () => {
        const d = createStreamDecoder();
        const gbk = iconv.encode("目录: C:\\Users\\测试", "gbk");
        expect(d.decode(gbk)).toBe("目录: C:\\Users\\测试");
    });

    it("GBK 多字节跨 chunk 不炸（best-effort：边界可能误判，不抛错即可）", () => {
        const d = createStreamDecoder();
        const gbk = iconv.encode("中文输出测试", "gbk");
        expect(() => d.decode(gbk.subarray(0, 3)) + d.decode(gbk.subarray(3))).not.toThrow();
    });

    it("纯 ASCII 不受影响", () => {
        const d = createStreamDecoder();
        expect(d.decode(Buffer.from("ls -la\nerror 1"))).toBe("ls -la\nerror 1");
    });
});
