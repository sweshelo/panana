// RPG2's world maps (docs/worldmap.md): the terrain of W01 / W02_ground.bin written back byte for byte, its pools
// recounted (23 x 15 cells), the terrain parts and their models, and an edited terrain in the master of the export.
import { beforeAll, describe, expect, test } from 'bun:test';
import { findByName, findEntry, parseArchive } from '../src/archive/gsarc';
import { Game } from '../src/game/game';
import { buildGround, copyGround, groundPools, parseGround, WORLD_MODEL_ARCHIVE, WORLD_SIZE } from '../src/game/worldmap';
import { openImage } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

describe.skipIf(!hasCia)('RPG2 world maps', () => {
  let game: Game;
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  });

  test('ground.bin goes back byte for byte; the pools are the most cells of a part in 23 x 15', () => {
    for (const w of game.worldMaps().filter((x) => x.groundFile)) {
      const file = findByName(game.master.archive, w.groundFile!)!.body;
      const g = parseGround(file)!;
      expect(buildGround(file, g)).toEqual(file);
      const pools = groundPools(g.parts, 81);
      for (let p = 0; p < 81; p++) expect(pools[p]).toBe(u32(file, u32(file, 8) + p * 4));
    }
  });

  test('worldmapParts: 81 rows, the models are in D98F0E82', async () => {
    const parts = game.worldParts();
    expect(parts.length).toBe(81);
    const arc = parseArchive(await game.dump.readRomfs(WORLD_MODEL_ARCHIVE.toString(16).toUpperCase()));
    const models = parts.filter((p) => p.model);
    expect(models.length).toBeGreaterThan(40);
    for (const p of models) expect(findEntry(arc, p.model), `part ${p.row}`).toBeDefined();
  });

  test('a painted terrain is in the master of the export, with pools large enough', () => {
    const w = game.worldMaps().find((x) => x.code === 'W01')!;
    const g = copyGround(game.ground(w)!);
    // a crowd of one part: its pool must grow
    for (let y = 10; y < 20; y++) for (let x = 10; x < 30; x++) g.parts[y * WORLD_SIZE + x] = 2;
    const file = findByName(game.master.archive, w.groundFile!)!.body;
    const out = buildGround(file, g);
    // 10 x 20 cells: all of them fit in one 23 x 15 window
    expect(u32(out, u32(out, 8) + 2 * 4)).toBe(200);
    game.master.setRawEntry(findByName(game.master.archive, w.groundFile!)!.entry, out);
    expect(game.master.changed()).toBe(true);
    const master = parseArchive(game.master.buildArchive());
    const back = parseGround(findByName(master, w.groundFile!)!.body)!;
    expect(back.parts[15 * WORLD_SIZE + 15]).toBe(2);
    game.master.setRawEntry(findByName(game.master.archive, w.groundFile!)!.entry, file);
    expect(game.master.rawEntries.size).toBe(0);
  });
});
