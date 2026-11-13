// FREE! Update v17408: FUN_002FCD38. These are data-driven predicates, not CRO callbacks.
// The date kinds 0x39〜0x71 are not offered: an EventObject passes no date, so most are always false (lanai-custom-stages
// 3ds/research/event-conditions.md). Neither are 0x6E (writes a global), 0x27 and 0x2E / 0x2F (the main story's save).
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
  14: {
    label: 'ゲーム変数が指定値と等しい',
    first: '変数 ID (0x40 = 島レベル。ほかは未解析)',
    second: '比較する値',
    firstMax: 0xffff,
  },
  15: {
    label: 'ゲーム変数が指定値以上',
    first: '変数 ID (0x40 = 島レベル。ほかは未解析)',
    second: '比較する値',
    firstMax: 0xffff,
  },
  16: {
    label: 'ゲーム変数が指定値以下',
    first: '変数 ID (0x40 = 島レベル。ほかは未解析)',
    second: '比較する値',
    firstMax: 0xffff,
  },
  20: { label: 'アイテムを指定数以上持っている', first: 'アイテム ID', second: '個数' },
  21: { label: 'アイテムを指定数未満しか持っていない', first: 'アイテム ID', second: '個数' },
  22: { label: 'タイマーの残り時間がある', first: 'タイマー番号 (0x17 / 0x18)', firstMax: 0xffff },
  23: { label: 'タイマーの残り時間がない', first: 'タイマー番号 (0x17 / 0x18)', firstMax: 0xffff },
  29: { label: '常に成り立たない (0x1D)' },
  ...Object.fromEntries(
    [2, 3, 4].flatMap((bytes, i) =>
      ['と等しい', '以上', '以下'].map((cmp, j): [number, LanaiConditionType] => [
        0x30 + i * 3 + j,
        {
          label: `数値 ${bytes} つの連結値が指定値${cmp}`,
          first: `先頭の数値番号 (0x52。続く ${bytes} 個をつなげた値)`,
          second: '比較する値',
          firstMax: 0xffff,
          secondMax: 2 ** (bytes * 8) - 1,
        },
      ]),
    ),
  ),
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
