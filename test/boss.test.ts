// Boss battles (issue #43): the EventObject layout of kind 0x31, monsterFixGroup rows, and the code patch run on
// the ROM's code.bin with the executor (game/arm.ts).
import { beforeAll, describe, expect, test } from 'bun:test';
import { ArmMachine } from '../src/game/arm';
import { BOSS_PATCH, BOSS_PATCH_ID, KIND_BOSS, decodeFix, encodeFix, newBossRecord, newBossRow, readStages, usesBoss, writeStages, type BossStage } from '../src/game/boss';
import { codeIps } from '../src/export/pack';
import { applyIps } from '../src/rom/ips';
import { Game } from '../src/game/game';
import { applyRecords, buildPatches, patchRecords, type BuiltPatch } from '../src/game/patch';
import { buildAction } from '../src/game/scripts';
import { openImage } from '../src/rom/dump';
import { CIA, hasCia } from './env';

describe('boss rows', () => {
  test('stages round trip, unused stages cleared', () => {
    const row = new Uint8Array(0x50).fill(0xee);
    const stages: BossStage[] = [
      { fix: 9, bgm: 0x1b, repeat: false, messages: [0x1f49, 0x1f4a, 0] },
      { fix: 27, bgm: 0, repeat: true, messages: [0, 0, 0x2cf0] },
    ];
    writeStages(row, stages);
    expect(row[0x4d]).toBe(KIND_BOSS);
    expect(row[0x4e]).toBe(KIND_BOSS);
    expect(row[0x4f]).toBe(0);
    expect(row.subarray(0x30, 0x44).every((b) => b === 0)).toBe(true);
    expect(row[0x44]).toBe(0xee); // other fields kept
    expect(readStages(row)).toEqual(stages);
    expect(readStages(newBossRow(0x50, 65))).toEqual([{ fix: 65, bgm: 0x1c, repeat: false, messages: [0, 0, 0] }]);
    expect(() => writeStages(row, [])).toThrow();
  });

  test('range record like the vanilla battle ranges', () => {
    expect([...newBossRecord(70)]).toEqual([70, 0, 0, 0, 0, 0, 0, 0, 9, 2, 1, 1, 0, 0, 0, 0]);
  });

  test('monsterFixGroup rows', () => {
    // row 19 of v1.1.0: 3 monsters
    const r = Uint8Array.from([0x41, 3, 0, 0, 0x9e, 0, 0, 0xd0, 0xa1, 0, 0, 0xd0, 0x9e, 0, 0, 0xd0, 0, 0, 0, 0xd0, 0, 0, 0, 0xd0]);
    const g = decodeFix(r);
    expect(g).toEqual({ flags: 0x341, slots: [{ monster: 0x9e, count: 0 }, { monster: 0xa1, count: 0 }, { monster: 0x9e, count: 0 }] });
    const out = new Uint8Array(24);
    encodeFix(out, g);
    expect(out).toEqual(r);
  });
});

