// Fields of 電波人間のRPG3's GS tables (master 21350000), as far as they are understood. Found by comparing the rows with
// RPG2's (docs/analysis.md "itemData.bin") and with what the items do in the game; "unsure" fields are guesses.
import { ACTION_RANGE, ELEMENT } from '../game/actions';
import { AI_MODE } from '../game/monsters';
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

/**
 * The two elements of each multi-element number (10〜25) of an action. FUN_001B82B0 halves the damage and puts each
 * half through one element's resistance (FUN_001B8148); the pairs are its jump tables (also FUN_001BF3FC).
 */
export const OAHU_ELEMENT_PAIRS: Record<number, [number, number]> = {
  10: [1, 2], 11: [1, 3], 12: [1, 4], 13: [1, 5], 14: [1, 6], 15: [2, 3], 16: [2, 4], 17: [2, 5], 18: [2, 6],
  19: [3, 4], 20: [3, 5], 21: [3, 6], 22: [4, 5], 23: [4, 6], 24: [6, 5], 25: [7, 8],
};

/** Element numbers of an action (actionData w0 bit27-31): 1〜8 one element, 10〜25 two (OAHU_ELEMENT_PAIRS). */
export const OAHU_ELEMENT_NAMES: Record<number, string> = {
  ...Object.fromEntries(ELEMENT.map((e, i): [number, string] => [i, e || 'なし'])),
  ...Object.fromEntries(Object.entries(OAHU_ELEMENT_PAIRS).map(([k, [a, b]]): [number, string] => [Number(k), `${ELEMENT[a]}・${ELEMENT[b]}`])),
};

/** Kind of an action row (actionData w0 bit0-2), from the rows that have it and the code that tests it. */
export const OAHU_ACTION_KIND: Record<number, string> = {
  0: 'ワザ', 1: 'アンテナ', 2: 'つかまえたモンスター', 3: '自動・特殊', 4: '道具', 5: '状態で動けない', 6: '種類 6',
};

/**
 * Numbers of the states as the actions (+0x2E) and the effect 0x14 (its sub) name them, from the actions that have
 * each number. A battle unit keeps its resistances in the same order (slot = number + 9, FUN_004CCBE8).
 */
export const OAHU_STATE_CODE: Record<number, string> = {
  1: 'どく', 2: 'やけど', 3: 'みずびたし', 4: 'かぜ', 5: 'どろだらけ', 6: 'のろい', 7: 'かんでん', 8: 'こおり', 9: 'マヒ', 10: 'ねむり', 11: 'ゆうわく',
  13: 'あやつり', 14: 'ブレス封じ', 15: 'とくぎ封じ', 16: 'こうげきの増減', 17: 'ぼうぎょの増減', 18: 'すばやさの増減', 19: 'かいひの増減', 20: 'ブラインド',
  21: 'こうふん', 22: '突然死', 24: 'ためる', 25: 'むてき', 26: '反射', 27: 'カウンター', 28: 'ガードシールド', 29: 'まもり', 32: 'ゴールド増加',
  33: 'おたから', 34: 'レアおたから', 37: 'ステルス', 41: 'すべての状態異常', 42: '状態を消す',
};

/**
 * Category of an action (+0x2C), named from the actions that have it. FUN_004CC980 looks for 2 and 6 (ブレス・呪文). The
 * battle result takes it as its kind (+0x10), and FUN_001B51E8 applies the result by it: 21 and 22 change the unit's
 * form to the monster row of +0x1A (FUN_0029C93C); 22 also whitens the screen (@0x219F3C, only #966 ドローンＺ → まおう).
 */
export const OAHU_ACTION_CATEGORY: Record<number, string> = {
  1: '打撃', 2: 'ブレス・ビーム', 5: '能力の増減', 6: '呪文・状態', 7: 'アンテナ (戦闘のあと)', 8: '回復・アイテム', 10: 'アンテナ (自動)', 13: '特殊',
  21: '形態を変える', 22: '形態を変える (演出つき)',
};
/** Categories that change the unit's form (OAHU_ACTION_CATEGORY 21, 22): +0x1A is the monster row of the new form. */
export const OAHU_FORM_CATEGORIES = [21, 22];

/**
 * When a kind-3 action of the states fires (+0x2A): FUN_001B7D18 checks it for the actions of effect 0x2F (a monster's
 * ボディ, +0x34) after each hit, the same codes are checked for the automatic actions (@0x1C04C8). 1〜100 is a chance in
 * %. 101 fires on a blow that would defeat the unit, which then survives (the fatal mark +0x1B bit6 is cleared), and a
 * form change by it refills the HP (FUN_0029D6C0). 102〜107 are not checked for the attacks of caught monsters.
 */
export const OAHU_ACTION_TRIGGER: Record<number, string> = {
  0: 'いつでも',
  101: '倒される一撃を受けたとき (倒れずに発動)',
  102: '打撃を受けたとき', 103: '打撃を受けたとき (20%)', 104: '打撃を受けたとき (30%)', 105: '打撃を受けたとき (50%)', 106: '打撃を受けたとき (80%)',
  107: 'ブレス・呪文などを受けたとき (系統 2・3・6・15)',
  ...Object.fromEntries(ELEMENT.slice(1).map((e, i): [number, string] => [108 + i, `${e}の攻撃を受けたとき`])),
  116: '仲間がいるとき', 117: '仲間がいるとき (50%)', 118: '自分だけのとき', 119: '自分だけのとき (50%)',
};

