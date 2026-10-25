// New dungeons (game/newdungeon.ts, docs/integrations/panana/new-map.md §10): the vacant mapGroup row, the dungeon
// table row given to it, the save ranges, the event archive, and the round trip through a base MOD.
// Needs the local dump; skipped when it is missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { Game } from '../src/game/game';
import { CodeBin } from '../src/game/codebin';
import { BASE, MAP_TABLE, MAP_TABLE_ROWS } from '../src/game/codeconst';
import { buildMapPatch, dungeonRows, freeTableRows, readExtension } from '../src/game/mappatch';
import { makeMap } from '../src/game/newmap';
import {
  DUNGEON_LIMIT, MG, SAVE_FLAGS, SAVE_STATES, SAVE_VALUES, codeProblem, dungeonRoom, freeRange, makeDungeon, rowLabel, rowLabels,
  saveSize, slotsNeeded, stateDonor, suggestCode, usedRanges, vacantDungeons,
} from '../src/game/newdungeon';
import { buildModFiles, codeIps, modPackage } from '../src/export/pack';
import { applyIps, buildIps } from '../src/rom/ips';
import { baseModFromFiles, openImage } from '../src/rom/dump';
import { equalBytes, hex8, u16, u32 } from '../src/util/bytes';
import { findByName, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { MASTER_ARCHIVE } from '../src/game/master';
import { MAPDB_ARCHIVE } from '../src/game/mapdb';
import { CIA, hasCia } from './env';

const at = (a: number): number => a - BASE;

/** FUN_002f1f48 / FUN_002f8e1c over the 0x38 rows: the map row and the dungeon of a map. */
function gameRow(code: Uint8Array, map: number): { row: number; dungeon: number } | null {
  for (let d = 0; d < MAP_TABLE_ROWS; d++) {
    const o = at(MAP_TABLE) + d * 16;
    const n = u32(code, o + 8), arr = u32(code, o + 12);
    for (let j = 0; j < n; j++) if (u32(code, at(arr) + j * 0x1c) === map) return { row: arr + j * 0x1c, dungeon: u32(code, o) };
  }
  return null;
}

const RANGE_FIELDS = [[SAVE_STATES, MG.states, MG.stateCount], [SAVE_VALUES, MG.values, MG.valueCount], [SAVE_FLAGS, MG.flags, MG.flagCount]] as const;

describe.skipIf(!hasCia)('new dungeons', () => {
  let game: Game;
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  });

  test('the game has 58 mapGroup rows; row 11 is the vacant one; the dungeon table rows without maps are W01-W99', () => {
    expect(game.master.mapGroup.rows).toBe(DUNGEON_LIMIT);
    expect(game.master.mapGroup.rowSize).toBe(0x2c);
    expect(vacantDungeons(game)).toEqual([11]);
    expect(freeTableRows(game.dump.code)).toEqual([53, 52, 51, 50]);
    expect(dungeonRows(game.dump.code).filter((d) => d.count === 0).map((d) => d.dungeon)).toEqual([0x34, 0x35, 0x36, 0x37]);
    expect(dungeonRoom(game)).toBe(1);
  });

  test('mapGroup: the header labels are the codes of rows 1.. (row 11 = E00)', () => {
    const labels = rowLabels(game.master.mapGroup);
    expect(labels.length).toBe(57);
    expect(rowLabel(game, 1)).toBe('D01');
    expect(rowLabel(game, 57)).toBe('X02');
    expect(rowLabel(game, 11)).toBe('E00');
  });

  test('save ranges: the dungeons fill 0x8E / 0x91 / 0x92 to the end without gaps; row 11 has no slots', () => {
    for (const [key, first, count] of RANGE_FIELDS) {
      const size = saveSize(game, key);
      const used = usedRanges(game, first, count, -1);
      for (let i = 1; i < used.length; i++) expect(used[i]!.first).toBeGreaterThanOrEqual(used[i - 1]!.first + used[i - 1]!.count);
      expect(Math.max(...used.map((u) => u.first + u.count))).toBe(size);
      expect(freeRange(size, used, 1).count).toBe(0);
    }
    expect(game.master.mapGroup.row(11)[MG.stateCount]).toBe(0);
  });

  test('freeRange: the first gap that fits, else the largest', () => {
    expect(freeRange(100, [{ first: 0, count: 10 }, { first: 20, count: 10 }], 5)).toEqual({ first: 10, count: 5 });
    expect(freeRange(100, [{ first: 0, count: 10 }, { first: 20, count: 75 }], 20)).toEqual({ first: 10, count: 10 });
    expect(freeRange(30, [{ first: 0, count: 30 }], 4)).toEqual({ first: 0, count: 0 });
  });

  test('the state donor: some dungeon has unused 0x8E slots at the end of its range', async () => {
    const d = await stateDonor(game, (r) => game.eventTable(r), 11);
    expect(d).not.toBeNull();
    expect(d!.tail.count).toBeGreaterThan(0);
    const t = (await game.eventTable(d!.donor))!;
    expect(slotsNeeded(t)).toBe(d!.need);
    expect(d!.need).toBeGreaterThanOrEqual(t.rows);
  });

  test('codes: D11 is the next dungeon code; existing codes and labels are refused', () => {
    expect(suggestCode(game, 'D', 11)).toBe('D11');
    expect(codeProblem(game, 'D11', 11)).toBe('');
    expect(codeProblem(game, 'D01', 11)).not.toBe('');
    expect(codeProblem(game, 'E01', 11)).not.toBe('');
    expect(codeProblem(game, 'E00', 11)).toBe(''); // the row's own label
    expect(codeProblem(game, 'd1', 11)).not.toBe('');
  });

  test('makeDungeon + first map + export: the game finds the map in dungeon 11; read back as a base MOD', async () => {
    const mg0 = game.master.mapGroup.data.slice();
    const texts0 = game.master.texts.saved();
    const tmpl = game.code.byName('D01B02001')!;
    const nd = await makeDungeon(game, { dungeon: 11, code: 'D11', name: 'テストのどうくつ', template: 1 }, new Set(game.dump.names()), (d) => game.eventTable(d), () => 0.37);
    try {
      // mapGroup row 11 = row 1 but for the archive, the name and the ranges
      const r11 = game.master.mapGroup.row(11), r1 = game.master.mapGroup.row(1);
      for (let o = 0; o < 0x2c; o++) {
        if ((o >= MG.archive && o < MG.archive + 4) || o === MG.name || o === MG.name + 1) continue;
        if ([MG.states, MG.states + 1, MG.stateCount, MG.values, MG.values + 1, MG.valueCount, MG.flags, MG.flags + 1, MG.flagCount].includes(o as never)) continue;
        expect(r11[o]).toBe(r1[o]!);
      }
      expect(hex8(u32(r11, MG.archive))).toBe(nd.archiveName);
      expect(game.dump.names().map((n) => n.toUpperCase())).not.toContain(nd.archiveName);
      expect(game.master.dungeonName(11)).toBe('テストのどうくつ');
      expect(u16(r11, MG.name)).toBe(nd.nameId);
      // 0x8E: the donor's unused tail (the donor keeps what its rows use); no 0x91 / 0x92
      expect(nd.donor).toBeGreaterThan(0);
      const dRow = game.master.mapGroup.row(nd.donor), dOrig = mg0.subarray(game.master.mapGroup.offset + nd.donor * 0x2c);
      expect(dRow[MG.stateCount]).toBe(nd.donorSlots);
      expect({ first: u16(r11, MG.states), count: r11[MG.stateCount]! }).toEqual(nd.ranges[0]!);
      expect(nd.ranges[0]!.first).toBe(u16(dOrig, MG.states) + nd.donorSlots);
      expect(nd.ranges[0]!.first + nd.ranges[0]!.count).toBe(u16(dOrig, MG.states) + dOrig[MG.stateCount]!);
      expect((await game.eventTable(nd.donor))!.capacity).toBe(nd.donorSlots);
      expect([r11[MG.valueCount], r11[MG.flagCount]]).toEqual([0, 0]);
      for (const u of usedRanges(game, MG.states, MG.stateCount, 11)) expect(nd.ranges[0]!.first >= u.first + u.count || nd.ranges[0]!.first + nd.ranges[0]!.count <= u.first).toBe(true);
      expect(rowLabel(game, 11)).toBe('D11');
      // The archive: the template's entries, an empty EventObject table
      const arc = parseArchive(nd.archive);
      expect(hex8(arc.hash)).toBe(nd.archiveName);
      const src = parseArchive(await game.dump.readRomfs(hex8(game.master.eventArchive(1))));
      expect(arc.entries.map((e) => e.hash)).toEqual(src.entries.map((e) => e.hash));
      const ev = arc.entries.map((e) => (e.comp === 1 ? unpackEntry(arc, e) : null)).find((x) => x?.name?.endsWith('_EventObject.bin'))!;
      expect(new GsTable(ev.body).rows).toBe(0);

      game.addedFiles.set(nd.archiveName, nd.archive);
      game.forgetEvents(11);
      game.code.addDungeon({ dungeon: 11, code: nd.code });
      const { info, doc } = makeMap(game, { dungeon: 11, floor: -1, name: 'D11B01001', template: tmpl, templateDoc: game.doc(tmpl), copyTiles: true, newDungeonCode: 'D11' });
      expect(info.dungeonCode).toBe('D11');
      game.code.addMap(info);
      const t = await game.eventTable(11);
      expect(t?.rows).toBe(0);
      expect(t?.capacity).toBe(nd.ranges[0]!.count);

      // code.ips: W99's row (53) now holds dungeon 11 "D11" with the map; every other map as before
      const code = game.dump.code;
      const ips = codeIps(game)!;
      const patched = applyIps(code, ips);
      const g = gameRow(patched, info.hash)!;
      expect(g.dungeon).toBe(11);
      expect(u32(patched, at(MAP_TABLE) + 53 * 16)).toBe(11);
      const cb = new CodeBin(patched);
      expect(cb.dungeons).toEqual([{ dungeon: 11, code: 'D11' }]);
      expect(cb.byHash(info.hash)?.dungeonCode).toBe('D11');
      for (const o of game.code.maps.slice(0, 205)) expect(cb.byHash(o.hash)).toEqual(o);
      expect(readExtension(patched)!.dungeons).toEqual([{ tableRow: 53, dungeon: 11, original: { dungeon: 0x37, name: u32(code, at(MAP_TABLE) + 53 * 16 + 4), count: 0, array: u32(code, at(MAP_TABLE) + 53 * 16 + 12) } }]);
      // rebuilding is idempotent; without the dungeon the table is the game's again
      const again = applyIps(patched, buildIps(buildMapPatch(patched, [{ ...info }], [{ dungeon: 11, code: 'D11' }]).records));
      expect(equalBytes(again, patched)).toBe(true);
      expect(equalBytes(applyIps(patched, buildIps(buildMapPatch(patched, []).records)), code)).toBe(true);

      // The package, loaded as the base MOD
      const pkg = modPackage(game, buildModFiles(game, [doc], [], game.master.changed()));
      expect(pkg.has(`romfs/${nd.archiveName}`)).toBe(true);
      const master = pkg.get(`romfs/${MASTER_ARCHIVE}`)!;
      const mgOut = new GsTable(findByName(parseArchive(master), 'mapGroup.bin')!.body);
      expect(equalBytes(mgOut.row(11), game.master.mapGroup.row(11))).toBe(true);
      expect(equalBytes(mgOut.row(1), mg0.subarray(mgOut.offset + 0x2c, mgOut.offset + 0x58))).toBe(true);
      const mod = baseModFromFiles('export', [
        { name: 'code.ips', bytes: pkg.get('exefs/code.ips')! },
        { name: MASTER_ARCHIVE, bytes: master },
        { name: MAPDB_ARCHIVE, bytes: pkg.get(`romfs/${MAPDB_ARCHIVE}`)! },
        { name: nd.archiveName, bytes: pkg.get(`romfs/${nd.archiveName}`)! },
      ]);
      const g2 = await Game.load(await openImage(Bun.file(CIA), 'cia'), mod);
      expect(g2.code.dungeons).toEqual([{ dungeon: 11, code: 'D11' }]);
      expect(g2.master.dungeonName(11)).toBe('テストのどうくつ');
      expect(g2.code.byName('D11B01001')?.added).toBe(true);
      expect((await g2.eventTable(11))?.rows).toBe(0);
      expect(vacantDungeons(g2)).toEqual([]);
      expect(dungeonRoom(g2)).toBe(0);
      expect(equalBytes(applyIps(g2.dump.code, codeIps(g2)!), g2.dump.code)).toBe(true);
    } finally {
      game.code.removeMaps(game.code.addedMaps().map((m) => m.hash));
      game.code.removeDungeon(11);
      game.addedFiles.clear();
      game.forgetEvents(11);
      game.master.restoreTable('mapGroup.bin', mg0);
      game.master.texts.restore(texts0);
      for (let d = 0; d < game.master.mapGroup.rows; d++) game.forgetEvents(d);
    }
  });
});
