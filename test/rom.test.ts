// Golden tests against the Python reference (test/golden/export_golden.py) and round trips
// (docs/map-editor-design.md §9). Needs the local dump; skipped when it is missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { entryBlob, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { lz10Compress, lz10Decompress } from '../src/archive/lz10';
import { Game } from '../src/game/game';
import { MapDb } from '../src/game/mapdb';
import { LAYOUTS, fineToWorld, loadDoc, recCellPos, sectionBytes } from '../src/game/sections';
import { openImage } from '../src/rom/dump';
import { buildArchive, buildMapDb, buildModFiles } from '../src/export/pack';
import { GsTable } from '../src/archive/gstable';
import { findByName } from '../src/archive/gsarc';
import { mapTitle } from '../src/game/names';
import { recordObjectRow, recordPlacement, isIndoor } from '../src/game/objects';
import { validate } from '../src/editor/validate';
import { removeTile, setTile } from '../src/editor/state';
import { equalBytes } from '../src/util/bytes';
import { CIA, GOLDEN, hasCia, hasGolden } from './env';

const sha1 = (b: Uint8Array): string => createHash('sha1').update(b).digest('hex');

describe.skipIf(!hasCia || !hasGolden)('dump vs Python reference', () => {
  let game: Game;
  let golden: any;
  beforeAll(async () => {
    golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  });

  test('code.bin (BLZ) matches ctrtool', () => {
    expect(sha1(game.dump.code)).toBe(golden.code_sha1);
  });

  test('archive A90C8038 and map DB', async () => {
    expect(sha1(await game.dump.readRomfs('A90C8038'))).toBe(golden.archive.sha1);
    expect(game.dbArchive.entries.map(({ hash, type, size, comp, raw }) => ({ hash, type, size, comp, raw }))).toEqual(golden.archive.entries);
    expect(sha1(game.dbBytes)).toBe(golden.mapdb.sha1);
    expect(game.db.count).toBe(golden.mapdb.count);
  });

  test('LZ10 compressor is byte-identical to gsarc.lz10_compress', () => {
    const c = lz10Compress(game.dbBytes);
    expect(sha1(c)).toBe(golden.mapdb.lz10_sha1);
    expect(equalBytes(lz10Decompress(c), game.dbBytes)).toBe(true);
  });

  test('all 205 maps: names, dungeons, floors, section hashes and sizes', () => {
    expect(game.code.maps.length).toBe(205);
    const got = game.code.maps.map((m) => ({
      hash: m.hash,
      name: m.name,
      dungeon: m.dungeon,
      floor: m.floor,
      sections: m.sections,
      sizes: m.sections.map((s) => game.db.get(s).length),
    }));
    expect(got).toEqual(golden.maps);
  });

  test('mapParts (tileset 0)', () => {
    expect(game.master.mapParts.rows).toBe(golden.mapParts.rows);
    for (let k = 0; k < 15; k++)
      for (let l = 0; l < 8; l++) expect(game.master.partModel(k, 0, l)).toBe(golden.mapParts.tileset0[k][l]);
  });

  for (const name of ['D01B02001', 'D02B02002']) {
    test(`${name}: tiles and sections 3/4/5/8`, () => {
      const doc = game.doc(game.code.byName(name)!);
      const g = golden[name];
      expect(doc.tiles.map((t) => [t.kind, t.x, t.y, t.rot | t.rotHi, t.letter, t.pad])).toEqual(g.tiles);
      const got: any[] = [];
      for (const k of [3, 4, 5, 8]) {
        const L = LAYOUTS[k]!;
        for (const r of doc.recs[k] ?? []) {
          const [x, y] = k === 3 ? [r.x, r.y] : recCellPos(r, L);
          const ident = k === 3 ? r.raw[0x14] : (r.raw[0]! | (r.raw[1]! << 8) | (r.raw[2]! << 16) | (r.raw[3]! << 24)) >>> 0;
          got.push({ section: k, ident, x, y, raw: Buffer.from(r.raw).toString('hex') });
        }
      }
      expect(got.length).toBe(g.placements.length);
      got.forEach((p, i) => {
        const e = g.placements[i];
        expect(p.section).toBe(e.section);
        expect(p.ident).toBe(e.ident);
        expect(p.raw).toBe(e.raw);
        expect(p.x).toBeCloseTo(e.x, 6);
        expect(p.y).toBeCloseTo(e.y, 6);
      });
    });
  }

  test('fine units: world = 50 + v * 100', () => {
    expect(fineToWorld(93) / 500).toBeCloseTo(18.7, 6);
  });

  test('round trip: every section of every map rebuilds to the same bytes', () => {
    for (const info of game.code.maps) {
      const doc = loadDoc(game.db, info);
      for (let k = 0; k < 10; k++) expect(equalBytes(sectionBytes(doc, k), game.db.get(info.sections[k]!))).toBe(true);
    }
  });

  test('round trip: unedited map DB and archive are byte-identical', () => {
    const docs = game.code.maps.map((m) => loadDoc(game.db, m));
    const { db, changed } = buildMapDb(game, docs);
    expect(changed).toBe(0);
    expect(equalBytes(db, game.dbBytes)).toBe(true);
    expect(equalBytes(new MapDb(game.dbBytes).build(), game.dbBytes)).toBe(true);
  });

  test('edited export: only the map DB entry changes, and it reads back', async () => {
    const info = game.code.byName('D01B02001')!;
    const doc = game.doc(info);
    setTile(doc, 13, 17, { kind: 1, letter: 0x7a, rot: 1 }); // new tile
    doc.recs[4]![0]!.x += 3; // move a treasure
    const { archive, changed } = buildArchive(game, [doc]);
    expect(changed).toBe(2);
    const a = parseArchive(archive);
    const orig = game.dbArchive;
    for (const e of orig.entries) {
      if (e.index === game.dbEntry.index) continue;
      expect(equalBytes(entryBlob(a, a.entries[e.index]!), entryBlob(orig, e))).toBe(true);
    }
    const db = new MapDb(unpackEntry(a, a.entries[game.dbEntry.index]!).body);
    const back = loadDoc(db, info);
    expect(back.tiles.length).toBe(81);
    expect(back.tiles.at(-1)).toMatchObject({ kind: 1, x: 13, y: 17, rot: 1 });
    expect(back.recs[4]![0]!.x).toBe(game.doc(info).recs[4]![0]!.x + 3);
    // every other map is unchanged
    for (const m of game.code.maps) {
      if (m.hash === info.hash) continue;
      for (const s of m.sections) expect(equalBytes(db.get(s), game.db.get(s))).toBe(true);
    }
  });

  test('validation: vanilla maps report nothing, edits are caught', () => {
    const docs = new Map();
    for (const m of game.editableMaps()) expect(validate(game, game.doc(m), game.master.tileset(m.dungeon), docs)).toEqual([]);
    const info = game.code.byName('D01B02001')!;
    const doc = game.doc(info);
    removeTile(doc, 19, 12); // under the door at (19, 12)
    doc.recs[4]![0]!.x = 400;
    const msgs = validate(game, doc, 0, docs).map((i) => `${i.level} ${i.msg}`);
    expect(msgs.some((m) => m.startsWith('error') && m.includes('(19, 12) にタイルがありません'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('error') && m.includes('0〜299'))).toBe(true);
    // a point another map refers to disappears
    const b1 = game.doc(game.code.byName('D01B01001')!);
    b1.recs[3] = [];
    expect(validate(game, b1, 0, docs).some((i) => i.level === 'error' && i.msg.includes('D01B02001 の出入口'))).toBe(true);
  });
  test('names: dungeons (mapGroup +0x14 is u16) and maps', () => {
    const m = game.master;
    expect(m.dungeonName(1)).toBe('山のどうくつ');
    expect(m.dungeonName(15)).toBe('暗闇のどうくつ1');
    expect(m.dungeonName(19)).toBe('デンパタウン');
    expect(mapTitle(game.code.byName('D01B02001')!, game.code.maps, m)).toBe('山のどうくつ 地下2階');
    expect(mapTitle(game.code.byName('D02B02003')!, game.code.maps, m)).toBe('海底トンネル 地下2階 (3)');
    expect(mapTitle(game.code.byName('K01B01ENT')!, game.code.maps, m)).toBe('暗闇のどうくつ1 地下1階 入口');
    expect(mapTitle(game.code.byName('M01OUT000')!, game.code.maps, m)).toBe('デンパタウン 屋外');
  });

  test('objects: chests, doors and stairs of D01B02001', async () => {
    const info = game.code.byName('D01B02001')!;
    const doc = game.doc(info);
    const ctx = { master: game.master, events: await game.eventTable(1), indoor: isIndoor(doc) };
    expect(doc.recs[4]!.every((r) => recordObjectRow(4, r, ctx) === 0x15)).toBe(true); // gimk_05_trebox_1
    const p = doc.recs[3]!.map((r) => recordObjectRow(3, r, ctx));
    expect(p).toEqual([15, 1, 16, 10, 1, 10]); // gate_07, stair_1, gate_08, gate_02, stair_1, gate_02
    // doors: angle / 100-unit step from +0x15 (FUN_002effa0); chests are never rotated
    const pl = doc.recs[3]!.map((r) => recordPlacement(3, r, doc, game.master));
    const door13 = doc.recs[3]!.findIndex((r) => r.x === 13 && r.y === 10); // +0x15 = 3 -> west, +90°
    expect(pl[door13]).toEqual({ angle: Math.PI / 2, ox: -100, oz: 0 });
    expect(doc.recs[4]!.every((r) => recordPlacement(4, r, doc, game.master).angle === 0)).toBe(true);
  });

  test('treasure: chest -> EventObject +0x08 -> treasureGroup; edits export 56562135 and the event archive', async () => {
    const ev = (await game.eventTable(1))!;
    const doc = game.doc(game.code.byName('D01B02001')!);
    const chest = doc.recs[4]![5]!; // (19.5, 10.5)
    const evRow = chest.raw[0]!;
    expect(ev.kind(evRow)).toBe(0x0c);
    const row = ev.treasureRow(evRow);
    const slots = game.master.treasureSlots(row);
    expect(slots.filter((s) => s.item).length).toBeGreaterThan(0);

    game.master.setTreasureSlot(row, 1, 28, 3); // add テレポーター with weight 3
    ev.setTreasureRow(evRow + 1, row);
    const files = buildModFiles(game, [], [ev], true);
    expect([...files.keys()].sort()).toEqual(['56562135', '79B881BB']);
    // master: only treasureGroup.bin differs
    const orig = parseArchive(await game.dump.readRomfs('56562135'));
    const re = parseArchive(files.get('56562135')!);
    for (const e of orig.entries) {
      const a = unpackEntry(orig, e), b = unpackEntry(re, re.entries[e.index]!);
      if (a.name === 'treasureGroup.bin') {
        const t = new GsTable(b.body);
        expect(t.row(row)[4]! | (t.row(row)[5]! << 8)).toBe(28);
      } else expect(equalBytes(a.body, b.body)).toBe(true);
    }
    // event archive: the new pointer reads back
    const evArc = parseArchive(files.get('79B881BB')!);
    const tbl = new GsTable(findByName(evArc, 'd01_EventObject.bin')!.body);
    expect(tbl.row(evRow + 1)[8]).toBe(row & 0xff);
    // restore for other tests
    game.setMaster(await game.dump.readRomfs('56562135'), 'ROM');
  });
});
