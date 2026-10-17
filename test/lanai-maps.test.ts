// 電波人間のRPG FREE! (lanai) maps (naauao lanai/map.md): the facing codec of tiles, and (with the dumps) the map table,
// the map database, the documents and the tile models.
import { beforeAll, describe, expect, test } from 'bun:test';
import { LANAI_ACTIONS, lanaiActionName } from '../src/lanai/actions';
import { lanaiContents } from '../src/lanai/contents';
import { LanaiMaps } from '../src/lanai/maps';
import { lanaiTileModels } from '../src/lanai/mapModels';
import { LanaiSession } from '../src/lanai/session';
import { buildTiles, LANAI_ROT_CODEC, letterIndex, parseTiles, type TileLayout } from '../src/game/sections';
import { openImages } from '../src/rom/dump';
import { equalBytes } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const LAYOUT: TileLayout = { size: 20, rot: 0x10, letter: 0x11, pad: 0x12, rotCodec: LANAI_ROT_CODEC };

describe('lanai tile facing', () => {
  const rec = (facing: number): Uint8Array => {
    const b = new Uint8Array(20);
    b[0] = 5;
    b[4] = 3;
    b[6] = 4;
    b[0x10] = facing;
    b[0x11] = 0x7a;
    return b;
  };

  test('4 / 2 / 1 / 8 are the turns 0 / 1 / 2 / 3', () => {
    for (const [byte, rot] of [[4, 0], [2, 1], [1, 2], [8, 3]] as const) {
      const [t] = parseTiles(rec(byte), LAYOUT);
      expect(t).toMatchObject({ kind: 5, x: 3, y: 4, rot, rotHi: 0 });
      expect(buildTiles([t!], LAYOUT)).toEqual(rec(byte));
    }
  });

  test('turning a tile writes the matching byte; a byte of no turn is kept', () => {
    const [t] = parseTiles(rec(4), LAYOUT);
    t!.rot = 3;
    expect(buildTiles([t!], LAYOUT)[0x10]).toBe(8);
    const [odd] = parseTiles(rec(3), LAYOUT);
    expect(buildTiles([odd!], LAYOUT)).toEqual(rec(3));
  });
});

