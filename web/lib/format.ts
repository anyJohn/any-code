/** token 数紧凑格式化（FR-22）：1234 → "1.2k"，999 → "999"。列表/状态条展示用。 */
export function fmtTokens(n: number): string {
    if (!Number.isFinite(n)) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(Math.round(n));
}
