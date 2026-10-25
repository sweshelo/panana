// 初代's world map (src/honolulu/worldmap.ts, naauao honolulu/worldmap.md): PierData of 49C917B7 (an entry without a
// file name, found by its table's name), the pictures of the pier's darc, the edits and their export. The tests with
// the ROM read roms/honolulu-base.cia.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { parseArchive, unpackEntry } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { HonoluluMaster } from '../src/honolulu/master';
import { HonoluluSession } from '../src/honolulu/session';
import { HonoluluWorldmapPage } from '../src/honolulu/WorldmapPage';
import { HONOLULU_PIER_ARCHIVE, HonoluluWorldmap, PIER_STAGES, PierImages, pierStageOf, type PierIsland } from '../src/honolulu/worldmap';
import { readDarc } from '../src/layout/darc';
import { openImage } from '../src/rom/dump';
import { equalBytes } from '../src/util/bytes';
import { hasHonolulu, HONOLULU_BASE } from './env';

/** The ROM's islands (naauao worldmap.md §3): row → dungeon, icon, position (the same at every stage), ship. */
const ROM: [number, number, [number, number], number][] = [
  [2, 59, [28, 30], 1], [3, 58, [-33, -23], 1], [4, 60, [33, -23], 1], [5, 59, [-63, -50], 2], [6, 63, [-50, 42], 2],
  [7, 62, [70, -45], 2], [8, 61, [-80, 5], 2], [9, 63, [-125, -70], 3], [10, 59, [125, -70], 3], [11, 64, [125, 75], 3],
];

const island = (more: Partial<PierIsland>): PierIsland => ({ row: 0, dungeon: 2, icon: 59, at: [[0, 0], [0, 0], [0, 0]], ship: 1, ...more });

describe('初代のワールドマップ (ROM なし)', () => {
  test('the positions of the ship stages', () => {
    expect([0, 1, 2, 3].map((s) => pierStageOf(s).stage)).toEqual([1, 1, 2, 3]);
  });

  test('problems: off the screen, outside the telescope, a dungeon without the star', () => {
    expect(HonoluluWorldmap.problems(island({ at: [[28, 30], [28, 30], [28, 30]] }), 18)).toEqual([]);
    // outside the hole of stage 1 (radius 81), inside stage 2's (108)
    expect(HonoluluWorldmap.problems(island({ at: [[90, 0], [90, 0], [90, 0]] }), 18)).toEqual([expect.stringContaining('望遠鏡の穴 (半径 約 81)')]);
    // an island of stage 3 only: stages 1 and 2 do not matter
    expect(HonoluluWorldmap.problems(island({ ship: 3, at: [[0, 0], [0, 0], [125, 75]] }), 18)).toEqual([]);
    expect(HonoluluWorldmap.problems(island({ ship: 3, at: [[0, 0], [0, 0], [150, 0]] }), 18)).toEqual([expect.stringContaining('画面の外')]);
    expect(HonoluluWorldmap.problems(island({ dungeon: 13 }), 18)).toEqual([expect.stringContaining('星が付きません')]);
    expect(HonoluluWorldmap.problems(island({ icon: 70 }), 18)).toEqual([expect.stringContaining('アイコン 70')]);
  });
});

