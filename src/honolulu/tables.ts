// Fields of 電波人間のRPG (初代)'s GS tables, as far as they are understood (naauao honolulu/analysis.md・items.md・
// shops.md・monsters.md), in the same definitions as the other games (game/tabledef.ts). Most tables are not analysed yet: the
// pages read them through rowDef, which shows the bytes no field covers as raw fields. The file names are the same as
// RPG2's (itemData.bin …) but the rows are not: never use kaharatables.ts for them. "unsure" fields are guesses.
import type { FieldDef, TableDef } from '../game/tabledef';

const f = (key: string, offset: number, type: FieldDef['type'], label: string, more: Partial<FieldDef> = {}): FieldDef => ({ key, offset, type, label, ...more });
const msg = { kind: 'message' } as const;
const hash = { kind: 'hash' } as const;
const row = (table: string) => ({ kind: 'row', table }) as const;

/** itemData +0x1A (naauao honolulu/items.md §2). */
export const HONOLULU_ITEM_CATEGORY: Record<number, string> = { 0: '空き', 1: '道具・だいじなもの', 3: '装備', 4: 'ふく', 5: 'あみ', 6: 'ダミー' };

/** itemData.bin (master エントリ 51): 298 × 0x1C, no model (naauao honolulu/items.md §2). */
export const HONOLULU_ITEM_DATA: TableDef = {
  file: 'itemData.bin',
  rowSize: 0x1c,
  fields: [
    f('name', 0x00, 'u32', '名前', { ref: msg }),
    f('desc', 0x04, 'u32', '説明', { ref: msg }),
    f('shopDesc', 0x08, 'u32', '店員の説明', { ref: msg, note: '0 = なし' }),
    f('price', 0x0c, 'u32', '買値'),
    f('sell', 0x10, 'u32', '売値'),
    f('kind', 0x14, 'u8', '種類のビット', { hex: true, unsure: true, note: '0x01 装備・ふく、0x10 だいじなもの系、0x08 道具、0x20 フルーツと推定' }),
    f('used', 0x18, 'u8', '中身のある行', { note: '1 = 中身のある行、0 = 空き' }),
    f('sub', 0x19, 'u8', '装備・ふくの行', { note: '分類 3 は equipData、分類 4 は clothData の行。道具 (分類 1 の行 1〜27) は 124〜150 の連番で、何の行かは未解析 (naauao items.md は「ほかの分類は 0」としている)' }),
    f('category', 0x1a, 'u8', '分類', { ref: { kind: 'enum', values: HONOLULU_ITEM_CATEGORY } }),
  ],
};

/** equipData.bin (master エントリ 53): 198 × 0x18 (naauao honolulu/items.md §3.1). */
export const HONOLULU_EQUIP_DATA: TableDef = {
  file: 'equipData.bin',
  rowSize: 0x18,
  fields: [
    f('item', 0x08, 'u16', 'アイテム', { ref: row('itemData.bin'), note: 'itemData +0x19 から引いた行と相互に一致。naauao items.md §3.1 は u32 としているが、+0x0A が 1 の行があるので u16 (+0x0A は別の値)' }),
    f('value', 0x0c, 'u32', '効果の値', { hex: true, unsure: true, note: 'いのちのピアス 0x1400、イヤリング 0x2300 と増える' }),
  ],
};

/** clothData.bin (master エントリ 52): 102 × 8 (naauao honolulu/items.md §3.2). */
export const HONOLULU_CLOTH_DATA: TableDef = {
  file: 'clothData.bin',
  rowSize: 8,
  fields: [
    f('texture', 0x00, 'u32', 'テクスチャ', { ref: hash, note: 'B50A5EA9 のエントリ' }),
    f('pattern', 0x04, 'u8', '模様の番号', { unsure: true, note: '行ごとに 1 ずつ増える' }),
  ],
};

