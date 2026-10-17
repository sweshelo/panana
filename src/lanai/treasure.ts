// RPG FREE!'s chest contents (naauao lanai/map.md §5.2, §7.1): a chest's EventObject row has an action of type
// 0x8000000E (looks 0 / 2) or 0x80000010 (look 1) whose first argument (+0x14 for the first action) is a row number
// of the content's TreasureGroup. A TreasureGroup row has RPG3's shape (oahu/treasure.ts): 10 entries of
// {u32 value, u16 weight, u8 kind, u8 0xD0}; opening the chest picks one entry with a chance by weight. Empty entries
// are {0x80000000, 1, 1, 0xD0} (RPG3's are value 0).
import { u16, u32, w16, w32 } from '../util/bytes';
import { LANAI_EVENT_ACTIONS, LANAI_EVENT_SECTIONS, type LanaiMaps } from './maps';
import type { LanaiTable } from './table';

export const LANAI_TREASURE_SLOTS = 10;
/** The value of an empty entry. */
export const LANAI_TREASURE_EMPTY = 0x80000000;

/** Action types of chests (map.md §5.2): their first argument is the TreasureGroup row. */
export const LANAI_CHEST_ACTIONS: Record<number, string> = { 0x8000000e: '宝箱 (見た目 0 / 2)', 0x80000010: '宝箱 (見た目 1)' };

/**
 * What an entry gives (+0x06), as seen in the ROM's rows: 1 an item (an ItemData row ID), 2 G (the value is the
 * amount), 3 (values are about all 1; RPG3's jewels), 4 a MonsterGroup row ID of the content (RPG3's chest battle;
 * not confirmed). The code that reads 3 and 4 is not found yet.
 */
export const LANAI_TREASURE_KIND: Record<number, string> = { 1: 'アイテム', 2: 'G', 3: '種類 3 (ジュエル?)', 4: '戦闘 (群れ)' };
export const LANAI_TREASURE_ITEM = 1;
export const LANAI_TREASURE_GOLD = 2;
export const LANAI_TREASURE_BATTLE = 4;

export interface LanaiTreasureSlot {
  /** Item ID, MonsterGroup row ID, or the amount. */
  value: number;
  weight: number;
  kind: number;
}

/** Offset in an EventObject row of the TreasureGroup row of its chest action (the first one), or null when it has none. */
export function lanaiChestField(t: LanaiTable, row: number): number | null {
  if (row <= 0 || row >= t.rows) return null;
  for (const o of LANAI_EVENT_ACTIONS) if (LANAI_CHEST_ACTIONS[t.u32(row, o)]) return o + 4;
  return null;
}

/** The TreasureGroup row of a chest's EventObject row, or null when the row has no chest action. */
export function lanaiChestTreasureRow(t: LanaiTable, row: number): number | null {
  const o = lanaiChestField(t, row);
  return o === null ? null : t.u32(row, o);
}

const isEmpty = (v: number): boolean => v === 0 || v === LANAI_TREASURE_EMPTY;

/** The filled entries of a row. */
export function lanaiTreasureSlots(t: LanaiTable, row: number): LanaiTreasureSlot[] {
  if (row < 0 || row >= t.rows) return [];
  const r = t.row(row);
  const out: LanaiTreasureSlot[] = [];
  for (let i = 0; i < LANAI_TREASURE_SLOTS; i++) {
    const o = i * 8;
    if (!isEmpty(u32(r, o))) out.push({ value: u32(r, o), weight: u16(r, o + 4), kind: r[o + 6]! });
  }
  return out;
}

/** The bytes of a row with these entries packed at the front; empty entries are {0x80000000, 1, 1, 0xD0} like the ROM's. */
export function lanaiTreasureRowBytes(t: LanaiTable, row: number, slots: LanaiTreasureSlot[]): Uint8Array {
  const r = t.row(row).slice();
  for (let i = 0; i < LANAI_TREASURE_SLOTS; i++) {
    const s = slots[i];
    const o = i * 8;
    w32(r, o, s ? s.value >>> 0 : LANAI_TREASURE_EMPTY);
    w16(r, o + 4, s ? s.weight : 1);
    r[o + 6] = s ? s.kind : 1;
    r[o + 7] = 0xd0;
  }
  return r;
}

/** Write a row's entries (a row that becomes its bytes as read again is reverted). */
export function lanaiWriteTreasure(t: LanaiTable, row: number, slots: LanaiTreasureSlot[]): void {
  const b = lanaiTreasureRowBytes(t, row, slots);
  const was = t.originalRow(row);
  if (was && was.every((x, i) => x === b[i])) t.revertRow(row);
  else t.setRow(row, b);
}

/** "キズぐすり" / "300 G" / "群れ 80000015" (names given by the caller). */
export function lanaiTreasureLabel(s: LanaiTreasureSlot, itemName: (id: number) => string, groupName: (id: number) => string): string {
  if (s.kind === LANAI_TREASURE_ITEM) return itemName(s.value);
  if (s.kind === LANAI_TREASURE_GOLD) return `${s.value} G`;
  if (s.kind === LANAI_TREASURE_BATTLE) return `戦闘: ${groupName(s.value)}`;
  return `${LANAI_TREASURE_KIND[s.kind] ?? `種類 ${s.kind}`} ${s.value}`;
}

/** A chest of the content's maps: the map, the record (section 4 …) and its EventObject row. */
export interface LanaiChestUser {
  map: string;
  section: number;
  index: number;
  event: number;
}

/** The records of the content's maps whose EventObject row names each TreasureGroup row (the content shares one table). */
export function lanaiChestUsers(maps: LanaiMaps): Map<number, LanaiChestUser[]> {
  const out = new Map<number, LanaiChestUser[]>();
  for (const m of maps.maps) {
    if (m.world) continue;
    const t = maps.eventTable(m.dungeon);
    if (!t) continue;
    const doc = maps.doc(m);
    for (const k of LANAI_EVENT_SECTIONS)
      (doc.recs[k] ?? []).forEach((r, index) => {
        // the EventObject row of sections 3 / 4 / 5 / 8 is at +0x04 (mapedit.ts lanaiRecEventRow)
        const event = u32(r.raw, 4);
        const row = event ? lanaiChestTreasureRow(t, event) : null;
        if (row !== null) out.set(row, [...(out.get(row) ?? []), { map: m.name, section: k, index, event }]);
      });
  }
  return out;
}
