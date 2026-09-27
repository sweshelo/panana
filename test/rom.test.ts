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
import { P3, P7, letterIndex, recEventRow } from '../src/game/sections';
import { placeStamp, duplicateRecord } from '../src/editor/place';
import { gimmickTemplates } from '../src/game/templates';
import { OBJ_INVISIBLE, recordObjectRow, recordPlacement, isIndoor } from '../src/game/objects';
import { validate } from '../src/editor/validate';
import { removeTile, setTile } from '../src/editor/state';
import { equalBytes } from '../src/util/bytes';
import { CIA, ELPULSE, GOLDEN, hasCia, hasGolden } from './env';
import { existsSync, readdirSync } from 'node:fs';
import { baseModFromFiles } from '../src/rom/dump';
import { EVENT_KINDS, KIND_SWITCH } from '../src/game/eventkinds';
import { modPackage } from '../src/export/pack';
import { ENT, WORLD_SIZE, buildEntrances, coveredParts, moveEntrance, parseEntrances } from '../src/game/worldmap';

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
    for (const m of game.editableMaps()) expect(validate(game, game.doc(m), game.master.tileset(m), docs)).toEqual([]);
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
    expect(pl[door13]).toEqual({ angle: Math.PI / 2, ox: -100, oy: 0, oz: 0 });
    // +0x1A = 1: the door sits on the edge of its cell (250)
    const door19 = doc.recs[3]!.findIndex((r) => r.x === 19 && r.y === 12);
    expect(pl[door19]).toEqual({ angle: 0, ox: 0, oy: 0, oz: -250 });
    expect(doc.recs[4]!.every((r) => recordPlacement(4, r, doc, game.master).angle === 0)).toBe(true);
  });

  test('objects: doors on walls (section 7) of M02F01INN', async () => {
    const info = game.code.byName('M02F01INN')!;
    const doc = game.doc(info);
    const events = await game.eventTable(info.dungeon);
    const ctx = { master: game.master, events, indoor: isIndoor(doc) };
    const s7 = doc.recs[7]!;
    expect(s7.map((r) => [r.x, r.y])).toEqual([[3250, 3100], [3750, 3100], [2900, 3750], [3250, 3600], [3750, 3600], [4100, 3750], [3500, 4250]]);
    // the inn's doors (EventObject 0x14, model +0x46 = gimk_02_door_01 / _03); the last record is an exit
    expect(s7.map((r) => recordObjectRow(7, r, ctx))).toEqual([4, 4, 6, 4, 4, 6, OBJ_INVISIBLE]);
    expect(s7.slice(0, 6).every((r) => events!.kind(recEventRow(7, r.raw)) === 0x14)).toBe(true);
    // FUN_001c6280: y -5, angle from +0x16 (+180° when EventObject +0x48 is set: the rooms on the left mirror
    // the ones on the right), 50 along the wall (+0x15 flips the way)
    const r = (p: { angle: number; ox: number; oy: number; oz: number }) => [Math.round((p.angle * 180) / Math.PI), p.ox, p.oy, p.oz];
    expect(s7.map((p) => r(recordPlacement(7, p, doc, game.master, events)))).toEqual([
      [90, 0, -5, -50], [-90, 0, -5, -50], [180, 50, -5, 0], [90, 0, -5, -50], [-90, 0, -5, -50], [180, -50, -5, 0], [180, 0, -5, 0],
    ]);
  });

  test('objects: doors on walls lead to points of other maps (section 3 and 7 IDs)', () => {
    const docs = game.code.maps.map((m) => game.doc(m));
    const wallIds = new Set(docs.flatMap((d) => (d.recs[7] ?? []).map((r) => P7.id(r.raw))));
    // the exits of the houses' rooms come back to the doors of the town
    expect(docs.flatMap((d) => d.recs[3] ?? []).filter((r) => wallIds.has(P3.destPoint(r.raw))).length).toBe(31);
  });

  test('objects: stairs and furniture of S10B01AAA (issue #29)', () => {
    const doc = game.doc(game.code.byName('S10B01AAA')!);
    const r = (p: { angle: number; ox: number; oy: number; oz: number }) => [Math.round((p.angle * 180) / Math.PI), Math.round(p.ox), p.oy, Math.round(p.oz)];
    // indoor stairs: slot (+0x19 = 8 / 2) and 50 towards +0x15 = 3 (west)
    expect(doc.recs[3]!.map((p) => r(recordPlacement(3, p, doc, game.master)))).toEqual([[0, 117, 0, 167], [0, 117, 0, -167]]);
    // furniture: direction 2 -> 0°, 0 -> 180°; mapObject 0xBA moves (+30, -20) for direction 2
    const pl = doc.recs[2]!.map((p) => r(recordPlacement(2, p, doc, game.master)));
    expect(pl[1]).toEqual([0, 30, 0, -20]);
    expect(pl[10]).toEqual([180, 0, 0, 0]);
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
  test('adding: chest / gimmick get their own event rows and treasure rows, and export them', async () => {
    const g = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const info = g.code.byName('D01B02001')!;
    const doc = g.doc(info);
    const ev = (await g.eventTable(1))!;
    const rows0 = ev.rows, tg0 = g.master.treasureGroup.rows;
    expect(ev.capacity).toBe(56);
    const ctx = { doc, docs: [doc], events: ev, master: g.master };

    const [s4, i4] = placeStamp(ctx, { type: 'chest' }, 14.5, 12.5);
    const chest = doc.recs[s4]![i4]!;
    const row = chest.raw[0]!;
    expect(row).toBe(rows0);
    expect(ev.kind(row)).toBe(0x0c);
    expect(ev.treasureRow(row)).toBe(tg0);
    const slot = ev.slot(row);
    expect(slot).toBeLessThan(56);
    for (let i = 0; i < rows0; i++) expect(ev.slot(i)).not.toBe(slot);

    const dup = duplicateRecord(ctx, 4, chest);
    expect(dup.raw[0]).toBe(rows0 + 1);
    expect(ev.treasureRow(rows0 + 1)).toBe(tg0 + 1);

    const templates = await gimmickTemplates(g, 1);
    expect(templates.length).toBeGreaterThan(10);
    const t5 = templates.find((t) => t.section === 5 && t.event)!;
    const [s5, i5] = placeStamp(ctx, { type: 'template', t: t5 }, 15.5, 12.5);
    expect(doc.recs[s5]![i5]!.raw[0]).toBe(rows0 + 2);

    const files = buildModFiles(g, [doc], [ev], true);
    expect([...files.keys()].sort()).toEqual(['56562135', '79B881BB', 'A90C8038']);
    const tbl = new GsTable(findByName(parseArchive(files.get('79B881BB')!), 'd01_EventObject.bin')!.body);
    expect(tbl.rows).toBe(rows0 + 3);
    const tgBack = new GsTable(findByName(parseArchive(files.get('56562135')!), 'treasureGroup.bin')!.body);
    expect(tgBack.rows).toBe(tg0 + 2);
    // index: sorted hashes, one per row, then the {0, 0} terminator
    const idx: number[][] = [];
    for (let o = tgBack.indexOffset; o < tgBack.data.length; o += 8) idx.push([tgBack.data[o]! | (tgBack.data[o + 1]! << 8) | (tgBack.data[o + 2]! << 16) | (tgBack.data[o + 3]! << 24) >>> 0]);
    expect(idx.length).toBe(tg0 + 3);
    expect(equalBytes(tgBack.row(5), game.master.treasureGroup.row(5))).toBe(true);
    const db = new MapDb(unpackEntry(parseArchive(files.get('A90C8038')!), parseArchive(files.get('A90C8038')!).entries[g.dbEntry.index]!).body);
    expect(loadDoc(db, info).recs[4]!.length).toBe(game.doc(info).recs[4]!.length + 1);
  });
  test('every vanilla event kind has a name', async () => {
    const missing = new Set<number>();
    for (const d of new Set(game.editableMaps().map((m) => m.dungeon))) {
      const ev = await game.eventTable(d);
      if (ev) for (let i = 0; i < ev.rows; i++) if (!EVENT_KINDS[ev.kind(i)]) missing.add(ev.kind(i));
    }
    expect([...missing]).toEqual([]);
  });

  const MODOUT = `${ELPULSE}/mod/out`;
  test.skipIf(!existsSync(`${MODOUT}/code.ips`))('base MOD (elpulse mod/out): switch patch, switch + gate, package', async () => {
    const files = readdirSync(`${MODOUT}/romfs`).map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(`${MODOUT}/romfs/${n}`)) }));
    files.push({ name: 'code.ips', bytes: new Uint8Array(readFileSync(`${MODOUT}/code.ips`)) });
    const mod = baseModFromFiles('out', files);
    const g = await Game.load(await openImage(Bun.file(CIA), 'cia'), mod);
    expect(g.switchVersion).toBe(1);
    expect(g.master.itemName(34)).toBe('アンテナパワーＳ'); // item MOD's master
    const info = g.code.byName('D01B02001')!;
    const doc = g.doc(info);
    const ev = (await g.eventTable(1))!;
    const ctx = { doc, docs: [doc], events: ev, master: g.master };
    const stamp = { type: 'switchgate' as const, gate: undefined as number | undefined };
    const [s3, i3] = placeStamp(ctx, stamp, 14.5, 10.5); // gate on the tile (14, 10)
    const gateRow = P3.door(doc.recs[s3]![i3]!.raw);
    expect(stamp.gate).toBe(gateRow);
    const [s5, i5] = placeStamp(ctx, stamp, 15.5, 11.5);
    const swRow = doc.recs[s5]![i5]!.raw[0]!;
    expect(ev.kind(swRow)).toBe(KIND_SWITCH);
    expect(ev.table.row(swRow)[8]).toBe(gateRow);
    expect(validate(g, doc, 0, new Map(), ev).filter((i) => i.level === 'error')).toEqual([]);
    const pkg = modPackage(g, buildModFiles(g, [doc], [ev], false));
    expect(pkg.has('exefs/code.ips')).toBe(true);
    expect(pkg.has('romfs/A90C8038') && pkg.has('romfs/79B881BB') && pkg.has('romfs/56562135')).toBe(true);
    expect(equalBytes(pkg.get('romfs/56562135')!, mod.romfs.get('56562135')!)).toBe(true); // untouched base file
  });
});

