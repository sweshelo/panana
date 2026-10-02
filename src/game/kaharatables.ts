// Fields of 電波人間のRPG2's GS tables for the RomFS viewer (docs/analysis.md "itemData.bin"; items.ts reads them).
import type { TableDef } from './tabledef';
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

export const KAHARA_TABLES: Record<string, TableDef> = { [KAHARA_ITEM_DATA.file]: KAHARA_ITEM_DATA };
