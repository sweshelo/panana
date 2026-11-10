// The automap of the new dungeons (game/automap.ts): the choice of the slot to share, the patch on a blank code.bin and,
// when the ROM is there, FUN_002f8cb0 of the ROM's code.bin run with the executor (game/arm.ts).
import { beforeAll, describe, expect, test } from 'bun:test';
import { ArmMachine } from '../src/game/arm';
import { disassemble } from '../src/game/disasm';
import { Game } from '../src/game/game';
import { applyRecords, buildPatches, patchRecords, type BuiltPatch } from '../src/game/patch';
import {
  AUTOMAP_PATCH_ID,
  AUTOMAP_SITES,
  automapHosts,
  automapPatchSource,
  automapProblem,
  hasAutomapSlot,
} from '../src/game/automap';
import { openImage } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

const BLANK = new Uint8Array(0x420000);
const DUNGEON = 0x30b788;
const at = (code: Uint8Array, a: number) => disassemble(u32(code, a - 0x100000), a);
const build = (code: Uint8Array, source: string): { built: BuiltPatch; code: Uint8Array } => {
  const built = buildPatches(code, [{ id: AUTOMAP_PATCH_ID, title: '', source, enabled: true }]).get(AUTOMAP_PATCH_ID)!;
  return { built, code: applyRecords(code, patchRecords([built])) };
};

describe('automap slots', () => {
  test('the dungeons with a slot of their own', () => {
    expect([0, 1, 10, 11, 14, 15, 18, 19, 0x1b, 0x1c, 0x1d, 0x1e].map(hasAutomapSlot)).toEqual([
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  test('a new dungeon shares the slot with the fewest maps (the lower ID on a tie); two new ones spread', () => {
    const maps = new Map([
      [1, 2],
      [2, 12],
      [0x1c, 1],
      [0x1d, 1],
      [11, 3],
      [12, 1],
    ]);
    const count = (d: number) => maps.get(d) ?? 5;
    expect([...automapHosts([11], count)]).toEqual([[11, 0x1c]]);
    expect([...automapHosts([12, 11], count)]).toEqual([
      [11, 0x1c],
      [12, 0x1d],
    ]);
    expect([...automapHosts([5], count)]).toEqual([]); // has its own
    expect(automapPatchSource(new Map())).toBeNull();
  });
});

describe('automap patch (blank code.bin)', () => {
  let built: BuiltPatch;
  let code: Uint8Array;
  beforeAll(() => ({ built, code } = build(BLANK, automapPatchSource(new Map([[11, 1]]))!)));

  test('assembles: both calls go to the cave', () => {
    expect(built.errors).toEqual([]);
    const fn = built.labels.get('automap_dungeon')!;
    for (const a of AUTOMAP_SITES) expect(at(code, a).target).toBe(fn);
    expect(automapProblem(BLANK)).toMatch(/0x2F8CD4・0x40269C/);
  });

  test('the new dungeon becomes the host, other IDs stay', () => {
    const fn = built.labels.get('automap_dungeon')!;
    const run = (id: number) => new ArmMachine(code, { stubs: new Map([[DUNGEON, () => id]]) }).run(fn, [0x1234]);
    expect([run(11), run(1), run(5), run(0x34), run(12)]).toEqual([1, 1, 5, 0x34, 12]);
  });
});

/** FUN_002f8cb0 of `code`: the automap record of the map on dungeon `id` (r0 = the save, slot pointers at +0x410). */
function recordOf(code: Uint8Array, id: number): number {
  const m = new ArmMachine(code, {
    stubs: new Map([
      [0x309330, () => 0], // the kind of map (2 = none)
      [DUNGEON, () => id],
      [0x319170, () => 0xabcdef01], // the map hash
      [0x2f8d40, (mm: ArmMachine) => mm.r[0]!], // (falls through into) the search of the slot's records: the slot pointer here
    ]),
  });
  const save = m.alloc(0x500);
  for (let s = 0; s < 16; s++) m.write(save + 0x410 + s * 4, 0x7000 + s, 4);
  return m.run(0x2f8cb0, [save]);
}

describe.skipIf(!hasCia)('automap patch on code.bin', () => {
  let game: Game;
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  });

  test("the game's calls where the patch goes; ID 11 has no slot, D01 slot 0, S06 slot 15", () => {
    const code = game.dump.code;
    expect(automapProblem(code)).toBeNull();
    for (const a of AUTOMAP_SITES) expect(at(code, a).target).toBe(DUNGEON);
    expect(at(code, 0x4026a8).target).toBe(0x2f8de0); // the lower screen: FUN_002f8de0 of that ID
    expect(recordOf(code, 11)).toBe(0);
    expect(recordOf(code, 1)).toBe(0x7000);
    expect(recordOf(code, 0x1d)).toBe(0x7000 + 15);
  });

  test('with the patch, ID 11 gets the slot of its host; the others are as before', () => {
    const { built, code } = build(game.dump.code, automapPatchSource(new Map([[11, 0x1c]]))!);
    expect(built.errors).toEqual([]);
    expect(recordOf(code, 11)).toBe(0x7000 + 14);
    for (const [id, slot] of [
      [1, 0],
      [10, 9],
      [0x0f, 10],
      [0x12, 13],
      [0x1c, 14],
      [0x1d, 15],
    ] as const)
      expect(recordOf(code, id)).toBe(0x7000 + slot);
    expect(recordOf(code, 12)).toBe(0);
    expect(recordOf(code, 0x34)).toBe(0);
  });
});