describe.skipIf(!hasHonolulu)('初代のワールドマップ (ROM)', () => {
  let session: HonoluluSession;
  let original: Uint8Array;
  beforeAll(async () => {
    const dump = await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia');
    session = await HonoluluSession.open(dump);
    original = await dump.readRomfs(HONOLULU_PIER_ARCHIVE);
  });

  test('PierData as the ROM has it', () => {
    const islands = session.worldmap.islands();
    expect(islands.map((it) => [it.dungeon, it.icon, it.at[0], it.ship])).toEqual(ROM);
    for (const it of islands) expect(it.at).toEqual([it.at[0]!, it.at[0]!, it.at[0]!]);
    // every island of the ROM is where it shows
    for (const it of islands) expect(HonoluluWorldmap.problems(it, session.master.rows('dungeonData.bin').rows)).toEqual([]);
  });

  test('the pictures of the pier (darc → BCLIM)', () => {
    const entry = parseArchive(original).entries[0]!;
    const files = readDarc(unpackEntry(parseArchive(original), entry).body);
    expect(files.has('blyt/pier_btm.bclyt')).toBe(true);
    expect([...files.keys()].filter((p) => p.startsWith('timg/island_')).length).toBe(8);
    const im = PierImages.read(session.worldmap.pier);
    expect(im.get('pier_btm_bg')).toMatchObject({ width: 320, height: 240 });
    expect(im.get('telescope_01')).toMatchObject({ width: 320, height: 240 });
    expect(im.icon(58)).toMatchObject({ width: 32, height: 32 });
    expect(im.icon(64)).toMatchObject({ width: 32, height: 48 });
    expect(im.icon(57)).toBeUndefined();
    // the frame's hole: transparent in the middle, opaque in the corner
    const t = im.get('telescope_02')!;
    expect(t.rgba[(124 * 320 + 160) * 4 + 3]).toBe(0);
    expect(t.rgba[3]).toBeGreaterThan(0);
  });

  test('an edit goes into 49C917B7; reverted, nothing is left', () => {
    const wm = session.worldmap;
    expect(session.modFiles().size).toBe(0);
    wm.set(3, 'dungeon', 9);
    wm.set(3, 'icon', 61);
    wm.set(3, 'ship', 3);
    wm.move(3, 1, -100, 60);
    expect(wm.island(3)).toEqual({ row: 3, dungeon: 9, icon: 61, at: [[-63, -50], [-100, 60], [-63, -50]], ship: 3 });
    expect(wm.changed(3)).toBe(true);
    expect(session.changed()).toBe(true);
    const files = session.modFiles();
    expect([...files.keys()]).toEqual([HONOLULU_PIER_ARCHIVE]);
    // the rebuilt archive: PierData with the edit (LZ10 again), the layout as it was
    const arc = parseArchive(files.get(HONOLULU_PIER_ARCHIVE)!);
    const before = parseArchive(original);
    expect(arc.entries.map((e) => [e.hash, e.comp])).toEqual(before.entries.map((e) => [e.hash, e.comp]));
    expect(equalBytes(unpackEntry(arc, arc.entries[0]!).body, unpackEntry(before, before.entries[0]!).body)).toBe(true);
    const pier = new GsTable(unpackEntry(arc, arc.entries[1]!).body);
    expect(pier.name).toBe('PierData');
    expect(pier.rows).toBe(10);
    expect(pier.row(3)).toEqual(wm.rows.row(3));
    // and read back
    const again = new HonoluluWorldmap(new HonoluluMaster(files.get(HONOLULU_PIER_ARCHIVE)!, session.messages.texts, HONOLULU_PIER_ARCHIVE));
    expect(again.island(3)).toEqual(wm.island(3));
    expect(again.island(4)).toEqual(wm.island(4, true));
    // the saved rows put back on a fresh copy
    const saved = wm.pier.saved();
    expect(saved.map(([t, r]) => [t, r])).toEqual([['PierData', 3]]);
    wm.revert(3);
    expect(wm.changed(3)).toBe(false);
    expect(session.changed()).toBe(false);
    wm.pier.restore(saved);
    expect(wm.island(3).dungeon).toBe(9);
    wm.move(3, 'all', -63, -50);
    wm.revert(3);
    expect(session.modFiles().size).toBe(0);
  });

  test('the page: the islands, the stages and the notes', () => {
    const html = renderToString(<HonoluluWorldmapPage session={session} arg="9" />);
    expect(html).toContain('ワールドマップ');
    expect(html).toContain('ガーディアンタワー');
    expect(html).toContain('行 9');
    for (const s of PIER_STAGES) expect(html).toContain(s.label);
    expect(html).toContain('拠点の島から見える 3D の島');
    expect(html).toContain('screen-map');
  });
});
