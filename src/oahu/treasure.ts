// RPG3's chest contents (naauao oahu/map.md §10): a chest's EventObject row (kind 0x10 / 0x12) names a treasureGroup row
// (master 21350000, 0x50 bytes) of 10 entries {u32 value, u16 weight, u8 kind, u8 0xD0}; opening it picks one entry
// with a chance by weight (FUN_00229734). The kind says what the value is: an item, an amount of G or of jewels.
import type { GsTable } from '../archive/gstable';
import { u16, u32, w16, w32 } from '../util/bytes';
import { EO } from './events';
import type { OahuMaster } from './master';

export const OAHU_TREASURE_FILE = 'treasureGroup.bin';
export const OAHU_TREASURE_SLOTS = 10;

/** EventObject kinds of chests (FUN_004BC3C0): 0x10 (FUN_001E6804) and 0x12 (FUN_0027EED4, another class). */
export const OAHU_CHEST_KINDS: Record<number, string> = { 0x10: '宝箱', 0x12: '宝箱 (別の動き)' };

/** What an entry gives (+0x06; FUN_001E66B0): 1 an item (1 of it), 2 G, 3 jewels (the value is the amount), 4 not known. */
export const OAHU_TREASURE_KIND: Record<number, string> = { 1: 'アイテム', 2: 'G', 3: 'ジュエル', 4: '種類 4 (未解析)' };

export interface OahuTreasureSlot {
  /** Item ID, or the amount of G / jewels. */
  value: number;
  weight: number;
  kind: number;
}

/** treasureGroup row of a chest's EventObject row (+0x10), null when the row is not a chest. */
export function oahuChestTreasureRow(ev: Uint8Array): number | null {
  return OAHU_CHEST_KINDS[ev[EO.kind]!] ? u32(ev, EO.args) : null;
}

export function oahuTreasureTable(master: OahuMaster): GsTable {
  return master.table(OAHU_TREASURE_FILE);
}

/** The filled entries of a row (the game skips entries whose value is 0). */
export function oahuTreasureSlots(t: GsTable, row: number): OahuTreasureSlot[] {
  if (row < 0 || row >= t.rows) return [];
  const r = t.row(row);
  const out: OahuTreasureSlot[] = [];
  for (let i = 0; i < OAHU_TREASURE_SLOTS; i++) {
    const o = i * 8;
    if (u32(r, o)) out.push({ value: u32(r, o), weight: u16(r, o + 4), kind: r[o + 6]! });
  }
  return out;
}

/** Write the entries packed at the front; empty entries are {0, 1, 1, 0xD0} like the game's data. */
export function oahuWriteTreasure(t: GsTable, row: number, slots: OahuTreasureSlot[]): void {
  const r = t.row(row);
  for (let i = 0; i < OAHU_TREASURE_SLOTS; i++) {
    const s = slots[i];
    const o = i * 8;
    w32(r, o, s ? s.value : 0);
    w16(r, o + 4, s ? s.weight : 1);
    r[o + 6] = s ? s.kind : 1;
    r[o + 7] = 0xd0;
  }
}

/** "やくそう" / "300 G" / "1 ジュエル". */
export function oahuTreasureLabel(s: OahuTreasureSlot, itemName: (id: number) => string): string {
  if (s.kind === 1) return itemName(s.value) || `アイテム ${s.value}`;
  if (s.kind === 2) return `${s.value} G`;
  if (s.kind === 3) return `${s.value} ジュエル`;
  return `${OAHU_TREASURE_KIND[s.kind] ?? `種類 ${s.kind}`} ${s.value}`;
}
