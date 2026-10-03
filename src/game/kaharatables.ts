// Fields of 電波人間のRPG2's GS tables for the RomFS viewer (docs/analysis.md "itemData.bin"; items.ts reads them).
import type { TableDef } from './tabledef';
import { ACTION_KIND, ACTION_RANGE, ACTION_SIDE, ELEMENT } from './actions';
import { ITEM_CATEGORY } from './items';

const msg = { kind: 'message' } as const;

export const KAHARA_ITEM_DATA: TableDef = {
  file: 'itemData.bin',
  rowSize: 0x30,
  fields: [
    { key: 'price', offset: 0x00, type: 'u32', label: '買値' },
    { key: 'sell', offset: 0x04, type: 'u32', label: '売値' },
    { key: 'flags', offset: 0x08, type: 'u32', label: 'フラグ', hex: true },
    { key: 'rarity', offset: 0x08, type: 'u32', label: '☆', bits: [5, 3], alias: true },
    { key: 'name', offset: 0x0c, type: 'u32', label: '名前', ref: msg },
    { key: 'menu', offset: 0x10, type: 'u32', label: '説明 (メニュー)', ref: msg },
    { key: 'shop0', offset: 0x14, type: 'u32', label: '説明 (お店 1)', ref: msg },
    { key: 'shop1', offset: 0x18, type: 'u32', label: '説明 (お店 2)', ref: msg },
    { key: 'shop2', offset: 0x1c, type: 'u32', label: '説明 (お店 3)', ref: msg },
    { key: 'model', offset: 0x20, type: 'u32', label: 'モデル', ref: { kind: 'hash' } },
    { key: 'action', offset: 0x24, type: 'u32', label: 'アクション', note: '道具。装備は効果の値 (s16 × 2)' },
    { key: 'order', offset: 0x28, type: 'u16', label: '並び' },
    { key: 'chain', offset: 0x2a, type: 'u16', label: '上限で変わる先' },
    { key: 'category', offset: 0x2c, type: 'u8', label: '分類', ref: { kind: 'enum', values: ITEM_CATEGORY }, note: '下位 4 ビット' },
    { key: 'state1', offset: 0x2d, type: 'u8', label: '効果 1 の状態' },
    { key: 'state2', offset: 0x2e, type: 'u8', label: '効果 2 の状態' },
    { key: 'limit', offset: 0x2f, type: 'u8', label: '上限', note: '0 = 99' },
  ],
};

const elements = Object.fromEntries(ELEMENT.map((e, i) => [i, e || 'なし']));
const perf = (key: string, offset: number, label: string, note?: string): TableDef['fields'][number] => ({ key, offset, type: 'u16', label, note: note ?? 'directData (2713402F) の行 (docs/action-performance.md §2)' });

/** actionData.bin (56562135): 672 × 0x3C (docs/battle.md §8, action-performance.md §2). */
export const KAHARA_ACTION_DATA: TableDef = {
  file: 'actionData.bin',
  rowSize: 0x3c,
  fields: [
    { key: 'w0', offset: 0x00, type: 'u32', label: 'w0', hex: true },
    { key: 'kind', offset: 0x00, type: 'u32', label: 'カテゴリ', bits: [1, 2], alias: true, ref: { kind: 'enum', values: ACTION_KIND } },
    { key: 'type', offset: 0x00, type: 'u32', label: '種別', bits: [3, 4], alias: true, note: 'カテゴリごとに意味が違う (battle.md §6.1, §7)' },
    { key: 'side', offset: 0x00, type: 'u32', label: '陣営', bits: [7, 2], alias: true, ref: { kind: 'enum', values: ACTION_SIDE } },
    { key: 'range', offset: 0x00, type: 'u32', label: '範囲', bits: [9, 4], alias: true, ref: { kind: 'enum', values: ACTION_RANGE } },
    { key: 'level', offset: 0x00, type: 'u32', label: '付与の段階', bits: [13, 3], alias: true },
    { key: 'strengthMin', offset: 0x00, type: 'u32', label: '状態の強さ (最小)', bits: [16, 4], alias: true },
    { key: 'strengthMax', offset: 0x00, type: 'u32', label: '状態の強さ (最大)', bits: [20, 4], alias: true },
    { key: 'element', offset: 0x00, type: 'u32', label: '属性', bits: [24, 4], alias: true, ref: { kind: 'enum', values: elements } },
    { key: 'ground', offset: 0x00, type: 'u32', label: '地面系', bits: [28, 1], alias: true, note: '浮遊に当たらない' },
    { key: 'inBattle', offset: 0x00, type: 'u32', label: '戦闘で使える', bits: [29, 1], alias: true },
    { key: 'inHouse', offset: 0x00, type: 'u32', label: 'ハウスで使える', bits: [30, 1], alias: true },
    { key: 'inField', offset: 0x00, type: 'u32', label: 'フィールドで使える', bits: [31, 1], alias: true },
    { key: 'name', offset: 0x04, type: 'u32', label: '名前', ref: msg, note: '使ったときのメッセージ (モンスターのワザ名、セリフ)' },
    { key: 'u08', offset: 0x08, type: 'u32', label: '+0x08', unsure: true },
    { key: 'result1', offset: 0x0c, type: 'u32', label: '結果', ref: msg },
    { key: 'result2', offset: 0x10, type: 'u32', label: '結果 (別)', ref: msg },
    { key: 'item', offset: 0x14, type: 'u16', label: 'アイテム' },
    { key: 'turns', offset: 0x16, type: 's16', label: '状態のターン', note: '種別 5 (変身・セリフ) では変身先の行' },
    { key: 'min', offset: 0x18, type: 's16', label: '量 (最小)' },
    { key: 'max', offset: 0x1a, type: 's16', label: '量 (最大)' },
    { key: 'direction', offset: 0x1c, type: 'u16', label: '演出の進行', note: 'カメラ・前に出るかなどの処理の番号 (action-performance.md §2.2)' },
    perf('perfUser', 0x1e, '使用者の演出'),
    perf('perfTarget', 0x20, '対象の演出'),
    perf('perfExtra', 0x22, '追加の演出'),
    perf('perf24', 0x24, '演出 +0x24'),
    perf('perf26', 0x26, '演出 +0x26'),
    perf('perf28', 0x28, '演出 +0x28'),
    perf('perf2A', 0x2a, '演出 +0x2A'),
    perf('perfUser2', 0x2c, '使用者の演出 (別の組)'),
    perf('perfTarget2', 0x2e, '対象の演出 (別の組)'),
    { key: 'u30', offset: 0x30, type: 'u16', label: '+0x30', unsure: true },
    { key: 'state', offset: 0x32, type: 'u8', label: '付ける状態', note: 'conditionData の ID' },
    { key: 'power', offset: 0x33, type: 'u8', label: '威力', note: '1/10 単位 (10 = 範囲の補正)' },
    { key: 'u34', offset: 0x34, type: 'u32', label: '+0x34', unsure: true },
    { key: 'u38', offset: 0x38, type: 'u32', label: '+0x38', unsure: true },
  ],
};

export const KAHARA_TABLES: Record<string, TableDef> = { [KAHARA_ITEM_DATA.file]: KAHARA_ITEM_DATA, [KAHARA_ACTION_DATA.file]: KAHARA_ACTION_DATA };