/** shopItemData.bin (master エントリ 68): 753 × 4, the stock of every stage in a row (naauao honolulu/shops.md §2.2). */
export const HONOLULU_SHOP_ITEM_DATA: TableDef = {
  file: 'shopItemData.bin',
  rowSize: 4,
  fields: [
    f('item', 0x00, 'u16', 'アイテム', { ref: row('itemData.bin') }),
    f('featured', 0x02, 'u8', '目玉の品', { bits: [0, 1], note: '段階が変わったときにこの品があれば入荷を知らせる (フラグ 0x27)' }),
  ],
};

/** shopItemGroup.bin (master エントリ 69): the 12 stages of the shop (naauao honolulu/shops.md §2.1, §3). */
export const HONOLULU_SHOP_ITEM_GROUP: TableDef = {
  file: 'shopItemGroup.bin',
  rowSize: 0xc,
  fields: [
    f('first', 0x00, 'u16', '最初の行', { note: 'shopItemData の行' }),
    f('last', 0x02, 'u16', '最後の行', { note: 'この行を含む' }),
    f('dungeon', 0x04, 'u16', 'ダンジョン', { ref: row('dungeonData.bin'), note: '0 = 最初の段階' }),
    f('progress', 0x06, 'u16', '進み具合', { note: 'ダンジョンの進み具合 (セーブ変数 0x40) がこの値のとき、この段階になる' }),
    f('prevFirst', 0x08, 'u16', '前の段階の最初の行'),
    f('prevLast', 0x0a, 'u16', '前の段階の最後の行'),
  ],
};

/** dungeonData.bin (master エントリ 24): 18 × 0x18, rows 1〜11 are the 11 dungeons (naauao honolulu/analysis.md §3.1, §4). */
export const HONOLULU_DUNGEON_DATA: TableDef = {
  file: 'dungeonData.bin',
  rowSize: 0x18,
  fields: [
    f('name', 0x10, 'u16', '名前', { ref: msg }),
    f('desc', 0x12, 'u16', '説明', { ref: msg, note: '推奨レベル' }),
    f('mapData', 0x16, 'u8', 'mapData の行', { ref: row('mapData.bin'), note: '階の定義の頭 +0x14 が 0 の階のタイルセット (naauao honolulu/map.md §3.3)' }),
  ],
};

/** mapData.bin (master エントリ 33): 15 × 0xC, a floor's tileset (naauao honolulu/map.md §3.3). */
export const HONOLULU_MAP_DATA: TableDef = {
  file: 'mapData.bin',
  rowSize: 0xc,
  fields: [
    f('tileset', 0x00, 'u8', 'タイルセット', { note: 'mapParts のモデルの組 (0〜7)' }),
    f('resource', 0x06, 'u8', 'mapResource の行', { ref: row('mapResource.bin') }),
    f('sound', 0x07, 'u8', '+0x07', { unsure: true, note: '音 (FUN_0020C2A0 に渡す) と推定' }),
  ],
};

/** soundData.bin (master エントリ 64): 252 × 0xC, the sounds the game names by row (naauao honolulu/analysis.md §3.1; as RPG2 / RPG3). */
export const HONOLULU_SOUND_DATA: TableDef = {
  file: 'soundData.bin',
  rowSize: 0xc,
  fields: [
    f('item', 0x00, 'u32', 'アイテム ID', { hex: true, note: 'sound.bcsar のアイテム (0x01nnnnnn = 音 nnnnnn)' }),
    f('volume', 0x08, 'u8', '音量', { unsure: true, note: 'RPG2 / RPG3 と同じ並びと推定' }),
  ],
};

/** mapParts.bin (master エントリ 36): 48 × 0x114, the paths and rooms of the tiles (naauao honolulu/map.md §3.3). */
export const HONOLULU_MAP_PARTS: TableDef = {
  file: 'mapParts.bin',
  rowSize: 0x114,
  fields: [
    f('shape', 0x08, 'u8', '形の番号', { note: '向きだけ違う行が同じ値' }),
    f('edges', 0x10c, 'u8', '辺のビット', { hex: true, unsure: true, note: '上位 4 bit が部屋の壁 (0x40 上・0x80 右・0x20 下・0x10 左)、下位が通路の開いた辺と推定' }),
    f('angle', 0x110, 's16', '回転 (度)', { note: 'Y 軸の回転。0・90・−90・180' }),
  ],
};

