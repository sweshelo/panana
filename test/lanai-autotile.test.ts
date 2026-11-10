// RPG FREE! (lanai) automatic map tiles: the brush is offered on outdoor / dungeon maps whose tileset has every part,
// strokes write facings in lanai's 1 / 2 / 4 / 8 coding, and (with the ROM) the shared part shapes match how the
// game's own maps place their tiles.
import { beforeAll, describe, expect, test } from 'bun:test';
import { turnMask } from '../src/editor/autotile';
import { Controller } from '../src/editor/controller';
import { LANAI_AUTO } from '../src/game/autotile';
import { buildTiles, LANAI_ROT_CODEC, parseTiles, type MapDoc } from '../src/game/sections';
import { lanaiContents } from '../src/lanai/contents';
import { LanaiEditState } from '../src/lanai/mapedit';
import { LANAI_MAP_FORMAT, lanaiMaps, type LanaiMapInfo, type LanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const TILE = LANAI_MAP_FORMAT.tile;

function fakeState(palette: Map<number, number[]>): LanaiEditState {
  const maps = {
    on: () => () => {},
    palette: () => palette,
    commit: () => {},
    tileSource: () => ({ mapData: 0, tileset: 0 }),
    session: { edited: () => {} },
    contentTable: () => undefined,
    eventRows: () => null,
    treasureRows: () => null,
  } as unknown as LanaiMaps;
  return new LanaiEditState(maps);
}
const doc = (): MapDoc => ({ hash: 1, name: 'D01001B01', dungeon: 0, floor: 1, tiles: [], recs: {}, sec6Header: new Uint8Array(8), cells6: [] } as unknown as MapDoc);
const info = (world = false): LanaiMapInfo => ({ index: 0, hash: 1, name: world ? 'W01' : 'D01001B01', sections: [], mapDataId: 0, dungeon: 0, encounterLevel: 0, floor: 1, world });
const full = (): Map<number, number[]> => new Map(LANAI_AUTO.parts.map((p) => [p.kind, [0, 1]]));

describe('RPG FREE! automatic brush', () => {
  test('offered on dungeon maps only, and only when the tileset has every part', () => {
    const st = fakeState(full());
    st.info = info();
    st.current = doc();
    expect(st.autoProfile).toBe(LANAI_AUTO);
    st.current.tiles.push({ kind: 16, x: 0, y: 0, rot: 0, rotHi: 0, letter: 0x7a, pad: 0 });
    expect(st.autoProfile).toBeUndefined();
    st.current = doc();
    st.info = info(true);
    expect(st.autoProfile).toBeUndefined();
    const partial = full();
    partial.delete(10);
    const other = fakeState(partial);
    other.info = info();
    other.current = doc();
    expect(other.mapTopology).toBe(LANAI_AUTO);
    expect(other.autoProfile).toBeUndefined();
  });

  test('a filled stroke makes a room whose facings are written as 1 / 2 / 4 / 8', () => {
    const st = fakeState(full());
    st.info = info();
    st.current = doc();
    st.autoRandomVariants = false;
    st.brush = { auto: true, kind: 5, rot: 0, letter: 0x7a };
    st.setTool('paint');
    const ctl = new Controller(st);
    ctl.down(1, 1, { button: 0, shiftKey: false });
    for (const [x, y] of [[2, 1], [3, 1], [3, 2], [2, 2], [1, 2], [1, 3], [2, 3], [3, 3]] as const) ctl.move(x, y);
    ctl.up();
    const tiles = st.current.tiles;
    expect(tiles).toHaveLength(9);
    const at = (x: number, y: number) => tiles.find((t) => t.x === x && t.y === y)!;
    expect(at(2, 2).kind).toBe(5);
    // edges face the centre: north edge rot 0 (byte 4), east 1 (2), south 2 (1), west 3 (8): map.md §3.2
    for (const [x, y, byte] of [[2, 1, 4], [3, 2, 2], [2, 3, 1], [1, 2, 8]] as const) {
      expect(at(x, y).kind).toBe(7);
      expect(LANAI_ROT_CODEC.encode(at(x, y).rot)).toBe(byte);
    }
    const bytes = buildTiles(tiles, TILE);
    expect(parseTiles(bytes, TILE)).toEqual(parseTiles(buildTiles(parseTiles(bytes, TILE), TILE), TILE));
    for (let i = 0; i < tiles.length; i++) expect([1, 2, 4, 8]).toContain(bytes[i * 20 + TILE.rot]!);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! ROM: part shapes', () => {
  let s: LanaiSession;
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump, { fresh: true });
  }, 300000);

  test('every open edge of a placed part has a neighbour, and 8 / 13 lack their inward diagonals', async () => {
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    const diagonals = [[1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
    const seen = new Map<number, { n: number; bad: number }>();
    let offered = 0, dungeons = 0;
    for (const c of lanaiContents(s)) {
      const m = await lanaiMaps(s, c).catch(() => null);
      if (!m) continue;
      for (const info of m.maps) {
        const doc = m.doc(info);
        if (info.world || doc.tiles.some((t) => t.kind >= 15 && t.kind <= 27)) continue;
        dungeons++;
        const st = new LanaiEditState(m);
        st.open(info);
        if (st.autoProfile) offered++;
        const grid = new Set(doc.tiles.filter((t) => t.kind !== 33).map((t) => `${t.x},${t.y}`));
        // room tiles (parts with full-width edges): an inward corner's diagonal is outside the room
        const room = new Set(doc.tiles.filter((t) => LANAI_AUTO.parts.find((p) => p.kind === t.kind)?.wide).map((t) => `${t.x},${t.y}`));
        for (const t of doc.tiles) {
          const part = LANAI_AUTO.parts.find((p) => p.kind === t.kind);
          if (!part) continue;
          let occ = 0, diag = 0;
          dirs.forEach(([dx, dy], i) => { if (grid.has(`${t.x + dx},${t.y + dy}`)) occ |= 1 << i; });
          diagonals.forEach(([dx, dy], i) => { if (room.has(`${t.x + dx},${t.y + dy}`)) diag |= 1 << i; });
          const open = turnMask(part.wide | part.narrow, t.rot), corners = turnMask(part.corners ?? 0, t.rot);
          const ok = (occ & open) === open && (diag & corners) === 0;
          const e = seen.get(t.kind) ?? { n: 0, bad: 0 };
          e.n++;
          if (!ok) e.bad++;
          seen.set(t.kind, e);
        }
      }
    }
    expect(dungeons).toBe(507);
    // most dungeon tilesets have every part (the brush is offered on them)
    expect(offered).toBeGreaterThan(dungeons / 2);
    console.log(`dungeon maps ${dungeons}, brush offered on ${offered}; misfits by kind: ${JSON.stringify([...seen])}`);
    for (const p of LANAI_AUTO.parts) {
      const e = seen.get(p.kind)!;
      expect(e.n).toBeGreaterThan(0);
      expect(e.bad / e.n).toBeLessThan(0.01);
    }
  }, 300000);
});
