// New maps (issue #19, docs/new-map.md): the code.ips that extends the code.bin tables, the map DB entries, and the
// round trip through a base MOD. Needs the local dump; skipped when it is missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { Game } from '../src/game/game';
import { CodeBin } from '../src/game/codebin';
import { BASE, MAP_SECTIONS, MAP_SECTIONS_ROWS, MAP_TABLE, MAP_TABLE_ROWS } from '../src/game/codeconst';
import { MapDb } from '../src/game/mapdb';
import { EXT_HEADER, HOOK_ADDR, HOOK_SITE, SPILL, buildMapPatch, readExtension, type AddedMap } from '../src/game/mappatch';
import { addableDungeons, makeMap, suggestName } from '../src/game/newmap';
import { sectionBytes } from '../src/game/sections';
import { buildMapDb, buildModFiles, codeIps, modPackage } from '../src/export/pack';
import { appendIps, applyIps, buildIps } from '../src/rom/ips';
import { baseModFromFiles, openImage } from '../src/rom/dump';
import { equalBytes, u32 } from '../src/util/bytes';
import { unpackEntry, parseArchive, findEntry } from '../src/archive/gsarc';
import { MAPDB_ENTRY } from '../src/game/mapdb';
import { CIA, hasCia } from './env';

const at = (a: number): number => a - BASE;

/** FUN_002d9b18 (+ the hook): section k of a map, as the game finds it. */
function gameSection(code: Uint8Array, map: number, k: number): number | null {
  for (let i = 0; i < MAP_SECTIONS_ROWS; i++) if (u32(code, at(MAP_SECTIONS) + i * 40) === map) return u32(code, at(MAP_SECTIONS) + i * 40 + k * 4);
  if (u32(code, at(HOOK_SITE)) !== 0xea000000 + (((HOOK_ADDR - HOOK_SITE - 8) >> 2) & 0xffffff)) return null;
  const h = u32(code, at(u32(code, at(HOOK_ADDR) + 0x34))); // the hook's literal -> header
  expect(h).toBe(0x504d4e50);
  const n = u32(code, at(EXT_HEADER) + 8), p = u32(code, at(EXT_HEADER) + 12);
  for (let i = 0; i < n; i++) if (u32(code, at(p) + i * 40) === map) return u32(code, at(p) + i * 40 + k * 4);
  return null;
}

/** FUN_002f1f48 / FUN_002f8e1c: the map row and the dungeon of a map. */
function gameRow(code: Uint8Array, map: number): { row: number; dungeon: number } | null {
  for (let d = 0; d < MAP_TABLE_ROWS; d++) {
    const o = at(MAP_TABLE) + d * 16;
    const n = u32(code, o + 8), arr = u32(code, o + 12);
    for (let j = 0; j < n; j++) if (u32(code, at(arr) + j * 0x1c) === map) return { row: arr + j * 0x1c, dungeon: u32(code, o) };
  }
  return null;
}

/** FUN_002d9a4c: lower_bound over the index (unsigned), then the entry there. */
function gameDbEntry(db: Uint8Array, hash: number): number {
  const n = u32(db, 0);
  let lo = 0, len = n;
  while (len > 0) {
    const half = len >> 1;
    if (u32(db, 4 + (lo + half) * 12) < hash) {
      lo += half + 1;
      len -= half + 1;
    } else len = half;
  }
  return lo < n ? u32(db, 4 + lo * 12) : -1;
}

const spec = (i: number, dungeon: number, floor: number): AddedMap => ({
  hash: 0x12345600 + i,
  sections: Array.from({ length: 10 }, (_, k) => 0x12345600 + i + k * 0x100000),
  name: `T${String(i).padStart(2, '0')}B${String(-floor).padStart(2, '0')}001`,
  dungeon,
  floor,
  mapDataKey: 0,
  extra: 3,
});