/** Label of a trigger code (+0x2A): the named codes, else "n %" for 1〜100. */
export function oahuTriggerLabel(v: number): string {
  return OAHU_ACTION_TRIGGER[v] ?? (v >= 1 && v <= 100 ? `${v}% の確率` : `${v} (未確認)`);
}

/** Side an action aims at (w0 bit19-20): FUN_0018F13C takes the units of its own side for 1. */
export const OAHU_ACTION_SIDE: Record<number, string> = { 0: '相手の側', 1: '自分の側' };

/** actionData.bin: 1126 × 0x30. The skills of the monsters, the items' actions and the antennas. */
export const OAHU_ACTION_DATA: TableDef = {
  file: 'actionData.bin',
  rowSize: 0x30,
  fields: [
    f('bits', 0x00, 'u32', 'ビット', { unsure: true, hex: true }),
    f('kind', 0x00, 'u32', '種類', { bits: [0, 3], alias: true, ref: { kind: 'enum', values: OAHU_ACTION_KIND }, note: 'コードは w0 & 7 で比べる (3 = 自動 @0x1C04BC、4 = 道具 @0x1BB5E8)。2 はつかまえたモンスターを戦闘で使ったときのアクションで、名前がモンスターの名前。monsterParameter +0x3C が指し、すぐあとにそのモンスターのワザが並ぶ' }),
    f('subject', 0x00, 'u32', '番号', { bits: [3, 11], alias: true, note: '種類 2 (つかまえたモンスター) ではモンスターの行 (同じモンスターの 2 つ目の行は 1 つ目の番号)。種類 4 (道具) ではアイテムの番号に近い値で、@0x1BA50C が 333・334 と比べる' }),
    f('side', 0x00, 'u32', '狙う側', { bits: [19, 2], alias: true, ref: { kind: 'enum', values: OAHU_ACTION_SIDE }, note: '1 = 自分の側 (FUN_0018F13C)' }),
    f('range', 0x00, 'u32', '範囲', { bits: [21, 4], alias: true, ref: { kind: 'enum', values: ACTION_RANGE }, note: '8 と比べられる (FUN_0018F13C)。番号の意味は RPG2 の w0 bit9-12 と同じと推定 (2 単体・6 全体・1 自分)' }),
    f('element', 0x00, 'u32', '属性', { bits: [27, 5], alias: true, ref: { kind: 'enum', values: OAHU_ELEMENT_NAMES }, note: 'w0 >> 27 (@0x1BD028)。1〜8 は 1 つの属性、10〜25 は 2 つの属性 (フレイムアイス 10 = 火・氷 など)。2 つのときはダメージを半分ずつそれぞれの属性のたいせいで計算して足す (FUN_001B82B0)' }),
    f('w1', 0x04, 'u32', '+0x04', { unsure: true, hex: true }),
    f('name', 0x08, 'u32', '名前', { ref: msg, note: '戦闘で出る名前。道具のアクションは「使った」のメッセージ' }),
    f('u0C', 0x0c, 'u32', '+0x0C', { unsure: true, note: 'メッセージの番号に見えるが、打撃 243 行が同じ 60202 (なごみの会話) で、行と関係のないなごみの会話や、どのファイルにもない 160872 なども入る。説明ではない' }),
    f('result1', 0x10, 'u32', '結果', { ref: msg, note: '1 体に効いたとき・成功したときの文 (「にダメージ与えた」「は どくをあびた」「が かけつけた」)' }),
    f('result2', 0x14, 'u32', '結果 (複数・別)', { ref: msg, note: '複数に効いたときの文 (「に 平均ダメージ与えた」「のHPが 平均回復した」) か、もう一方の結果 (「しかし　だれも来なかった…」「の寿命が縮んだ」)。文から推定' }),
    f('min', 0x18, 'u16', '最小', { note: '威力・回復量など (RPG2 の +0x18)' }),
    f('max', 0x1a, 'u16', '最大', { note: '系統 21・22 (形態を変える) では次の形態の monsterParameter の行 (FUN_001B459C が結果の +0x16 に入れる)' }),
    f('u1C', 0x1c, 'u16', '+0x1C', { unsure: true }),
    f('perf1', 0x1e, 'u16', '演出 1', { unsure: true, note: '演出の表の行と推定 (RPG2 の +0x1E)。続く欄も同じ並びの番号' }),
    f('perf2', 0x20, 'u16', '演出 2', { unsure: true }),
    f('perf3', 0x22, 'u16', '演出 3', { unsure: true }),
    f('perf4', 0x24, 'u16', '演出 4', { unsure: true }),
    f('perf5', 0x26, 'u16', '演出 5', { unsure: true }),
    f('u28', 0x28, 'u16', '+0x28', { unsure: true }),
    f('trigger', 0x2a, 'u8', '発動の条件', { note: '種類 3 のアクションを、ボディ (効果 0x2F) や自動 (効果 0x2D) の枠からいつ出すか (FUN_001B7D18)。1〜100 は確率 (%)。101 = 倒される一撃を受けたとき (倒れずに発動し、形態を変えるなら HP も戻る)。102〜106 打撃、107 ブレス・呪文など、108〜115 属性 1〜8 の攻撃を受けたとき。116〜119 は味方の数 (推定)' }),
    f('ap', 0x2b, 's8', '消費 AP', { note: '呪文・アンテナ・つかまえたモンスターのアクションにある。ワザの条件 (monsterBrain.bin) が AP を見るとき、使う側の今の AP (ユニット +0x62) より多ければ使わない (FUN_0018F13C)' }),
    f('category', 0x2c, 'u8', '系統', { ref: { kind: 'enum', values: OAHU_ACTION_CATEGORY }, unsure: true, note: '名前はその系統のアクションから付けたもの' }),
    f('u2D', 0x2d, 'u8', '+0x2D', { unsure: true }),
    f('state', 0x2e, 'u8', '状態', { ref: { kind: 'enum', values: OAHU_STATE_CODE }, note: '付ける (治す) 状態の番号。装備の効果 0x14 の対象と同じ番号 (どくこうげき 1、ファイアビーム 2 やけど、氷の双爪 8 こおり)' }),
    f('u2F', 0x2f, 'u8', '+0x2F', { unsure: true }),
  ],
};