/** skillData.bin (master エントリ 42): 152 × 0x28, the skills of the antennas (naauao honolulu/analysis.md §3.1). */
export const HONOLULU_SKILL_DATA: TableDef = {
  file: 'skillData.bin',
  rowSize: 0x28,
  fields: [
    f('name', 0x00, 'u32', '名前', { ref: msg }),
    f('desc', 0x04, 'u32', '説明', { ref: msg }),
  ],
};

/** scenario.bin (master エントリ 62): 205 × 0x2C (naauao honolulu/analysis.md §3.1). */
export const HONOLULU_SCENARIO: TableDef = {
  file: 'scenario.bin',
  rowSize: 0x2c,
  fields: [
    f('dungeon', 0x24, 'u16', 'ダンジョン', { ref: row('dungeonData.bin'), unsure: true }),
    f('stage', 0x26, 'u16', '段階', { unsure: true }),
  ],
};

/** mapObject.bin (master エントリ 35): 68 × 0x24 (naauao honolulu/analysis.md §3.1). */
export const HONOLULU_MAP_OBJECT: TableDef = {
  file: 'mapObject.bin',
  rowSize: 0x24,
  fields: [
    f('archive', 0x00, 'u32', 'アーカイブ', { hex: true, note: 'モデルを入れたルートのアーカイブ (15BE1AD4・3A309010・FB501D1A)' }),
    f('model', 0x04, 'u32', 'モデル', { ref: hash }),
    f('scale', 0x14, 'f32', '+0x14', { unsure: true, note: '拡大率と推定 (多くは 1)' }),
  ],
};

/** mapResource.bin (master エントリ 37): 9 × 0x14 (naauao honolulu/analysis.md §2). */
export const HONOLULU_MAP_RESOURCE: TableDef = {
  file: 'mapResource.bin',
  rowSize: 0x14,
  fields: [
    f('tiles', 0x00, 'u32', 'タイルのモデルのアーカイブ', { hex: true }),
    f('texture', 0x04, 'u32', 'テクスチャ', { ref: hash, note: '469B3DC6 のエントリ' }),
    f('extra', 0x08, 'u32', '+0x08', { ref: hash, unsure: true, note: 'タイルのモデルのアーカイブのエントリ (用途は未確認)' }),
  ],
};

/** designedMap.bin (master エントリ 38): 83 × 0x20, the designed rooms (naauao honolulu/map.md §3.3). */
export const HONOLULU_DESIGNED_MAP: TableDef = {
  file: 'designedMap.bin',
  rowSize: 0x20,
  fields: [
    f('model', 0x04, 'u32', '部屋のモデル', { ref: hash, note: 'AD853AFD のエントリ。0 = 頭の行の後ろに置く物の行' }),
    f('resource', 0x08, 'u8', 'mapResource の行', { ref: row('mapResource.bin') }),
  ],
};

/** monsterData.bin (2713402F): 92 × 0x2C, the looks of the monsters (naauao honolulu/analysis.md §3.1, monsters.md §2.1). */
export const HONOLULU_MONSTER_DATA: TableDef = {
  file: 'monsterData.bin',
  rowSize: 0x2c,
  fields: [
    f('name', 0x00, 'u32', '名前', { ref: msg }),
    f('model', 0x04, 'u32', 'モデル', { ref: hash, note: '470D2848 のエントリ' }),
    f('texture', 0x08, 'u32', 'テクスチャ', { ref: hash, note: '470D2848 のエントリ' }),
    f('scale1', 0x0c, 'f32', '+0x0C', { unsure: true, note: '拡大率と推定。戦闘では +0x24 と掛ける' }),
    f('scale2', 0x10, 'f32', '+0x10', { unsure: true, note: '拡大率と推定' }),
    f('battleScale', 0x24, 'u16', '戦闘での大きさの係数', { unsure: true, note: 'FUN_0019C338 が +0x0C の f32 と掛ける (意味は未確認)' }),
    f('fieldRank', 0x2a, 'u8', '+0x2A', { unsure: true, note: 'FUN_00204C70 が引数と比べ、それ以下の敵だけを群れから選ぶ (フィールドに出す見た目と推定)' }),
  ],
};

