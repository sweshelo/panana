// Adding, copying and renaming the maps and dungeons (MapGroup rows) of a RPG FREE! stage (src/lanai/mapadd.ts): the
// map database's added entries, a table cut to its first rows, the actions turned to the copied maps, and on the ROM
// (skipped without the decrypted CIAs: test/env.ts) a map copied in a dungeon, a dungeon copied with its maps and its
// EventObject table, the names, the saved edits put back in a new session, and taking it all out again.
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { ArmMachine } from '../src/game/arm';
import { MapDb } from '../src/game/mapdb';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { fieldStartPatch, LANAI_NO_FIELD_START } from '../src/lanai/fieldStart';
import {
  addLanaiGroup,
  addLanaiMap,
  canRemoveGroup,
  groupCode,
  groupMaps,
  recodeLanaiGroup,
  recodeMapName,
  remapEventMaps,
  removeLanaiGroup,
  removeLanaiMap,
  renameLanaiGroup,
  renameLanaiMap,
  rowName,
  suggestGroupCode,
  suggestMapName,
} from '../src/lanai/mapadd';
import {
  LANAI_EVENT_ACTIONS,
  LANAI_MAP_ROW,
  LANAI_MAP_TABLE_ENTRY,
  LANAI_MAPDB_ENTRY,
  lanaiMaps,
  type LanaiMaps,
} from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { LanaiTable } from '../src/lanai/table';
import { openImages, type Dump } from '../src/rom/dump';
import { applyIps } from '../src/rom/ips';
import { equalBytes, u32, w32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

/** A table of `rows` rows of `size` bytes (row r filled with r + 1), row IDs 0x80000000 | r, no strings. */
function plainTable(rows: number, size: number): Uint8Array {
  const pool = new TextEncoder().encode('Tbl\0\0\0\0\0\0\0\0\0\0\0\0\0'); // 16 bytes
  const data = 0x40 + pool.length;
  const ids = Math.ceil((data + rows * size) / 16) * 16;
  const relocAt = Math.ceil((ids + rows * 4) / 16) * 16;
  const b = new Uint8Array(relocAt);
  const h = [rows, size, 0x40, pool.length, data, rows * size, ids, rows * 4, 0, 0, relocAt, 0, 0, 0];
  h.forEach((v, i) => w32(b, i * 4, v));
  b.set(pool, 0x40);
  for (let r = 0; r < rows; r++) {
    b.fill(r + 1, data + r * size, data + (r + 1) * size);
    w32(b, ids + r * 4, (0x80000000 | r) >>> 0);
  }
  return b;
}

describe('map database: added entries', () => {
  const db = (): MapDb => {
    const b = new Uint8Array(4 + 12 + 4);
    w32(b, 0, 1);
    w32(b, 4, 0x100);
    w32(b, 8, 0);
    w32(b, 12, 4);
    b.set([1, 2, 3, 4], 16);
    return new MapDb(b);
  };

  test('an added entry is built in hash order, and taken out it builds as the original', () => {
    const d = db();
    const orig = d.build();
    d.add(0x50, new Uint8Array([7, 7]));
    expect(d.isAdded(0x50)).toBe(true);
    expect(d.isAdded(0x100)).toBe(false);
    expect(d.addedHashes()).toEqual([0x50]);
    const built = new MapDb(d.build());
    expect(built.count).toBe(2);
    expect([...built.get(0x50)]).toEqual([7, 7]);
    expect([...built.get(0x100)]).toEqual([1, 2, 3, 4]);
    expect(u32(d.build(), 4)).toBe(0x50);
    d.remove(0x50);
    expect(d.has(0x50)).toBe(false);
    expect(equalBytes(d.build(), orig)).toBe(true);
    expect(() => d.remove(0x100)).toThrow();
  });
});

describe('LanaiTable.copyOf', () => {
  test('cuts a table to its first rows and reads as unedited', () => {
    const t = new LanaiTable(plainTable(4, 8));
    t.setU8(2, 0, 0x55);
    const c = LanaiTable.copyOf(t, 1);
    expect(c.rows).toBe(1);
    expect(c.rowIds).toEqual([0x80000000]);
    expect(c.changed).toBe(false);
    expect(c.originalRows).toBe(1);
    expect([...c.row(0)]).toEqual(Array(8).fill(1));
    const all = LanaiTable.copyOf(t);
    expect(all.rows).toBe(4);
    expect(all.u8(2, 0)).toBe(0x55);
    // the copy's row added gets the next row ID
    expect(c.rowId(c.addRow(0))).toBe(0x80000001);
  });
});

describe('copies of a dungeon', () => {
  test('the actions that name a map of the group go to its copy; the others stay', () => {
    const t = new LanaiTable(plainTable(3, 100));
    for (let r = 0; r < 3; r++)
      for (const o of LANAI_EVENT_ACTIONS) for (let a = 0; a < 6; a++) t.setU32(r, o + a * 4, 0);
    t.setU32(1, 0x10, 0x80000013);
    t.setU32(1, 0x14, 0xaaaa0001); // a map of the group
    t.setU32(1, 0x18, 5); // the point
    t.setU32(2, 0x40, 0x80000011);
    t.setU32(2, 0x44, 0xbbbb0001); // a map of another group
    t.setU32(2, 0x2c, 0xaaaa0002);
    const n = remapEventMaps(
      t,
      new Map([
        [0xaaaa0001, 0xcccc0001],
        [0xaaaa0002, 0xcccc0002],
      ]),
    );
    expect(n).toBe(2);
    expect(t.u32(1, 0x14)).toBe(0xcccc0001);
    expect(t.u32(1, 0x18)).toBe(5);
    expect(t.u32(2, 0x44)).toBe(0xbbbb0001);
    expect(t.u32(2, 0x2c)).toBe(0xcccc0002);
    // the type fields are not arguments
    expect(t.u32(1, 0x10)).toBe(0x80000013);
  });

  test('map names take the new code', () => {
    expect(recodeMapName('D01001B01', 'D01', 'D09')).toBe('D09001B01');
    expect(recodeMapName('F01OUTF01', 'D01', 'D09')).toBe('F01OUTF01');
  });
});

describe.skipIf(!hasLanai)('RPG FREE! maps and dungeons added (ROM)', () => {
  let dump: Dump;
  let s: LanaiSession;
  let content: LanaiContent;
  let maps: LanaiMaps;
  beforeAll(async () => {
    dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump, { fresh: true });
    content = lanaiContents(s)[38]!;
    maps = await lanaiMaps(s, content);
  }, 300000);

  test('the Update resolves all nine slots of an added floor, including empty slots restored from older edits and MODs', async () => {
    const local = await LanaiSession.open(dump, { fresh: true });
    const c = lanaiContents(local)[1]!;
    const floors = await lanaiMaps(local, c);
    const template = floors.mapByName('D01001B02')!;
    let hash = 0x11000;
    const floor = addLanaiMap(
      floors,
      { template, floor: -3, name: 'D01001B03', copy: 'tiles' },
      () => hash++ / 0x100000000,
    );
    const saved = local.saved();
    const empty = floor.slots.slice(0, 9).filter((h) => floors.db.get(h).length === 0);
    expect(empty).toHaveLength(7);
    expect(saved.maps!.filter(([, h]) => empty.includes(h))).toHaveLength(7);

    // Execute the game's slot reader against the actual map table and DB, stubbing only archive access.
    const sizesOnGame = (file: Uint8Array): number[] => {
      const archive = parseArchive(file);
      const table = unpackEntry(archive, findEntry(archive, LANAI_MAP_TABLE_ENTRY)!).body;
      const db = unpackEntry(archive, findEntry(archive, LANAI_MAPDB_ENTRY)!).body;
      const m = new ArmMachine(dump.code, { stubs: new Map([[0x2bd2e4, () => dbAt]]) });
      const load = (bytes: Uint8Array): number => {
        const address = m.alloc(bytes.length);
        bytes.forEach((v, i) => m.wb(address + i, v));
        return address;
      };
      const dbAt = load(db);
      const tableAt = load(table);
      m.write(0x4eb098, tableAt, 4);
      m.write(0x4eb09c, tableAt + table.length, 4);
      const result = m.alloc(8);
      return floor.slots.slice(0, 9).map((_, slot) => {
        m.run(0x2b164c, [result, floor.hash, slot]);
        return m.read(result + 4, 4);
      });
    };
    const expected = [floors.db.get(template.hash).length, 0, 0, 0, 0, 0, 8, 0, 0];
    expect(sizesOnGame(local.modFiles().get(c.archive)!)).toEqual(expected);

    // Earlier versions wrote only nonempty sections into both the autosave and the exported archive.
    saved.maps = saved.maps!.filter(([, h]) => !empty.includes(h));
    const legacyTable = saved.mapTables![0]![1];
    w32(legacyTable, floor.index * LANAI_MAP_ROW + 0x24, 0x12345678);
    const reopened = await LanaiSession.open(dump, { fresh: true });
    await reopened.restore(saved);
    expect(sizesOnGame(reopened.modFiles().get(c.archive)!)).toEqual(expected);
    expect(reopened.needsFieldStartGuard).toBe(true);
    for (const h of empty) floors.db.remove(h);
    floors.setTableBytes(legacyTable);
    const legacy = local.modFiles();
    expect(sizesOnGame(legacy.get(c.archive)!)[4]).toBe(8); // lower_bound returns slot 6's header for chests
    const imported = await LanaiSession.open(dump, {
      fresh: true,
      baseMod: { label: 'legacy', romfs: legacy, ips: null },
    });
    await imported.restore({ rows: [], mapTables: [[c.archive, legacyTable]] });
    expect(sizesOnGame((await imported.allModFiles()).get(c.archive)!)).toEqual(expected);
    expect(imported.needsFieldStartGuard).toBe(true);
  }, 300000);

  test('the field constructor calls CRO export 3 on the original floors and skips it on an added floor in the same group', async () => {
    const local = await LanaiSession.open(dump, { fresh: true });
    const floors = await lanaiMaps(local, lanaiContents(local)[1]!);
    const b2 = floors.mapByName('D01001B02')!;
    expect(local.codeIps()).toBeNull();
    const b3 = addLanaiMap(floors, { template: b2, floor: -3, name: 'D01001B03', copy: 'tiles' });
    expect(b3.slots[9]).toBe(LANAI_NO_FIELD_START);
    const ips = local.codeIps()!;
    const code = applyIps(dump.code, ips);
    expect(fieldStartPatch(code)).toBeNull(); // reusing the guard from an imported MOD
    let current = b2.hash;
    let calls = 0;
    const manager = 0x30008000;
    const m = new ArmMachine(code, {
      textEnd: 0x49a000,
      maxDepth: 12,
      stubs: new Map([
        [0x2e7c60, (cpu) => cpu.r[0]!], // base constructor
        [
          0x314550,
          (cpu) => {
            expect(cpu.r[1]).toBe(0x2a);
            return current;
          },
        ], // current map save key
        [
          0x2e7e4c,
          (cpu) => {
            expect(cpu.r[0]).toBe(manager);
            expect(cpu.r[1]).toBe(3);
            return 0x77068c;
          },
        ],
        [
          0x77068c,
          () => {
            calls++;
            return 0x770abc;
          },
        ],
      ]),
    });
    const table = floors.tableBytes;
    const tableAt = m.alloc(table.length);
    table.forEach((v, i) => m.wb(tableAt + i, v));
    m.write(0x4eb098, tableAt, 4);
    m.write(0x4eb09c, tableAt + table.length, 4);
    const field = m.alloc(16);
    const mode = m.alloc(16);
    m.write(0x4eb760, mode, 4);
    m.write(mode + 8, 3, 4);
    m.write(0x4eb5ec, manager, 4);
    const start = (hash: number): number => {
      current = hash;
      m.run(0x182324, [field]);
      return m.read(field + 12, 4);
    };
    expect(start(b2.hash)).toBe(0x770abc);
    expect(start(b3.hash)).toBe(0);
    expect(calls).toBe(1);
    expect(start(floors.mapByName('D01001B01')!.hash)).toBe(0x770abc);
    expect(start(0)).toBe(0x770abc);
    // Slot 9 is terrain on world maps, including a third-party terrain hash equal to the marker.
    m.wb(tableAt + b3.index * LANAI_MAP_ROW + 0x40, 'W'.charCodeAt(0));
    expect(start(b3.hash)).toBe(0x770abc);
    expect(calls).toBe(4);
    removeLanaiMap(floors, b3);
    expect(local.codeIps()).toBeNull();
  }, 300000);

  test('a map copied in its dungeon: own sections and EventObject rows; exported, saved and put back; taken out', async () => {
    const src = maps.mapByName('D01001B01')!;
    const ev = maps.eventTable(src.dungeon)!;
    const rows = ev.rows;
    const romMaps = maps.maps.length;
    const code = groupCode(maps, src.dungeon);
    expect(code).toBe('D01');
    const name = suggestMapName(maps, code, src.floor);
    expect(name).toMatch(/^D01\d{3}B01$/);
    const m = addLanaiMap(maps, { template: src, floor: src.floor, name, copy: 'all' });
    expect(m.added).toBe(true);
    expect(m.dungeon).toBe(src.dungeon);
    expect(maps.maps.length).toBe(romMaps + 1);
    expect(m.sections.every((h, k) => (k === 7 ? h === 0 : !src.sections.includes(h)))).toBe(true);
    const a = maps.doc(src),
      b = maps.doc(m);
    expect(b.tiles.length).toBe(a.tiles.length);
    // each EventObject row the records name got a copy (shared ones share it)
    const named = new Set<number>();
    for (const k of [3, 4, 5, 8]) for (const r of a.recs[k] ?? []) if (u32(r.raw, 4) > 0) named.add(u32(r.raw, 4));
    expect(ev.rows).toBe(rows + named.size);
    for (const k of [3, 4, 5, 8])
      for (const [i, r] of (b.recs[k] ?? []).entries()) {
        const was = u32(a.recs[k]![i]!.raw, 4);
        expect(u32(r.raw, 4) >= rows || was === 0).toBe(true);
      }

    // the export: one more row in the map table, the sections in the database
    const arc = parseArchive(s.modFiles().get(content.archive)!);
    const table = unpackEntry(arc, findEntry(arc, LANAI_MAP_TABLE_ENTRY)!).body;
    expect(table.length / LANAI_MAP_ROW).toBe(romMaps + 1);
    expect(rowName(table.subarray(romMaps * LANAI_MAP_ROW))).toBe(name);
    const db = new MapDb(unpackEntry(arc, findEntry(arc, LANAI_MAPDB_ENTRY)!).body);
    expect(equalBytes(db.get(m.sections[0]!), maps.db.get(src.sections[0]!))).toBe(true);

    // saved and put back in a new session
    const again = await LanaiSession.open(dump, { fresh: true });
    await again.restore(s.saved());
    const maps2 = await lanaiMaps(again, lanaiContents(again)[38]!);
    const m2 = maps2.mapByName(name)!;
    expect(m2.hash).toBe(m.hash);
    expect(m2.added).toBe(true);
    expect(maps2.doc(m2).tiles.length).toBe(b.tiles.length);
    expect(maps2.eventTable(src.dungeon)!.rows).toBe(ev.rows);

    renameLanaiMap(maps, maps.mapByName(name)!, 'D01999B01');
    expect(maps.mapByName('D01999B01')!.hash).toBe(m.hash);
    removeLanaiMap(maps, maps.mapByName('D01999B01')!);
    expect(maps.maps.length).toBe(romMaps);
    expect(maps.db.addedHashes()).toEqual([]);
    s.revertAll();
    expect(s.modFiles().size).toBe(0);
  }, 300000);

  test('a dungeon copied with its maps: own MapGroup row, name, EventObject table and slots; stairs lead to the copies', async () => {
    const mg = maps.mapGroup!;
    const groupRows = mg.rows;
    const tmpl =
      maps.maps.find((m) => !m.world && groupMaps(maps, m.dungeon).length > 1)?.dungeon ??
      maps.mapByName('D01001B01')!.dungeon;
    const g = maps.groups[tmpl]!;
    const list = groupMaps(maps, tmpl);
    const from = groupCode(maps, tmpl);
    const code = suggestGroupCode(maps, from[0]);
    const end = Math.max(...maps.groups.map((x) => (x.stateCount ? x.stateFirst + x.stateCount : 0)));
    const otherName = maps.groupName(tmpl);
    const r = addLanaiGroup(maps, { template: tmpl, name: 'テストのどうくつ', code, copyMaps: true });
    expect(r.group).toBe(groupRows);
    expect(mg.rows).toBe(groupRows + 1);
    expect(r.made.length).toBe(list.length);
    expect(r.made.map((m) => m.name)).toEqual(list.map((m) => recodeMapName(m.name, from, code)));
    const ng = maps.groups[r.group]!;
    expect(maps.groupName(r.group)).toBe('テストのどうくつ');
    expect(maps.groupName(tmpl)).toBe(otherName);
    expect(ng.eventEntry).not.toBe(g.eventEntry);
    expect(ng.stateFirst).toBe(end);
    expect(ng.stateCount).toBe(g.stateCount);
    expect(ng.firstMap).toBe(r.first.hash);
    const copy = maps.eventTable(r.group)!;
    const orig = maps.eventTable(tmpl)!;
    expect(copy).not.toBe(orig);
    expect(copy.rows).toBe(orig.rows);
    // every action argument that named a map of the group names its copy now
    const hashOf = new Map(list.map((m, i) => [m.hash, r.made[i]!.hash]));
    for (let row = 0; row < orig.rows; row++)
      for (const o of LANAI_EVENT_ACTIONS)
        for (let k = 1; k <= 5; k++) {
          const v = orig.u32(row, o + k * 4);
          expect(copy.u32(row, o + k * 4)).toBe(hashOf.get(v) ?? v);
        }

    // the export: the new entry (packed like the template's), listed in TableResource when the template's is
    const arc = parseArchive(s.modFiles().get(content.archive)!);
    const e = findEntry(arc, ng.eventEntry)!;
    expect(e).toBeDefined();
    const te = findEntry(arc, g.eventEntry)!;
    expect(e.type).toBe(te.type);
    expect(e.comp).toBe(te.comp);
    expect(equalBytes(unpackEntry(arc, e).body, copy.data)).toBe(true);
    const tr = maps.contentTable('TableResource');
    if (tr) {
      const has = (h: number): boolean => Array.from({ length: tr.rows }, (_, i) => tr.u32(i, 0)).includes(h);
      expect(has(ng.eventEntry)).toBe(has(g.eventEntry));
    }

    // put back in a new session
    const again = await LanaiSession.open(dump, { fresh: true });
    await again.restore(s.saved());
    const maps2 = await lanaiMaps(again, lanaiContents(again)[38]!);
    expect(maps2.groups.length).toBe(groupRows + 1);
    expect(maps2.groupName(r.group)).toBe('テストのどうくつ');
    expect(maps2.eventTable(r.group)!.rows).toBe(copy.rows);
    expect(maps2.mapByName(r.first.name)!.dungeon).toBe(r.group);
    expect(equalBytes(again.modFiles().get(content.archive)!, s.modFiles().get(content.archive)!)).toBe(true);

    // renamed and recoded; then taken out, nothing is left to export
    renameLanaiGroup(maps, r.group, '別の名前');
    expect(maps.groupName(r.group)).toBe('別の名前');
    expect(maps.groupName(tmpl)).toBe(otherName);
    recodeLanaiGroup(maps, r.group, suggestGroupCode(maps, 'D'));
    expect(groupMaps(maps, r.group).every((m) => m.name.startsWith(groupCode(maps, r.group)))).toBe(true);
    expect(canRemoveGroup(maps, r.group)).toBe(true);
    expect(canRemoveGroup(maps, tmpl)).toBe(false);
    removeLanaiGroup(maps, r.group);
    expect(mg.rows).toBe(groupRows);
    expect(s.addedTables()).toEqual([]);
    expect(s.modFiles().size).toBe(0);
  }, 300000);

  test('a ROM dungeon renamed gets a name row of its own (the shared row keeps its text)', () => {
    const g = maps.mapByName('D01001B01')!.dungeon;
    const msg = s.need('MessageMapName');
    const before = maps.groupName(g);
    const id = maps.groups[g]!.nameId;
    renameLanaiGroup(maps, g, 'あたらしい名前');
    expect(maps.groupName(g)).toBe('あたらしい名前');
    expect(maps.groups[g]!.nameId).not.toBe(id);
    expect(s.plain(msg, msg.find(id), 'message').trim()).toBe(before);
    s.revertAll();
    expect(maps.groupName(g)).toBe(before);
  });
});
