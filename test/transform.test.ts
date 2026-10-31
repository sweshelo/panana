// The patch "見た目の変わる変身" (src/game/transform.ts) against the RPG2 dump. Skipped without it.
import { describe, expect, test } from 'bun:test';
import { Game } from '../src/game/game';
import { openImage } from '../src/rom/dump';
import { buildPatches } from '../src/game/patch';
import { BOSS_PATCH } from '../src/game/boss';
import { MONSTER_ROWS_PATCH } from '../src/game/monsters';
import { ITEM_ACTION_PATCH } from '../src/game/items';
import { BGM_EXT_PATCH } from '../src/game/bgmext';
import { levelStealthPatch } from '../src/game/levelstealth';
import { TRANSFORM_PATCH, TRANSFORM_PATCH_ID, lookChanges, needsTransformPatch } from '../src/game/transform';
import { CIA, hasCia } from './env';

describe.skipIf(!hasCia)('RPG2: transformations that change the model', () => {
  test('the game\'s own transformations keep the design; one into another design needs the patch', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    expect(lookChanges(game.master)).toEqual([]);
    expect(needsTransformPatch(game.master)).toBe(false);
    const mp = game.master.table('monsterParameter.bin');
    // まおう 44 → 45 (next form) and たからばこぞう 20 → 21 (skill #583) into a row of another design
    mp.row(45)[0x4c] = 141;
    mp.row(21)[0x4c] = 112;
    expect(lookChanges(game.master)).toEqual([
      { from: 20, to: 21, by: 583 },
      { from: 21, to: 20, by: 'next' },
      { from: 21, to: 20, by: 586 },
      { from: 44, to: 45, by: 'next' },
      { from: 45, to: 46, by: 'next' },
    ]);
    expect(needsTransformPatch(game.master)).toBe(true);
  });

  test('the patch: the instructions it replaces, and it builds with the other patches of the export', async () => {
    const game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const built = buildPatches(game.dump.code, [BOSS_PATCH, MONSTER_ROWS_PATCH, ITEM_ACTION_PATCH, BGM_EXT_PATCH, levelStealthPatch(), TRANSFORM_PATCH]);
    for (const b of built.values()) expect(b.errors).toEqual([]);
    const at = built.get(TRANSFORM_PATCH_ID)!.blocks.filter((b) => b.kind === 'at');
    // cmp r8, #0 in FUN_00289524; the mov after getting the transformed unit's display in the 7 performances; beq in FUN_0022e498
    expect(at.map((b) => [b.addr, b.lines.map((l) => l.before)])).toEqual([
      [0x2895e0, [0xe3580000]],
      [0x22fd68, [0xe1a06000]],
      [0x230e70, [0xe1a04000]],
      [0x2517f4, [0xe1a06000]],
      [0x25243c, [0xe1a04000]],
      [0x2531cc, [0xe1a06000]],
      [0x254530, [0xe1a04000]],
      [0x256874, [0xe1a04000]],
      [0x22e6e4, [0x0a000002]],
    ]);
  });
});