/** The resistances of monsterBattleParameter +0x2D〜+0x2F: signed 4 bits × 6, low nibble first (naauao monsters.md §2). */
const resist4 = Array.from({ length: 6 }, (_, k) => f(`resist${k}`, 0x2d + (k >> 1), 's8', `耐性 ${k + 1} (4 bit)`, { bits: [(k & 1) * 4, 4], unsure: true, note: '属性の耐性と推定。戦闘の物体 +0xD8〜' }));
/** +0x30〜+0x32: 2 bits × 11, each 0〜3 picks one of 4 steps of a table (*0x31F644 +0x4C). */
const resist2 = Array.from({ length: 11 }, (_, k) => f(`ailment${k}`, k < 8 ? 0x30 : 0x32, k < 8 ? 'u16' : 'u8', `耐性 ${k + 1} (2 bit)`, { bits: [2 * (k % 8), 2], unsure: true, note: '状態異常の耐性と推定 (値 0〜3 で 4 段階の表を引く)' }));

/**
 * monsterBattleParameter.bin (master エントリ 48): 111 × 0x34, the bit-packed battle parameters of a monster, read by
 * FUN_00205BE8 (naauao honolulu/monsters.md §2). The game draws each stat between the smaller of its two values and the
 * larger; HP's are the maximum (w0) and the minimum (w4), the others' two values are equal in every row.
 */