/**
 * How a state adds up the values from its sources (conditionData +0x36 low 4 bits): FUN_0019FD2C, then clamped to
 * +0x2C〜+0x2E.
 */
export const OAHU_COMBINE: Record<number, string> = {
  0: '0 (効かない)',
  1: '足し算',
  2: '足し算',
  3: '掛け算',
  4: '% の掛け算 (100 = そのまま)',
  5: '足し算 (どちらかが上限なら上限)',
  6: '% の掛け算 (どちらかが上限なら上限)',
  7: '後の値で上書き',
  8: '大きいほう',
};

/** conditionData.bin: 125 × 0x3C. The states: ailments, buffs, resistances and what the equipment and monsters give. */
export const OAHU_CONDITION_DATA: TableDef = {
  file: 'conditionData.bin',
  rowSize: 0x3c,
  fields: [
    f('icon', 0x00, 'u32', 'アイコン', { ref: { kind: 'hash' }, unsure: true }),
    f('name', 0x04, 'u32', '名前', { ref: msg }),
    f('label', 0x08, 'u32', '表示', { ref: msg }),
    f('resist', 0x0c, 'u32', '効かなかった', { ref: msg }),
    f('hit1', 0x10, 'u32', 'かかった 1', { ref: msg }),
    f('hit2', 0x14, 'u32', 'かかった 2', { ref: msg }),
    f('hit3', 0x18, 'u32', 'かかった 3', { ref: msg }),
    f('cure1', 0x1c, 'u32', '治った 1', { ref: msg }),
    f('cure2', 0x20, 'u32', '治った 2', { ref: msg }),
    f('cure3', 0x24, 'u32', '治った 3', { ref: msg }),
    f('base', 0x28, 's16', '元の値', { note: '何も付いていないときの値 (% の状態は 100)' }),
    f('u2A', 0x2a, 's16', '+0x2A', { unsure: true }),
    f('min', 0x2c, 's16', '最小', { note: 'FUN_0019FD2C が足し合わせた値をこの範囲に収める' }),
    f('max', 0x2e, 's16', '最大'),
    f('u30', 0x30, 'u8', '+0x30', { unsure: true }),
    f('combine', 0x36, 'u8', '足し合わせ方', { bits: [0, 4], ref: { kind: 'enum', values: OAHU_COMBINE }, note: '同じ状態が装備などから重なったときの計算 (FUN_0019FD2C)' }),
    f('u38', 0x38, 'u8', '+0x38', { unsure: true }),
    f('u39', 0x39, 'u8', '+0x39', { unsure: true }),
  ],
};

/** Names of the states whose name message is なし, from their messages (+0x10 / +0x1C: "は どくをあびた"). */
export const OAHU_STATE_NAMES: Record<number, string> = {
  1: 'どく', 2: 'もうどく', 3: 'やけど', 4: 'みずびたし', 5: 'かぜ', 6: 'どろだらけ', 7: 'のろい', 8: 'かんでん', 9: 'こおり', 10: 'マヒ', 11: 'ねむり',
  14: 'おどろき', 15: 'ブレス封じ', 16: 'とくぎ封じ', 17: 'こうげきアップ', 18: 'こうげきダウン', 19: 'ぼうぎょアップ', 20: 'ぼうぎょダウン',
  21: 'すばやさアップ', 22: 'すばやさダウン', 23: 'かいひアップ', 24: 'かいひダウン', 25: 'ブラインド', 27: 'あとラウンドの命', 29: 'ためる', 30: 'むてき',
  33: 'ガードシールド', 41: 'ステルス', 66: '防御',
};

/** Rate value of a drop (monsterParameter): 1 in battleParameter u16 [0xE6 + value × 2] battles (OahuBattle.dropOdds). */
const RATE_NOTE = 'ドロップの率の値 (0〜15)。battleParameter +0xE6 の表で「何回に 1 回」になる (0 は必ず、大きいほど出にくい)';
const itemRef = { kind: 'row', table: 'itemData.bin' } as const;
const actionRef = { kind: 'row', table: 'actionData.bin' } as const;
const monsterRef = { kind: 'row', table: 'monsterParameter.bin' } as const;

