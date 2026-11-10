// FREE! Update v17408: FUN_002FCD38. naauao PR #77; 0x51/52/53 are separate save arrays.
export interface LanaiCondition { kind: number; v1: number; v2: number }
export const LANAI_CONDITIONS: [number, string][] = [
  [0, '条件なし'], [1, 'コンテンツをクリア済み'], [2, 'コンテンツが未クリア'],
  [3, 'フラグが ON'], [4, 'フラグが OFF'], [5, '数値 ='], [6, '数値 ≥'], [7, '数値 ≤'],
  [8, '常に偽'], [9, '常に真'], [10, '常に偽 (0x0A)'], [11, '常に真 (0x0B)'],
  [12, '現在の MapGroup のイベント状態 ≥'], [13, '現在の MapGroup のイベント状態 ≤'],
  [22, 'タイマーの残り時間がある'], [23, 'タイマーの残り時間がない'], [29, '常に偽 (0x1D)'],
];
export function conditionText(c: LanaiCondition): string {
  if (c.kind === 0x72) return `条件スクリプト #${c.v1}`;
  return `${LANAI_CONDITIONS.find(([k]) => k === c.kind)?.[1] ?? `未解析 0x${c.kind.toString(16)}`} (${c.v1}, ${c.v2})`;
}
