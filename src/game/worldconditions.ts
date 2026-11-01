// Appearance conditions of the world maps' entrances: an entrance (section 2) with +0x10 = a Wxx_EventObject row is
// placed only when that row's conditions let it (FUN_001e2ac4 checks +0x4C / +0x04 and +0x4B / +0x00 with
// FUN_0030b8a4, like the dungeon loaders do; docs/worldmap.md §6, docs/event-list.md §4).
import { ENT } from './worldmap';
import { KIND_ENTRANCE } from './worldnotice';
import { u32, w32 } from '../util/bytes';

/** Indexes of the entrances whose +0x10 is `row` (none for row 0). */
export function entranceRowUsers(list: Uint8Array[], row: number): number[] {
  if (!row) return [];
  return list.flatMap((r, i) => (ENT.event(r) === row ? [i] : []));
}

/** Records of a world map's section 6 ({u32 row, s16 x, s16 y, ...} x 16 bytes) that use `row`. */
export function worldEventPlaces(section6: Uint8Array, row: number): number {
  let n = 0;
  for (let o = 0; o + 16 <= section6.length; o += 16) if (u32(section6, o) === row) n++;
  return n;
}

/**
 * A row for an entrance's conditions: kind 0x11, the only kind whose action is a plain entrance (FUN_00319184 /
 * FUN_002daac0; with kind 0 or 0x24 the entrance cannot be entered, 0x21 only shows a message), with the conditions
 * (+0x00 / +0x04 / +0x4B / +0x4C) of `from` when given. The state slot (+0x44) is given by EventTable.addRow.
 */
export function newEntranceRow(size: number, from: Uint8Array | null): Uint8Array {
  const row = new Uint8Array(size);
  row[0x4d] = KIND_ENTRANCE;
  if (from) {
    w32(row, 0x00, u32(from, 0x00));
    w32(row, 0x04, u32(from, 0x04));
    row[0x4b] = from[0x4b]!;
    row[0x4c] = from[0x4c]!;
  }
  return row;
}

/**
 * Set one condition of a row: `field` 0x4B (with the value at +0x00) or 0x4C (+0x04). Type 0 clears it and keeps
 * the value (some kinds use +0x00 for something else).
 */
export function setRowCondition(row: Uint8Array, field: 0x4b | 0x4c, type: number, value: number): void {
  row[field] = type & 0xff;
  if (type) w32(row, field === 0x4b ? 0x00 : 0x04, value >>> 0);
}
