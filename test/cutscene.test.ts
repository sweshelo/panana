// Scripted events (game/cutscene.ts): the command layout, the data rows, the range fields, and the interpreter of
// the boss patch run with the executor (game/arm.ts) on a blank code.bin with every game function stubbed (no ROM).
import { describe, expect, test } from 'bun:test';
import { ArmMachine } from '../src/game/arm';
import { BOSS_PATCH, BOSS_PATCH_ID, BOSS_SCRIPT_PATCH, bossPatchFor, KIND_BOSS, readStages, writeStages } from '../src/game/boss';
import {
  ACTOR_HERO, ACTOR_PARTY, CMDS_PER_ROW, DATA_MARK, decodeCommand, encodeCommand, isDataRow, OP, rangeInfo, readCommands, rowsFor, writeCommands,
  type Command,
} from '../src/game/cutscene';
import type { EventTable } from '../src/game/events';
import { buildPatches, applyRecords, patchRecords } from '../src/game/patch';
import { u32 } from '../src/util/bytes';
import { BGM_EXT_PATCH } from '../src/game/bgmext';
import { ITEM_ACTION_PATCH } from '../src/game/items';
import { MONSTER_ROWS_PATCH } from '../src/game/monsters';
import { TRANSFORM_PATCH } from '../src/game/transform';
import { Game } from '../src/game/game';
import { openImage } from '../src/rom/dump';
import { CIA, hasCia } from './env';
import { beforeAll } from 'bun:test';

/** A stand-in for EventTable with plain rows. */
function table(rows: number): EventTable {
  const data = Array.from({ length: rows }, () => new Uint8Array(0x50));
  return {
    rows,
    has: (r: number) => r >= 0 && r < rows,
    table: { row: (r: number) => data[r]!, rowSize: 0x50 },
  } as unknown as EventTable;
}

describe('commands', () => {
  test('round trip, signed coordinates', () => {
    const b = new Uint8Array(8);
    const c: Command = { op: OP.WALK, arg: 15, actor: ACTOR_PARTY, p: -3, q: 120 };
    encodeCommand(b, 0, c);
    expect([...b]).toEqual([2, 15, 0xfe, 0xff, 0xfd, 0xff, 120, 0]);
    expect(decodeCommand(b, 0)).toEqual(c);
    encodeCommand(b, 0, { op: OP.MSG, arg: 0, actor: 7, p: 0x1c78, q: 0x58 });
    expect(decodeCommand(b, 0)).toEqual({ op: OP.MSG, arg: 0, actor: 7, p: 0x1c78, q: 0x58 });
  });

  test('data rows: 8 commands each, an END, the mark and the owner slot', () => {
    expect(rowsFor(0)).toBe(1);
    expect(rowsFor(7)).toBe(1);
    expect(rowsFor(8)).toBe(2);
    const ev = table(6);
    const cmds = Array.from({ length: 10 }, (_, i): Command => ({ op: OP.WAIT, arg: 0, actor: 0, p: i + 1, q: 0 }));
    writeCommands(ev, 3, 2, cmds, 41);
    const r = ev.table.row(3);
    expect(u32(r, 0x40)).toBe(DATA_MARK);
    expect(r[0x44]).toBe(41);
    expect(isDataRow(r)).toBe(true);
    expect(readCommands(ev, 3, 2)).toEqual(cmds);
    expect(decodeCommand(ev.table.row(4), (10 - CMDS_PER_ROW) * 8).op).toBe(OP.END);
    expect(() => writeCommands(ev, 3, 1, cmds, 41)).toThrow();
  });

  test('a stage keeps its script at +4 / +6 instead of the messages', () => {
    const row = new Uint8Array(0x50);
    writeStages(row, [{ fix: 0, bgm: 0, repeat: false, messages: [0, 0, 0], script: { first: 60, rows: 2 } }, { fix: 9, bgm: 0x1c, repeat: false, messages: [0x1f49, 0, 0] }]);
    expect([row[0x08], row[0x0a], row[0x0c], row[0x0e]]).toEqual([0, 2, 60, 2]);
    expect(readStages(row)).toEqual([
      { fix: 0, bgm: 0, repeat: false, messages: [0, 0, 0], script: { first: 60, rows: 2 } },
      { fix: 9, bgm: 0x1c, repeat: false, messages: [0x1f49, 0, 0] },
    ]);
  });

  test('the interpreter is exported only when a stage has a script', () => {
    const ev = table(2);
    expect(bossPatchFor([ev])).toBeNull();
    writeStages(ev.table.row(0), [{ fix: 9, bgm: 0, repeat: false, messages: [0, 0, 0] }]);
    expect(bossPatchFor([ev])).toBe(BOSS_PATCH);
    writeStages(ev.table.row(1), [{ fix: 0, bgm: 0, repeat: false, messages: [0, 0, 0], script: { first: 0, rows: 1 } }]);
    expect(bossPatchFor([ev])).toBe(BOSS_SCRIPT_PATCH);
  });
});