/**
 * Resistances of a monster: [key, label, word offset, low bit]. FUN_004CCBE8 (a battle unit from a row) reads them
 * as 5-bit signed values into the unit's state slots 1〜31, which are the subs of the effects 0x15 (elements, 1〜8)
 * and 0x14 (ailments, slot − 9).
 */
export const OAHU_MONSTER_RESISTS: [string, string, number, number][] = [
  ['rFire', '火', 0x1c, 0], ['rIce', '氷', 0x1c, 5], ['rWind', '風', 0x1c, 10], ['rEarth', '土', 0x1c, 15], ['rElec', '電気', 0x1c, 20], ['rWater', '水', 0x1c, 25],
  ['rLight', '光', 0x20, 0], ['rDark', '闇', 0x20, 5],
  ['rPoison', 'どく', 0x24, 0], ['rBurn', 'やけど', 0x24, 5], ['rSoak', 'みずびたし', 0x24, 10], ['rCold', 'かぜ', 0x24, 15], ['rMud', 'どろだらけ', 0x24, 20], ['rCurse', 'のろい', 0x24, 25],
  ['rShock', 'かんでん', 0x28, 0], ['rFreeze', 'こおり', 0x28, 5], ['rPara', 'マヒ', 0x28, 10], ['rSleep', 'ねむり', 0x28, 15],
  ['rCharm', 'ゆうわく', 0x2c, 20], ['rBlind', 'ブラインド', 0x28, 20], ['rDeath', '突然死', 0x2c, 15],
];
/** The other 5-bit fields read as resistances: unit slots 25〜28, the state numbers 16〜19 (stat changes). */
const RESIST_OTHER: [string, string, number, number][] = [['rAttack', 'こうげき', 0x28, 25], ['rDefense', 'ぼうぎょ', 0x2c, 0], ['rSpeed', 'すばやさ', 0x2c, 5], ['rEvasion', 'かいひ', 0x2c, 10]];

/**
 * The conditions of a monster's skill slots: rows of monsterBrain.bin (402F0000, 16 × 3 bytes; the master object's
 * +0x818). FUN_0018F13C checks them for each slot (FUN_001BE560) and narrows the targets. The names in 「」 are the
 * test monsters 「知能：…」 that give one skill each condition.
 */
export const OAHU_SKILL_CONDITION: Record<number, string> = {
  0: 'なし',
  1: 'いつでも',
  2: 'いつでも (AP)',
  3: '1 回だけ',
  4: '1 回だけ (AP)',
  5: '弱いじめ',
  6: '仕留める',
  7: '強者狙い',
  8: '回復潰し',
  9: '特技潰し',
  10: 'ピンチ救い',
  11: 'お助け',
  12: '自分の HP 50% 以下',
  13: '自分の HP 50% 以下',
  14: '自分の HP 25% 以下',
  15: '自分の HP 25% 以下',
};

/** What each row of monsterBrain.bin does, read from its bits (OAHU_MONSTER_BRAIN). */
export const OAHU_SKILL_CONDITION_NOTE: Record<number, string> = {
  0: '何も確かめない。「使えないとき」の枠のワザはこの条件で使われる',
  1: 'いつでも使う (AP を確かめるのは電波人間のアンテナだけ)',
  2: 'AP が足りるときだけ',
  3: 'まだ使っていないワザだけ (1 回だけ。「知能：標準抑」)',
  4: 'まだ使っていないワザだけ、AP が足りるときだけ',
  5: '効く相手から、HP 65% 以下の相手を優先し、属性のたいせいが一番低い相手を狙う (「知能：弱いじめ」)',
  6: '効く相手のうち HP 25% 以下の相手だけ。いなければ使わない。属性のたいせいが一番低く、HP が一番少ない相手を狙う (「知能：仕留める」)',
  7: '効く相手のうち、強さの値が上位半分の相手を狙う。AP が要る。ターゲットの効果に引き寄せられない (「知能：強者狙い」)',
  8: '効く相手から、回復 (系統 8)・特殊 (系統 13) のアクションを持つ相手、行動できる相手、自分のアクションを使える相手を優先。AP が要る。ターゲットの効果に引き寄せられない (「知能：回復潰し」)',
  9: '効く相手から、行動できる相手、自分のアクションを使える相手を優先。AP が要る。ターゲットの効果に引き寄せられない (「知能：特技潰し」)',
  10: 'HP 25% 以下の相手 (回復なら味方) がいるときだけ、その相手に (「知能：ピンチ救い」)',
  11: 'HP 65% 以下の相手 (回復なら味方) がいるときだけ、その相手に (「知能：お助け」)',
  12: '自分の HP が 50% 以下のときだけ',
  13: '自分の HP が 50% 以下のときだけ (12 と同じ中身)',
  14: '自分の HP が 25% 以下のときだけ。ターゲットの効果に引き寄せられない',
  15: '自分の HP が 25% 以下のときだけ (14 と同じ中身)',
};

/** How a condition uses one of its target tests (2-bit fields of monsterBrain.bin): FUN_001F869C's last argument. */
export const OAHU_BRAIN_MODE: Record<number, string> = { 0: 'しない', 1: '当てはまる相手だけ', 2: '当てはまる相手を優先', 3: '当てはまる相手だけ' };