export const HONOLULU_MONSTER_BATTLE_PARAMETER: TableDef = {
  file: 'monsterBattleParameter.bin',
  rowSize: 0x34,
  fields: [
    f('level', 0x00, 'u32', 'Lv', { bits: [0, 7] }),
    f('hpMax', 0x00, 'u32', 'HP (最大)', { bits: [7, 15] }),
    f('atk1', 0x00, 'u32', 'こうげき (値 1)', { bits: [22, 10], note: '名前は推定' }),
    f('def1', 0x04, 'u32', 'ぼうぎょ (値 1)', { bits: [0, 10], note: '名前は推定' }),
    f('spd1', 0x04, 'u32', 'すばやさ (値 1)', { bits: [10, 10], note: '名前は推定' }),
    f('drop1Rate', 0x04, 'u32', 'ドロップ 1 の率の段階', { bits: [20, 3], note: '段階から確率への換算は未確認' }),
    f('drop1', 0x04, 'u32', 'ドロップ 1', { bits: [23, 9], ref: row('itemData.bin') }),
    f('drop2Rate', 0x08, 'u32', 'ドロップ 2 の率の段階', { bits: [0, 3] }),
    f('drop2', 0x08, 'u32', 'ドロップ 2', { bits: [3, 9], ref: row('itemData.bin') }),
    f('gold', 0x08, 'u32', 'お金', { bits: [12, 16] }),
    f('raw8', 0x08, 'u32', 'w2 bit28-31', { bits: [28, 4], unsure: true, hex: true }),
    f('exp', 0x0c, 'u32', '経験値', { bits: [0, 16] }),
    f('flag16', 0x0c, 'u32', '状態のビット 1', { bits: [16, 1], unsure: true, note: '戦闘の物体 +0xE4 bit0' }),
    f('flag17', 0x0c, 'u32', '状態のビット 2', { bits: [17, 1], unsure: true, note: '戦闘の物体 +0xE4 bit2' }),
    f('status', 0x0c, 'u32', '開始時の状態', { bits: [18, 5], ref: row('conditionData.bin'), note: 'conditionData の行、0 = なし' }),
    f('statusRate', 0x0c, 'u32', '開始時の状態の確率の段階', { bits: [23, 3] }),
    f('flags26', 0x0c, 'u32', 'w3 bit26-29', { bits: [26, 4], unsure: true, hex: true, note: '戦闘の物体 +0xE4 bit23-26' }),
    f('raw0c', 0x0c, 'u32', 'w3 bit30-31', { bits: [30, 2], unsure: true, hex: true }),
    f('raw10', 0x10, 'u32', 'w4 bit0-5', { bits: [0, 6], unsure: true, hex: true }),
    f('target', 0x10, 'u32', '狙い方', { bits: [6, 2], unsure: true, note: '2 のとき HP の少ない電波人間を狙う (FUN_002B0BC8)' }),
    f('hpMin', 0x10, 'u32', 'HP (最小)', { bits: [8, 15] }),
    f('raw10b', 0x10, 'u32', 'w4 bit23-31', { bits: [23, 9], unsure: true, hex: true }),
    f('atk2', 0x14, 'u32', 'こうげき (値 2)', { bits: [0, 10] }),
    f('def2', 0x14, 'u32', 'ぼうぎょ (値 2)', { bits: [10, 10] }),
    f('spd2', 0x14, 'u32', 'すばやさ (値 2)', { bits: [20, 10] }),
    f('raw14', 0x14, 'u32', 'w5 bit30-31', { bits: [30, 2], unsure: true, hex: true }),
    f('growth', 0x18, 'u16', '+0x18', { unsure: true, note: 'Lv とともに増える値 (100〜4200)。FUN_002B2994 が戦闘中に読む。意味は未確認' }),
    f('flags1a', 0x1a, 'u16', '+0x1A', { unsure: true, hex: true, note: 'bit0-1 は FUN_002B38xx が比べる、bit3-5 → +0x63、bit6・7 → +0xE4 bit1・bit3' }),
    f('direct', 0x1c, 'u16', '演出', { unsure: true, note: 'directData (2713402F) の行。次の形態がある行の戦闘で使う' }),
    f('line', 0x1e, 'u16', '形態変化のセリフ', { ref: msg, note: 'この行の形態になったときのセリフ' }),
    ...Array.from({ length: 5 }, (_, k) => f(`skill${k}`, 0x20 + 2 * k, 'u16', `ワザ ${k + 1}`, { ref: row('monsterAttackSkill.bin'), note: '0 = 空き' })),
    f('design', 0x2c, 'u8', '見た目', { ref: row('monsterData.bin'), note: 'monsterData (2713402F) の行: 名前とモデル' }),
    ...resist4,
    ...resist2,
    f('next', 0x33, 'u8', '次の形態', { ref: row('monsterBattleParameter.bin'), note: '0 = なし。最初の形態の経験値・お金・ドロップは 0 で、最後の形態が持つ' }),
  ],
};

/** monsterAttackSkill.bin (master エントリ 47): 233 × 0x24, the monsters' skills (naauao honolulu/monsters.md §3). */
export const HONOLULU_MONSTER_ATTACK_SKILL: TableDef = {
  file: 'monsterAttackSkill.bin',
  rowSize: 0x24,
  fields: [
    f('message', 0x00, 'u32', '戦闘メッセージ', { ref: msg }),
    f('bits', 0x04, 'u32', 'ビット詰め', { hex: true, unsure: true, note: '+0x1D bit2 = 1 のとき bit4-8 が状態 (conditionData の行) など。naauao monsters.md §3' }),
    f('power', 0x08, 'f32', '威力の倍率', { unsure: true, note: '推定 (100 / 130 / 150 …)' }),
    f('min', 0x0c, 'u16', '量の最小'),
    f('max', 0x0e, 'u16', '量の最大'),
    f('direct1', 0x12, 'u16', '演出 (使う側)', { unsure: true, note: 'directData の行' }),
    f('direct2', 0x14, 'u16', '演出 (使う側、条件つき)', { unsure: true, note: 'directData の行' }),
    f('direct3', 0x16, 'u16', '演出 (相手ごと 1)', { unsure: true }),
    f('direct4', 0x18, 'u16', '演出 (相手ごと 2)', { unsure: true }),
    f('direct5', 0x1a, 'u16', '演出 (相手ごと、種類 4)', { unsure: true }),
    f('form', 0x1d, 'u8', '行動のビット', { hex: true, unsure: true, note: 'bit2 で +0x04 の写し方が変わる' }),
    f('accuracy', 0x1e, 'u8', '命中率 (×10 %)', { unsure: true, note: '推定。実データは 10 (100%)' }),
  ],
};