describe('ranges (section 8)', () => {
  test('size, shape and how it fires', () => {
    const rec = (b8: number[]) => Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, ...b8, 0, 0, 0]);
    expect(rangeInfo(rec([9, 2, 1, 1, 0]))).toEqual({ size: 400, square: false, step: true }); // the vanilla battles
    expect(rangeInfo(rec([9, 2, 0, 1, 1]))).toEqual({ size: 200, square: true, step: true }); // the vanilla talks
    expect(rangeInfo(rec([9, 2, 0, 0, 0]))).toEqual({ size: 200, square: false, step: false }); // shops
    expect(rangeInfo(rec([9, 2, 5, 1, 0])).size).toBe(0);
  });
});

describe('the interpreter on the executor', () => {
  const code = new Uint8Array(0x3c0000);
  const built = buildPatches(code, [BOSS_SCRIPT_PATCH]).get(BOSS_PATCH_ID)!;
  const patched = applyRecords(code, patchRecords([built]));
  const F = {
    stopCtl: 0x3024f8, hero: 0x319a6c, actor: 0x31ba8c, release: 0x31b67c, rowObj: 0x31c970, anim: 0x30cca4, msg: 0x310798, move: 0x3080e4,
    waitMove: 0x308068, count: 0x31bb10, member: 0x303db0, float: 0x305f98, turn: 0x319a7c, partyAnim: 0x30250c, wait: 0x3086e4, se: 0x317524,
    mark: 0x31bc08, cam: 0x31b1b4, camTake: 0x3179b8, camKeep: 0x301f80, camMove: 0x317210, camWait: 0x301d9c, camBack: 0x301a44,
    camFollow: 0x301888, camFree: 0x301764, color: 0x3174e8, fadeOut: 0x300dbc, fadeIn: 0x31745c, fadeWait: 0x31747c, place: 0x30150c, put: 0x31b408,
    state: 0x31b10c, setState: 0x31b0d8, rangeOff: 0x317f68, battle: 0x2fc790,
  };

  test('assembles', () => {
    expect(built.errors).toEqual([]);
  });

  /** Run boss_run on a row (70) whose stage 0 has a script in data rows 71.. */
  const run = (cmds: Command[], fix = 0, flags = 0) => {
    const stubs = new Map<number, (mm: ArmMachine) => number>();
    const m = new ArmMachine(patched, { stubs, maxDepth: 8 });
    const objs = new Map<number, number>();
    const newObj = (): number => {
      const o = m.alloc(0x40), node = m.alloc(0x40);
      m.write(o + 0x10, node, 4);
      return o;
    };
    const hero = newObj();
    const party = [hero, newObj(), newObj()];
    const rowObj = (row: number): number => {
      if (!objs.has(row)) objs.set(row, newObj());
      return objs.get(row)!;
    };
    for (const a of Object.values(F)) stubs.set(a, () => 0);
    stubs.set(F.hero, () => hero);
    stubs.set(F.count, () => party.length);
    stubs.set(F.member, (mm) => party[mm.r[0]!]!);
    stubs.set(F.rowObj, (mm) => (mm.r[0] === 99 ? 0 : rowObj(mm.r[0]!)));
    // the event rows: 70 = the boss row, 71.. = data rows
    const rows = m.alloc(0x50 * 4);
    const base = rows;
    const data = new Uint8Array(0x50 * 3);
    cmds.forEach((c, i) => encodeCommand(data, Math.floor(i / CMDS_PER_ROW) * 0x50 + (i % CMDS_PER_ROW) * 8, c));
    data.forEach((b, i) => m.wb(base + 0x50 + i, b));
    const args = base + 8;
    m.wb(args, fix);
    m.wb(args + 2, 2 | flags);
    m.write(args + 4, 71 | (rowsFor(cmds.length) << 16), 4);
    const obj = m.alloc(0x1c), globals = m.alloc(0x1000);
    m.write(0x564638, globals, 4);
    m.write(obj + 4, 70, 4);
    m.write(obj + 0x10, args, 4);
    m.wb(obj + 0x14, 0);
    m.write(obj + 0x18, base, 4);
    m.run(built.labels.get('boss_run')!, [obj]);
    const names = new Map(Object.entries(F).map(([k, v]) => [v, k]));
    return { calls: m.calls.filter((c) => names.has(c.target)).map((c) => ({ f: names.get(c.target)!, a: c.args })), hero, party, rowObj };
  };
  const seq = (r: ReturnType<typeof run>) => r.calls.map((c) => c.f);

  test('lines with speakers, then the event ends without a battle', () => {
    const r = run([
      { op: OP.MSG, arg: 0, actor: ACTOR_HERO, p: 0x1c78, q: 0 },
      { op: OP.MSG, arg: 0x5b, actor: 5, p: 0x1c79, q: 0x58 },
      { op: OP.MSG, arg: 0, actor: 0, p: 0x1c7a, q: 0 },
    ]);
    expect(seq(r)).toEqual([
      'state', 'stopCtl', 'hero', 'actor', // the stage not won yet; control off, the hero's handle
      'hero', 'anim', 'msg', 'anim', // the hero talks (0x1F), then stands (1)
      'rowObj', 'actor', 'anim', 'msg', 'anim', 'release', // row 5 talks (0x5B), then 0x58
      'msg', // no speaker
      'release', 'stopCtl', // the hero's handle, control back
      'setState', 'rangeOff', // no battle: state 1, the range is off until the map is loaded again
    ]);
    const anims = r.calls.filter((c) => c.f === 'anim').map((c) => c.a[1]);
    expect(anims).toEqual([0x1f, 1, 0x5b, 0x58]);
    expect(r.calls.filter((c) => c.f === 'msg').map((c) => c.a[0])).toEqual([0x1c78, 0x1c79, 0x1c7a]);
    expect(r.calls.find((c) => c.f === 'setState')!.a.slice(0, 2)).toEqual([70, 1]);
    expect(r.calls[1]!.a[0]).toBe(0);
    expect(r.calls.filter((c) => c.f === 'stopCtl').at(-1)!.a[0]).toBe(1);
  });

  test('the party walks together; the hero and objects turn, animate and are put', () => {
    const r = run([
      { op: OP.WALK, arg: 10, actor: ACTOR_PARTY, p: 80, q: 60 },
      { op: OP.TURN, arg: 2, actor: ACTOR_HERO, p: 0, q: 0 },
      { op: OP.ANIM, arg: 1, actor: ACTOR_PARTY, p: 0x16, q: 0 },
      { op: OP.WALK, arg: 0, actor: 5, p: 80, q: 40 },
      { op: OP.PLACE, arg: 2, actor: ACTOR_HERO, p: 82, q: 65 },
      { op: OP.PLACE, arg: 0, actor: 5, p: 82, q: 47 },
    ], 9);
    const s = seq(r);
    // party: a handle, a walk and a move for each of the 3, then wait, stand and release each
    expect(s.slice(4, 5)).toEqual(['hero']);
    const walk = s.slice(5, s.indexOf('turn'));
    expect(walk.filter((f) => f === 'move').length).toBe(3);
    expect(walk.filter((f) => f === 'waitMove').length).toBe(3);
    expect(walk.filter((f) => f === 'member').length).toBe(3);
    expect(r.calls.filter((c) => c.f === 'move').slice(0, 3).map((c) => c.a[0])).toEqual([0, 1, 2].map((i) => r.calls.filter((c) => c.f === 'actor')[1 + i]!.a[0]));
    expect(r.calls.find((c) => c.f === 'turn')!.a[0]).toBe(r.calls[3]!.a[0]); // the hero's handle
    expect(r.calls.find((c) => c.f === 'partyAnim')!.a.slice(0, 4)).toEqual([0x16, 1, 0, 1]);
    // row 5 walks without a walking animation
    const i5 = s.indexOf('rowObj');
    expect(s.slice(i5, i5 + 5)).toEqual(['rowObj', 'actor', 'move', 'waitMove', 'release']);
    // the party is put in formation, facing north (FUN_0030150c's 3); the object at once
    const place = r.calls.find((c) => c.f === 'place')!;
    expect(place.a.slice(1, 4)).toEqual([3, 1, 1]);
    expect(r.calls.find((c) => c.f === 'put')!.a[0]).toBe(r.rowObj(5));
    // then the battle
    expect(s.at(-1)).toBe('battle');
    expect(s).not.toContain('setState');
  });

  test('camera, mark, fade, sound and wait; the camera and the fade are put back at the end', () => {
    const r = run([
      { op: OP.MARK, arg: 2, actor: 5, p: 0, q: 0 },
      { op: OP.CAMERA, arg: 15, actor: 5, p: 0, q: 0 },
      { op: OP.SE, arg: 0, actor: 0, p: 0x4f, q: 0 },
      { op: OP.WAIT, arg: 0, actor: 0, p: 5, q: 0 },
      { op: OP.CAMERA, arg: 0, actor: 0, p: 10, q: 20 },
      { op: OP.FADE, arg: 0, actor: 0, p: 3, q: 0 },
      { op: OP.MSG, arg: 0, actor: 99, p: 0x1c78, q: 0 }, // row 99 is not on this map: just the line
    ]);
    expect(seq(r)).toEqual([
      'state', 'stopCtl', 'hero', 'actor',
      'rowObj', 'actor', 'se', 'mark', 'wait', 'mark', 'release',
      'rowObj', 'actor', 'cam', 'camTake', 'camKeep', 'camMove', 'camWait', 'release',
      'se', 'wait',
      'camMove', 'camWait', // the camera is taken once
      'color', 'fadeOut',
      'rowObj', 'msg',
      'fadeIn', 'fadeWait', 'camBack', 'camWait', 'camFollow', 'camFree', 'release', 'stopCtl',
      'setState', 'rangeOff',
    ]);
    const marks = r.calls.filter((c) => c.f === 'mark').map((c) => c.a.slice(1, 4));
    expect(marks).toEqual([[2, 2, 1], [2, 2, 0]]);
    expect(r.calls.find((c) => c.f === 'se')!.a[0]).toBe(0x66);
    expect(r.calls.find((c) => c.f === 'camMove')!.a[3]).toBe(3);
  });

  test('a repeating stage without a battle keeps its state but turns its range off', () => {
    const r = run([{ op: OP.WAIT, arg: 0, actor: 0, p: 1, q: 0 }], 0, 1);
    expect(seq(r).slice(-2)).toEqual(['stopCtl', 'rangeOff']);
  });

  test('without the interpreter, a script stage goes straight to its battle', () => {
    const b = buildPatches(code, [BOSS_PATCH]).get(BOSS_PATCH_ID)!;
    expect(b.errors).toEqual([]);
    expect(b.labels.has('cs_run')).toBe(false);
    expect(KIND_BOSS).toBe(0x31);
  });
});

