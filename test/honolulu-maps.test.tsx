// 初代's map page (honolulu/maps.ts, mapview.ts, MapPage.tsx): the 97 maps of csvMap and their two sections, the
// dungeons' floor definitions ("261" files, naauao#47) with their encounters and chests, the view-only edit state and
// the 3D view's models (tile kind → part → mapParts row and variant → the floor's tileset; props are mapObject rows).
// The tests with the ROM read roms/honolulu-base.cia.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { HonoluluMapPage } from '../src/honolulu/MapPage';
import { findEntry, parseArchive } from '../src/archive/gsarc';
import { HONOLULU_CHEST_SECTION, HONOLULU_DESIGNED_ROOMS, HONOLULU_EXIT_SECTION, HONOLULU_OBJECT_SECTION, HONOLULU_ROT_CODEC, mapCode, parseFloors, parsePartNames, partOfName, RANDOM_POS, type HonoluluMaps } from '../src/honolulu/maps';
import { HonoluluMapState, partTurn, PROP_ANGLES } from '../src/honolulu/mapview';
import { buildObjects, buildTileset } from '../src/cgfx/tileset';
import { hex8 } from '../src/util/bytes';
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

  test('a part name places a mapParts row and a variant (FUN_0016CB70)', () => {
    expect(partOfName('path_00')).toEqual({ row: 1, variant: 0 });
    expect(partOfName('path14a')).toEqual({ row: 15, variant: 1 });
    expect(partOfName('room_00')).toEqual({ row: 16, variant: 0 });
    expect(partOfName('room02g')).toEqual({ row: 18, variant: 7 });
    expect(partOfName('room_31')).toEqual({ row: 47, variant: 0 });
    expect(partOfName('house')).toBeNull();
    const b = new Uint8Array(4 + 24);
    b[0] = 2;
    b.set([...'path_00'].map((c) => c.charCodeAt(0)), 4);
    b.set([...'room28a'].map((c) => c.charCodeAt(0)), 16);
    expect(parsePartNames(b)).toEqual(['path_00', 'room28a']);
    // the game's turns: props N / E / S / W, parts in degrees
    expect(PROP_ANGLES).toEqual([Math.PI, Math.PI / 2, 0, -Math.PI / 2]);
    expect(partTurn(-90)).toBeCloseTo(-Math.PI / 2);
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

  test('the tiles\' parts: kind = index of the part file; 3 × 3 rooms are room_00 in the middle, walls on the sides', () => {
    expect(maps.parts).toHaveLength(121);
    expect(maps.part(89)).toEqual({ name: 'room_00', row: 16, variant: 0 });
    expect([91, 92, 93, 94].map((k) => maps.part(k)!.name)).toEqual(['room_02', 'room_03', 'room_04', 'room_05']);
    expect(maps.part(73)).toEqual({ name: 'room28a', row: 44, variant: 1 });
    // the kinds no tile has are the parts 0, 9〜16, 65〜72, 90, 103〜106
    const used = new Set(maps.maps.flatMap((m) => maps.doc(m).tiles.map((t) => t.kind)));
    const unused = maps.parts.map((_, k) => k).filter((k) => !used.has(k));
    expect(unused).toEqual([0, 9, 10, 11, 12, 13, 14, 15, 16, 65, 66, 67, 68, 69, 70, 71, 72, 90, 103, 104, 105, 106]);
    // the turned rows share the models of the unturned one
    expect([18, 19, 20, 21].map((r) => session.master.rows('mapParts.bin').get(r, 'angle'))).toEqual([0, -90, 180, 90]);
    expect(maps.partAngle(94)).toBe(90);
  });

  test('every tile of every floor has a model in its tileset\'s archive; the designed rooms and props too', async () => {
    const archives = new Map<string, ReturnType<typeof parseArchive>>();
    const archive = async (name: string) => {
      if (!archives.has(name)) archives.set(name, parseArchive(await session.dump.readRomfs(name)));
      return archives.get(name)!;
    };
    let tiles = 0;
    const designed = new Set<string>();
    const roomTextures = new Map<string, string[]>();
    for (const m of maps.maps) {
      for (const f of m.floors) {
        const src = maps.tileSource(f);
        const arc = await archive(src.modelArchive);
        for (const t of maps.doc(m).tiles) {
          const h = maps.partModel(t.kind, src.tileset);
          expect(h && findEntry(arc, h) ? 'ok' : `${mapCode(m)} kind ${t.kind} ts ${src.tileset}`).toBe('ok');
          tiles++;
        }
        expect(findEntry(await archive('469B3DC6'), src.textureEntry)).toBeDefined();
        if (src.designed) {
          designed.add(`${maps.dungeon(f.dungeon)!.floors}/${f.index}`);
          expect(findEntry(await archive(HONOLULU_DESIGNED_ROOMS), src.designedModel)).toBeDefined();
          // a room's materials name its own textures and its tileset's (the view fills those in)
          const key = `${hex8(src.designedModel)}/${src.textureEntry}`;
          if (!roomTextures.has(key)) {
            const room = buildObjects(await session.dump.readRomfs(HONOLULU_DESIGNED_ROOMS), [src.designedModel]).get(src.designedModel)!;
            const tex = buildTileset(await session.dump.readRomfs(src.modelArchive), await session.dump.readRomfs('469B3DC6'), src.textureEntry).textures;
            const names = room.models.get(src.designedModel)!.materials.flatMap((mt) => mt.textures).filter((t): t is string => !!t);
            roomTextures.set(key, names.filter((n) => !room.textures.has(n) && !tex.has(n)));
          }
          expect(roomTextures.get(key)).toEqual([]);
        }
      }
      for (const r of maps.doc(m).recs[HONOLULU_OBJECT_SECTION] ?? []) {
        const ref = maps.objectModel(r.raw[0]!)!;
        expect(findEntry(await archive(hex8(ref.archive).toUpperCase()), ref.entry)).toBeDefined();
      }
    }
    expect(tiles).toBeGreaterThan(5000);
    // the 20 records with a designedMap key (header +0x4C; dungeons 11 and 12 read the same file)
    expect(designed.size).toBe(20);
    // デンパ島のどうくつ: mapData 1 (dungeonData +0x16), tileset 0 in 46910AB6 (caveA); its first floor is a designed room
    const d1 = maps.dungeon(1)!.records;
    expect(maps.tileSource(d1[1]!)).toMatchObject({ mapData: 1, tileset: 0, resource: 1, modelArchive: '46910AB6', designed: 0 });
    // 風の森: mapData 4 → tileset 3 in EAE2C0F2
    expect(maps.tileSource(maps.dungeon(2)!.records[1]!)).toMatchObject({ mapData: 4, tileset: 3, modelArchive: 'EAE2C0F2' });
    expect(maps.tileSource(d1[0]!).designed).toBe(1);
    // a map no floor uses is shown with mapData row 1 (row 0 is empty)
    expect(maps.tileSource(null)).toMatchObject({ mapData: -1, tileset: 0, modelArchive: '46910AB6' });
  });

  test('the page renders its loading state; the shell has the maps tab', async () => {
    const html = renderToString(<HonoluluMapPage session={session} arg={mapCode(maps.maps[2]!)} />);
    expect(html).toContain('マップを読み込み中');
  });
});
