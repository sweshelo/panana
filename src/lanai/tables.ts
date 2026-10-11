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
    f('design', 0x10, 'u32', '図鑑の説明文', { ref: { kind: 'row', table: 'MessageFlavor' }, note: 'MessageFlavor (4177000A) の行 ID (naauao lanai/monsters.md §2)' }),
    f('statsRow', 0x14, 'u16', '能力の行', { note: '+0x16 bit0-2 の表の行番号。能力の行は複数のモンスターで共有されることがある' }),
    f('statsTable', 0x16, 'u16', '能力の表', { bits: [0, 3], ref: { kind: 'enum', values: { 0: 'Main (0 は 1 扱い)', 1: 'Main', 2: 'Extra', 3: 'RegularEvent', 4: 'SpecialEvent' } } }),
    f('u16b3', 0x16, 'u16', '+0x16 bit3', { bits: [3, 1], unsure: true, note: 'ボス・強敵に多い。用途未確認' }),
    f('bookNo', 0x16, 'u16', '+0x16 bit4-15', { bits: [4, 12], unsure: true, note: '倒したときに登録する図鑑番号と推定' }),
    ...unknown(0x18, 0x24),
  ],
};

const action = { kind: 'row', table: 'ActionData' } as const;
const RES = (key: string, offset: number, shift: number, label: string): FieldDef => f(key, offset, 's32', label, { bits: [shift, 5] });

/** The elements of the resistances (w9 bit5-29, w10 bit0-14; naauao lanai/monsters.md §4.1). */
export const LANAI_ELEMENTS: [key: string, label: string][] = [['fire', '火'], ['ice', '氷'], ['wind', '風'], ['earth', '土'], ['thunder', '電気'], ['water', '水'], ['light', '光'], ['dark', '闇']];
/** The 18 states of the resistances (w11〜w13 in order). */
export const LANAI_STATES: [key: string, label: string][] = [
  ['poison', '毒'], ['burn', 'やけど'], ['soak', 'みずびたし'], ['cold', 'かぜっぴき'], ['mud', 'どろだらけ'], ['curse', '呪い'],
  ['shock', 'かんでん'], ['frost', 'しもやけ'], ['paralysis', 'マヒ'], ['sleep', 'ねむり'], ['blind', 'ブラインド'], ['atkDown', '攻撃力ダウン'],
  ['defDown', '防御力ダウン'], ['spdDown', '素早さダウン'], ['evaDown', '回避率ダウン'], ['death', '突然死'], ['charm', 'ゆうわく'], ['fear', 'きょうふ'],
];
/** The race types: +0x8D bit0-7 and +0x8E bit0. */
export const LANAI_RACES: [key: string, label: string][] = [['good', 'ぜん'], ['evil', 'あく'], ['spirit', '霊'], ['dragon', '竜'], ['beast', '獣'], ['demon', '魔'], ['insect', '虫'], ['aquatic', '水生'], ['plant', '植物']];
/** The action slots of an ability row with the condition byte of each (naauao lanai/monsters.md §3, §7). */
export const LANAI_AUTO_SLOTS: { key: string; cond?: string; label: string }[] = [
  { key: 'actBattle', label: '戦闘開始時' },
  { key: 'actTurnStart', cond: 'condTurnStart', label: 'ターン開始時' },
  { key: 'actHit1', cond: 'condHit1', label: '被弾時 1' },
  { key: 'actHit2', cond: 'condHit2', label: '被弾時 2' },
  { key: 'actTurnEnd', cond: 'condTurnEnd', label: 'ターン終了時' },
];