/** monsterGroup.bin (master エントリ 46): 58 × 0x2E, the encounter groups, looked up by a key (naauao monsters.md §5.1). */
export const HONOLULU_MONSTER_GROUP: TableDef = {
  file: 'monsterGroup.bin',
  rowSize: 0x2e,
  fields: [
    ...Array.from({ length: 5 }, (_, k) => [
      f(`a${k}`, 4 * k, 'u16', `枠 A ${k + 1}`, { ref: row('monsterBattleParameter.bin') }),
      f(`a${k}Weight`, 4 * k + 2, 'u8', `枠 A ${k + 1} の重み`),
    ]).flat(),
    ...Array.from({ length: 5 }, (_, k) => f(`b${k}`, 0x14 + 4 * k, 'u16', `枠 B ${k + 1}`, { ref: row('monsterBattleParameter.bin'), note: 'フィールドに出す見た目の敵と推定' })),
    ...Array.from({ length: 5 }, (_, k) => f(`kind${k}Weight`, 0x28 + k, 'u8', `型 ${k} の重み`, { note: '型の意味 (出てくる数と推定) は未確認' })),
  ],
};

/** monsterFixGroup.bin (master エントリ 45): 24 × 0x16, fixed groups (boss battles, guessed; naauao monsters.md §5.2). */
export const HONOLULU_MONSTER_FIX_GROUP: TableDef = {
  file: 'monsterFixGroup.bin',
  rowSize: 0x16,
  fields: Array.from({ length: 5 }, (_, k) => f(`m${k}`, 4 * k, 'u16', `敵 ${k + 1}`, { ref: row('monsterBattleParameter.bin') })),
};

/** csvMap.bin (A90C8038): 97 × 4, the maps (naauao honolulu/analysis.md §4). */
export const HONOLULU_CSV_MAP: TableDef = {
  file: 'csvMap.bin',
  rowSize: 4,
  fields: [f('map', 0x00, 'u32', 'マップ', { hex: true, note: 'マップ DB (A2C14C00) のハッシュ' })],
};

/** The definitions by file name (master 56562135, 2713402F, A90C8038). */
export const HONOLULU_TABLES: Record<string, TableDef> = Object.fromEntries(
  [
    HONOLULU_ITEM_DATA,
    HONOLULU_EQUIP_DATA,
    HONOLULU_CLOTH_DATA,
    HONOLULU_SHOP_ITEM_DATA,
    HONOLULU_SHOP_ITEM_GROUP,
    HONOLULU_DUNGEON_DATA,
    HONOLULU_SKILL_DATA,
    HONOLULU_SCENARIO,
    HONOLULU_MAP_DATA,
    HONOLULU_SOUND_DATA,
    HONOLULU_MAP_PARTS,
    HONOLULU_MAP_OBJECT,
    HONOLULU_MAP_RESOURCE,
    HONOLULU_DESIGNED_MAP,
    HONOLULU_MONSTER_DATA,
    HONOLULU_MONSTER_BATTLE_PARAMETER,
    HONOLULU_MONSTER_ATTACK_SKILL,
    HONOLULU_MONSTER_GROUP,
    HONOLULU_MONSTER_FIX_GROUP,
    HONOLULU_CSV_MAP,
  ].map((d) => [d.file, d]),
);