describe.skipIf(!hasCia)('new maps (docs/new-map.md)', () => {
  let game: Game;
  let code: Uint8Array;
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    code = game.dump.code;
  });

  test('the vanilla code.bin has no extension, and the free areas are what the patch expects', () => {
    expect(readExtension(code)).toBeNull();
    expect(code.subarray(at(EXT_HEADER), at(0x511000)).every((b) => b === 0)).toBe(true);
    expect(code.subarray(at(HOOK_ADDR), at(0x4c0000)).every((b) => b === 0)).toBe(true);
    expect(u32(code, at(HOOK_SITE))).toBe(0xe3e00000);
    const keys = code.subarray(at(0x4c1738), at(0x4c1738) + 205 * 4);
    for (const s of SPILL) expect(equalBytes(code.subarray(at(s), at(s) + 205 * 4), keys)).toBe(true);
  });

  test('one map in D01: the game finds its sections and its row; the other maps are unchanged', () => {
    const m = spec(1, 1, -3);
    const patched = applyIps(code, buildIps(buildMapPatch(code, [m]).records));
    expect(patched.length).toBe(code.length);
    for (let k = 0; k < 10; k++) expect(gameSection(patched, m.hash, k)).toBe(m.sections[k]!);
    const r = gameRow(patched, m.hash)!;
    expect(r.dungeon).toBe(1);
    expect(u32(patched, at(r.row) + 4) | 0).toBe(-3);
    expect(u32(patched, at(r.row) + 0x10)).toBe(u32(code, at(0x4c681c))); // mapData key "none"
    const cb = new CodeBin(patched);
    expect(cb.maps.length).toBe(206);
    const info = cb.byHash(m.hash)!;
    expect({ name: info.name, dungeon: info.dungeon, floor: info.floor, added: info.added, sections: info.sections }).toEqual({
      name: m.name, dungeon: 1, floor: -3, added: true, sections: m.sections,
    });
    // Every original map: same sections, same row contents (with the key it gets at run time), same info.
    for (const o of game.code.maps) {
      for (let k = 0; k < 10; k++) expect(gameSection(patched, o.hash, k)).toBe(o.sections[k]!);
      const a = gameRow(code, o.hash), b = gameRow(patched, o.hash);
      if (!a) continue;
      expect(b!.dungeon).toBe(a.dungeon);
      expect(cb.byHash(o.hash)).toEqual(o);
    }
  });

  test('rebuilding from the patched code.bin is idempotent, and no maps restores the vanilla bytes', () => {
    const maps = [spec(1, 1, -3), spec(2, 8, -13), spec(3, 1, -4)];
    const p1 = applyIps(code, buildIps(buildMapPatch(code, maps).records));
    const p2 = applyIps(p1, buildIps(buildMapPatch(p1, maps).records));
    expect(equalBytes(p1, p2)).toBe(true);
    const back = applyIps(p1, buildIps(buildMapPatch(p1, []).records));
    expect(equalBytes(back, code)).toBe(true);
    // Removing one map of a dungeon keeps the others.
    const p3 = applyIps(p1, buildIps(buildMapPatch(p1, [maps[0]!]).records));
    expect(new CodeBin(p3).addedMaps().map((m) => m.name)).toEqual([maps[0]!.name]);
    expect(gameRow(p3, maps[1]!.hash)).toBeNull();
  });

  test('many maps in every dungeon spill into the unused key arrays and still read back', () => {
    const dungeons = addableDungeons(game).map((d) => d.dungeon);
    const maps = dungeons.map((d, i) => spec(i, d, -1)); // 52 section rows fill most of the .rodata padding
    const patch = buildMapPatch(code, maps);
    const p = applyIps(code, buildIps(patch.records));
    expect(patch.records.some(([o]) => o === at(SPILL[0]!))).toBe(true);
    const cb = new CodeBin(p);
    expect(cb.addedMaps().length).toBe(maps.length);
    for (const m of maps) {
      expect(gameRow(p, m.hash)!.dungeon).toBe(m.dungeon);
      expect(gameSection(p, m.hash, 9)).toBe(m.sections[9]!);
    }
    for (const o of game.code.maps) expect(cb.byHash(o.hash)).toEqual(o);
    expect(equalBytes(applyIps(p, buildIps(buildMapPatch(p, []).records)), code)).toBe(true);
  });

  test('IPS: appended records win over the base, and the base is kept', () => {
    const base = buildIps([[0x100, Uint8Array.of(1, 2, 3)], [0x200, Uint8Array.of(9)]]);
    const both = appendIps(base, [[0x101, Uint8Array.of(7)]]);
    const out = applyIps(new Uint8Array(0x300), both);
    expect([...out.subarray(0x100, 0x103)]).toEqual([1, 7, 3]);
    expect(out[0x200]).toBe(9);
  });

  test('makeMap + export: code.ips and map DB entries the game can find, read back as a base MOD', async () => {
    const tmpl = game.code.byName('D01B02001')!;
    const tdoc = game.doc(tmpl);
    expect(suggestName(game, 'D01', -3)).toBe('D01B03001');
    const { info, doc } = makeMap(game, { dungeon: 1, floor: -3, name: 'D01B03001', template: tmpl, templateDoc: tdoc, copyTiles: true }, () => 0.25 + Math.random() * 0.5);
    expect(sectionBytes(doc, 6)).toEqual(tdoc.sec6Header);
    expect(doc.tiles.length).toBe(tdoc.tiles.length);
    game.code.addMap(info);
    try {
      const { db } = buildMapDb(game, [doc]);
      for (let k = 0; k < 10; k++) expect(gameDbEntry(db, info.sections[k]!)).toBe(info.sections[k]!);
      const newDb = new MapDb(db);
      expect(newDb.count).toBe(game.db.count + 10);
      expect(equalBytes(newDb.get(info.sections[0]!), sectionBytes(doc, 0))).toBe(true);
      for (const o of game.code.maps.slice(0, 205)) expect(gameDbEntry(db, o.sections[0]!)).toBe(o.sections[0]!);

      const ips = codeIps(game)!;
      const pkg = modPackage(game, buildModFiles(game, [doc], [], false));
      expect(equalBytes(pkg.get('exefs/code.ips')!, ips)).toBe(true);
      // Load the export as the base MOD: the map is there (from the extension), with its sections.
      const mod = baseModFromFiles('export', [
        { name: 'code.ips', bytes: ips },
        { name: 'A90C8038', bytes: pkg.get('romfs/A90C8038')! },
      ]);
      const g2 = await Game.load(await openImage(Bun.file(CIA), 'cia'), mod);
      const again = g2.code.byName('D01B03001')!;
      expect(again.added).toBe(true);
      expect(again.sections).toEqual(info.sections);
      expect(g2.editableMaps().some((m) => m.hash === info.hash)).toBe(true);
      expect(g2.doc(again).tiles.length).toBe(tdoc.tiles.length);
      const arc = parseArchive(pkg.get('romfs/A90C8038')!);
      expect(unpackEntry(arc, findEntry(arc, MAPDB_ENTRY)!).body.length).toBeGreaterThan(game.dbBytes.length);
      // Exporting again from that base rebuilds the same tables (the base's extension is replaced, not doubled).
      expect(equalBytes(applyIps(g2.dump.code, codeIps(g2)!), g2.dump.code)).toBe(true);
    } finally {
      game.code.removeMaps([info.hash]);
    }
  });
});
