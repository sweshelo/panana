// Fields of 電波人間のRPG3's GS tables (master 21350000), as far as they are understood. Found by comparing the rows with
// RPG2's (docs/analysis.md "itemData.bin") and with what the items do in the game; "unsure" fields are guesses.
import type { FieldDef, TableDef } from '../game/tabledef';

/** Main category (+0x3A low 4 bits). */
export const OAHU_ITEM_KIND: Record<number, string> = { 1: '道具', 2: 'ジュエル', 3: '装備', 4: 'つりざお', 5: 'つりエサ', 6: 'インテリア' };

/** Full category byte (+0x3A): the main category and the sub category in the high 4 bits. */
export const OAHU_ITEM_CATEGORY: Record<number, string> = {
  0x11: '道具 (回復など)',
  0x21: '道具 (たね)',
  0x31: '道具 (水やり)',
  0x41: '道具 (色かえ薬)',
  0x51: '道具 (しんめ)',
  0x61: '道具 (さかな)',
  0x71: '道具 (花)',
  0x81: '道具 (能力のフルーツ)',
  0x91: '道具 (しゅうかくぶつ)',
  0xa1: '道具 (山の幸)',
  0xc1: '道具 (あかし)',
  0xd1: '道具 (大事なもの)',
  0xe1: '道具 (ペイント)',
  0x02: 'ジュエル',
  0x03: '装備 (首)',
  0x13: '装備 (腕)',
  0x23: '装備 (足)',
  0x33: '装備 (背中)',
  0x43: '装備 (服)',
  0x04: 'つりざお',
  0x05: 'つりエサ',
  0x16: 'インテリア (かざり)',
  0x26: 'インテリア (テーブル)',
  0x36: 'インテリア (いす)',
  0x46: 'インテリア (ランプ)',
  0x56: 'インテリア (ベッド)',
  0x66: 'インテリア (ゆか)',
  0x76: 'インテリア (かべ)',
  0x86: 'インテリア (やね)',
};

const f = (key: string, offset: number, type: FieldDef['type'], label: string, more: Partial<FieldDef> = {}): FieldDef => ({ key, offset, type, label, ...more });
const msg = { kind: 'message' } as const;

/** Description messages (+0x18..+0x24). */
export const OAHU_ITEM_TEXTS: [string, number, string][] = [
  ['menu', 0x18, '説明 (メニュー)'],
  ['shop0', 0x1c, '説明 (お店 1)'],
  ['shop1', 0x20, '説明 (お店 2)'],
  ['shop2', 0x24, '説明 (お店 3)'],
];

/** itemData.bin: 1191 rows × 0x40, ID = row (RPG2: 713 × 0x30; the RPG2 fields from +0x08 on moved 8 bytes down). */
export const OAHU_ITEM_DATA: TableDef = {
  file: 'itemData.bin',
  rowSize: 0x40,
  fields: [
    f('price', 0x00, 'u32', '買値'),
    f('sell', 0x04, 'u32', '売値', { note: 'RPG2 と同じ位置。キズぐすり 20 G に 2 G (買値の 1 割)' }),
    f('u08', 0x08, 'u32', '+0x08', { unsure: true, hex: true, note: '0x1A1。空き行・つりざお・大事なものは 0x1A0' }),
    f('u0C', 0x0c, 'u32', '+0x0C', { unsure: true, note: '買値の 5〜8 割ほどの数。RPG2 にない欄で、用途は未確認' }),
    f('flags', 0x10, 'u32', 'フラグ', { unsure: true, hex: true, note: 'RPG2 の +0x08 に当たる' }),
    f('rarity', 0x10, 'u32', '☆', { bits: [15, 3], alias: true, note: 'フラグの bit15-17 (推定。RPG2 の ☆ と多くが同じ)' }),
    f('name', 0x14, 'u32', '名前', { ref: msg }),
    ...OAHU_ITEM_TEXTS.map(([key, o, label]) => f(key, o, 'u32', label, { ref: msg, note: o === 0x18 ? undefined : 'お店ごとの口調 (RPG2 の並びから推定)' })),
    f('model', 0x28, 'u32', 'モデル', { ref: { kind: 'hash' }, note: 'BCH のエントリのハッシュ' }),
    f('equipValue', 0x2c, 's32', '+0x2D', { bits: [8, 18], unsure: true, note: '装備だけ 0 でない数 (−4〜600)。用途は未確認' }),
    f('order', 0x30, 'u16', '並び 1', { note: '並びの番号 (RPG2 の +0x28 に当たる)' }),
    f('order2', 0x32, 'u16', '並び 2', { unsure: true }),
    f('action', 0x34, 'u32', 'アクション', { ref: { kind: 'row', table: 'actionData.bin' }, note: '道具が使うアクション (actionData の行)。装備は効果の値 2 つ' }),
    f('amount1', 0x34, 's16', '効果 1 の値', { alias: true }),
    f('amount2', 0x36, 's16', '効果 2 の値', { alias: true }),
    f('u38', 0x38, 'u16', '+0x38', { unsure: true, note: 'すべて 0' }),
    f('category', 0x3a, 'u8', '分類', { ref: { kind: 'enum', values: OAHU_ITEM_CATEGORY }, note: '下位 4 ビット = 大分類、上位 = 小分類 (RPG2 の +0x2C と同じ)' }),
    f('effect1', 0x3b, 'u8', '効果 1', { note: '装備の効果の種類 (下の表)' }),
    f('effect1Sub', 0x3c, 'u8', '効果 1 の対象', { note: '能力・状態異常・属性の番号' }),
    f('effect2', 0x3d, 'u8', '効果 2'),
    f('effect2Sub', 0x3e, 'u8', '効果 2 の対象'),
    f('limit', 0x3f, 'u8', '上限', { note: '持てる数 (0 = 99)。つりざお・大事なものは 1' }),
  ],
};

