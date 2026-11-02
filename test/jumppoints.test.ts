// The destinations of "ジャンプ" (game/jumppoints.ts): the rows, the checks of the rows that follow their entrance, and
// the patch, run with the executor (game/arm.ts) on a blank code.bin and, when the ROM is there, on FUN_00265f1c's
// own loop of the ROM's code.bin.
import { beforeAll, describe, expect, test } from 'bun:test';
import { ArmMachine } from '../src/game/arm';
import { disassemble } from '../src/game/disasm';
import { Game } from '../src/game/game';
import { CAVE_START, applyRecords, buildPatches, patchRecords, type BuiltPatch } from '../src/game/patch';
import {
  JP, JUMP_GAME_ROWS, JUMP_MAX_ROWS, JUMP_PATCH_ID, JUMP_ROW_SIZE, JUMP_TABLE, NEVER, jumpChecks, jumpPatch, jumpPatchSource, jumpRowOf, newJumpRow, setJumpFollows, type JumpCheck,
} from '../src/game/jumppoints';
import { ENT, parseEntrances } from '../src/game/worldmap';
import { openImage } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

const BLANK = new Uint8Array(0x420000);
const COND = 0x30b8a4;
const rowsOf = (n: number, f: (i: number) => Uint8Array = (i) => newJumpRow(100 + i, 0x1000 + i, 0, false)): Uint8Array[] => Array.from({ length: n }, (_, i) => f(i));

describe('jump rows', () => {
  test('fields, a new row, the Panana flag', () => {
    const r = newJumpRow(94, 0x13befa50, 1, true);
    expect(r.length).toBe(JUMP_ROW_SIZE);
    expect([JP.name(r), JP.id(r), JP.world(r), JP.hidden(r), JP.follows(r)]).toEqual([94, 0x13befa50, 1, false, true]);
    setJumpFollows(r, false);
    expect(JP.follows(r)).toBe(false);
    expect([...r.subarray(0x0c)]).toEqual([0, 0xd0, 0xd0, 0xd0]); // +0x0C clear, the padding as in the game's rows
  });

  test('the row of an entrance (row 0 is "なし"; W01 and W02 apart)', () => {
    const rows = [newJumpRow(0, 5, 0, false), newJumpRow(1, 5, 0, false), newJumpRow(2, 7, 1, false)];
    expect(jumpRowOf(rows, 0, 5)).toBe(1);
    expect(jumpRowOf(rows, 1, 7)).toBe(2);
    expect(jumpRowOf(rows, 0, 7)).toBe(-1);
  });

  test('checks: conditions of the entrance row; a missing entrance never listed; an always-placed one not checked', () => {
    const rows = rowsOf(6, (i) => newJumpRow(i, 0x100 + i, 0, i >= 2));
    const ev = new Uint8Array(0x50);
    ev[0x4b] = 0xb0;
    ev[0x00] = 0x0e;
    ev[0x4c] = 0x37;
    ev[0x04] = 1;
    const ents = new Map([[0x102, 30], [0x103, 0], [0x105, 31]]);
    const { checks, missing } = jumpChecks(rows, (_w, id) => (ents.has(id) ? { event: ents.get(id)! } : null), (_w, row) => (row === 30 ? ev : null));
    expect(checks).toEqual([
      { row: 2, show: [0xb0, 0x0e], hide: [0x37, 1] },
      { row: 4, show: [NEVER, 0], hide: [0, 0] },
    ]);
    expect(missing).toEqual([5]);
  });

  test('no patch for the game\'s table as it is', () => {
    expect(jumpPatchSource(JUMP_GAME_ROWS, [])).toBeNull();
    expect(jumpPatch(rowsOf(JUMP_GAME_ROWS), () => ({ event: 0 }), () => null).patch).toBeNull();
  });
});

const build = (code: Uint8Array, source: string): { built: BuiltPatch; code: Uint8Array } => {
  const built = buildPatches(code, [{ id: JUMP_PATCH_ID, title: '', source, enabled: true }]).get(JUMP_PATCH_ID)!;
  return { built, code: applyRecords(code, patchRecords([built])) };
};
const at = (code: Uint8Array, a: number) => disassemble(u32(code, a - 0x100000), a);

