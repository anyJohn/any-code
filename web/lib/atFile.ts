/**
 * 检测 draft 末尾的 @file 引用 token。
 * 规则：@ 前必须是空格或行首才触发（避免 "文字@" / email 误触发）。
 * 返回：null=无活动 @；""=@ 单独（弹全量列表）；"foo"=@foo。
 * SPEC-021 B-008 / DEC-073。
 */
export function matchAtFileToken(draft: string): string | null {
    const m = draft.match(/(?:^|\s)@([^\s@]*)$/);
    return m ? m[1] : null;
}