describe.skipIf(!hasCia)('monsters, encounters and sounds', () => {
  let game: Game;
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  });

  test('monster parameters match elpulse docs/reference/monsters.md', async () => {
    const book = await game.monsters();
    expect(book.monsters.length).toBe(184);
    const m = book.monster(1)!;
    expect(m.name).toBe('カビまんじゅう');
    expect([m.level, m.hp.min, m.hp.max, m.attack.max, m.exp, m.gold]).toEqual([1, 8, 10, 18, 2, 2]);
    expect(m.drops.map((d) => d.rate)).toEqual([3, 5, 10]);
    expect(m.skills[0]!.name).toBe('ぶつかってきた');
    const king = book.monster(15)!;
    expect(king.name).toBe('キングウッキー');
    expect(king.focus).toBe(true);
    expect(book.monster(21)!.nextForm).toBe(20);
  });

  test('map encounter groups (section 6) resolve to monsterGroup rows', async () => {
    const book = await game.monsters();
    expect(book.groups.length).toBe(144);
    const doc = game.doc(game.code.byName('D01B01001')!);
    const { mapEncounters } = await import('../src/game/monsters');
    const enc = mapEncounters(doc);
    const g = book.group(enc.group)!;
    expect(g.row).toBe(6);
    expect(book.groupMonsters(g).map((r) => book.monster(r)!.name)).toContain('カビまんじゅう');
    // every map group hash is in the table
    for (const m of game.editableMaps()) {
      const e = mapEncounters(game.doc(m));
      if (e.group) expect(book.group(e.group)).toBeDefined();
      for (const h of e.cells.keys()) if (h) expect(book.group(h)).toBeDefined();
    }
  });

  test('group edits: slots, copy with a new hash, export and read back', async () => {
    const g2 = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const book = await g2.monsters();
    const g = book.groups[6]!;
    book.setGroupSlots(6, [{ monster: 15, weight: 3, count: 0 }], g.mates);
    expect(book.groups[6]!.leads).toEqual([{ monster: 15, weight: 3, count: 0 }]);
    expect(book.groupChanged(6)).toBe(true);
    const n = book.copyGroup(6);
    expect(n).toBe(144);
    expect(book.groupAdded(n)).toBe(true);
    const copy = book.groups[n]!;
    expect(book.group(copy.hash)).toBe(copy);
    expect(g2.master.changedTables()).toEqual(['monsterGroup.bin']);
    const files = buildModFiles(g2, [], [], g2.master.changed());
    const again = await Game.load(await openImage(Bun.file(CIA), 'cia'), { label: 'x', romfs: new Map([['56562135', files.get('56562135')!]]), ips: null });
    const b2 = await again.monsters();
    expect(b2.groups.length).toBe(145);
    expect(b2.group(copy.hash)!.leads).toEqual([{ monster: 15, weight: 3, count: 0 }]);
    book.revertGroup(6);
    expect(book.groupChanged(6)).toBe(false);
  });

  test('monster edits: fields, drops and skills; export and read back', async () => {
    const g2 = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const book = await g2.monsters();
    const before = book.monster(1)!;
    book.set(1, 'hpMax', 999);
    book.set(1, 'drop0', 2);
    book.set(1, 'rate0', 15);
    book.set(1, 'nextForm', 2);
    book.setSkills(1, [before.skills[0]!.action, 328]);
    const m = book.monster(1)!;
    expect([m.hp.max, m.hp.min, m.level, m.exp]).toEqual([999, before.hp.min, before.level, before.exp]);
    expect(m.dropSlots[0]).toEqual({ item: 2, rate: 15 });
    expect(m.resist).toEqual(before.resist);
    expect(m.skills.map((s) => s.action)).toEqual([before.skills[0]!.action, 328]);
    expect(book.original(1, 'hpMax')).toBe(before.hp.max);
    expect(book.changed(1)).toBe(true);
    const files = buildModFiles(g2, [], [], g2.master.changed());
    const again = await Game.load(await openImage(Bun.file(CIA), 'cia'), { label: 'x', romfs: new Map([['56562135', files.get('56562135')!]]), ips: null });
    const m2 = (await again.monsters()).monster(1)!;
    expect([m2.hp.max, m2.nextForm, m2.dropSlots[0]!.item]).toEqual([999, 2, 2]);
    expect(m2.skills.map((s) => s.action)).toEqual([before.skills[0]!.action, 328]);
    book.revert(1);
    expect(book.changed(1)).toBe(false);
  });

  test('actions: item effects and references', async () => {
    const { ActionBook } = await import('../src/game/actions');
    const book = await game.monsters();
    const actions = new ActionBook(game.master, (r) => book.monster(r)?.name ?? '');
    const { ItemBook } = await import('../src/game/items');
    const potion = new ItemBook(game, new Map()).item(2)!;
    expect(actions.refsOf(potion.action).items.map((i) => i.id)).toContain(2);
    const skill = book.monster(1)!.skills[0]!;
    expect(actions.action(skill.action)!.name).toBe('ぶつかってきた');
    expect(actions.refsOf(skill.action).monsters.map((m) => m.row)).toContain(1);
  });

  test('BGM names from soundData + sound.bcsar', async () => {
    const snd = await game.sounds();
    const s = game.master.sounds(game.code.byName('D01B02001')!);
    expect(snd.name(s.bgm)).toBe('BGM_CAVE');
    expect(snd.name(s.battle)).toBe('BGM_BATTLE_1');
    expect(snd.name(s.steps)).toBe('SE_FLD_STEPS1');
  });

  test('mapData per map: デンパ島のどうくつ inside 海底トンネル (issue #6)', async () => {
    const snd = await game.sounds();
    const m = (name: string) => game.code.byName(name)!;
    // Tunnel floors use the dungeon's mapData row 2 (tileset 1).
    expect(m('D02B02001').mapDataKey).toBe(0);
    expect(game.master.mapDataRow(m('D02B02001'))).toBe(2);
    expect(game.master.tileset(m('D02B02001'))).toBe(1);
    // The cave maps (H01/H02) have their own key -> mapData row 3 (tileset 0 = caveA, another BGM).
    for (const n of ['D02B01H01', 'D02B01H02', 'D02B02H01', 'D02B03H01']) {
      expect(game.master.mapDataRow(m(n))).toBe(3);
      expect(game.master.tileset(m(n))).toBe(0);
      expect(game.tilesetSource(m(n)).modelArchive).toBe(game.tilesetSource(m('D01B02001')).modelArchive);
    }
    expect(game.master.sounds(m('D02B01H01')).bgm).not.toBe(game.master.sounds(m('D02B02001')).bgm);
    expect(snd.name(game.master.sounds(m('D02B01H01')).bgm)).not.toBe(snd.name(game.master.sounds(m('D02B02001')).bgm));
    // The last one leads into 魔王の塔 and already uses its mapData row.
    expect(game.master.mapDataRow(m('D02B03H02'))).toBe(game.master.dungeonMapDataRow(3));
    // Maps without a key of their own keep the dungeon's row.
    for (const i of game.editableMaps())
      if (!i.mapDataKey && !['M01OUT000', 'M04F01AAA', 'M05OUT000'].includes(i.name)) {
        const ref = game.mapRef(i);
        expect(game.master.mapDataRow(ref)).toBe(game.master.dungeonMapDataRow(i.dungeon, ref.indoor));
      }
  });

  test('another tileset loads that tileset\'s models (tileset switch in the inspector)', () => {
    const m = (name: string) => game.code.byName(name)!;
    const cave = m('D01B02001');
    const tunnel = m('D02B02001');
    // Default = the map's own source.
    expect(game.tilesetSource(cave)).toEqual(game.tilesetSource(cave, game.master.tileset(cave)));
    // The cave (tileset 0) shown with the tunnel's tileset 1 uses the tunnel's model archive.
    const other = game.tilesetSource(cave, game.master.tileset(tunnel));
    expect(other.tileset).toBe(game.master.tileset(tunnel));
    expect(other.modelArchive).toBe(game.tilesetSource(tunnel).modelArchive);
    expect(other.modelArchive).not.toBe(game.tilesetSource(cave).modelArchive);
  });

  test('indoor maps use mapGroup +0x27 and have every tile model (issue #14)', async () => {
    const m = (name: string) => game.code.byName(name)!;
    // 港町 (dungeon 20): the town is mapData 21 (tileset 3); its houses (indoor tiles) are mapData 65 (tileset 1).
    expect(isIndoor(game.doc(m('M02F01INN')))).toBe(true);
    expect(game.master.mapDataRow(game.mapRef(m('M02F01INN')))).toBe(65);
    expect(game.master.tileset(game.mapRef(m('M02F01INN')))).toBe(1);
    expect(game.master.mapDataRow(m('M02F01INN'))).toBe(21);
    // Every tile of every indoor map has a model, and the model is in the map's model archive.
    const archives = new Map<string, Set<number>>();
    let indoor = 0;
    for (const info of game.editableMaps()) {
      const doc = game.doc(info);
      if (!isIndoor(doc)) continue;
      indoor++;
      const src = game.tilesetSource(game.mapRef(info, doc));
      if (!archives.has(src.modelArchive))
        archives.set(src.modelArchive, new Set(parseArchive(await game.dump.readRomfs(src.modelArchive)).entries.map((e) => e.hash >>> 0)));
      const have = archives.get(src.modelArchive)!;
      const missing = [...new Set(doc.tiles.map((t) => `${t.kind}/${letterIndex(t.letter)}`))].filter((k) => {
        const [kind, letter] = k.split('/').map(Number);
        const h = game.master.partModel(kind!, src.tileset, letter!);
        return !h || !have.has(h >>> 0);
      });
      expect({ map: info.name, missing }).toEqual({ map: info.name, missing: [] });
    }
    expect(indoor).toBeGreaterThan(40);
  });
});