describe.skipIf(!hasLanai)('RPG FREE! maps', () => {
  let s: LanaiSession;
  let all: LanaiMaps[];
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump);
    all = [];
    // the contents with a map table (map.md §1)
    for (const c of lanaiContents(s)) {
      try {
        all.push(await LanaiMaps.load(s, c));
      } catch {
        /* a content without maps */
      }
    }
  }, 300000);

  test('127 contents have a map database and a map table; 565 maps, 12 of them W01', () => {
    expect(all.length).toBe(127);
    expect(all.reduce((n, m) => n + m.maps.length, 0)).toBe(565);
    expect(all.reduce((n, m) => n + m.maps.filter((x) => x.world).length, 0)).toBe(12);
  });

  test('D01001B01 of content 38: its tileset, texture and the model of kind 5', () => {
    const m = all.find((x) => x.content.index === 38)!;
    const info = m.mapByName('D01001B01')!;
    expect(info.hash).toBe(0xa2b01ce4);
    expect(info.floor).toBe(-1);
    expect(m.groupName(info.dungeon)).not.toBe('');
    const doc = m.doc(info);
    expect(doc.tiles.length).toBeGreaterThan(0);
    const src = m.tileSource(info, doc);
    expect(src.partsName).toBe('MapPartsCaveB');
    expect(src.textureArchive).toBe(0x3dc60000);
    expect(m.partRef(src, 5, 0)).toEqual({ archive: 0xa6d70000, entry: 0xd922a800 });
  });

  test('NPC lines: the talking actions name rows of the group talk table (MapGroup +0x24, else MessageContents)', () => {
    const line = (content: number, map: string, row: number): { table: string; type: number; text: string } => {
      const m = all.find((x) => x.content.index === content)!;
      const info = m.mapByName(map)!;
      const ev = m.eventTable(info.dungeon)!;
      const talk = m.talkTable(info.dungeon)!;
      const type = ev.u32(row, 0x10);
      return { table: talk.name, type, text: s.plain(talk, ev.u32(row, 0x14), 'message') };
    };
    const b01 = line(1, 'D01001B01', 13);
    expect(b01.type).toBe(0x80000001);
    expect(LANAI_ACTIONS[b01.type]!.talk).toEqual([0]);
    expect(b01.table).toMatch(/_msg$/);
    expect(b01.text).toStartWith('むふふふ、むふふふ！');
    const sign = line(6, 'D01001B01', 7);
    expect(lanaiActionName(sign.type)).toBe('看板');
    expect(sign.text).toContain('シールドナイトへの道');
    // a group with 0 at +0x24 (a town)
    const m12 = all.find((x) => x.content.index === 12)!;
    expect(m12.groups[6]!.talkEntry).toBe(0);
    expect(m12.talkTable(6)!.name).toBe('MessageContents');
    expect(s.plain(m12.talkTable(6)!, 146, 'message')).toStartWith('電波人間よ、よく来ました。');
    // every talking action of every group names a row of its talk table
    let n = 0;
    for (const m of all) for (const g of m.groups) {
      const ev = m.eventTable(g.row);
      const talk = m.talkTable(g.row);
      for (let r = 1; ev && r < ev.rows; r++) for (const o of [0x10, 0x28, 0x40]) {
        const a = LANAI_ACTIONS[ev.u32(r, o)];
        for (const i of a?.talk ?? []) {
          n++;
          expect(talk).toBeDefined();
          expect(ev.u32(r, o + 4 + i * 4)).toBeLessThan(talk!.rows);
        }
      }
    }
    expect(n).toBeGreaterThan(500);
  });

  test('every map but the world maps writes back byte for byte; tile facings are the four masks', () => {
    let tiles = 0;
    for (const m of all) {
      for (const info of m.maps) {
        if (info.world) continue;
        const doc = m.doc(info);
        tiles += doc.tiles.length;
        for (const t of doc.tiles) expect(t.rotHi).toBe(0);
        for (let k = 0; k < 10; k++) {
          if (k === 7 || !info.sections[k] || !m.db.has(info.sections[k]!)) continue;
          expect(equalBytes(m.sectionBytes(doc, k), m.db.get(info.sections[k]!))).toBe(true);
        }
      }
    }
    // map.md counts 31777 tiles (the same map of two contents is counted once there); this counts every map of every content
    expect(tiles).toBe(33377);
  }, 300000);

  test('every tile of every map has a model, but kind 33', () => {
    const missing = new Map<number, number>();
    for (const m of all)
      for (const info of m.maps) {
        if (info.world) continue;
        const doc = m.doc(info);
        const src = m.tileSource(info, doc);
        for (const t of doc.tiles) if (!m.partRef(src, t.kind, letterIndex(t.letter))) missing.set(t.kind, (missing.get(t.kind) ?? 0) + 1);
      }
    expect([...missing.keys()].every((k) => k === 33)).toBe(true);
  }, 300000);

  test('the tile models load (GSC -> BCH) with the tileset texture', async () => {
    const m = all.find((x) => x.content.index === 38)!;
    const info = m.mapByName('D01001B01')!;
    const doc = m.doc(info);
    const src = m.tileSource(info, doc);
    const refs = doc.tiles.map((t) => m.partRef(src, t.kind, letterIndex(t.letter))).filter((r): r is NonNullable<typeof r> => !!r);
    const set = await lanaiTileModels(s, src, refs);
    expect(set.errors).toEqual([]);
    expect(set.models.size).toBeGreaterThan(3);
    expect(set.textures.size).toBeGreaterThan(0);
  });
});