describe('jump patch (blank code.bin)', () => {
  const checks: JumpCheck[] = [
    { row: 3, show: [0xb0, 0x0e], hide: [0, 0] },
    { row: 38, show: [0, 0], hide: [0x20, 3] },
    { row: 39, show: [NEVER, 0], hide: [0, 0] },
  ];
  let built: BuiltPatch;
  let code: Uint8Array;
  beforeAll(() => ({ built, code } = build(BLANK, jumpPatchSource(JUMP_MAX_ROWS, checks)!)));

  test('assembles: 40 rows, the hook to the cave and back', () => {
    expect(built.errors).toEqual([]);
    expect(at(code, 0x265f58).text).toMatch(/mov r0, #0x1e0/i);
    expect(at(code, 0x266070).text).toMatch(/cmp r4, #(0x28|40)\b/i);
    expect(at(code, 0x3047c8).text).toMatch(/cmp r5, #(0x28|40)\b/i);
    const hook = built.labels.get('jp_hook')!;
    expect(at(code, 0x26600c).target).toBe(hook);
    // first the game's own skip, on the flags the game set
    expect(at(code, hook).text).toMatch(/^beq/);
    expect(at(code, hook).target).toBe(0x26606c);
  });

  test('a row is listed when its conditions let it; rows without a check always', () => {
    const listed = (row: number, holds: (type: number, value: number) => boolean): number => {
      const m = new ArmMachine(code, { stubs: new Map([[COND, (mm: ArmMachine) => (mm.r[1]! < 0xb6 && holds(mm.r[1]!, mm.r[2]!) ? 1 : 0)]]) });
      return m.run(built.labels.get('jp_listed')!, [row]);
    };
    expect(listed(1, () => false)).toBe(1); // no check
    expect(listed(3, (t, v) => t === 0xb0 && v === 0x0e)).toBe(1);
    expect(listed(3, () => false)).toBe(0);
    expect(listed(38, () => false)).toBe(1); // only "gone when" (the ending): not reached yet
    expect(listed(38, (t, v) => t === 0x20 && v === 3)).toBe(0);
    expect(listed(39, () => true)).toBe(0); // its entrance is gone
  });

  test('only the row count, without checks', () => {
    const { built: b, code: c } = build(BLANK, jumpPatchSource(39, [])!);
    expect(b.errors).toEqual([]);
    expect(at(c, 0x265f58).text).toMatch(/mov r0, #0x1d4/i);
    expect(u32(c, 0x26600c - 0x100000)).toBe(0); // the hook is not written
  });
});

/**
 * FUN_00265f1c's loop of the ROM, run from 0x265F38 to 0x266078 (a `bx lr` put there): the list it makes from
 * `rows`, with `visited` rows' 0x65 bits set and FUN_0030b8a4 answering `holds`.
 */
function listOf(code: Uint8Array, rows: Uint8Array[], visited: (row: number) => boolean, holds: (type: number, value: number) => boolean): number[][] {
  // a trampoline at the bottom of the code cave: push {lr}; b 0x265F38, and pop {pc} at 0x266078 (the part
  // of the function run here has no prologue of its own; its calls change lr)
  const c = code.slice();
  const put = (a: number, w: number): void => c.set([w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, w >>> 24], a - 0x100000);
  const TRAMP = CAVE_START; // the bottom of the cave (patches fill it from the top)
  put(TRAMP, 0xe52de004); // push {lr}
  put(TRAMP + 4, (0xea000000 | (((0x265f38 - (TRAMP + 4 + 8)) >> 2) & 0xffffff)) >>> 0); // b 0x265F38
  put(0x266078, 0xe49df004); // pop {pc}
  let header = 0;
  let table = 0;
  const stubs = new Map<number, (m: ArmMachine) => number>([
    [0x33d690, (m) => (header = m.alloc(8))],
    [0x33c398, (m) => m.alloc(m.r[0]!)],
    [0x31cfb8, (m) => table + 4 + m.r[1]! * JUMP_ROW_SIZE], // the row (r1)
    [0x304adc, (m) => (m.write(m.r[3]!, visited(m.r[2]!) ? 1 : 0, 4), 0)], // 0x65[r2] -> [r3]
    [0x3129bc, () => 0],
    [0x31c3d8, () => 1], // (0x34, 2): 黄泉の門 open
    [COND, (m) => (m.r[1]! < 0xb6 && holds(m.r[1]!, m.r[2]!) ? 1 : 0)],
  ]);
  const m = new ArmMachine(c, { stubs, maxDepth: 4 });
  const master = m.alloc(0x800);
  table = m.alloc(4 + rows.length * JUMP_ROW_SIZE);
  m.write(table, rows.length, 4);
  rows.forEach((r, i) => r.forEach((b, k) => m.wb(table + 4 + i * JUMP_ROW_SIZE + k, b)));
  m.write(0x520448, master, 4);
  m.write(master + 0x6b0, table, 4);
  m.write(0x564638, m.alloc(0x10), 4);
  m.run(TRAMP, []);
  const n = m.read(header, 4);
  const list = m.read(header + 4, 4);
  return Array.from({ length: n }, (_, i) => [0, 4, 8].map((o) => m.read(list + i * 12 + o, 4)));
}

describe.skipIf(!hasCia)('jump patch on code.bin', () => {
  let game: Game;
  let rows: Uint8Array[];
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
    const t = game.master.table(JUMP_TABLE);
    rows = Array.from({ length: t.rows }, (_, i) => t.row(i).slice());
  });

  test("the table: 38 rows of 16 bytes; the game's instructions where the patch goes", () => {
    const t = game.master.table(JUMP_TABLE);
    expect([t.rows, t.rowSize]).toEqual([JUMP_GAME_ROWS, JUMP_ROW_SIZE]);
    const code = game.dump.code;
    expect(at(code, 0x265f58).text).toMatch(/mov r0, #0x1c8/i);
    expect(at(code, 0x266070).text).toMatch(/cmp r4, #(0x26|38)\b/i);
    expect(at(code, 0x3047c8).text).toMatch(/cmp r5, #(0x26|38)\b/i);
    expect(at(code, 0x26600c).text).toMatch(/^beq/);
    expect(at(code, 0x26600c).target).toBe(0x26606c);
    // +0x0D-0x0F are padding (0xD0): bit0 of +0x0D, Panana's flag, is clear in every row
    expect(rows.every((r) => r[0x0d] === 0xd0 && r[0x0e] === 0xd0 && r[0x0f] === 0xd0)).toBe(true);
    expect(rows.some(JP.follows)).toBe(false);
  });

  test('the rows lead to the entrances of W01 / W02', () => {
    const [w01, w02] = game.worldMaps();
    const ids = [new Set(parseEntrances(game.db.get(w01!.sections[2]!)).map(ENT.id)), new Set(parseEntrances(game.db.get(w02!.sections[2]!)).map(ENT.id))];
    for (let i = 1; i < rows.length; i++) expect(ids[JP.world(rows[i]!)]!.has(JP.id(rows[i]!))).toBe(true);
  });

  test("the game's loop lists the visited rows; with the patch the same, plus rows 38 / 39 and the checks", () => {
    const code = game.dump.code;
    const all = () => true;
    const vanilla = listOf(code, rows, all, all);
    // row 0 ("なし") and row 34 (+0x0C bit0) are not listed
    expect(vanilla.length).toBe(JUMP_GAME_ROWS - 2);
    expect(vanilla[0]).toEqual([JP.name(rows[1]!), 0xa8654391, JP.id(rows[1]!)]);

    const more = [...rows.map((r) => r.slice()), newJumpRow(0x2c00, 0xabcdef01, 0, true), newJumpRow(0x2c01, 0xabcdef02, 0, true)];
    setJumpFollows(more[5]!, true);
    const checks: JumpCheck[] = [
      { row: 5, show: [0xb0, 0x0e], hide: [0, 0] },
      { row: 38, show: [0, 0], hide: [0, 0] },
      { row: 39, show: [NEVER, 0], hide: [0, 0] },
    ];
    const { built, code: patched } = build(code, jumpPatchSource(more.length, checks)!);
    expect(built.errors).toEqual([]);
    expect(listOf(patched, rows, all, all)).toEqual(vanilla);
    const withNew = listOf(patched, more, all, all);
    expect(withNew.length).toBe(vanilla.length + 1); // 38 listed, 39's entrance is gone
    expect(withNew.at(-1)).toEqual([0x2c00, 0xa8654391, 0xabcdef01]);
    const hidden = listOf(patched, more, all, () => false);
    expect(hidden.some((e) => e[2] === JP.id(rows[5]!))).toBe(false);
    expect(hidden.length).toBe(vanilla.length);
    // not visited: not listed, whatever the checks say
    expect(listOf(patched, more, (r) => r !== 38, all).some((e) => e[2] === 0xabcdef01)).toBe(false);
  });
});
