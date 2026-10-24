// Fields of 電波人間のRPG (初代)'s GS tables, as far as they are understood (naauao honolulu/analysis.md・items.md・
// shops.md), in the same definitions as the other games (game/tabledef.ts). Most tables are not analysed yet: the
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
  ],
};

/** mapResource.bin (master エントリ 37): 9 × 0x14 (naauao honolulu/analysis.md §2). */
export const HONOLULU_MAP_RESOURCE: TableDef = {
  file: 'mapResource.bin',
  rowSize: 0x14,
  fields: [f('tiles', 0x00, 'u32', 'タイルのモデルのアーカイブ', { hex: true })],
};

/** monsterData.bin (2713402F): 92 × 0x2C, the looks of the monsters (naauao honolulu/analysis.md §3.1). */
export const HONOLULU_MONSTER_DATA: TableDef = {
  file: 'monsterData.bin',
  rowSize: 0x2c,
  fields: [
    f('name', 0x00, 'u32', '名前', { ref: msg }),
    f('model', 0x04, 'u32', 'モデル', { ref: hash, note: '470D2848 のエントリ' }),
    f('texture', 0x08, 'u32', 'テクスチャ', { ref: hash, note: '470D2848 のエントリ' }),
    f('scale1', 0x0c, 'f32', '+0x0C', { unsure: true, note: '拡大率と推定' }),
    f('scale2', 0x10, 'f32', '+0x10', { unsure: true, note: '拡大率と推定' }),
  ],
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
    HONOLULU_MAP_OBJECT,
    HONOLULU_MAP_RESOURCE,
    HONOLULU_MONSTER_DATA,
    HONOLULU_CSV_MAP,
  ].map((d) => [d.file, d]),
);