describe.skipIf(!hasCia)('resistance edits and the item book', () => {
  test('resistance: effect tables, edit, export and read back', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const book = await game.monsters();
    expect(book.battle.multiplier(-9)).toBe(4);
    expect(book.battle.multiplier(0)).toBe(1);
    expect(book.battle.multiplier(9)).toBeCloseTo(0.1, 5);
    expect(book.battle.coefficient(-9)).toBe(200);
    expect(book.battle.coefficient(9)).toBe(0);
    expect(book.battle.chance(0, 0)).toBe(100);
    expect(book.battle.chance(2, 0)).toBe(50);
    // +10: an element is void, an ailment is clamped to +9 (0%)
    expect(book.battle.multiplier(10)).toBe(0);
    expect(book.battle.coefficient(10)).toBe(0);
    expect(book.battle.coefficient(-12)).toBe(200);
    const ham = book.monster(22)!;
    expect(ham.name).toBe('ゴールデンハム');
    expect(ham.resist.slice(0, 8).map((r) => r.value)).toEqual([10, 10, 10, 10, 10, 10, 10, 10]);
    book.setResist(3, 1, 10);
    expect(book.monster(3)!.resist[1]!.value).toBe(10);
    book.setResist(3, 1, -9);
    expect(book.monster(3)!.resist[1]!.value).toBe(-9);
    book.revert(3);
    const m = book.monster(1)!;
    expect(m.resist[0]!.name).toBe('火');
    expect(m.resist[0]!.value).toBe(-6);
    const before = m.resist.map((r) => r.value);
    book.setResist(1, 0, 7);
    book.setResist(1, 24, -9);
    expect(book.monster(1)!.resist[0]!.value).toBe(7);
    expect(book.monster(1)!.resist[24]!.value).toBe(-9);
    // other fields untouched
    expect(book.monster(1)!.resist.map((r, i) => (i === 0 || i === 24 ? before[i] : r.value))).toEqual(before);
    expect(book.monster(1)!.hp.max).toBe(10);
    expect(book.changed(1)).toBe(true);
    expect(game.master.changedTables()).toEqual(['monsterParameter.bin']);
    const files = buildModFiles(game, [], [], game.master.changed());
    const again = await Game.load(await openImage(Bun.file(CIA), 'cia'), { label: 'x', romfs: new Map([['56562135', files.get('56562135')!]]), ips: null });
    const b2 = await again.monsters();
    expect(b2.monster(1)!.resist[0]!.value).toBe(7);
    expect(b2.monster(1)!.resist[24]!.value).toBe(-9);
    book.revert(1);
    expect(book.changed(1)).toBe(false);
    expect(game.master.changedTables()).toEqual([]);
  });

  test('items: names, effects, shops, chests', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { ItemBook, loadShops } = await import('../src/game/items');
    const { chestSources } = await import('../src/pages/items');
    const items = new ItemBook(game, await loadShops(game));
    const potion = items.item(2)!;
    expect(potion.name).toBe('キズぐすり+');
    expect([potion.price, potion.sell, potion.rarity]).toEqual([80, 8, 1]);
    expect(potion.shops).toEqual([1, 5, 6, 7, 10, 11, 17]);
    expect(potion.effect).toStartWith('HP 回復');
    const chests = await chestSources(game, (m) => game.doc(m), (d) => game.eventTable(d));
    expect(chests.size).toBeGreaterThan(20);
    for (const list of chests.values()) for (const c of list) expect(c.chance).toBeGreaterThan(0);
  });

  test('shops: 18 shops with their settings', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { loadShops } = await import('../src/game/items');
    const { buildShops, loadShopTable } = await import('../src/game/shops');
    const shops = buildShops(await loadShops(game), await loadShopTable(game));
    expect(shops.map((s) => s.id)).toEqual([...Array(18).keys()]);
    expect(shops.reduce((a, s) => a + s.items.length, 0) + shops.length).toBe(443); // ShopItem rows
    const fairy = shops[17]!;
    expect(fairy.variant).toBe(2);
    expect(fairy.messages[0]).toBeGreaterThanOrEqual(0xe3);
    expect(fairy.items).toContain(480); // ようせいのはね
    for (const s of shops) expect(s.messages.length).toBe(10);
  });

  test('shop edits are written to both archives, and an unchanged stock rebuilds the same table', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { ShopStock, parseShopItems } = await import('../src/game/shops');
    const stock = (await ShopStock.load(game))!;
    expect(stock.archiveNames()).toEqual(['49A43B63', '1D37838B']);
    const arc = await game.archive('49A43B63');
    const orig = unpackEntry(arc, arc.entries.find((e) => e.hash === 0x67297400)!).body;
    expect(equalBytes(stock.build(), orig)).toBe(true);
    expect(stock.buildArchives().size).toBe(0);
    stock.set(0, [...stock.items(0), 480]);
    expect(stock.saved()).toEqual([[0, [...stock.originalItems(0), 480]]]);
    const files = stock.buildArchives();
    expect([...files.keys()]).toEqual(['49A43B63', '1D37838B']);
    for (const bytes of files.values()) {
      const a = parseArchive(bytes);
      const t = new GsTable(unpackEntry(a, a.entries.find((e) => e.hash === 0x67297400)!).body);
      expect(parseShopItems(t).get(0)).toContain(480);
      expect(t.rows).toBe(444);
    }
    stock.revert(0);
    expect(stock.changed()).toBe(false);
  });

  test('item edits are exported in itemData.bin and can be reverted', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { ItemBook } = await import('../src/game/items');
    const items = new ItemBook(game, new Map());
    const potion = items.item(2)!;
    expect(potion.descriptions[0]!.text).not.toBe('');
    expect(items.itemActions().some((a) => a.row === potion.action)).toBe(true);
    items.set(2, { price: 999, rarity: 4, limit: 20 });
    expect([potion.price, potion.sell, potion.rarity, potion.limit]).toEqual([999, 8, 4, 20]);
    expect(items.changed(2)).toBe(true);
    expect(items.original(2).price).toBe(80);
    expect(game.master.changedTables()).toEqual(['itemData.bin']);
    const files = buildModFiles(game, [], [], game.master.changed());
    const again = await Game.load(await openImage(Bun.file(CIA), 'cia'), { label: 'x', romfs: new Map([['56562135', files.get('56562135')!]]), ips: null });
    const p2 = new ItemBook(again, new Map()).item(2)!;
    expect([p2.price, p2.sell, p2.rarity, p2.limit, p2.name]).toEqual([999, 8, 4, 20, 'キズぐすり+']);
    items.revert(2);
    expect(items.changed(2)).toBe(false);
    expect(potion.price).toBe(80);
    expect(game.master.changedTables()).toEqual([]);
  });
});

