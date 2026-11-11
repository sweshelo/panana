// FREE! Update v17408: FUN_002FCD38. These are data-driven predicates, not CRO callbacks.
export interface LanaiConditionType {
  label: string;
  first?: string;
  second?: string;
  firstMax?: number;
  secondMax?: number;
}

export const LANAI_CONDITIONS: Record<number, LanaiConditionType> = {
  1: { label: 'コンテンツをクリア済み', first: 'コンテンツ', firstMax: 0xffff },
  2: { label: 'コンテンツを未クリア', first: 'コンテンツ', firstMax: 0xffff },
  3: { label: 'フラグが立っている', first: 'フラグ番号 (0x51)', firstMax: 0xffff },
  4: { label: 'フラグが立っていない', first: 'フラグ番号 (0x51)', firstMax: 0xffff },
  5: {
    label: '数値が指定値と等しい',
    first: '数値番号 (0x52)',
    second: '比較する値',
    firstMax: 0xffff,
    secondMax: 255,
  },
  6: { label: '数値が指定値以上', first: '数値番号 (0x52)', second: '比較する値', firstMax: 0xffff, secondMax: 255 },
  7: { label: '数値が指定値以下', first: '数値番号 (0x52)', second: '比較する値', firstMax: 0xffff, secondMax: 255 },
  8: { label: '常に成り立たない' },
  9: { label: '常に成り立つ' },
  10: { label: '常に成り立たない (0x0A)' },
  11: { label: '常に成り立つ (0x0B)' },
  12: { label: 'イベントの状態が指定値以上', first: 'イベント', second: '状態', secondMax: 3 },
  13: { label: 'イベントの状態が指定値以下', first: 'イベント', second: '状態', secondMax: 3 },
  22: { label: 'タイマーの残り時間がある', first: 'タイマー番号 (0x17 / 0x18)', firstMax: 0xffff },
  23: { label: 'タイマーの残り時間がない', first: 'タイマー番号 (0x17 / 0x18)', firstMax: 0xffff },
  29: { label: '常に成り立たない (0x1D)' },
};

export const lanaiConditionLabel = (kind: number): string =>
  (kind === 0x72 ? '条件スクリプト' : LANAI_CONDITIONS[kind]?.label) ??
  `未解析の条件 0x${kind.toString(16).toUpperCase()}`;

export interface LanaiCondition {
  kind: number;
  v1: number;
  v2: number;
}

export const LANAI_CONDITION_OPTIONS: [number, string][] = [
  [0, '条件なし'],
  ...Object.entries(LANAI_CONDITIONS).map(([kind, spec]): [number, string] => [Number(kind), spec.label]),
];

export function conditionText(c: LanaiCondition): string {
  if (c.kind === 0x72) return `条件スクリプト #${c.v1}`;
  return `${c.kind === 0 ? '条件なし' : lanaiConditionLabel(c.kind)} (${c.v1}, ${c.v2})`;
}
