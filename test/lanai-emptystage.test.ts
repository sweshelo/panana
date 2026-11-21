// An empty stage (src/lanai/emptyStage.ts: content 99's room with a gate and the game's opening) and giving a map
// another tileset (tilesets.ts): with the ROM.
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, parseArchive } from '../src/archive/gsarc';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { lanaiStageThumbnail } from '../src/lanai/StageThumbnail';
import { addLanaiEmptyStage } from '../src/lanai/emptyStage';
import { lanaiButtonDoor, lanaiEditState, lanaiValidateAll } from '../src/lanai/mapedit';
import { lanaiMaps, type LanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { buildStageScripts, checkStageScript } from '../src/lanai/stageScript';
import {
  lanaiTilesets,
  mapDataTileset,
  setLanaiTileset,
  tilesetGaps,
  tilesetTable,
  tilesetTextureDiffers,
} from '../src/lanai/tilesets';
import { lanaiTileModels } from '../src/lanai/mapModels';
import { addLanaiMapData } from '../src/lanai/mapadd';
import { openImages } from '../src/rom/dump';
import { hex8, u32 } from '../src/util/bytes';
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

  test('a new stage starts without template mission, requirements, stamina or thumbnail art', async () => {
    const stage = c.stages[0]!;
    expect(stage.name).toBe('空のステージ');
    expect(stage.mission).toBe('');
    expect(stage.note).toBe('');
    expect(stage.stamina).toBe(0);
    expect(stage.recommendedLevel).toBe(0);
    expect(stage.visible).toEqual({ kind: 0, v1: 0, v2: 0 });
    expect(stage.hidden).toEqual({ kind: 0, v1: 0, v2: 0 });
    const image = await lanaiStageThumbnail(s, c.archive, stage.thumbnail);
    expect(image.rgba.every((value, i) => value === (i % 4 === 3 ? 255 : 0))).toBe(true);
    const local = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'MapStage')!.table;
    expect(local.u8(0, 0x3d)).toBe(0);
    expect(local.u16(0, 0x36)).toBe(0);
    expect(local.u8(0, 0x24)).toBe(0);
    expect(local.u8(0, 0x30)).toBe(0);
    const restored = await LanaiSession.open(dump, { fresh: true });
    await restored.restore(s.saved());
    expect(lanaiContents(restored)[c.index]!.stages[0]!.mission).toBe('');
    expect(
      (await lanaiStageThumbnail(restored, c.archive, stage.thumbnail)).rgba.every(
        (value, i) => value === (i % 4 === 3 ? 255 : 0),
      ),
    ).toBe(true);
  });

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

  test('a persistent switch is given a function of the script (none is made) and undo restores the stage script', async () => {
    const { info } = start();
    const st = lanaiEditState(maps);
    st.open(info);
    const template = st.templates().find((t) => t.source === '新規保持スイッチ')!;
    const had = s.stageScripts.get(c.archive.toUpperCase())!.doc;
    s.setStageScriptDoc(c.archive, {
      ...had,
      functions: [...had.functions, { name: 'openGate', body: 'openDoor(1)' }],
    });
    const before = structuredClone(s.stageScripts.get(c.archive.toUpperCase())!.doc);
    const count = st.current!.recs[5]?.length ?? 0;
    st.edit((doc) =>
      st.placeStamp(
        doc,
        { type: 'template', t: { ...template, event: { ...template.event!, scriptFn: 'openGate' } } },
        5.5,
        5.5,
      ),
    );
    const row = u32(st.current!.recs[5]!.at(-1)!.raw, 4);
    expect(lanaiButtonDoor(maps, info.dungeon, row)).toBe(1);
    const stored = s.stageScripts.get(c.archive.toUpperCase())!;
    expect(stored.doc.bindings).toContainEqual({
      trigger: 'switch',
      group: info.dungeon,
      row,
      fn: 'openGate',
    });
    expect(stored.doc.functions).toEqual(before.functions);
    expect((await checkStageScript(s, c, stored.source)).problems).toEqual([]);
    const files = new Map<string, Uint8Array>();
    await buildStageScripts(s, files);
    expect(files.has(c.archive)).toBe(true);
    st.undo();
    expect(st.current!.recs[5]?.length ?? 0).toBe(count);
    expect(s.stageScripts.get(c.archive.toUpperCase())!.doc).toEqual(before);
    st.redo();
    expect(lanaiButtonDoor(maps, info.dungeon, row)).toBe(1);
    st.undo();
  });

  test('both switch types can be placed without a function: the script is left as it is', async () => {
    const { info } = start();
    const st = lanaiEditState(maps);
    st.open(info);
    const before = structuredClone(s.stageScripts.get(c.archive.toUpperCase())!.doc);
    for (const [source, x] of [
      ['新規保持スイッチ', 4],
      ['新規プッシュスイッチ', 5],
    ] as const) {
      const template = st.templates().find((t) => t.source === source)!;
      st.edit((doc) => st.placeStamp(doc, { type: 'template', t: template }, x, 5));
      const row = u32(st.current!.recs[5]!.at(-1)!.raw, 4);
      const stored = s.stageScripts.get(c.archive.toUpperCase())!;
      expect(stored.doc.bindings.find((b) => b.group === info.dungeon && b.row === row)).toBeUndefined();
      expect(stored.doc).toEqual(before);
      expect(lanaiButtonDoor(maps, info.dungeon, row)).toBeNull();
    }
    st.undo();
    st.undo();
    expect(s.stageScripts.get(c.archive.toUpperCase())!.doc).toEqual(before);
  });

  test('a new stair keeps its selected destination in the event row and undoes with the record', () => {
    const { info, g } = start();
    const st = lanaiEditState(maps);
    st.open(info);
    const template = st.templates().find((t) => t.source === '新規上り階段')!;
    const events = maps.eventTable(info.dungeon)!;
    const before = events.rows;
    const count = st.current!.recs[3]!.length;
    st.edit((doc) =>
      st.placeStamp(
        doc,
        {
          type: 'template',
          t: { ...template, event: { ...template.event!, destination: { map: info.hash, point: g.firstPoint } } },
        },
        5.5,
        5.5,
      ),
    );
    const stair = st.current!.recs[3]!.at(-1)!;
    const row = u32(stair.raw, 4);
    expect(stair.raw[0x15]).toBe(5);
    expect(events.u32(row, 0x10)).toBe(0x80000013);
    expect([events.u32(row, 0x14), events.u32(row, 0x18)]).toEqual([info.hash, g.firstPoint]);
    expect(lanaiValidateAll(maps, info, st.current!).filter((i) => i.key.startsWith('destination/'))).toEqual([]);
    st.undo();
    expect(st.current!.recs[3]!.length).toBe(count);
    expect(events.rows).toBe(before);
  });

  test('a warp hole uses WarpCommon and stores its destination', () => {
    const { info, g } = start();
    const st = lanaiEditState(maps);
    st.open(info);
    const template = st.templates().find((t) => t.source === '新規ワープホール')!;
    expect(template.model).toEqual({ type: 'object', row: 105 });
    expect(template.event?.look).toBe(0);
    st.edit((doc) =>
      st.placeStamp(
        doc,
        {
          type: 'template',
          t: { ...template, event: { ...template.event!, destination: { map: info.hash, point: g.firstPoint } } },
        },
        5.5,
        5.5,
      ),
    );
    const hole = st.current!.recs[3]!.at(-1)!;
    const row = u32(hole.raw, 4);
    const events = maps.eventTable(info.dungeon)!;
    expect(hole.raw[0x15]).toBe(2);
    expect([events.u32(row, 0x10), events.u32(row, 0x14), events.u32(row, 0x18)]).toEqual([
      0x80000014,
      info.hash,
      g.firstPoint,
    ]);
    expect(lanaiValidateAll(maps, info, st.current!).filter((i) => i.key.startsWith('destination/'))).toEqual([]);
    st.undo();
    st.edit((doc) => st.placeStamp(doc, { type: 'template', t: template }, 5.5, 5.5));
    const pending = u32(st.current!.recs[3]!.at(-1)!.raw, 4);
    expect([events.u32(pending, 0x14), events.u32(pending, 0x18)]).toEqual([0, 0]);
    expect(lanaiValidateAll(maps, info, st.current!).some((i) => i.key.startsWith('destination/'))).toBe(true);
    st.undo();
  });

  test('a warp gate keeps the walking transfer action', () => {
    const { info } = start();
    const st = lanaiEditState(maps);
    st.open(info);
    const template = st.templates().find((t) => t.source === '新規ワープゲート')!;
    expect(template.model).toEqual({ type: 'object', row: 44 });
    st.edit((doc) => st.placeStamp(doc, { type: 'template', t: template }, 5.5, 5.5));
    const gate = st.current!.recs[3]!.at(-1)!;
    const row = u32(gate.raw, 4);
    expect(gate.raw[0x15]).toBe(4);
    expect(maps.eventTable(info.dungeon)!.u32(row, 0x10)).toBe(0x80000012);
    st.undo();
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

  test("a tileset's texture is the one its models name (Relic: 6D3A9800, not 2B84B000's stone walls)", async () => {
    const all = await lanaiTilesets(s);
    expect(u32(all.find((t) => t.name === 'Relic')!.resource, 4)).toBe(0x6d3a9800);
    for (const ts of all) {
      const set = await lanaiTileModels(
        s,
        {
          mapData: -1,
          tileset: 0,
          partsName: '',
          resource: 0,
          textureArchive: u32(ts.resource, 0),
          textureEntry: u32(ts.resource, 4),
        },
        [ts.floor!],
      );
      const names = set.models.get(ts.floor!.entry)!.materials.flatMap((m) => m.textures.filter((t) => t !== null));
      // Boutique's only texture (content 97) lacks its floor's bg_floor_01 in the ROM too
      const missing = names.filter((n) => !set.textures.has(n) && !(ts.name === 'Boutique' && n === 'bg_floor_01'));
      expect({ ts: ts.name, missing }).toEqual({ ts: ts.name, missing: [] });
    }
  });

  test('a new texture row keeps the battle field of the map; a wrong texture is fixed by picking the tileset again', async () => {
    const { info, doc } = start();
    const row = maps.mapDataRow(info, doc);
    const md = maps.contentTable('MapData')!,
      mr = maps.contentTable('MapResource')!;
    const all = await lanaiTilesets(s);
    const relic = all.find((t) => t.name === 'Relic')!;
    const field = mr.u32(md.row(row)[0x0b]!, 0x10);
    await setLanaiTileset(s, maps, row, relic);
    expect(mr.u32(md.row(row)[0x0b]!, 0x10)).toBe(field);
    expect(tilesetTextureDiffers(maps, row, relic)).toBe(false);
    // a stage saved with the stone-wall texture
    const wrong = mr.addRow(md.row(row)[0x0b]!);
    mr.setU32(wrong, 4, 0x2b84b000);
    md.setBits(row, 0x08, 24, 8, wrong);
    expect(tilesetTextureDiffers(maps, row, relic)).toBe(true);
    await setLanaiTileset(s, maps, row, relic);
    expect(mr.u32(md.row(row)[0x0b]!, 4)).toBe(0x6d3a9800);
    expect(tilesetTextureDiffers(maps, row, relic)).toBe(false);
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
    await expect(setLanaiTileset(s, rom, 0, all[0]!)).rejects.toThrow('新しい MapData 行');
    const row = addLanaiMapData(rom, 0);
    const next = all.find((t) => t.entry !== mapDataTileset(rom, 0))!;
    await setLanaiTileset(s, rom, row, next);
    expect(mapDataTileset(rom, row)).toBe(next.entry);
    expect(mapDataTileset(rom, 0)).not.toBe(next.entry);
    expect(s.modFiles().get(rom.content.archive)).toBeDefined();
    const restored = await LanaiSession.open(dump, { fresh: true });
    await restored.restore(s.saved());
    const romAgain = await lanaiMaps(restored, lanaiContents(restored)[28]!);
    expect(mapDataTileset(romAgain, row)).toBe(next.entry);
  });

  test('a door opened only from outside that an exit leads to is flagged (it stands open on arrival)', () => {
    const { info, doc, rec } = start();
    const key = `arrivaldoor/${hex8(u32(rec.raw, 0))}`;
    expect(lanaiValidateAll(maps, info, doc).some((i) => i.key === key)).toBe(false);
    // another exit of the map leading to the gate's point
    const row = maps.addNewEventRow(1, 0x80000016, 0);
    const events = maps.eventTable(1)!;
    events.setU32(row, 0x14, info.hash);
    events.setU32(row, 0x18, u32(rec.raw, 0));
    const raw = rec.raw.slice();
    raw.set([0x78, 0x56, 0x34, 0x12, row & 0xff, row >> 8, 0, 0], 0);
    const withExit = { ...doc, recs: { ...doc.recs, 3: [...doc.recs[3]!, { ...rec, raw }] } };
    expect(lanaiValidateAll(maps, info, withExit).some((i) => i.key === key)).toBe(true);
  });
});