describe.skipIf(!hasCia)('monster and item models', () => {
  test('every monster model converts with all its textures', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const book = await game.monsters();
    const { buildComposite } = await import('../src/cgfx/tileset');
    const { MONSTER_MODEL_ARCHIVE } = await import('../src/game/monsters');
    const arc = parseArchive(await game.dump.readRomfs(MONSTER_MODEL_ARCHIVE));
    const seen = new Set<string>();
    let n = 0;
    for (const m of book.monsters) {
      const x = book.modelOf(m);
      if (!x || seen.has(`${x.model}/${x.texture}`)) continue;
      seen.add(`${x.model}/${x.texture}`);
      const set = buildComposite(arc, x.model, x.texture);
      expect(set.errors).toEqual([]);
      const model = set.models.get(x.model)!;
      expect(model.meshes.length).toBeGreaterThan(0);
      for (const mat of model.materials) for (const t of mat.textures) if (t) expect(set.textures.has(t)).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(100);
  });

  test('every item model is in an item model archive', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { ItemBook, itemModelArchive } = await import('../src/game/items');
    const { buildObjects } = await import('../src/cgfx/tileset');
    const items = new ItemBook(game, new Map());
    const models = new Set(items.items.map((i) => i.model).filter((h) => h));
    for (const h of models) {
      const name = await itemModelArchive(game, h);
      expect(name).not.toBeNull();
      const set = buildObjects(await game.dump.readRomfs(name!), [h]).get(h)!;
      expect(set.errors).toEqual([]);
      // clothing patterns (596〜696) are a texture only
      if (set.models.size) expect(set.models.get(h)!.meshes.length).toBeGreaterThan(0);
      else expect(set.textures.size).toBe(1);
    }
  });
});