const brainFlag = (key: string, offset: number, bit: number, label: string, note: string): FieldDef =>
  f(key, offset, 'u8', label, { bits: [bit, 1], note });
const brainMode = (key: string, offset: number, bit: number, label: string, note: string): FieldDef =>
  f(key, offset, 'u8', label, { bits: [bit, 2], ref: { kind: 'enum', values: OAHU_BRAIN_MODE }, note });

/**
 * monsterBrain.bin (402F0000): 16 × 3 bytes, the conditions of the skill slots (OAHU_SKILL_CONDITION). Read by
 * FUN_0018F13C: the first byte says when the skill can be used, the rest how the targets are narrowed. A "only" test that
 * leaves nobody makes the skill unusable; a "prefer" test that leaves nobody keeps the targets as they were.
 */
export const OAHU_MONSTER_BRAIN: TableDef = {
  file: 'monsterBrain.bin',
  rowSize: 3,
  fields: [
    brainFlag('noLure', 0, 0, 'ターゲットに引き寄せられない', '相手の側を狙うとき、効果 0x12・0x13 (ターゲット・属性ターゲット) を持つ相手を 8 割の確率で選ぶのをしない'),
    brainFlag('ap', 0, 1, 'AP が要る', '消費 AP (actionData +0x2B) が今の AP より多ければ使わない'),
    brainFlag('apOwn', 0, 2, 'AP が要る (アンテナ)', '電波人間が自分のアクションの並び (+0x6D4 の 12 個、アンテナと推定) にあるアクションを使うときだけ AP を確かめる。モンスターには働かない'),
    brainFlag('hp50', 0, 3, '自分の HP 50% 以下', '自分の HP が 50% より多ければ使わない'),
    brainFlag('hp25', 0, 4, '自分の HP 25% 以下', '自分の HP が 25% より多ければ使わない'),
    brainFlag('once', 0, 5, 'まだ使っていない', '使ったワザの記録 (16 個、FUN_001F3390 が足す) にあれば使わない。記録は戦闘ごとと推定'),
    brainMode('effective', 0, 6, '効く相手', 'アクションを当てて効き目がある相手 (FUN_004CBEFC)'),
    brainMode('targetHp25', 1, 0, '相手の HP 25% 以下', 'FUN_0029F7D4'),
    brainMode('targetHp65', 1, 2, '相手の HP 65% 以下', 'FUN_0029F810'),
    brainMode('healer', 1, 4, '回復・特殊の相手', '相手のアクションの系統が 8 (回復) か 13 (特殊)。相手の側を狙うときだけ (FUN_0039B0D8)'),
    brainFlag('strong20', 1, 6, '強い相手 (上位 2 割)', '強さの値 (FUN_004CD6BC: 電波人間 +0x33C、モンスター monsterParameter +0x4A) の大きい順に並べて、上位 2 割 (1 人以上) に絞る'),
    brainFlag('strongHalf', 1, 7, '強い相手 (上位半分)', '同じ並びで上位半分に絞る (bit6 が立っていなければ)'),
    brainFlag('weakElement', 2, 0, '属性のたいせいが低い相手', 'アクションの属性 (1〜8) へのたいせいが一番低い相手に絞る'),
    brainMode('canAct', 2, 1, '行動できる相手', 'モンスター、または状態 8〜13 (こおり・マヒ・ねむり・ゆうわく・あやつり) のない、倒れていない電波人間 (FUN_0029D3F0。ほかにも確かめる値があり、名前は推定)'),
    brainMode('canUse', 2, 3, '自分のアクションを使える相手', '封じられていない相手 (FUN_004CBABC → FUN_004CAD54)'),
    brainFlag('lowestHp', 2, 5, 'HP が一番少ない相手', '今の HP が一番少ない相手に絞る'),
  ],
};

/** Number of skills of a monster (+0x54, u16 each: action << 4 | condition). */
export const OAHU_SKILLS = 6;
/** How the AI picks a skill (+0x38 bit12-14): FUN_001BE560 has a case for 0〜4, as RPG2's 5 modes. */
export const OAHU_AI_MODE: Record<number, string> = Object.fromEntries(AI_MODE.slice(0, 5).map((m, i): [number, string] => [i, m]));

/**
 * monsterParameter.bin: 201 × 0x70, bit-packed. Read by FUN_004CCBE8 (a battle unit from a row: stats as random
 * values between the two bounds, resistances, then the states of the effect kinds), FUN_004CD440 (drops), FUN_001BE560
 * (the AI) and the readers through FUN_004CA85C. The unused bits are filled with the byte D0.
 */
