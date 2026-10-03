// 電波人間のRPG3's maps (naauao oahu/map.md): the map table and database, the sections as documents, the
// EventObject tables, the tile models, and the export. Needs the Base and Update CIAs (test/env.ts).
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { MapDb } from '../src/game/mapdb';
import { recCellPos, sectionBytes } from '../src/game/sections';
import { OAHU_LAYOUTS, OAHU_MAP_ARCHIVE, OAHU_MAP_FORMAT, OAHU_MAPDB_ENTRY, oahuExitKind, oahuRecEventRow, type OahuMaps } from '../src/oahu/maps';
import { oahuEventEntries } from '../src/oahu/events';
import { OahuSession } from '../src/oahu/session';
import { openImage, openUpdate, withUpdate, type Dump } from '../src/rom/dump';
import { equalBytes, u32 } from '../src/util/bytes';
import { hasOahuBase, hasOahuUpdate, OAHU_BASE, OAHU_UPDATE } from './env';

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 maps', () => {
  let dump: Dump;
  let session: OahuSession;
  let maps: OahuMaps;
  beforeAll(async () => {
    const base = await openImage(Bun.file(OAHU_BASE), 'base');
    dump = withUpdate(base, await openUpdate(Bun.file(OAHU_UPDATE), 'update'));
    session = await OahuSession.open(dump);
    maps = session.maps;
  });

  test('the map table has 300 maps; every section but section 7 is in the map database', () => {
    expect(maps.maps.length).toBe(300);
    expect(maps.db.count).toBe(2700);
    const d = maps.mapByName('D10B01001')!;
    expect(d.dungeon).toBe(1);
    expect(d.floor).toBe(-1);
    for (const m of maps.maps) {
      expect(m.sections[7]).toBe(0);
      if (!m.world) for (const k of [0, 1, 2, 3, 4, 5, 6, 8, 9]) expect(maps.db.has(m.sections[k]!)).toBe(true);
    }
  });

  test('every map but the world map reads into records, and writes back byte for byte', () => {
    let tiles = 0;
    for (const m of maps.maps) {
      if (m.world) continue;
      const doc = maps.doc(m);
      // Only the absent section 7 (hash 0, no bytes) stays raw.
      expect(Object.keys(doc.raw)).toEqual(['7']);
      expect(doc.raw[7]!.length).toBe(0);
      tiles += doc.tiles.length;
      for (let k = 0; k < 10; k++) {
        if (k === 7) continue;
        expect(equalBytes(sectionBytes(doc, k, OAHU_MAP_FORMAT), maps.db.get(m.sections[k]!))).toBe(true);
      }
    }
    expect(tiles).toBe(13444);
  });

  test('records sit inside their map; exits name EventObject rows of their dungeon', async () => {
    const d10 = maps.mapByName('D10B01001')!;
    const doc = maps.doc(d10);
    const xs = doc.tiles.map((t) => t.x), ys = doc.tiles.map((t) => t.y);
    for (const k of [3, 4, 5, 8]) {
      for (const r of doc.recs[k] ?? []) {
        const [cx, cy] = recCellPos(r, OAHU_LAYOUTS[k]!);
        expect(cx).toBeGreaterThanOrEqual(Math.min(...xs) - 1);
        expect(cx).toBeLessThanOrEqual(Math.max(...xs) + 2);
        expect(cy).toBeGreaterThanOrEqual(Math.min(...ys) - 1);
        expect(cy).toBeLessThanOrEqual(Math.max(...ys) + 2);
      }
    }
    const events = (await maps.eventTable(maps.dungeonOf(d10)!))!;
    expect(events.name).toBe('D10_EventObject');
    expect(events.rowSize).toBe(0x58);
    // The first exit is EventObject row 11: an exit (+0x55 = 0x13) whose destination is a map (+0x10).
    const exit = doc.recs[3]![0]!;
    expect(oahuExitKind(exit.raw)).toBe(1);
    const row = events.row(oahuRecEventRow(3, exit.raw));
    expect(row[0x55]).toBe(0x13);
    expect(maps.map(u32(row, 0x10))).toBeDefined();
  });

  test('tile models: every tile of the dungeons has a model in its tileset archive', async () => {
    let missing = 0, total = 0;
    const archives = new Map<string, Set<number>>();
    for (const m of maps.maps) {
      if (m.world || !m.name.startsWith('D')) continue;
      const doc = maps.doc(m);
      const src = maps.tileSource(m, doc);
      let have = archives.get(src.modelArchive);
      if (!have) {
        have = new Set(parseArchive(await dump.readRomfs(src.modelArchive)).entries.map((e) => e.hash));
        archives.set(src.modelArchive, have);
      }
      for (const t of doc.tiles) {
        total++;
        const h = maps.partModel(t.kind, src.tileset, t.letter >= 0x61 && t.letter <= 0x67 ? t.letter - 0x60 : 0);
        if (!h || !have.has(h)) missing++;
      }
    }
    expect(total).toBeGreaterThan(5000);
    expect(missing / total).toBeLessThan(0.02);
  });

  test('an edited tile is exported in B68E0000, other sections unchanged', async () => {
    const m = maps.mapByName('D10B01001')!;
    const doc = maps.doc(m);
    const before = doc.tiles[0]!.kind;
    doc.tiles[0]!.kind = 5;
    maps.commit(m);
    expect(maps.isChanged(m)).toBe(true);
    const out = maps.changedArchives().get(OAHU_MAP_ARCHIVE)!;
    const db = new MapDb(unpackEntry(parseArchive(out), findEntry(parseArchive(out), OAHU_MAPDB_ENTRY)!).body);
    expect(u32(db.get(m.hash), 0)).toBe(5);
    expect(equalBytes(db.get(m.sections[2]!), maps.db.original(m.sections[2]!))).toBe(true);
    maps.revert(m);
    expect(maps.isChanged(m)).toBe(false);
    expect(maps.doc(m).tiles[0]!.kind).toBe(before);
    expect(maps.changedArchives().size).toBe(0);
  });

  test('event list: exits lead to maps, and the scripts (0x2E) of D10 build classes that show field messages', async () => {
    const entries = await oahuEventEntries(maps, session.code!.code, [40000, 49999]);
    expect(entries.length).toBe(2524);
    const dests = entries.filter((e) => e.dest);
    expect(dests.length).toBeGreaterThan(600);
    // +0x14 is the point ID (+0x00) of an exit of the destination map
    expect(dests.filter((e) => maps.exitByPoint(e.dest!.map, e.dest!.point) >= 0).length).toBeGreaterThan(600);
    const scripts = entries.filter((e) => e.kind === 0x2e);
    expect(scripts.length).toBe(636);
    // most scripts are built by the executor (the others are chosen by progress or have no class for the pair)
    expect(scripts.filter((e) => e.scripts.length).length).toBeGreaterThan(500);
    const withMessages = scripts.filter((e) => e.scripts.some((s) => s.cls.messages.length));
    expect(withMessages.length).toBeGreaterThan(100);
    for (const e of withMessages.slice(0, 20)) for (const s of e.scripts) for (const id of s.cls.messages) expect(session.messages.texts.preview(id, true)).toBeTruthy();
  });

  test('an edited EventObject row is exported in its dungeon archive', async () => {
    const d = maps.dungeonOf(maps.mapByName('D10B01001')!)!;
    const t = (await maps.eventTable(d))!;
    const before = t.row(11)[0x57]!;
    t.row(11)[0x57] = before ^ 1;
    maps.changed();
    const out = maps.changedArchives().get(d.archive)!;
    expect(out).toBeDefined();
    const saved = maps.saved();
    expect(saved.events!.length).toBe(1);
    t.row(11)[0x57] = before;
    expect(maps.changedArchives().size).toBe(0);
  });
});