describe.skipIf(!hasCia)('messages', () => {
  test('every message file rebuilds byte for byte, and an edit is exported', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const texts = game.master.texts;
    expect(texts.files.length).toBeGreaterThan(0);
    for (const f of texts.files) expect(`${f.name} ${f.editable}`).toBe(`${f.name} true`);
    // the text form keeps every message as it is
    const { textToUnits } = await import('../src/game/msgtext');
    for (const f of texts.files)
      for (let id = f.gmsg.first; id <= f.gmsg.last; id++) {
        const orig = f.gmsg.units(id)!;
        if (orig.length && !orig[orig.length - 1]) expect([...textToUnits(texts.text(id)!)]).toEqual([...orig]);
      }
    const id = 0x1c84; // D01 conversation (docs/reference/events.md)
    const before = game.master.message(id)!;
    texts.setText(id, 'テスト\nです');
    const files = buildModFiles(game, [], [], false);
    const { Master } = await import('../src/game/master');
    const re = new Master(files.get('56562135')!);
    expect(before.startsWith('Ď')).toBe(false); // the type code is skipped
    expect(re.message(id)).toBe('テスト です');
    expect(re.message(id + 1)).toBe(game.master.message(id + 1));
  });

  test('story conversations are found through the code', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { STORY_FILE, storyGroups } = await import('../src/game/codemessages');
    const field = game.master.texts.files.find((f) => STORY_FILE.test(f.name))!;
    expect([field.gmsg.first, field.gmsg.last]).toEqual([0x1bdf, 0x21af]);
    const groups = storyGroups(game.code.code, field.gmsg.first, field.gmsg.last);
    // "………おーい。そこのアナタですよう！" (the first meeting) is loaded by FUN_0019B564
    const meet = groups.find((g) => g.ids.includes(0x1c0b))!;
    expect(meet.fn).toBe(0x19b564);
    expect(game.master.texts.plain(0x1c0b)).toContain('そこのアナタですよう');
    const ids = new Set(groups.flatMap((g) => g.ids));
    expect(ids.size).toBeGreaterThan(1000);
    // the D01 conversation is named by an event row, not by the code
    expect(ids.has(0x1c84)).toBe(false);
  });
});