export const OAHU_MONSTER_PARAMETER: TableDef = {
  file: 'monsterParameter.bin',
  rowSize: 0x70,
  fields: [
    f('level', 0x00, 'u32', 'レベル', { bits: [0, 10], note: '値の並びから (はなもぐら 1、ブラックナイト 110)' }),
    f('attackMax', 0x00, 'u32', 'こうげき (上)', { bits: [10, 14], note: '能力は 2 つの値の間の乱数 (FUN_004CCBE8)。固定のときはこちら' }),
    f('attackMin', 0x04, 'u32', 'こうげき (下)', { bits: [0, 14] }),
    f('defenseMax', 0x04, 'u32', 'ぼうぎょ (上)', { bits: [14, 14] }),
    f('defenseMin', 0x08, 'u32', 'ぼうぎょ (下)', { bits: [0, 14] }),
    f('speedMax', 0x08, 'u32', 'すばやさ (上)', { bits: [14, 14] }),
    f('speedMin', 0x0c, 'u32', 'すばやさ (下)', { bits: [0, 14] }),
    f('exp', 0x10, 'u32', '経験値', { bits: [0, 24] }),
    f('gold', 0x14, 'u32', 'ゴールド', { bits: [0, 20], note: '@0x4CAB54' }),
    f('drop1', 0x14, 'u32', 'ドロップ 1', { bits: [20, 10], ref: itemRef, note: 'itemData の行 (FUN_004CD440)' }),
    f('rate1', 0x18, 'u32', '率 1', { bits: [0, 4], note: RATE_NOTE }),
    f('drop2', 0x18, 'u32', 'ドロップ 2', { bits: [4, 10], ref: itemRef }),
    f('rate2', 0x18, 'u32', '率 2', { bits: [14, 4], note: RATE_NOTE }),
    f('drop3', 0x18, 'u32', 'ドロップ 3', { bits: [18, 10], ref: itemRef }),
    f('rate3', 0x18, 'u32', '率 3', { bits: [28, 4], note: RATE_NOTE }),
    ...OAHU_MONSTER_RESISTS.map(([key, label, o, b]) => f(key, o, 's32', `たいせい ${label}`, { bits: [b, 5], note: b === 0 && o === 0x1c ? '−9〜+9。+10 は効かない (RPG2 と同じと推定)' : undefined })),
    ...RESIST_OTHER.map(([key, label, o, b]) => f(key, o, 's32', `たいせい ${label}の増減`, { bits: [b, 5], unsure: true, note: '状態の番号 16〜19 (能力の増減) の位置。能力ダウンへのたいせいと推定' })),
    f('ghost', 0x30, 'u32', 'ゴースト', { bits: [0, 1], note: '効果 0x10 (conditionData 60 ゴースト化)' }),
    f('charm', 0x30, 'u32', '効果 0x30', { bits: [1, 1], unsure: true, note: 'conditionData 75 ゆうわく の状態を付ける' }),
    f('act2B', 0x30, 'u32', 'アクション (効果 0x2B)', { bits: [2, 12], ref: actionRef, unsure: true, note: 'ほかの形態からこの行に変わった直後に続けて出すアクション (FUN_001B459C が新しい行のこの欄を読む)。元のデータではどの行も 0' }),
    f('act2C', 0x30, 'u32', 'アクション (効果 0x2C)', { bits: [14, 12], ref: actionRef, unsure: true }),
    f('body', 0x34, 'u32', 'ボディのアクション', { bits: [0, 12], ref: actionRef, note: '効果 0x2F (攻撃を受けたとき。どくボディなど)。種類 3 のアクションだけが、その +0x2A の条件で出る (FUN_001B7D18)。ボスの変身 (系統 21・22) もここに入る' }),
    f('body2', 0x34, 'u32', 'ボディのアクション 2', { bits: [12, 12], ref: actionRef, note: '効果 0x2F の 2 つ目' }),
    f('auto', 0x38, 'u32', '自動のアクション', { bits: [0, 12], ref: actionRef, note: '効果 0x2D' }),
    f('ai', 0x38, 'u32', 'ワザの選び方', { bits: [12, 3], ref: { kind: 'enum', values: OAHU_AI_MODE }, note: 'FUN_001BE560 の 5 通り。RPG2 の AI の型と同じと推定' }),
    f('fallback', 0x38, 'u32', '使えるワザがないとき', { bits: [15, 3], note: 'ワザの枠の番号 (0〜5)' }),
    f('u38b18', 0x38, 'u32', '+0x38 bit18-21', { bits: [18, 4], unsure: true, note: '戦闘のユニットどうしで比べる値 (@0x1C0170)。15 は特別' }),
    f('own', 0x3c, 'u32', 'つかまえたときのアクション', { bits: [0, 11], ref: actionRef, note: 'つかまえたモンスターを戦闘で使ったときのアクション (actionData の種類 2 の行)。アンテナ「つかまえる」でつかまえたモンスターは電波人間の +0x6A に入り、その電波人間のこの行動がこの行になる (FUN_004CB7C0)' }),
    f('name', 0x40, 'u32', '名前', { ref: msg }),
    f('desc', 0x44, 'u32', '説明', { ref: msg }),
    f('design', 0x48, 'u16', 'デザイン', { bits: [0, 8], alias: true, note: '402F0000 の monsterDesign.bin の行 (モデル +0x0C・色のテクスチャ +0x10・ワザのモーション +0x14)' }),
    f('u48', 0x48, 'u16', '+0x48', { unsure: true, hex: true, note: '下位 8 ビットはデザイン。bit9 も読まれる (同じモンスターの 2 つ目の行で立つ)' }),
    f('size', 0x4a, 'u16', '+0x4A', { unsure: true, note: '100〜170。大きさ (%) か' }),
    f('u4C', 0x4c, 'u16', '+0x4C', { bits: [0, 7], unsure: true, hex: true }),
    f('hpMax', 0x4e, 'u16', 'HP (上)'),
    f('hpMin', 0x50, 'u16', 'HP (下)'),
    f('evasion', 0x52, 'u16', 'かいひ', { bits: [0, 7] }),
    f('e19', 0x52, 'u16', '効果 0x19', { bits: [7, 1], unsure: true }),
    f('attacks', 0x52, 'u16', 'こうげき倍増', { bits: [8, 3], note: '効果 9 (conditionData 52 こうげき倍増) の値' }),
    f('e34', 0x52, 'u16', '効果 0x34', { bits: [11, 1], unsure: true }),
    f('guard', 0x52, 'u16', 'かばう (対象)', { bits: [12, 4], unsure: true, note: '効果 0x35 (conditionData 80 かばう) の対象。値は +0x6D' }),
    ...Array.from({ length: OAHU_SKILLS }, (_, i) => [
      f(`skill${i + 1}`, 0x54 + i * 2, 'u16', `ワザ ${i + 1}`, { bits: [4, 12], ref: actionRef }),
      f(`cond${i + 1}`, 0x54 + i * 2, 'u16', `ワザ ${i + 1} の条件`, { bits: [0, 4], ref: { kind: 'enum', values: OAHU_SKILL_CONDITION }, note: '402F0000 の monsterBrain.bin の行 (OAHU_MONSTER_BRAIN)。使えるかどうかと狙う相手を決める (FUN_0018F13C)' }),
    ]).flat(),
    f('u60', 0x60, 'u16', '+0x60', { unsure: true, hex: true }),
    f('u62', 0x62, 'u16', '+0x62', { unsure: true }),
    f('flags', 0x64, 'u16', 'フラグ', { unsure: true, hex: true, note: 'bit0 と bit4 が読まれる。bit4 が 0 の行 (ボスの最後でない形態) は、@0x1F6838 の攻撃では倒れない' }),
    f('book', 0x66, 'u8', '+0x66', { unsure: true, note: '図鑑の番号か (同じモンスターの 2 つ目の行は 0)' }),
    f('museum', 0x67, 'u8', 'ミュージアムの番号', { note: 'ミュージアムの読み出しが使う' }),
    f('u68', 0x68, 'u8', '+0x68', { unsure: true }),
    f('u69', 0x69, 'u8', '+0x69', { unsure: true }),
    f('u6A', 0x6a, 'u8', '+0x6A', { unsure: true }),
    f('apMax', 0x6b, 'u8', 'AP (上)'),
    f('apMin', 0x6c, 'u8', 'AP (下)'),
    f('guardValue', 0x6d, 'u8', 'かばう (値)', { unsure: true }),
  ],
};

