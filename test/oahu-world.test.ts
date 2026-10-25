// 電波人間のRPG3's world map W01 (naauao oahu/worldmap.md): the section table in code.bin, the terrain of
// W01_ground.bin (its pools rebuilt), the entrances and where their EventObject rows lead, the ranges, and the export.
// Needs the Base and Update CIAs (test/env.ts).
import { beforeAll, describe, expect, test } from 'bun:test';
import { findByName, parseArchive } from '../src/archive/gsarc';
import { MapDb } from '../src/game/mapdb';
import { OahuSession } from '../src/oahu/session';
import { buildOahuGround, oahuCoveredBy, oahuGroundPools, OAHU_WORLD, OAHU_WORLD_SECTIONS, OAHU_WORLD_SIZE, OAHU_WORLD_TABLE, parseChests, parseEventRanges, parseOahuGround, parseProps, WE, WS, type OahuWorld } from '../src/oahu/worldmap';
import { findEntry, unpackEntry } from '../src/archive/gsarc';
import { OAHU_MAP_ARCHIVE, OAHU_MAPDB_ENTRY } from '../src/oahu/maps';
import { openImage, openUpdate, withUpdate, type Dump } from '../src/rom/dump';
import { equalBytes, u32 } from '../src/util/bytes';
import { hasOahuBase, hasOahuUpdate, OAHU_BASE, OAHU_UPDATE } from './env';

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 world map', () => {
  let dump: Dump;
  let session: OahuSession;
  let world: OahuWorld;
  beforeAll(async () => {
    const base = await openImage(Bun.file(OAHU_BASE), 'base');
    dump = withUpdate(base, await openUpdate(Bun.file(OAHU_UPDATE), 'update'));
    session = await OahuSession.open(dump);
    world = session.world;
    await world.load(dump);
  });

  test('the section table in code.bin names the sections; all are in the map database', () => {
    const code = session.code!.code;
    for (let k = 0; k < 9; k++) expect(u32(code, OAHU_WORLD_TABLE - 0x100000 + k * 4)).toBe(OAHU_WORLD_SECTIONS[k]!);
    for (const h of OAHU_WORLD_SECTIONS) expect(session.maps.db.has(h)).toBe(true);
    expect(world.info?.name).toBe('W01');
    const sizes = OAHU_WORLD_SECTIONS.map((_, k) => world.section(k).length);
    expect(sizes).toEqual([200088, 22500, 4864, 3012, 7308, 128, 40, 22500, 80]);
  });

  test('the terrain: 95 parts, start cells only, the pools are the most cells in a 2 x 2 block', () => {
    expect(world.parts.length).toBe(95);
    expect(world.parts[1]!.name).toBe('bgpt_wld_sea_00.bch');
    const g = world.ground!;
    const file = world.originalGroundBytes()!;
    expect(equalBytes(buildOahuGround(file, parseOahuGround(file)!), file)).toBe(true);
    const pools = oahuGroundPools(g.parts, 95);
    for (let p = 0; p < 95; p++) expect(pools[p]).toBe(u32(file, u32(file, 8) + p * 4));
    // a 2 x 2 part never has another part to its right or below
    const covered = oahuCoveredBy(g, world.partFlags);
    const N = OAHU_WORLD_SIZE;
    let big = 0;
    for (let i = 0; i < N * N; i++) if (covered[i]! >= 0 && covered[i] !== i) big++;
    expect(big).toBeGreaterThan(3000);
    expect(world.explored().length).toBe(961);
  });

  test('entrances: 152, every EventObject row leads to a map whose exits come back to the world', () => {
    const list = world.entrances();
    expect(list.length).toBe(152);
    let withRow = 0;
    for (const r of list) {
      const d = world.dest(r);
      if (!d.row) continue;
      withRow++;
      if (d.mapHash) expect(d.map, `entrance ${WE.id(r).toString(16)}`).toBeDefined();
    }
    expect(withRow).toBe(86);
    const town = list.find((r) => world.dest(r).map?.name === 'S11OUT000')!;
    expect(WE.part(town)).toBe(90);
    expect([WE.x(town), WE.y(town)]).toEqual([247, 260]);
    expect(world.ports.has(WE.id(list[33]!))).toBe(true);
    // the maps of the destination's dungeon
    const d10 = list.find((r) => world.dest(r).map?.name === 'D10B01002')!;
    const maps = world.dungeonMaps(world.dest(d10).map!.dungeon).map((m) => m.name);
    expect(maps).toContain('D10B01001');
  });

  test('ranges, chests, props and event ranges', () => {
    const land = world.ranges(WS.land), sea = world.ranges(WS.sea);
    expect(land.length).toBe(251);
    expect(sea.length).toBe(609);
    const ai = session.master.table('areaInfoData.bin');
    const idx = ai.hashIndex();
    for (const r of land) expect(ai.row(idx.get(r.hash)!)[6]).toBe(1);
    for (const r of sea) expect(ai.row(idx.get(r.hash)!)[6]).toBe(2);
    expect(parseChests(world.section(WS.chests)).length).toBe(10);
    expect(parseProps(world.section(WS.props)).map((p) => p.value)).toEqual([405, 367]);
    expect(parseEventRanges(world.section(WS.events)).length).toBe(4);
  });

  test('edits are saved, restored and exported (terrain in the master, sections in the map database)', async () => {
    const list = world.entrances();
    const town = list.findIndex((r) => world.dest(r).map?.name === 'S11OUT000');
    const moved = list[town]!.slice();
    moved[0x10] = 240;
    world.setEntrance(town, moved);
    expect(world.paint(10, 10, 54, 1)).toBe(true);
    expect(world.isChanged()).toBe(true);
    const saved = world.saved();
    expect(saved.cells).toBeDefined();
    expect(saved.sections?.map(([h]) => h)).toEqual([OAHU_WORLD_SECTIONS[WS.entrances]]);

    const files = session.modFiles();
    const master = parseArchive(files.get('21350000')!);
    const ground = parseOahuGround(findByName(master, 'W01_ground.bin')!.body)!;
    expect(ground.parts[10 * 300 + 10]).toBe(54);
    expect(ground.rots[10 * 300 + 10]).toBe(1);
    const arc = parseArchive(files.get(OAHU_MAP_ARCHIVE)!);
    const db = new MapDb(unpackEntry(arc, findEntry(arc, OAHU_MAPDB_ENTRY)!).body);
    expect(db.get(OAHU_WORLD_SECTIONS[WS.entrances]!)[town * 32 + 0x10]).toBe(240);
    expect(db.get(OAHU_WORLD).length).toBe(200088);

    // another session takes the saved edits back
    const again = await OahuSession.open(dump);
    expect(again.world.isChanged()).toBe(false);
    again.world.restore(saved);
    expect(again.world.entrances()[town]![0x10]).toBe(240);
    expect(again.world.ground!.parts[10 * 300 + 10]).toBe(54);
    // put everything back
    again.world.revertGround();
    again.world.setEntrances(again.world.originalEntrances());
    expect(again.world.isChanged()).toBe(false);
    world.revertGround();
    world.setEntrances(world.originalEntrances());
    expect(world.isChanged()).toBe(false);
  });
});