describe.skipIf(!hasCia)('event list (docs/event-list.md)', () => {
  test('scripts: the classes of the D01 switches and the rows they complete', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { eventEntries } = await import('../src/game/eventlist');
    const entries = await eventEntries(game, (m) => game.doc(m), (d) => game.eventTable(d));
    expect(entries.length).toBe(1375);
    const d01 = (row: number) => entries.find((e) => e.dungeon === 1 && e.row === row)!;
    // switch -> door / gate (docs/events.md §5)
    for (const [row, vtable, target] of [[2, 0x4feca4, 10], [3, 0x4fecc4, 11], [4, 0x4fece4, 13], [9, 0x4fec84, 1]] as const) {
      const s = d01(row).scripts;
      expect(s.map((x) => x.cls.vtable)).toEqual([vtable]);
      expect(s[0]!.cls.completes).toEqual([target]);
    }
    // "ありゃ、重さが足りないんですかねえ？" from the switch script
    expect(d01(2).scripts[0]!.cls.messages).toContain(0x1c77);
    const scripts = entries.filter((e) => e.kind === 0x24 && e.places.length);
    expect(scripts.length).toBe(320);
    expect(scripts.filter((e) => e.scripts.length).length).toBeGreaterThanOrEqual(317);
    // appearance: D01 row 36 is gone once 0x91[4] = 2
    expect(d01(36).conditions).toEqual([{ field: 0x4c, type: 0xb0, value: 4, text: '0x91[0x04] = 2' }]);
  });

  test('annotated assembly of a script (D01 row 2: the switch that opens row 10)', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { eventEntries } = await import('../src/game/eventlist');
    const { CodeIndex } = await import('../src/game/scripts');
    const { scriptListing, listingText } = await import('../src/game/scriptasm');
    const entries = await eventEntries(game, (m) => game.doc(m), (d) => game.eventTable(d));
    const e = entries.find((x) => x.dungeon === 1 && x.row === 2)!;
    const index = new CodeIndex(game.code.code, new Set(entries.flatMap((x) => x.scripts.map((s) => s.cls.vtable))));
    const fns = scriptListing({ code: game.code.code, message: (id) => game.master.texts.plain(id) }, index, e.scripts[0]!.cls);
    expect(fns[0]!.addr).toBe(0x258904); // vtable[1]
    expect(fns[0]!.lines.length).toBe(8); // not cut at the push
    const text = listingText(fns);
    expect(text).toContain('bl #0x31aa2c'); // docs/events.md §5: open row 10 with animation 0x53 and sound 0x5C
    expect(text).toContain('行を完了する (行=10)');
    expect(text).toContain('アニメを再生する (s0 = 速さ, s1 = 開始位置) (アニメ=0x53)');
    expect(text).toContain('効果音を鳴らす (番号=0x5C)');
    expect(text).toContain('ありゃ、重さが足りないんですかねえ');
  });

  test('a code patch: the D01 row 2 switch also opens row 11, checked and exported in code.ips', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { eventEntries } = await import('../src/game/eventlist');
    const { buildPatches, patchRecords, applyRecords } = await import('../src/game/patch');
    const { checkPatch } = await import('../src/game/patchcheck');
    const { codeIps } = await import('../src/export/pack');
    const { applyIps } = await import('../src/rom/ips');
    const entries = await eventEntries(game, (m) => game.doc(m), (d) => game.eventTable(d));
    const e = entries.find((x) => x.dungeon === 1 && x.row === 2)!;
    const vtables = entries.flatMap((x) => x.scripts.map((s) => s.cls.vtable));
    const source = '@0x2587A4\n  bl both\n@0x2587AC\n  nop\n@cave both\n  push {r4, lr}\n  mov r0, #10\n  bl FUN_0031AA2C\n  mov r0, #11\n  bl FUN_0031AA2C\n  pop {r4, pc}\n';
    const patch = { id: 'p', title: 'both', source, enabled: true };
    const built = buildPatches(game.dump.code, [patch]);
    const b = built.get('p')!;
    expect(b.errors).toEqual([]);
    const patched = applyRecords(game.dump.code, patchRecords(built.values()));
    const check = checkPatch(patched, b, e, e.raw, vtables);
    expect(check.runs.map((r) => r.result)).toEqual(['returned', 'returned']);
    expect(check.classes![0]!.completes).toEqual([10, 11]);
    // unbalanced stack is caught
    const broken = buildPatches(game.dump.code, [{ ...patch, source: '@cave x\n  push {r4, lr}\n  bx lr\n' }]).get('p')!;
    const run = checkPatch(applyRecords(game.dump.code, patchRecords([broken])), broken).runs[0]!;
    expect(run.result).toBe('stack');
    // export: code.ips holds the patch
    game.codePatches = [patch];
    const ips = codeIps(game)!;
    expect(equalBytes(applyIps(game.dump.code, ips).subarray(0x1587a4, 0x1587b0), patched.subarray(0x1587a4, 0x1587b0))).toBe(true);
    game.codePatches = [];
  });

  test('condition types are read from FUN_0030B8A4', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const { readConditionTypes } = await import('../src/game/conditions');
    const t = readConditionTypes(game.code.code);
    expect(t.get(0x01)).toEqual({ type: 0x01, getter: 'progress', test: 'atLeast', index: 0x33 });
    expect(t.get(0x18)).toEqual({ type: 0x18, getter: 'progress', test: 'atLeast', index: 0 });
    expect(t.get(0x37)?.getter).toBe('rowState');
    expect(t.get(0x3b)).toEqual({ type: 0x3b, getter: 'dungeonFlag', test: 'clear', index: 0x34 });
    expect(t.get(0xad)).toEqual({ type: 0xad, getter: 'flag92', test: 'clear' });
    expect(t.get(0xb0)).toEqual({ type: 0xb0, getter: 'value91', test: 'equals', eq: 2 });
  });
});

