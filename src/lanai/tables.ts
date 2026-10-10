// Fields of 電波人間のRPG FREE!'s GS tables (master 2135000A), as far as they are understood (naauao lanai/monsters.md),
// in the same definitions as RPG2 / RPG3 (game/tabledef.ts): the books read rows through them, show the fields they do
// not use with ui/RowFields, and an editor can take the fields that become known. A string field holds the file offset
// of its string in the table's pool (lanai/table.ts); "unsure" fields are guesses or not known.
import type { FieldDef, TableDef } from '../game/tabledef';

const f = (key: string, offset: number, type: FieldDef['type'], label: string, more: Partial<FieldDef> = {}): FieldDef => ({ key, offset, type, label, ...more });
const str = { kind: 'message' } as const;
const hash = { kind: 'hash' } as const;

/** u32 fields not known yet, from `from` up to the row's end. */
const unknown = (from: number, to: number, skip: number[] = []): FieldDef[] =>
  Array.from({ length: (to - from) >>> 2 }, (_, i) => from + i * 4)
    .filter((o) => !skip.includes(o))
    .map((o) => f(`u${o.toString(16)}`, o, 'u32', `+0x${o.toString(16).toUpperCase()}`, { unsure: true, hex: true }));

export const LANAI_MONSTER_PARAMETER: TableDef = {
  file: 'MonsterParameter',
  rowSize: 0x24,
  fields: [
    f('base', 0x00, 'u32', '元のモンスターの番号', { bits: [0, 10], unsure: true, note: '同じモンスターの重複の行が共有する番号と推定' }),
    f('own', 0x00, 'u32', '+0x00 bit10-19', { bits: [10, 10], unsure: true, note: '重複でない行では bit0-9 と同じ、重複の行では 0' }),
    f('look', 0x00, 'u32', '見た目 (MonsterDesign)', { bits: [20, 10], ref: { kind: 'row', table: 'MonsterDesign' }, note: 'MonsterDesign の行番号。ゲームはこれで見た目を引く (code.bin 0x306E84: lsl #2; lsr #22)' }),
    f('top', 0x00, 'u32', '+0x00 bit30-31', { bits: [30, 2], unsure: true }),
    f('name', 0x04, 'u32', '名前', { ref: str }),
    f('voice', 0x08, 'u32', 'voice', { unsure: true, note: '1 バイトずつの文字列 (半角カナの読み)。音声合成用と推定。多くは空' }),
    f('groupName', 0x0c, 'u32', '群れの名前', { ref: str }),
    f('design', 0x10, 'u32', '+0x10', { unsure: true, hex: true, note: '0x8000xxxx の値。MonsterDesign の行 ID とは 40 行しか合わず、見た目ではない' }),
    f('u14', 0x14, 'u16', '+0x14', { unsure: true }),
    f('u16', 0x16, 'u16', '+0x16', { unsure: true }),
    ...unknown(0x18, 0x24),
  ],
};

export const LANAI_MONSTER_DESIGN: TableDef = {
  file: 'MonsterDesign',
  rowSize: 0xa0,
  fields: [
    f('u0', 0x00, 'u32', '+0x00', { unsure: true, hex: true }),
    f('u4', 0x04, 'u32', '+0x04', { unsure: true, hex: true }),
    f('model', 0x08, 'u32', 'モデル', { ref: hash, note: 'BCH のエントリ (28480000 / 719F0000)' }),
    f('texture', 0x0c, 'u32', '色のテクスチャ', { ref: hash, note: 'モデルのテクスチャを名前で差し替える BCH' }),
    f('motion', 0x10, 'u32', '戦闘のモーション', { ref: hash }),
    f('u14', 0x14, 'u32', '+0x14', { unsure: true, ref: str, note: '一部の行だけ文字列 (再配置される)' }),
    f('u18', 0x18, 'u32', '+0x18', { unsure: true, ref: str, note: '一部の行だけ文字列 (再配置される)' }),
    f('u1c', 0x1c, 'u32', '+0x1C', { unsure: true, hex: true }),
    ...[0x20, 0x24, 0x28, 0x2c, 0x30, 0x38, 0x3c, 0x40, 0x44, 0x48].map((o, i) => f(`size${i}`, o, 'f32', `大きさ ${i + 1}`, { unsure: true, note: '大きさ・距離と推定 (60.0、4.0、1.0 …)' })),
    f('u34', 0x34, 'u32', '+0x34', { unsure: true, ref: str, note: '一部の行だけ文字列 (再配置される)' }),
    ...unknown(0x4c, 0xa0),
  ].sort((a, b) => a.offset - b.offset),
};

/** The definitions by table name. */
export const LANAI_TABLES: Record<string, TableDef> = Object.fromEntries([LANAI_MONSTER_PARAMETER, LANAI_MONSTER_DESIGN].map((d) => [d.file, d]));
