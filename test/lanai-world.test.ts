// 電波人間のRPG FREE!'s world maps (naauao lanai/worldmap.md): the terrain of slot 9 painted in place with its pools, the
// entrances and where their EventObject rows (action 0x8000001F) lead, and (with the dumps) the ROM's worlds.
import { beforeAll, describe, expect, test } from 'bun:test';
import { MapDb } from '../src/game/mapdb';
import { lanaiContents } from '../src/lanai/contents';
import { LanaiMaps, type LanaiMapInfo } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { LanaiTable } from '../src/lanai/table';
import { LANAI_WORLD_CONTENTS, LANAI_WORLD_ENTER, LANAI_WORLD_PARTS, LanaiWorld, lanaiWorldParts, LW, parseWorldObjects, WE, type LanaiWorldPart } from '../src/lanai/worldmap';
import { LanaiWorldSource } from '../src/lanai/worldsource';
import { oahuGroundPools, parseOahuGround } from '../src/oahu/worldmap';
import { openImages } from '../src/rom/dump';
import { equalBytes, u32, w16, w32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const N = 300;

/** A map database of `entries` (hash ascending). */
function db(entries: [number, Uint8Array][]): MapDb {
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const head = new Uint8Array(4 + sorted.length * 12);
  w32(head, 0, sorted.length);
  let off = 0;
  sorted.forEach(([h, b], i) => {
    w32(head, 4 + i * 12, h);
    w32(head, 8 + i * 12, off);
    w32(head, 12 + i * 12, b.length);
    off += b.length;
  });
  const out = new Uint8Array(head.length + off);
  out.set(head);
  let o = head.length;
  for (const [, b] of sorted) {
    out.set(b, o);
    o += b.length;
  }
  return new MapDb(out);
}

/** A terrain like the ROM's (header, grid, 95 pools, the list, 95 more u32). */
function groundBytes(cells: [number, number, number][]): Uint8Array {
  const b = new Uint8Array(0x2c230);
  w32(b, 0, 1);
  w32(b, 4, 0x14);
  w32(b, 8, 0x2bf34);
  w32(b, 12, 0x2c0b0);
  w32(b, 16, 0x2c0b4);
  for (const [x, y, p] of cells) b[0x14 + (y * N + x) * 2] = p;
  const parts = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) parts[i] = b[0x14 + i * 2]!;
  oahuGroundPools(parts, 95).forEach((v, p) => w32(b, 0x2bf34 + p * 4, v));
  return b;
}

function entrance(part: number, id: number, event: number, x: number, y: number, facing: number): Uint8Array {
  const r = new Uint8Array(32);
  w32(r, 0, part);
  w32(r, 8, id);
  w32(r, 0x0c, event);
  w16(r, 0x10, x);
  w16(r, 0x12, y);
  r[0x1c] = facing;
  return r;
}

/** A GS table of 100-byte EventObject rows (no row IDs, no strings): the fields the world reads. */
function eventTable(rows: Uint8Array[]): LanaiTable {
  // only the parts of a table the world uses
  const t = { rows: rows.length, rowSize: 100, data: rows } as unknown as LanaiTable;
  const fake = t as unknown as { u32: (r: number, o: number) => number; u16: (r: number, o: number) => number; setU32: (r: number, o: number, v: number) => void; addRow: (from: number) => number };
  fake.u32 = (r, o) => u32(rows[r]!, o);
  fake.u16 = (r, o) => rows[r]![o]! | (rows[r]![o + 1]! << 8);
  fake.setU32 = (r, o, v) => w32(rows[r]!, o, v);
  fake.addRow = (from) => {
    rows.push(rows[from]!.slice());
    (t as unknown as { rows: number }).rows = rows.length;
    return rows.length - 1;
  };
  return t;
}

