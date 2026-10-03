// 電波人間のRPG3's maps (naauao oahu/map.md): the map table and database, the sections as documents, the
// EventObject tables, the tile models, and the export. Needs the Base and Update CIAs (test/env.ts).
import { beforeAll, describe, expect, test } from 'bun:test';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { MapDb } from '../src/game/mapdb';
import { recCellPos, sectionBytes } from '../src/game/sections';
import { OAHU_LAYOUTS, OAHU_MAP_ARCHIVE, OAHU_MAP_FORMAT, OAHU_MAPDB_ENTRY, oahuExitKind, oahuRecEventRow, type OahuMaps } from '../src/oahu/maps';
import { oahuEventEntries } from '../src/oahu/events';
import { OahuEditState, oahuValidate } from '../src/oahu/mapedit';
import { Controller } from '../src/editor/controller';
import { tileAt } from '../src/editor/state';
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

  test('shared editor: paint, room cells, undo and redo on an RPG3 map', async () => {
    const m = maps.mapByName('D10B01001')!;
    const st = new OahuEditState(maps);
    await maps.eventTable(maps.dungeonOf(m)!);
    st.open(m);
    const ctl = new Controller(st);
    expect(oahuValidate(maps, m, st.current!)).toEqual([]);
    // the palette of the tileset has the kinds of the map's tiles
    const pal = maps.palette(st.tileset);
    for (const t of st.current!.tiles) expect(pal.has(t.kind)).toBe(true);
    // paint an empty cell
    const empty: [number, number] = [0, 0];
    while (tileAt(st.current!, ...empty)) empty[0]++;
    st.brush = { kind: [...pal.keys()][0]!, letter: 0x7a, rot: 1 };
    st.setTool('paint');
    ctl.down(empty[0] + 0.5, empty[1] + 0.5, { shiftKey: false, button: 0 });
    ctl.up();
    expect(tileAt(st.current!, ...empty)?.rot).toBe(1);
    expect(maps.isChanged(m)).toBe(true);
    // the tile record is 20 bytes; the new one has zeros in RPG3's extra bytes
    expect(maps.db.get(m.hash).length).toBe(maps.db.original(m.hash).length + 20);
    // section 6: toggle a cell
    const n6 = st.current!.cells6.length;
    st.setTool('room');
    ctl.down(empty[0] + 0.5, empty[1] + 0.5, { shiftKey: false, button: 0 });
    ctl.up();
    expect(st.current!.cells6.length).toBe(st.current!.sec6Header.length ? n6 + 1 : n6);
    st.undo();
    st.undo();
    expect(tileAt(st.current!, ...empty)).toBeUndefined();
    expect(maps.isChanged(m)).toBe(false);
    st.redo();
    expect(tileAt(st.current!, ...empty)).toBeDefined();
    expect(maps.doc(m)).toBe(st.current!);
    st.revert();
    expect(maps.isChanged(m)).toBe(false);
  });

  test('shared editor: copying a chest copies its EventObject row; undo removes it; saved edits keep added rows', async () => {
    const m = maps.mapByName('D10B01001')!;
    const d = maps.dungeonOf(m)!;
    const table = (await maps.eventTable(d))!;
    const rows = table.rows;
    const tables = maps.eventTableBytes();
    const st = new OahuEditState(maps);
    st.open(m);
    const ctl = new Controller(st);
    const chests = [...(st.current!.recs[4] ?? [])];
    expect(chests.length).toBeGreaterThan(0);
    st.select({ type: 'rec', section: 4, index: 0 });
    ctl.duplicateRec();
    expect(st.error).toBe('');
    expect(st.current!.recs[4]!.length).toBe(chests.length + 1);
    expect(table.rows).toBe(rows + 1);
    const copy = st.current!.recs[4]!.at(-1)!;
    expect(oahuRecEventRow(4, copy.raw)).toBe(rows);
    expect(equalBytes(table.row(rows), table.row(oahuRecEventRow(4, chests[0]!.raw)))).toBe(true);
    // the archive of the dungeon is exported with the longer table
    expect(maps.changedArchives().has(d.archive)).toBe(true);
    const saved = maps.saved();
    expect(saved.events!.some(([, r, before]) => r === rows && before.length === 0)).toBe(true);
    st.undo();
    expect(table.rows).toBe(rows);
    expect(maps.isChanged(m)).toBe(false);
    expect(maps.changedArchives().size).toBe(0);
    // restoring the saved edits brings the added row back
    await maps.restore(saved);
    expect(table.rows).toBe(rows + 1);
    maps.restoreEventTableBytes(tables);
    maps.revert(m);
    expect(maps.changedArchives().size).toBe(0);
  });

  test('shared editor: templates of the dungeon place copies with new point IDs and rows', async () => {
    const m = maps.mapByName('D10B01001')!;
    const d = maps.dungeonOf(m)!;
    const table = (await maps.eventTable(d))!;
    const st = new OahuEditState(maps);
    st.open(m);
    const ts = st.templates();
    expect(ts.some((t) => t.section === 3)).toBe(true);
    const exit = ts.find((t) => t.section === 3 && t.event)!;
    const rows = table.rows;
    let placed: [number, number] = [0, 0];
    st.edit((doc) => (placed = st.placeStamp(doc, { type: 'template', t: exit }, 5.5, 5.5)));
    const r = st.current!.recs[placed[0]]![placed[1]]!;
    expect(u32(r.raw, 0)).not.toBe(u32(exit.raw, 0));
    expect(oahuRecEventRow(3, r.raw)).toBe(rows);
    st.undo();
    expect(table.rows).toBe(rows);
    const changed = [0, 1, 2, 3, 4, 5, 6, 8, 9].filter((k) => !equalBytes(maps.db.get(m.sections[k]!), maps.db.original(m.sections[k]!)));
    expect(changed).toEqual([]);
    expect(maps.isChanged(m)).toBe(false);
  });
});