/** One ability row (MonsterParameterMain / Extra / RegularEvent / SpecialEvent, 0x9C, bit-packed; naauao lanai/monsters.md §3). */
const statsFields: FieldDef[] = [
  f('weight', 0x00, 'u32', '狙われやすさ', { bits: [0, 10], note: '対象を選ぶときの重み (標準 100)。推定' }),
  f('w0b10', 0x00, 'u32', '+0x00 bit10-11', { bits: [10, 2], unsure: true }),
  f('level', 0x00, 'u32', 'Lv', { bits: [12, 10] }),
  f('exp', 0x04, 'u32', '経験値', { bits: [0, 22] }),
  f('gold', 0x08, 'u32', 'ゴールド', { bits: [0, 22] }),
  f('ab27', 0x08, 'u32', '+0x08 bit22 (能力 0x27)', { bits: [22, 1], unsure: true }),
  ...[0, 1, 2, 3].map((i) => f(`drop${i + 1}`, 0x0c + i * 4, 'u32', `ドロップ ${i + 1}`, { ref: { kind: 'row', table: 'ItemData' }, note: 'ItemData の行 ID (0 = なし)' })),
  f('drop5', 0x1c, 'u32', 'ドロップ 5 (未使用)', { unsure: true, hex: true }),
  f('drop6', 0x20, 'u32', 'ドロップ 6 (未使用)', { unsure: true, hex: true }),
  f('res0', 0x24, 's32', '属性 0 (未使用)', { bits: [0, 5], unsure: true }),
  ...LANAI_ELEMENTS.map(([k, l], i) => (i < 5 ? RES(k, 0x24, 5 + i * 5, `${l}たいせい`) : RES(k, 0x28, (i - 5) * 5, `${l}たいせい`))),
  ...LANAI_STATES.map(([k, l], i) => RES(k, 0x2c + Math.floor(i / 6) * 4, (i % 6) * 5, `${l}たいせい`)),
  f('actBattle', 0x38, 'u32', '戦闘開始時の行動', { ref: action }),
  f('actDefault', 0x3c, 'u32', '+0x3C の行動', { ref: action, unsure: true, note: '全行にある。通常攻撃・既定の行動と推定' }),
  f('actTurnStart', 0x40, 'u32', 'ターン開始時の行動', { ref: action }),
  f('actHit1', 0x44, 'u32', '被弾時の行動 1', { ref: action }),
  f('actHit2', 0x48, 'u32', '被弾時の行動 2', { ref: action }),
  f('actTurnEnd', 0x4c, 'u32', 'ターン終了時の行動', { ref: action }),
  f('morph30', 0x50, 'u32', '系統 30 の変身先 (先読み)', { ref: { kind: 'row', table: 'MonsterParameter' }, note: '0 = なし' }),
  ...[0, 1, 2, 3, 4, 5].map((i) => f(`skill${i + 1}`, 0x54 + i * 4, 'u32', `ワザ ${i + 1}`, { ref: action })),
  // per slot 6 bits of target rule + 3 bits of level; slots 1-3 in +0x6C/+0x6E, 4-6 the same in +0x70/+0x72
  ...[0, 1].flatMap((g) => {
    const o = 0x6c + g * 4, n = g * 3;
    return [
      f(`target${n + 1}`, o, 'u16', `ワザ ${n + 1} の狙い方`, { bits: [0, 6] }),
      f(`slotLv${n + 1}`, o, 'u16', `ワザ ${n + 1} のレベル`, { bits: [6, 3] }),
      f(`target${n + 2}`, o, 'u16', `ワザ ${n + 2} の狙い方`, { bits: [9, 6] }),
      f(`slotLv${n + 2}`, o + 2, 'u16', `ワザ ${n + 2} のレベル`, { bits: [0, 3] }),
      f(`target${n + 3}`, o + 2, 'u16', `ワザ ${n + 3} の狙い方`, { bits: [3, 6] }),
      f(`slotLv${n + 3}`, o + 2, 'u16', `ワザ ${n + 3} のレベル`, { bits: [9, 3] }),
    ];
  }),
  f('treasure', 0x74, 'u16', '+0x74 bit0 (お宝系)', { bits: [0, 1], unsure: true }),
  f('hpHi', 0x76, 'u16', '最大 HP (上)'),
  f('hpLo', 0x78, 'u16', '最大 HP (下)'),
  f('atkHi', 0x7a, 'u16', 'こうげき (上)'),
  f('atkLo', 0x7c, 'u16', 'こうげき (下)'),
  f('defHi', 0x7e, 'u16', 'ぼうぎょ (上)'),
  f('defLo', 0x80, 'u16', 'ぼうぎょ (下)'),
  f('spdHi', 0x82, 'u16', 'すばやさ (上)'),
  f('spdLo', 0x84, 'u16', 'すばやさ (下)'),
  f('u86', 0x86, 'u8', '+0x86', { unsure: true }),
  f('apHi', 0x87, 'u8', '最大 AP (上)'),
  f('apLo', 0x88, 'u8', '最大 AP (下)'),
  f('evade', 0x89, 'u8', 'かいひ率', { bits: [0, 7] }),
  f('rank1', 0x8a, 'u8', 'ドロップ 1 のランク', { bits: [0, 4] }),
  f('rank2', 0x8a, 'u8', 'ドロップ 2 のランク', { bits: [4, 4] }),
  f('rank3', 0x8b, 'u8', 'ドロップ 3 のランク', { bits: [0, 4] }),
  f('rank4', 0x8b, 'u8', 'ドロップ 4 のランク', { bits: [4, 4] }),
  f('u8c', 0x8c, 'u8', 'ドロップ 5・6 のランク (未使用)', { unsure: true, hex: true }),
  ...LANAI_RACES.map(([k, l], i) => f(`race_${k}`, i < 8 ? 0x8d : 0x8e, 'u8', `種族: ${l}`, { bits: [i < 8 ? i : 0, 1] })),
  f('auraCharm', 0x8e, 'u8', 'ゆうわくのオーラ', { bits: [1, 7], note: '毎ターン相手にゆうわくを付ける率 % (推定)' }),
  f('auraFear', 0x8f, 'u8', 'きょうふのオーラ', { bits: [0, 7], note: '毎ターン相手にきょうふを付ける率 % (推定)' }),
  f('ab4a', 0x8f, 'u8', '+0x8F bit7 (能力 0x4A)', { bits: [7, 1], unsure: true }),
  f('actions', 0x90, 'u8', '行動回数', { bits: [0, 3] }),
  f('u90b3', 0x90, 'u8', '+0x90 bit3', { bits: [3, 1], unsure: true }),
  f('u90hi', 0x90, 'u8', '+0x90 bit4-7', { bits: [4, 4], unsure: true }),
  f('u91', 0x91, 'u8', '+0x91 (能力 0x4B の値)', { unsure: true }),
  f('u92', 0x92, 'u8', '+0x92', { unsure: true, hex: true }),
  f('u93', 0x93, 'u8', '+0x93 (能力 0x28 の値)', { unsure: true }),
  f('u94', 0x94, 'u8', '+0x94', { unsure: true, hex: true }),
  f('skillLevel', 0x95, 'u8', 'ワザのレベル (既定)', { note: 'ワザ枠ごとのレベルと大きいほうを使う (推定)' }),
  f('condTurnStart', 0x96, 'u8', 'ターン開始時の発動条件'),
  f('condHit1', 0x97, 'u8', '被弾時 1 の発動条件'),
  f('condHit2', 0x98, 'u8', '被弾時 2 の発動条件'),
  f('condTurnEnd', 0x99, 'u8', 'ターン終了時の発動条件'),
  f('ai', 0x9a, 'u8', 'AI の方式', { bits: [0, 3] }),
  f('fallback', 0x9a, 'u8', '使えるワザがないときの枠', { bits: [3, 3] }),
  f('u9ahi', 0x9a, 'u8', '+0x9A bit6-7', { bits: [6, 2], unsure: true }),
];

/** The four ability tables, in the order of MonsterParameter +0x16 bit0-2 (1〜4). */
export const LANAI_STATS_TABLES = ['MonsterParameterMain', 'MonsterParameterExtra', 'MonsterParameterRegularEvent', 'MonsterParameterSpecialEvent'] as const;
export const LANAI_STATS: TableDef[] = LANAI_STATS_TABLES.map((file) => ({ file, rowSize: 0x9c, fields: statsFields }));

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
export const LANAI_TABLES: Record<string, TableDef> = Object.fromEntries([LANAI_MONSTER_PARAMETER, LANAI_MONSTER_DESIGN, ...LANAI_STATS].map((d) => [d.file, d]));
