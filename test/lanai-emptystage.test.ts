// An empty stage (src/lanai/emptyStage.ts: content 99's room with a gate and the game's opening) and giving a map
// another tileset (tilesets.ts): with the ROM.
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, parseArchive } from '../src/archive/gsarc';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { addLanaiEmptyStage } from '../src/lanai/emptyStage';
import { lanaiEditState, lanaiValidateAll } from '../src/lanai/mapedit';
import { lanaiMaps, type LanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { buildStageScripts, checkStageScript } from '../src/lanai/stageScript';
import { lanaiTilesets, mapDataTileset, setLanaiTileset, tilesetGaps, tilesetTable } from '../src/lanai/tilesets';
import { openImages } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! empty stage and tilesets', () => {
  let dump: Awaited<ReturnType<typeof openImages>>;
  let s: LanaiSession;
  let c: LanaiContent;
  let maps: LanaiMaps;
  beforeAll(async () => {
    dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump, { fresh: true });
    const index = await addLanaiEmptyStage(s, '空のステージ');
    c = lanaiContents(s)[index]!;
    maps = await lanaiMaps(s, c);
  });
  const start = () => {
    const g = maps.groups[1]!;
    const info = maps.map(g.firstMap)!;
    const doc = maps.doc(info);
    return { g, info, doc, rec: doc.recs[3]!.find((r) => u32(r.raw, 0) === g.firstPoint)! };
  };

  test('the room gets a gate at its bottom middle, a corridor below and a door row', () => {
    const { info, doc, rec } = start();
    expect([rec.x, rec.y, rec.raw[0x14], rec.raw[0x15]]).toEqual([6, 7, 1, 12]);
    const at = (x: number, y: number) => doc.tiles.find((t) => t.x === x && t.y === y)?.kind;
    // content 1's start: the opening (kind 9), the corridor (1, 1) and its dead end (4)
    expect([at(6, 7), at(6, 8), at(6, 9), at(6, 10)]).toEqual([9, 1, 1, 4]);
    expect(doc.tiles.length).toBe(9 + 3);
    const eo = maps.eventTable(1)!;
    const row = u32(rec.raw, 4);
    expect(row).toBe(1);
    expect(eo.u32(row, 0x10)).toBe(0x80000017);
    expect(lanaiValidateAll(maps, info, doc)).toEqual([]);
  });

  test('the opening is the game one: the walk in from the gate, its door closing; the CRO builds', async () => {
    const st = s.stageScripts.get(c.archive.toUpperCase())!;
    expect(st.doc.bindings).toEqual([{ trigger: 'intro', group: 1, row: 0, fn: '' }]);
    const check = await checkStageScript(s, c, st.source);
    expect(check.problems).toEqual([]);
    expect(check.intros[1]!.gate).toEqual({ x: 6, z: 7, dir: 4, door: 1 });
    const files = new Map<string, Uint8Array>();
    await buildStageScripts(s, files);
    expect([...files.keys()].sort()).toEqual([`.crr/contents${String(c.index).padStart(4, '0')}.crr`, c.archive]);
  });

  test('another tileset: its table is copied in, with a MapPartsType and a MapResource row; saved and restored', async () => {
    const all = await lanaiTilesets(s);
    expect(all.length).toBeGreaterThanOrEqual(19);
    expect(all.every((t) => t.floor && u32(t.resource, 0))).toBe(true);
    const { info, doc } = start();
    const row = maps.mapDataRow(info, doc);
    expect(maps.tileSource(info, doc).partsName).toBe('MapPartsCaveA');
    const relic = all.find((t) => t.name === 'Relic')!;
    expect(tilesetGaps(maps, row, await tilesetTable(s, maps, relic))).toEqual([]);
    await setLanaiTileset(s, maps, row, relic);
    const src = maps.tileSource(info, maps.doc(info));
    expect(src.partsName).toBe('MapPartsRelic');
    expect([src.textureArchive, src.textureEntry]).toEqual([u32(relic.resource, 0), u32(relic.resource, 4)]);
    expect(mapDataTileset(maps, row)).toBe(relic.entry);
    // back to CaveA: no second table, the rows it had are used again
    const caveA = all.find((t) => t.name === 'CaveA')!;
    await setLanaiTileset(s, maps, row, caveA);
    expect(maps.contentTable('MapPartsType')!.rows).toBe(2);
    await setLanaiTileset(s, maps, row, relic);
    expect(maps.contentTable('MapPartsType')!.rows).toBe(2);
    expect(findEntry(parseArchive(s.modFiles().get(c.archive)!), relic.entry)).toBeTruthy();

    const s2 = await LanaiSession.open(dump, { fresh: true });
    await s2.restore(s.saved());
    const c2 = lanaiContents(s2)[c.index]!;
    const m2 = await lanaiMaps(s2, c2);
    const i2 = m2.map(info.hash)!;
    expect(m2.tileSource(i2, m2.doc(i2)).partsName).toBe('MapPartsRelic');
  });

  test('the open map hears of another tileset: its source is read again and the views are told', async () => {
    const { info } = start();
    const st = lanaiEditState(maps);
    st.open(info);
    const heard: string[] = [];
    st.on((what) => heard.push(what));
    const all = await lanaiTilesets(s);
    const row = maps.mapDataRow(info, maps.doc(info));
    const next = all.find((t) => t.entry !== mapDataTileset(maps, row) && t.name === 'IceA')!;
    await setLanaiTileset(s, maps, row, next);
    expect(st.source!.partsName).toBe('MapPartsIceA');
    expect(heard).toContain('map');
  });

  test('ROM stages keep their tileset', async () => {
    const rom = await lanaiMaps(s, lanaiContents(s)[28]!);
    const all = await lanaiTilesets(s);
    await expect(setLanaiTileset(s, rom, 0, all[0]!)).rejects.toThrow('追加したステージ');
  });
});