describe('lanai world (no ROM)', () => {
  const W = 0xa8654391, D = 0x11112222;
  const slots = [W, 0xa235f6d5, 0x904b269e, 0x1d9cb94d, 0x751f7483, 0x6de5d537, 0xdb09782b, 0x1cb64240, 0x903e6dd3, 0xe400feef];
  const make = (): { world: LanaiWorld; database: MapDb; events: Uint8Array[] } => {
    const ground = groundBytes([[10, 10, 5], [11, 10, 5], [12, 12, 7]]);
    const ents = new Uint8Array(64);
    ents.set(entrance(88, 0xaaaa0001, 1, 10, 11, 4), 0);
    ents.set(entrance(90, 0xaaaa0002, 2, 20, 21, 1), 32);
    const range = new Uint8Array(12);
    w32(range, 0, 0x80000002);
    w16(range, 4, 30);
    w16(range, 6, 33);
    range[8] = 3;
    range[9] = 3;
    const objects = new Uint8Array(12);
    w32(objects, 0, 5);
    w16(objects, 8, 7);
    w16(objects, 10, 8);
    const database = db([[W, new Uint8Array(0)], [slots[1]!, new Uint8Array(22500)], [slots[2]!, ents], [slots[3]!, range], [slots[4]!, new Uint8Array(0)], [slots[5]!, new Uint8Array(0)], [slots[6]!, new Uint8Array(0)], [slots[7]!, new Uint8Array(22500)], [slots[8]!, objects], [slots[9]!, ground]]);
    const events = [0, 1, 2].map(() => new Uint8Array(100));
    w32(events[1]!, 0x10, LANAI_WORLD_ENTER);
    w32(events[1]!, 0x14, D);
    for (let k = 0; k < 4; k++) w32(events[1]!, 0x18 + k * 4, 0x77770000 + k);
    events[1]![0x5a] = 0x1a;
    events[1]![0x5b] = 0x02;
    w32(events[2]!, 0x10, 0x8000002d);
    const table = eventTable(events);
    const info = { index: 0, hash: W, name: 'W01', sections: [], slots, mapDataId: 0, dungeon: 0, encounterLevel: 3, floor: 0, world: true } as LanaiMapInfo;
    const dest = { index: 1, hash: D, name: 'D01001F01', sections: [], slots: [], mapDataId: 0, dungeon: 1, encounterLevel: 0, floor: 1, world: false } as LanaiMapInfo;
    const maps = {
      db: database, maps: [info, dest], session: { edited: () => {}, table: () => undefined },
      changed: () => {},
      on: () => () => {},
      map: (h: number) => (h === D ? dest : h === W ? info : undefined),
      eventTable: (g: number) => (g === 0 ? table : undefined),
      addEventRow: (_g: number, from: number) => table.addRow(from),
      eventRows: () => events.map((r) => r.slice()),
      restoreEventRows: (_g: number, rows: Uint8Array[]) => {
        events.length = 0;
        events.push(...rows.map((r) => r.slice()));
        (table as unknown as { rows: number }).rows = events.length;
      },
      doc: () => ({ recs: { 3: [] } }),
      contentTable: () => undefined,
    } as unknown as LanaiMaps;
    const parts: LanaiWorldPart[] = Array.from({ length: 95 }, (_, row) => ({ row, model: row >= 2 && row <= 86 ? 0x1000 + row : 0, flags: row === 7 ? 0x10 : 0, battle: 4, object: row === 88 ? 534 : row === 90 ? 533 : 0, name: '' }));
    return { world: new LanaiWorld(maps, info, parts), database, events };
  };

  test('reads the terrain, the entrances and where they lead', () => {
    const { world } = make();
    expect(world.ground!.parts[10 * N + 10]).toBe(5);
    expect(world.entrances().length).toBe(2);
    const d = world.dest(world.entrances()[0]!);
    expect(d).toMatchObject({ row: 1, action: 0x10, mapHash: D, points: [0x77770000, 0x77770001, 0x77770002, 0x77770003] });
    expect(d.map?.name).toBe('D01001F01');
    // a script entrance has no destination action
    expect(world.dest(world.entrances()[1]!).action).toBe(-1);
    // the model: EventObject +0x5A, else WorldmapParts +0x0C
    expect(world.entranceObject(world.entrances()[0]!)).toBe(0x21a);
    expect(world.entranceObject(world.entrances()[1]!)).toBe(533);
    expect(world.ranges(LW.land)).toEqual([{ hash: 0x80000002, x: 30, y: 33, w: 3, h: 3 }]);
    expect(parseWorldObjects(world.section(LW.objects))).toEqual([{ value: 5, kind: 0, x: 7.5, y: 8.5 }]);
  });

  test('painting writes the cell and grows the pools; painting back and normalizing gives the ROM bytes', () => {
    const { world, database } = make();
    const h = world.hash(LW.ground);
    const orig = database.original(h).slice();
    // three cells of part 5 in one 2 x 2 block: its pool grows from 2 to 3
    expect(world.paint(10, 11, 5, 1)).toBe(true);
    const b = database.get(h);
    expect(b[0x14 + (11 * N + 10) * 2]).toBe(5);
    expect(b[0x15 + (11 * N + 10) * 2]).toBe(1);
    expect(u32(b, 0x2bf34 + 5 * 4)).toBe(3);
    expect(world.groundChanged()).toBe(true);
    expect(world.paint(10, 11, 5, 1)).toBe(false);
    expect(world.paint(10, 11, 0, 0)).toBe(true);
    world.normalize();
    expect(world.groundChanged()).toBe(false);
    expect(equalBytes(database.get(h), orig)).toBe(true);
    expect(parseOahuGround(database.get(h))!.parts[10 * N + 10]).toBe(5);
  });

  test('undo points cover the terrain, the entrances and the EventObject rows', () => {
    const { world, events } = make();
    const snap = world.snapshot();
    world.paint(50, 50, 9, 0);
    const i = world.addEntrance(0, 40, 41);
    expect(i).toBe(2);
    const added = world.entrances()[2]!;
    expect([WE.x(added), WE.y(added), WE.part(added)]).toEqual([40, 41, 88]);
    // its own EventObject row, a copy of the one it was made from, and a new ID
    expect(WE.event(added)).toBe(3);
    expect(equalBytes(events[3]!, events[1]!)).toBe(true);
    expect(world.entranceById(WE.id(added))).toBe(2);
    expect(world.removeEntrance(0)).toBe(false);
    world.restore(snap);
    expect(world.entrances().length).toBe(2);
    expect(world.ground!.parts[50 * N + 50]).toBe(0);
    expect(world.isChanged()).toBe(false);
  });

  test('Panana-added entrances can be removed, the ROM\'s cannot', () => {
    const { world } = make();
    world.addEntrance(1, 60, 60);
    expect(world.removeEntrance(2)).toBe(true);
    expect(world.entrances().length).toBe(2);
    expect(world.changedSlots()).toEqual([]);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! world maps', () => {
  let s: LanaiSession;
  const worlds: { content: number; maps: LanaiMaps; info: LanaiMapInfo }[] = [];
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump);
    for (const c of lanaiContents(s)) {
      if (!(LANAI_WORLD_CONTENTS as readonly number[]).includes(c.index)) continue;
      const maps = await LanaiMaps.load(s, c);
      for (const info of maps.maps) if (info.world) worlds.push({ content: c.index, maps, info });
    }
  }, 300000);

  test('W01 in 9 contents, W02 in 3; WorldmapParts has 95 rows', () => {
    expect(worlds.filter((w) => w.info.name === 'W01').map((w) => w.content)).toEqual([...LANAI_WORLD_CONTENTS]);
    expect(worlds.filter((w) => w.info.name === 'W02').map((w) => w.content)).toEqual([33, 71, 126]);
    const parts = lanaiWorldParts(s.table(LANAI_WORLD_PARTS));
    expect(parts.length).toBe(95);
    expect(parts[88]!.object).toBe(534);
  });

  test('the terrain is slot 9 (oahu\'s W01_ground.bin) and its pools are what the grid needs', () => {
    const parts = lanaiWorldParts(s.table(LANAI_WORLD_PARTS));
    for (const { maps, info } of worlds) {
      const w = new LanaiWorld(maps, info, parts);
      const b = w.section(LW.ground);
      expect(b.length).toBe(180784);
      expect(w.ground).not.toBeNull();
      const pools = oahuGroundPools(w.ground!.parts, 95);
      for (let p = 0; p < 95; p++) expect(u32(b, 0x2bf34 + p * 4)).toBe(pools[p]!);
      expect(w.section(LW.dark).length).toBe(22500);
    }
  });

  test('every entrance with action 0x8000001F leads to a map of its content', () => {
    let n = 0;
    for (const { maps, info } of worlds) {
      const w = new LanaiWorld(maps, info, []);
      for (const r of w.entrances()) {
        const d = w.dest(r);
        if (d.action < 0) continue;
        n++;
        expect(d.map).toBeDefined();
        expect([1, 2, 4, 8]).toContain(r[0x1c]!);
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  test('painting and putting it back leaves the database as the ROM\'s; the source draws it', () => {
    const { maps, info } = worlds[0]!;
    const w = new LanaiWorld(maps, info, lanaiWorldParts(s.table(LANAI_WORLD_PARTS)));
    const [x, y] = [WE.x(w.entrances()[0]!) + 2, WE.y(w.entrances()[0]!) + 2];
    const before = w.ground!.parts[y * N + x]!, rot = w.ground!.rots[y * N + x]!;
    expect(w.paint(x, y, before === 9 ? 10 : 9, 0)).toBe(true);
    expect(maps.db.changedHashes()).toContain(w.hash(LW.ground));
    w.paint(x, y, before, rot);
    w.normalize();
    expect(maps.db.changedHashes()).not.toContain(w.hash(LW.ground));
    const src = new LanaiWorldSource(w);
    expect(src.palette().length).toBeGreaterThan(80);
    expect(src.entrances().length).toBe(w.entrances().length);
    src.dispose();
  });
});