/**
 * monsterGroup.bin: 190 × 0x3E. Like RPG2's: 5 candidates of the lead and of the mates {u16 monster, u8 weight,
 * u8 count}, then 5 monsters of a fixed formation (the bosses' groups have only these).
 */
export const OAHU_MONSTER_GROUP: TableDef = {
  file: 'monsterGroup.bin',
  rowSize: 0x3e,
  fields: [
    ...(['lead', 'mate'] as const).flatMap((side, s) => Array.from({ length: 5 }, (_, i) => {
      const o = s * 0x14 + i * 4;
      const label = `${side === 'lead' ? '先頭' : 'なかま'} ${i + 1}`;
      return [
        f(`${side}${i + 1}`, o, 'u16', label, { ref: monsterRef, note: i || s ? undefined : '先頭 (マップで見える 1 体目と 3 体目) の候補。なかまは 2 体目と 4 体目 (RPG2 と同じと推定)' }),
        f(`${side}${i + 1}Weight`, o + 2, 'u8', `${label} の重み`),
        f(`${side}${i + 1}Count`, o + 3, 'u8', `${label} の数`, { unsure: true, note: '数のコード。RPG2 (0〜7) にない 10・11・14 などがあり、意味は未確認' }),
      ];
    }).flat()),
    ...Array.from({ length: 5 }, (_, i) => f(`fixed${i + 1}`, 0x28 + i * 2, 'u16', `決まった並び ${i + 1}`, { ref: monsterRef, note: i ? undefined : 'ボスの群れはこれだけを持つ' })),
    f('flags', 0x32, 'u8', 'フラグ', { hex: true, unsure: true, note: '0x80 に、決まった並びの群れは 1 (宝箱・ボスは 0x81・0x83・0x87)' }),
    f('u33', 0x33, 'u8', '+0x33', { unsure: true }),
    f('u34', 0x34, 'u8', '+0x34', { unsure: true }),
    f('u35', 0x35, 'u8', '+0x35', { unsure: true }),
    f('u38', 0x38, 'u8', '+0x38', { unsure: true, note: '場所 (ダンジョン) の番号か' }),
    f('u39', 0x39, 'u8', '+0x39', { unsure: true, note: 'ボスは 0xA4' }),
  ],
};

export const OAHU_TABLES: Record<string, TableDef> = Object.fromEntries(
  [OAHU_ITEM_DATA, OAHU_ACTION_DATA, OAHU_CONDITION_DATA, OAHU_MONSTER_PARAMETER, OAHU_MONSTER_GROUP, OAHU_MONSTER_BRAIN].map((d) => [d.file, d]),
);

