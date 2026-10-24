// 初代's map page (honolulu/maps.ts, mapview.ts, MapPage.tsx): the 97 maps of csvMap and their two sections, the
// dungeons' floor definitions ("261" files, naauao#47) with their encounters and chests, and the view-only edit state.
// The tests with the ROM read roms/honolulu-base.cia.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { HonoluluMapPage } from '../src/honolulu/MapPage';
import { HONOLULU_CHEST_SECTION, HONOLULU_EXIT_SECTION, HONOLULU_OBJECT_SECTION, HONOLULU_ROT_CODEC, mapCode, parseFloors, RANDOM_POS, type HonoluluMaps } from '../src/honolulu/maps';
import { HonoluluMapState } from '../src/honolulu/mapview';
import { HonoluluSession } from '../src/honolulu/session';
import { openImage } from '../src/rom/dump';
import { hasHonolulu, HONOLULU_BASE } from './env';

describe('初代の map page (no ROM)', () => {
  test('the facing letters N / E / S / W are the turns 0..3; other bytes are none', () => {
    expect([0x4e, 0x45, 0x53, 0x57].map(HONOLULU_ROT_CODEC.decode)).toEqual([0, 1, 2, 3]);
    expect(HONOLULU_ROT_CODEC.decode(0xfe)).toBe(-1);
    expect(HONOLULU_ROT_CODEC.encode(2)).toBe(0x53);
  });

  test('a floor definition file: records of a 0x64-byte header and 9 counted arrays', () => {
    const sizes = [20, 12, 12, 12, 12, 6, 8, 12, 4];
    const counts = [1, 0, 0, 2, 0, 0, 0, 1, 0];
    const len = 8 + 0x64 + sizes.reduce((n, s, i) => n + 4 + s * counts[i]!, 0);
    const b = new Uint8Array(len);
    const v = new DataView(b.buffer);
    b.set([0x32, 0x36, 0x31, 0], 0);
    v.setUint32(4, 1, true);
    v.setUint32(8, 0x1234, true); // id
    v.setUint32(12, 0xabcd, true); // map
    v.setInt16(8 + 0x18, -2, true); // floor
    let o = 8 + 0x64;
    sizes.forEach((s, i) => {
      v.setUint32(o, counts[i]!, true);
      o += 4;
      for (let k = 0; k < counts[i]!; k++) {
        if (i === 3) { v.setInt16(o + 8, k + 3, true); v.setInt16(o + 10, 4, true); }
        if (i === 7) { v.setInt16(o + 8, RANDOM_POS, true); v.setInt16(o + 10, RANDOM_POS, true); }
        o += s;
      }
    });
    const [f] = parseFloors(b, 1);
    expect(f).toMatchObject({ id: 0x1234, map: 0xabcd, floor: -2, dungeon: 1 });
    expect(f!.chests.map((c) => [c.x, c.y])).toEqual([[3, 4], [4, 4]]);
    expect(f!.monsters[0]!.x).toBe(RANDOM_POS);
    expect(() => parseFloors(b.subarray(0, len - 1), 1)).toThrow('途中で終わっています');
  });

  test('the view-only state ignores edits', () => {
    const st = new HonoluluMapState();
    st.show({ hash: 1, name: '', dungeon: 0, floor: 0, tiles: [{ kind: 5, x: 1, y: 1, rot: 0, rotHi: 0, letter: 0, pad: 0 }], recs: {}, sec6Header: new Uint8Array(0), cells6: [], raw: {} });
    st.edit((d) => (d.tiles = []));
    st.touch((d) => (d.tiles = []));
    st.checkpoint();
    expect(st.current!.tiles).toHaveLength(1);
    expect(st.canUndo()).toBe(false);
  });
});