/** actionData.bin: 1126 × 0x30 (only what the items use). */
export const OAHU_ACTION_DATA: TableDef = {
  file: 'actionData.bin',
  rowSize: 0x30,
  fields: [
    f('bits', 0x00, 'u32', 'ビット', { unsure: true, hex: true }),
    f('kind', 0x00, 'u32', '種類', { bits: [1, 2], alias: true, ref: { kind: 'enum', values: { 1: 'ワザ', 2: 'アイテム' } }, note: 'RPG2 と同じ bit1-2 と推定' }),
    f('name', 0x08, 'u32', '名前', { ref: msg, note: '道具のアクションは「使った」のメッセージ' }),
    f('help', 0x0c, 'u32', '説明', { ref: msg }),
    f('result1', 0x10, 'u32', '結果 1', { ref: msg }),
    f('result2', 0x14, 'u32', '結果 2', { ref: msg }),
    f('min', 0x18, 'u16', '最小'),
    f('max', 0x1a, 'u16', '最大'),
  ],
};

/** conditionData.bin: 125 × 0x3C. */
export const OAHU_CONDITION_DATA: TableDef = {
  file: 'conditionData.bin',
  rowSize: 0x3c,
  fields: [
    f('icon', 0x00, 'u32', 'アイコン', { ref: { kind: 'hash' }, unsure: true }),
    f('name', 0x04, 'u32', '名前', { ref: msg }),
    f('label', 0x08, 'u32', '表示', { ref: msg }),
    f('resist', 0x0c, 'u32', '効かなかった', { ref: msg }),
    f('hit', 0x10, 'u32', 'なった (1 体)', { ref: msg }),
    f('hitAll', 0x14, 'u32', 'なった (全体)', { ref: msg }),
  ],
};

/** monsterParameter.bin: 201 × 0x70 (naauao oahu/analysis.md §6). */
export const OAHU_MONSTER_PARAMETER: TableDef = {
  file: 'monsterParameter.bin',
  rowSize: 0x70,
  fields: [
    f('name', 0x40, 'u32', '名前', { ref: msg }),
    f('desc', 0x44, 'u32', '説明', { ref: msg }),
  ],
};

export const OAHU_TABLES: Record<string, TableDef> = Object.fromEntries(
  [OAHU_ITEM_DATA, OAHU_ACTION_DATA, OAHU_CONDITION_DATA, OAHU_MONSTER_PARAMETER].map((d) => [d.file, d]),
);

/** Stats of the stat-up effect (0x1B) and elements of the element effects, by their number (+0x3C / +0x3E). */
export const OAHU_STAT: Record<number, string> = { 0: 'さいだいＨＰ', 1: 'さいだいＡＰ', 2: 'こうげき', 3: 'ぼうぎょ', 4: 'すばやさ', 5: 'かいひ' };
export const OAHU_ELEMENT: Record<number, string> = { 1: '火', 2: '氷', 3: '風', 4: '土', 5: '電気', 6: '水', 7: '光', 8: '闇', 9: 'すべての属性' };
export const OAHU_AILMENT: Record<number, string> = {
  1: 'どく', 2: 'やけど', 3: 'みずびたし', 4: 'かぜ', 5: 'どろだらけ', 6: 'のろい', 7: 'かんでん', 8: 'こおり', 9: 'マヒ', 10: 'ねむり', 11: 'ゆうわく',
  20: 'ブラインド', 22: '突然死', 41: 'すべての状態異常',
};

/** What the second byte of an effect names. */
export type EffectSub = 'stat' | 'element' | 'ailment';
/** How the value of an effect reads. */
export type EffectValue = 'plus' | 'percent' | 'element' | 'action' | 'number';

export interface EffectKind {
  label: string;
  sub?: EffectSub;
  value: EffectValue;
}

/**
 * Kinds of the equipment effects (+0x3B / +0x3D), named from the equipment that have them and what RPG2's same
 * equipment do. The others are shown by number.
 */
export const OAHU_EQUIP_EFFECTS: Record<number, EffectKind> = {
  0x05: { label: '固定ダメージ', value: 'number' },
  0x0a: { label: '打撃の属性', value: 'element' },
  0x11: { label: '浮遊', value: 'number' },
  0x14: { label: 'たいせい (状態異常)', sub: 'ailment', value: 'plus' },
  0x15: { label: 'たいせい (属性)', sub: 'element', value: 'plus' },
  0x1b: { label: '能力アップ', sub: 'stat', value: 'plus' },
  0x1c: { label: '使う AP', value: 'percent' },
  0x23: { label: 'ゴールド', value: 'percent' },
  0x24: { label: 'ドロップ率', value: 'percent' },
  0x25: { label: 'レアドロップ率', value: 'percent' },
  0x26: { label: '激レアドロップ率', value: 'percent' },
  0x2d: { label: 'アクション (自動)', value: 'action' },
  0x2e: { label: 'アクション (打撃)', value: 'action' },
  0x2f: { label: 'アクション (ボディ)', value: 'action' },
  0x31: { label: '経験値', value: 'percent' },
};

export const OAHU_EFFECT_SUBS: Record<EffectSub, Record<number, string>> = { stat: OAHU_STAT, element: OAHU_ELEMENT, ailment: OAHU_AILMENT };