describe.skipIf(!hasCia)('boss patch on code.bin', () => {
  let game: Game;
  let code: Uint8Array;
  let built: BuiltPatch;
  let patched: Uint8Array;
  const G = 0x564638; // pointer to the game's globals
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    code = game.dump.code;
    built = buildPatches(code, [BOSS_PATCH]).get(BOSS_PATCH_ID)!;
    patched = applyRecords(code, patchRecords([built]));
  });

  test('assembles', () => {
    expect(built.errors).toEqual([]);
    // the hooks replace the instructions they were written for
    const before = new Map(built.blocks.filter((b) => b.kind === 'at').map((b) => [b.addr, b.lines[0]!.before]));
    expect(before).toEqual(new Map([[0x1f41dc, 0xe351000b], [0x1ce320, 0xe20140ff], [0x1ce358, 0xe3540000]]));
  });

  test('exported in code.ips only when asked (a boss row exists)', async () => {
    expect(codeIps(game)).toBeNull();
    expect(applyIps(code, codeIps(game, [BOSS_PATCH])!)).toEqual(patched);
    const ev = (await game.eventTable(5))!;
    expect(usesBoss([ev])).toBe(false);
    const saved = ev.data.slice();
    ev.addRow(newBossRow(ev.table.rowSize, 9));
    expect(usesBoss([ev])).toBe(true);
    ev.restore(saved);
  });

  test('a range of kind 0x31 makes the boss action; the other kinds are made as before', () => {
    const ev = new Uint8Array(0x50);
    ev[0x4d] = KIND_BOSS;
    expect(buildAction(patched, 0x1f41c8, 5, 23, ev)?.vtable).toBe(built.labels.get('boss_vtable'));
    expect(buildAction(code, 0x1f41c8, 5, 23, ev)).toBeNull();
    const script = new Uint8Array(0x50);
    script[0x4d] = 0x24;
    for (const [d, row] of [[5, 23], [5, 22], [1, 36]] as const)
      expect(buildAction(patched, 0x1f41c8, d, row, script)?.vtable).toBe(buildAction(code, 0x1f41c8, d, row, script)!.vtable);
  });

  /** Run boss_run for a row in state `state`, its action being stage `stage`. */
  const enter = (state: number, stage: number, args: number[]) => {
    const stubs = new Map([
      [0x31b10c, () => state], // state of the row
      [0x310798, () => 0], // message
      [0x2fc790, () => 0], // fixed battle
    ]);
    const m = new ArmMachine(patched, { stubs });
    const globals = m.alloc(0x1000), obj = m.alloc(0x18), a = m.alloc(0x14);
    m.write(G, globals, 4);
    m.write(obj + 4, 70, 4);
    m.write(obj + 0x10, a, 4);
    m.wb(obj + 0x14, stage);
    args.forEach((b, k) => m.wb(a + k, b));
    m.run(built.labels.get('boss_run')!, [obj]);
    return {
      messages: m.calls.filter((c) => c.target === 0x310798).map((c) => c.args[0]),
      battle: m.calls.filter((c) => c.target === 0x2fc790).map((c) => [c.args[0], c.args[1]]),
      end: m.read(globals + 0xa44, 2),
    };
  };
  const args = (fix: number, bgm: number, flags: number, msgs: number[]): number[] => [fix, bgm, flags, 0, ...msgs.flatMap((v) => [v & 0xff, (v >> 8) & 0xff, 0, 0])];

  test('entering: messages, then the battle; a win will set the state to stage + 1', () => {
    const r = enter(1, 1, args(9, 0, 0, [0x1f49, 0, 0x1f4b]));
    expect(r.messages).toEqual([0x1f49, 0x1f4b]);
    expect(r.battle).toEqual([[9, 0x1c]]);
    expect(r.end).toBe(0x8000 | (2 << 13) | 70);
  });

  test('a repeating stage records nothing; a stage already won does nothing', () => {
    const rep = enter(0, 0, args(27, 0x1d, 1, [0, 0, 0]));
    expect(rep.battle).toEqual([[27, 0x1d]]);
    expect(rep.end).toBe(0);
    const done = enter(1, 0, args(9, 0, 0, [0x1f49, 0, 0]));
    expect(done.messages).toEqual([]);
    expect(done.battle).toEqual([]);
  });

  test('end of battle: the boss word is not a 0x91 index, and a win writes the state', () => {
    const idx = (v: number): number => {
      const m = new ArmMachine(patched);
      m.run(built.labels.get('boss_end_index')!, [0, v]);
      return m.r[4]!;
    };
    expect(idx(0x10)).toBe(0x10); // the game's own (0x91[0x10] = 2)
    expect(idx(0x8000 | (1 << 13) | 70)).toBe(0);

    const win = (v: number) => {
      const stubs = new Map([[0x30b788, () => 5], [0x3048f8, () => 0]]);
      const m = new ArmMachine(patched, { stubs });
      const globals = m.alloc(0x1000);
      m.write(0, globals, 4); // r8 = 0 -> [r8] = the globals
      m.write(globals + 0xa44, v, 2);
      m.run(built.labels.get('boss_end_win')!, []);
      return m.calls.filter((c) => c.target === 0x3048f8).map((c) => c.args.slice(0, 3));
    };
    expect(win(0x8000 | (3 << 13) | 70)).toEqual([[5, 70, 3]]);
    expect(win(0x10)).toEqual([]);
  });
});
