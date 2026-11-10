// Free event rows (game/eventslots.ts): which rows of a dungeon's EventObject table new objects may take again after
// a chest or gimmick is deleted, how EventTable hands them out, and how releasing leaves the table. No ROM needed.
import { describe, expect, test } from 'bun:test';
import { rebuildArchive, type ArcEntry } from '../src/archive/gsarc';
import { KIND_BOSS, writeStages } from '../src/game/boss';
import { KIND_SWITCH } from '../src/game/eventkinds';
import { EventTable } from '../src/game/events';
import { freeRows, isBlankRow, liveRows, releaseRows } from '../src/game/eventslots';
import { u16, w32 } from '../src/util/bytes';

const SIZE = 0x50;
const CHEST = 0x0c;

/** A GS table of `rows` rows (row i: kind `kinds[i]`, slot i) without a hash index. */
function gsTable(kinds: number[]): Uint8Array {
  const off = 0x40;
  const out = new Uint8Array(off + kinds.length * SIZE);
  w32(out, 0, kinds.length);
  w32(out, 4, SIZE);
  w32(out, 0x10, off);
  w32(out, 0x14, kinds.length * SIZE);
  w32(out, 0x18, out.length);
  kinds.forEach((k, i) => {
    out[off + i * SIZE + 0x4d] = k;
    out[off + i * SIZE + 0x44] = i;
    out[off + i * SIZE + 0x08] = 1; // something besides the kind and slot
  });
  return out;
}

/** An EventTable read from an archive holding d01_EventObject.bin. */
function events(kinds: number[], capacity = 10): EventTable {
  const like: ArcEntry = { index: 0, hash: 0, type: 0, size: 0, offset: 0, comp: 1, unk: 0xffffffff, raw: 0 };
  const arc = rebuildArchive({ data: new Uint8Array(12), version: 5, hash: 0, entries: [] }, new Map(), [
    { hash: 1, name: 'd01_EventObject.bin', body: gsTable(kinds), like },
  ]);
  return EventTable.fromArchive(1, capacity, 'test', arc)!;
}

describe('rows in use', () => {
  test('records, switch targets, hard-coded script targets and script data rows', () => {
    const ev = events([0, CHEST, KIND_SWITCH, 0, 0, KIND_BOSS, 0, 0, 0, 0]);
    w32(ev.table.row(2), 0x08, 3);
    w32(ev.table.row(2), 0x0c, 0);
    writeStages(ev.table.row(5), [{ fix: 0, bgm: 0, repeat: false, messages: [0, 0, 0], script: { first: 7, rows: 2 } }]);
    expect([...liveRows(ev, [1, 2, 5], 2)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 7, 8]);
    // D01's script row 2 opens rows 10 (outside the table here, ignored)
    expect(liveRows(ev, [2], 1).has(3)).toBe(true);
  });

  test('free rows: unused and added, used by the game maps only, or blank', () => {
    const ev = events([0, CHEST, CHEST, 0, CHEST]);
    ev.addRow(ev.table.row(1)); // row 5, added
    ev.table.row(3).fill(0); // a blank game row
    // nothing points at rows 2 / 3 / 4 / 5; only row 2 was on a game map
    const live = liveRows(ev, [1], 1);
    expect(freeRows(ev, live, new Set([1, 2]))).toEqual([2, 3, 5]);
    expect(isBlankRow(ev.table.row(3))).toBe(true);
  });
});

describe('taking free rows', () => {
  test('addRow takes the lowest free row with a free slot, then grows the table', () => {
    const ev = events([0, CHEST, CHEST, CHEST], 5);
    const free = [2];
    ev.freeRows = () => free;
    expect(ev.roomLeft()).toBe(2); // row 2 again + one more row
    const a = ev.addRow(ev.table.row(1));
    expect(a).toBe(2);
    expect(ev.rows).toBe(4);
    expect(u16(ev.table.row(2), 0x44)).toBe(2); // its slot back (rows 0 / 1 / 3 hold 0 / 1 / 3)
    expect(free).toEqual([]);
    const b = ev.addRow(ev.table.row(1));
    expect(b).toBe(4);
    expect(u16(ev.table.row(4), 0x44)).toBe(4);
    expect(() => ev.addRow(ev.table.row(1))).toThrow();
  });
});

describe('releasing rows', () => {
  test('added rows at the end go away (the table is as in the game again), others are blanked', () => {
    const ev = events([0, CHEST, CHEST, CHEST]);
    ev.addRow(ev.table.row(1));
    ev.addRow(ev.table.row(1));
    expect(ev.rows).toBe(6);
    releaseRows(ev, [4, 5]);
    expect(ev.rows).toBe(4);
    expect(ev.changed()).toBe(false);

    ev.addRow(ev.table.row(1)); // 4
    ev.addRow(ev.table.row(1)); // 5
    releaseRows(ev, [2, 4]);
    expect(ev.rows).toBe(6);
    expect(isBlankRow(ev.table.row(2))).toBe(true);
    expect(u16(ev.table.row(2), 0x44)).toBe(2);
    expect(isBlankRow(ev.table.row(4))).toBe(true);
    expect(isBlankRow(ev.table.row(5))).toBe(false);
  });

  test('the game rows stay even when free', () => {
    const ev = events([0, CHEST, CHEST]);
    releaseRows(ev, [1, 2]);
    expect(ev.rows).toBe(3);
    expect(isBlankRow(ev.table.row(2))).toBe(true);
  });

  test('a game row deleted by hand (blanked) is free from then on', () => {
    const ev = events([0, CHEST, CHEST]);
    const live = liveRows(ev, [1], 1);
    expect(freeRows(ev, live, new Set())).toEqual([]); // row 2: unused, but the code may use it
    releaseRows(ev, [2]);
    expect(freeRows(ev, live, new Set())).toEqual([2]);
  });
});