describe.skipIf(!hasCia)('the interpreter on the ROM', () => {
  let game: Game;
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  });

  test('assembles over the real code.bin, alone and with all of Panana\'s other patches (the code cave is shared)', () => {
    const code = game.dump.code;
    const alone = buildPatches(code, [BOSS_SCRIPT_PATCH]).get(BOSS_PATCH_ID)!;
    expect(alone.errors).toEqual([]);
    const before = new Map(alone.blocks.filter((b) => b.kind === 'at').map((b) => [b.addr, b.lines[0]!.before]));
    expect(before).toEqual(new Map([[0x1f41dc, 0xe351000b], [0x1ce320, 0xe20140ff], [0x1ce358, 0xe3540000]]));
    const all = buildPatches(code, [BOSS_SCRIPT_PATCH, ITEM_ACTION_PATCH, BGM_EXT_PATCH, TRANSFORM_PATCH, MONSTER_ROWS_PATCH]);
    const errors = [...all.entries()].flatMap(([id, b]) => b.errors.map((e) => `${id}:${e.line} ${e.message}`));
    const caves = [...all.values()].flatMap((b) => b.blocks.filter((x) => x.kind === 'cave').map((x) => [x.addr, x.lines.length * 4] as const));
    console.log('cave blocks (address, bytes)', caves.map(([a, n]) => `${a.toString(16)} ${n}`).join(', '));
    expect(errors).toEqual([]);
  });

  test('vanilla ranges: the talk and battle ranges are sized as documented', () => {
    // D05F01003: row 22 (talk) is a 200 square, row 23 (battle) a 400 circle, both entered
    const map = game.code.byName('D05F01003')!;
    const doc = game.doc(map);
    const of = (row: number) => (doc.recs[8] ?? []).find((r) => u32(r.raw, 0) === row);
    expect(rangeInfo(of(22)!.raw)).toEqual({ size: 200, square: true, step: true });
    expect(rangeInfo(of(23)!.raw)).toEqual({ size: 400, square: false, step: true });
  });
});