describe.skipIf(!hasCia)('world maps (docs/worldmap.md)', () => {
  let game: Game;
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  });

  test('the world table, the entrances of W01 and its terrain', () => {
    const w01 = game.code.world(0xa8654391)!;
    expect(w01.code).toBe('W01');
    expect(game.worldMaps().map((w) => w.code)).toContain('W01');
    for (const h of w01.sections) expect(game.db.has(h)).toBe(true);
    const ents = parseEntrances(game.db.get(w01.sections[2]!));
    expect(ents.length).toBe(54);
    expect(equalBytes(buildEntrances(ents), game.db.get(w01.sections[2]!))).toBe(true);
    // Most entrances lead to a map of the table, at a section 3 point of it.
    const known = ents.filter((r) => game.code.byHash(ENT.destMap(r)));
    expect(known.length).toBeGreaterThan(40);
    for (const r of known) expect(ENT.x(r) >= 0 && ENT.x(r) < WORLD_SIZE && ENT.y(r) >= 0 && ENT.y(r) < WORLD_SIZE).toBe(true);
    expect(game.worldMaps().map((w) => w.code)).toEqual(['W01', 'W02', 'W99']); // W98 has no entrances
    expect(game.worldPartFlags()?.length).toBe(81);
    const g = game.ground(w01)!;
    expect(g).not.toBeNull();
    expect(g.parts.filter((p) => p > 0).length).toBe(10024);
    const flags = game.worldPartFlags()!;
    expect(coveredParts(g, (p) => flags[p] ?? 0).filter((p) => p > 0).length).toBeGreaterThan(10024);
    // Dungeon exits to W01 name one of its entrances.
    const ids = new Set(ents.map(ENT.id));
    const exits = game.code.maps.flatMap((m) => (game.doc(m).recs[3] ?? []).filter((p) => P3.destMap(p.raw) === w01.hash));
    expect(exits.length).toBeGreaterThan(40);
    expect(exits.filter((p) => ids.has(P3.destPoint(p.raw))).length).toBe(exits.length);
  });

  test('unedited entrances change nothing; a moved one is the only change in the map DB', () => {
    const w01 = game.code.world(0xa8654391)!;
    const ents = parseEntrances(game.db.get(w01.sections[2]!));
    expect(equalBytes(buildMapDb(game, [], [[w01.sections[2]!, buildEntrances(ents)]]).db, game.dbBytes)).toBe(true);
    const moved = ents.slice();
    moved[0] = moveEntrance(ents[0]!, ENT.x(ents[0]!) + 1, ENT.y(ents[0]!));
    const { db, changed } = buildMapDb(game, [], [[w01.sections[2]!, buildEntrances(moved)]]);
    expect(changed).toBe(1);
    const back = new MapDb(db);
    expect(ENT.x(parseEntrances(back.get(w01.sections[2]!))[0]!)).toBe(ENT.x(ents[0]!) + 1);
    for (const m of game.code.maps) expect(equalBytes(back.get(m.sections[0]!), game.db.get(m.sections[0]!))).toBe(true);
    const files = buildModFiles(game, [], [], false, [[w01.sections[2]!, buildEntrances(moved)]]);
    expect([...files.keys()]).toEqual(['A90C8038']);
  });
});