/** Stats of the stat-up effect (0x1B) and elements of the element effects, by their number (+0x3C / +0x3E). */
export const OAHU_STAT: Record<number, string> = { 0: 'さいだいＨＰ', 1: 'さいだいＡＰ', 2: 'こうげき', 3: 'ぼうぎょ', 4: 'すばやさ', 5: 'かいひ' };
export const OAHU_ELEMENT: Record<number, string> = { 1: '火', 2: '氷', 3: '風', 4: '土', 5: '電気', 6: '水', 7: '光', 8: '闇', 9: 'すべての属性' };
/** Subs of the ailment resistance (0x14): the ailments of the state numbers. */
export const OAHU_AILMENT: Record<number, string> = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 22, 41].map((k): [number, string] => [k, OAHU_STATE_CODE[k]!]));

/** What the second byte of an effect names. */
export type EffectSub = 'stat' | 'element' | 'ailment';
/** How the value of an effect reads. */
export type EffectValue = 'plus' | 'percent' | 'element' | 'action' | 'number' | 'flag';

export interface EffectKind {
  label: string;
  /** The conditionData row of the state (FUN_001A6348). */
  condition: number;
  sub?: EffectSub;
  value: EffectValue;
}

/**
 * Effect kinds (an equipment's +0x3B / +0x3D, a monster's states): FUN_001A6348 turns a kind into the conditionData
 * row of its state, whose name and way of adding up (+0x36) give the label and how the value reads. The rows named
 * なし are named from the equipment that have them.
 */
const EFFECTS: [number, number, string, EffectValue, EffectSub?][] = [
  [0x01, 45, '必中', 'flag'],
  [0x02, 48, 'シールドバスター', 'flag'],
  [0x03, 46, 'クリティカル率増加', 'number'],
  [0x04, 47, 'かじば', 'number'],
  [0x05, 49, '固定ダメージ', 'number'],
  [0x06, 50, 'ダメージ倍増', 'percent'],
  [0x07, 51, 'こうげき倍増', 'plus'],
  [0x08, 53, 'とくぎ回数アップ', 'plus'],
  [0x09, 52, 'こうげき倍増 (回数)', 'plus'],
  [0x0a, 54, '打撃の属性', 'element'],
  [0x0b, 55, '状態 55', 'flag'],
  [0x0c, 56, 'だんけつ', 'flag'],
  [0x0d, 57, '状態 57 (2〜4)', 'number'],
  [0x0e, 58, '状態 58', 'flag'],
  [0x0f, 59, 'HP吸収', 'percent'],
  [0x10, 60, 'ゴースト化', 'flag'],
  [0x11, 61, '浮遊', 'flag'],
  [0x12, 62, 'ターゲット', 'flag'],
  [0x13, 63, '属性ターゲット', 'flag', 'element'],
  [0x14, 64, 'たいせい (状態異常)', 'plus', 'ailment'],
  [0x15, 65, 'たいせい (属性)', 'plus', 'element'],
  [0x16, 66, '状態 66', 'flag'],
  [0x17, 67, 'オート防御', 'percent'],
  [0x18, 68, 'こんじょう', 'flag'],
  [0x19, 69, '状態 69', 'flag'],
  [0x1a, 70, 'アンテナ', 'plus'],
  [0x1b, 71, '能力アップ', 'plus', 'stat'],
  [0x1c, 72, '使用AP軽減', 'percent'],
  [0x1d, 73, 'HP回復効果倍増', 'percent'],
  [0x1e, 26, '興奮', 'flag'],
  [0x1f, 28, 'ゴーストバスター', 'number'],
  [0x20, 31, '反射', 'flag'],
  [0x21, 32, 'カウンター', 'flag'],
  [0x22, 34, 'かばう', 'percent'],
  [0x23, 36, 'ゴールド増加', 'percent'],
  [0x24, 37, 'ドロップ率', 'percent'],
  [0x25, 38, 'レアドロップ率', 'percent'],
  [0x26, 39, '激レアドロップ率', 'percent'],
  [0x27, 40, 'にげる', 'percent'],
  [0x28, 42, '状態 42', 'flag'],
  [0x29, 43, '先制防ぎ', 'flag'],
  [0x2a, 44, 'まわりこみ', 'percent'],
  [0x2b, 74, 'アクション (0x2B)', 'action'],
  [0x2c, 74, 'アクション (0x2C)', 'action'],
  [0x2d, 74, 'アクション (自動)', 'action'],
  [0x2e, 74, 'アクション (打撃)', 'action'],
  [0x2f, 74, 'アクション (ボディ)', 'action'],
  [0x30, 75, 'ゆうわく', 'flag'],
  [0x31, 76, '経験値増加', 'percent'],
  [0x32, 77, 'つかまえる率増加', 'percent'],
  [0x33, 78, '床ダメージなし', 'flag'],
  [0x34, 79, '状態 79', 'flag'],
  [0x35, 80, 'かばう (0x35)', 'percent'],
];

/** Effect kinds by number (0x01〜0x35; the game has no others). */
export const OAHU_EQUIP_EFFECTS: Record<number, EffectKind> = Object.fromEntries(
  EFFECTS.map(([k, condition, label, value, sub]): [number, EffectKind] => [k, { label, condition, value, ...(sub ? { sub } : {}) }]),
);
export const OAHU_EFFECT_KINDS = EFFECTS.length;

export const OAHU_EFFECT_SUBS: Record<EffectSub, Record<number, string>> = { stat: OAHU_STAT, element: OAHU_ELEMENT, ailment: OAHU_AILMENT };