describe.skipIf(!hasHonolulu)('初代の map page (ROM)', () => {
  let session: HonoluluSession;
  let maps: HonoluluMaps;
  beforeAll(async () => {
    session = await HonoluluSession.open(await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia'));
    maps = await session.maps();
  });

  test('97 maps, each with its tiles; the second section from code.bin 0x2FF6D8', () => {
    expect(maps.maps).toHaveLength(97);
    expect(maps.db.count).toBe(194);
    expect(maps.maps.every((m) => maps.doc(m).tiles.length > 0)).toBe(true);
    expect(maps.maps.reduce((n, m) => n + maps.doc(m).tiles.length, 0)).toBe(5812); // 5878 with E4544B2E twice, as code.bin's table has it
    expect(maps.maps.every((m) => m.objects)).toBe(true);
    const docs = maps.maps.map((m) => maps.doc(m));
    // tiles: x 0〜49, y 0〜33, all facing 'N'
    expect(Math.max(...docs.flatMap((d) => d.tiles.map((t) => t.x)))).toBe(49);
    expect(Math.max(...docs.flatMap((d) => d.tiles.map((t) => t.y)))).toBe(33);
    expect(docs.every((d) => d.tiles.every((t) => t.rot === 0 && !t.rotHi))).toBe(true);
    // props: 42 maps have none (a section of 1 byte); the others face N / S / E / W
    expect(docs.filter((d) => !d.recs[HONOLULU_OBJECT_SECTION]?.length)).toHaveLength(42);
    const props = docs.flatMap((d) => d.recs[HONOLULU_OBJECT_SECTION] ?? []);
    expect(props.every((r) => HONOLULU_ROT_CODEC.decode(r.raw[8]!) >= 0)).toBe(true);
    expect(Math.min(...props.map((r) => r.raw[0]!))).toBe(24);
    expect(Math.max(...props.map((r) => r.raw[0]!))).toBe(57);
  });

  test('the dungeons name their floor definitions (dungeonData +0x04); every file is read to its end', () => {
    const d1 = maps.dungeon(1)!;
    expect(d1.name).toBe('デンパ島のどうくつ');
    expect(d1.floors).toBe(0x89d51400);
    expect(d1.records.map((f) => f.floor)).toEqual([-1, -1, -2, -3, -3]);
    expect(d1.maps.map((h) => maps.map(h)!.index)).toEqual([81, 2, 3, 4, 5]);
    expect(maps.dungeons.map((d) => d.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    // the maps no floor names
    expect(maps.maps.filter((m) => !m.floors.length).map((m) => m.index)).toEqual([8, 84, 90, 91]);
  });

  test('encounters and chests by their keys (monsterGroup / itemGroup hash indexes)', () => {
    const floors = maps.dungeons.flatMap((d) => d.records);
    for (const f of floors) if (f.monsterGroup) expect(maps.monsterGroupRow(f.monsterGroup)).toBeDefined();
    for (const f of floors) if (f.itemGroup) expect(maps.itemGroupRow(f.itemGroup)).toBeDefined();
    const chests = floors.flatMap((f) => [...f.chests, ...f.chests2]);
    expect(chests.filter((c) => new DataView(c.raw.buffer, c.raw.byteOffset).getUint32(0, true) && maps.itemGroupRow(new DataView(c.raw.buffer, c.raw.byteOffset).getUint32(0, true)) === undefined)).toHaveLength(0);
    expect(maps.chestItems(0)).toEqual([{ item: maps.chestItems(0)[0]!.item, count: 1 }]);
    expect(session.master.context().rowName!('itemData.bin', maps.chestItems(0)[0]!.item)).toBe('キズぐすり');
    // B2F of デンパ島のどうくつ: its chests and exits on the map, without the ones at a random place
    const b2 = maps.dungeon(1)!.records[2]!;
    const doc = maps.floorDoc(maps.map(b2.map)!, b2);
    expect(doc.recs[HONOLULU_CHEST_SECTION]).toHaveLength(13);
    expect(doc.recs[HONOLULU_EXIT_SECTION]).toHaveLength(2);
    expect(b2.monsters[0]!.x).toBe(RANDOM_POS);
    // the floor's x / y are the tiles' minus one: placed things land on tiles
    const cells = new Set(doc.tiles.map((t) => `${t.x},${t.y}`));
    expect(doc.recs[HONOLULU_CHEST_SECTION]!.every((r) => cells.has(`${r.x},${r.y}`))).toBe(true);
    // the floors of a group: デンパ島のどうくつ B2F's encounters
    const g = maps.monsterGroupRow(b2.monsterGroup)!;
    expect(maps.groupFloors(g).some((x) => x.floor === b2 && !x.placed)).toBe(true);
    // the map's own document is not changed by a floor's
    expect(maps.doc(maps.map(b2.map)!).recs[HONOLULU_CHEST_SECTION] ?? []).toHaveLength(0);
  });

  test('the page renders its loading state; the shell has the maps tab', async () => {
    const html = renderToString(<HonoluluMapPage session={session} arg={mapCode(maps.maps[2]!)} />);
    expect(html).toContain('マップを読み込み中');
  });
});
