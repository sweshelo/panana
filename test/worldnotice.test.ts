// Appearance conditions of the world maps' entrances (game/worldconditions.ts) and the "〇〇が出現した！" notice patch
// (game/worldnotice.ts), run with the executor (game/arm.ts) on a blank code.bin with the game's functions stubbed,
// and on the ROM's code.bin when it is there.
import { beforeAll, describe, expect, test } from 'bun:test';
import { ArmMachine } from '../src/game/arm';
import { disassemble } from '../src/game/disasm';
import { Game } from '../src/game/game';
import { applyRecords, buildPatches, patchRecords, type BuiltPatch } from '../src/game/patch';
import { entranceRowUsers, newEntranceRow, setRowCondition, worldEventPlaces } from '../src/game/worldconditions';
import { KIND_ENTRANCE, NOTICE_DUNGEON, NOTICE_PATCH_ID, NOTICE_TEMPLATE, noticePatch, noticePatchSource, notices, setNoticeMessage, type Notice } from '../src/game/worldnotice';
import { ENT, ENTRANCE_SIZE, freeEntranceId, newEntrance, parseEntrances, setEntranceU32 } from '../src/game/worldmap';
import { openImage } from '../src/rom/dump';
import { u32, w32 } from '../src/util/bytes';
import { CIA, hasCia } from './env';

describe('entrance conditions', () => {
  test('rows used by entrances and by section 6', () => {
    const e = (row: number) => setEntranceU32(new Uint8Array(ENTRANCE_SIZE), 0x10, row);
    const list = [e(0), e(25), e(3), e(25)];
    expect(entranceRowUsers(list, 25)).toEqual([1, 3]);
    expect(entranceRowUsers(list, 0)).toEqual([]);
    const s6 = new Uint8Array(48);
    w32(s6, 0, 3);
    w32(s6, 16, 9);
    w32(s6, 32, 3);
    expect(worldEventPlaces(s6, 3)).toBe(2);
    expect(worldEventPlaces(s6, 25)).toBe(0);
  });

  test('a new row is a plain entrance (kind 0x11) with the conditions copied', () => {
    const from = new Uint8Array(0x50).fill(0xee);
    w32(from, 0, 1);
    w32(from, 4, 4);
    from[0x4b] = 0xb1;
    from[0x4c] = 0x37;
    const row = newEntranceRow(0x50, from);
    expect(row[0x4d]).toBe(KIND_ENTRANCE);
    expect([u32(row, 0), u32(row, 4), row[0x4b], row[0x4c]]).toEqual([1, 4, 0xb1, 0x37]);
    expect(row.subarray(8, 0x4b).every((b) => b === 0)).toBe(true);
    expect(newEntranceRow(0x50, null).filter((b) => b).length).toBe(1);
  });

  test('a new entrance: a copy with its own ID, no row and no point, at the cell', () => {
    const t = new Uint8Array(ENTRANCE_SIZE);
    w32(t, 0x00, 77);
    w32(t, 0x04, 5);
    w32(t, 0x08, 0xd71400a3);
    w32(t, 0x10, 25);
    w32(t, 0x14, 0x1234);
    w32(t, 0x18, 0xf0);
    const seq = [5 / 2 ** 32, 0, 9 / 2 ** 32];
    const id = freeEntranceId([t], () => seq.shift()!);
    expect(id).toBe(9); // 5 is taken, 0 is never an ID
    const r = newEntrance(t, id, 120, 299);
    expect([ENT.part(r), ENT.id(r), ENT.destMap(r), ENT.event(r), ENT.point(r), ENT.model(r), ENT.x(r), ENT.y(r)]).toEqual([77, 9, 0xd71400a3, 0, 0, 0xf0, 120, 299]);
    expect(ENT.part(newEntrance(undefined, 1, 0, 0))).toBe(76);
  });

  test('setting and clearing a condition', () => {
    const row = new Uint8Array(0x50);
    setRowCondition(row, 0x4b, 0x18, 3);
    setRowCondition(row, 0x4c, 0x37, 1);
    expect([row[0x4b], u32(row, 0), row[0x4c], u32(row, 4)]).toEqual([0x18, 3, 0x37, 1]);
    setRowCondition(row, 0x4b, 0, 9);
    expect([row[0x4b], u32(row, 0)]).toEqual([0, 3]); // the value is kept
  });
});

// a blank code.bin: the patch only needs the cave and the hook's address
const BLANK = new Uint8Array(0x420000);
const F = {
  w01: 0x17e08c, alloc: 0x33d690, base: 0x31b170, state: 0x31bff4, cond: 0x30b8a4, narrate: 0x30cc48, setState: 0x3048f8, object: 0x31c970,
  vehicle: 0x2e592c, party: 0x319a6c, place: 0x31c948, add: 0x338450, move: 0x31b408, turn: 0x331ca8, quat: 0x32e6bc, fadeOut: 0x300dbc, fadeIn: 0x31745c, release: 0x31c89c,
};
/** The other functions of the notice (stubbed: they only matter by their order). */
const OTHERS = [0x31c958, 0x31b1b4, 0x3179b8, 0x3174e8, 0x301888, 0x3086e4, 0x31747c, 0x300854, 0x317524, 0x3007c0, 0x301764, F.release, F.turn];
const f32 = (v: number): number => new Uint32Array(new Float32Array([v]).buffer)[0]!;
const fromF32 = (v: number): number => new Float32Array(new Uint32Array([v]).buffer)[0]!;
/** Where the party stands (x, y, z) and the entrances' objects' place. */
const PARTY = [1250, -3, 4050];
const ENTRANCE_AT = [8150, 0, 2350];

/** Run the hook (FUN_0019aa88's W01 branch) and, when it made the notice action, its [2]. */
function run(code: Uint8Array, built: BuiltPatch, o: { game?: number; state: (row: number) => number; holds: (row: number, type: number, value: number) => boolean; placed?: (row: number) => boolean; vehicle?: boolean; quat?: boolean }) {
  const vec = (m: ArmMachine, a: number): number[] => [0, 4, 8].map((i) => Math.round(fromF32(m.read(a + i, 4))));
  const nodes: number[] = [];
  const mover = (m: ArmMachine): number => {
    const obj = m.alloc(0x20);
    const node = m.alloc(0x40);
    m.write(obj + 0x10, node, 4);
    if (o.quat) m.write(node + 0x10, 8, 4);
    nodes.push(node);
    PARTY.forEach((v, i) => m.write(node + 0x14 + i * 4, f32(v), 4));
    return obj;
  };
  const stubs = new Map<number, (m: ArmMachine) => number>([
    ...OTHERS.map((a) => [a, () => 0] as [number, (m: ArmMachine) => number]),
    [F.object, (m) => ((o.placed ?? (() => true))(m.r[0]!) ? 0x9000000 + m.r[0]! : 0)],
    [F.vehicle, (m) => (o.vehicle ? mover(m) : 0)],
    [F.party, (m) => mover(m)],
    [F.place, (m) => {
      const a = m.alloc(12);
      ENTRANCE_AT.forEach((v, i) => m.write(a + i * 4, f32(v), 4));
      return a;
    }],
    [F.add, (m) => {
      const [a, b, out] = [m.r[0]!, m.r[1]!, m.r[2]!];
      for (let i = 0; i < 12; i += 4) m.write(out + i, f32(fromF32(m.read(a + i, 4)) + fromF32(m.read(b + i, 4))), 4);
      return out;
    }],
    [F.move, () => 0],
    [F.quat, () => 0],
    [F.fadeOut, () => 0],
    [F.fadeIn, () => 0],
    [F.w01, () => o.game ?? 0],
    [F.alloc, (m) => m.alloc(0x10)],
    [F.base, (m) => m.r[0]!],
    [F.state, (m) => o.state(m.r[1]!)],
    [F.cond, (m) => (o.holds(m.r[0]!, m.r[1]!, m.r[2]!) ? 1 : 0)],
    [F.narrate, () => 0],
    [F.setState, () => 0],
  ]);
  const m = new ArmMachine(code, { stubs, maxDepth: 6 });
  const action = m.run(built.labels.get('wn_hook')!, [0x123456, 4]) >>> 0;
  const made = action !== 0 && action !== o.game;
  const first = m.calls.filter((c) => c.target === F.w01).map((c) => c.args.slice(0, 2));
  let shown: number[] = [];
  let written: number[][] = [];
  let order: string[] = [];
  let moves: number[][] = [];
  let turns: [string, number][] = [];
  if (made) {
    const vtable = m.read(action, 4);
    const m2 = new ArmMachine(code, { stubs, maxDepth: 6 });
    // the places the mover is put at, read when FUN_0031b408 is called
    const at: number[][] = [];
    stubs.set(F.move, (mm) => (at.push(vec(mm, mm.r[1]!)), 0));
    m2.run(m2.read(vtable + 8, 4), [action]);
    stubs.set(F.move, () => 0);
    moves = at;
    turns = m2.calls.filter((c) => c.target === F.turn || c.target === F.quat).map((c) => [c.target === F.turn ? 'euler' : 'quat', c.args[0]!] as [string, number]);
    shown = m2.calls.filter((c) => c.target === F.narrate).map((c) => c.args[0]!);
    written = m2.calls.filter((c) => c.target === F.setState).map((c) => c.args.slice(0, 3));
    const names = new Map([[F.fadeOut, 'out'], [F.move, 'move'], [F.fadeIn, 'in'], [F.narrate, 'message'], [F.release, 'release'], [F.setState, 'done']]);
    order = m2.calls.filter((c) => names.has(c.target)).map((c) => names.get(c.target)!);
    expect(m.calls.find((c) => c.target === F.base)?.args[1]).toBe(0x1000000);
    expect(vtable).toBe(built.labels.get('wn_vtable')!);
  }
  return { action, made, first, shown, written, order, moves, turns, nodes };
}

describe('notice patch (blank code.bin)', () => {
  const list: Notice[] = [
    { row: 29, message: 0x2c00, show: [0x18, 3], hide: [0, 0] },
    { row: 30, message: 0x2c01, show: [0, 0], hide: [0x37, 1] },
    { row: 31, message: 0x2c02, show: [0xaf, 1], hide: [0, 0] },
  ];
  let built: BuiltPatch;
  let code: Uint8Array;
  beforeAll(() => {
    built = buildPatches(BLANK, [{ id: NOTICE_PATCH_ID, title: '', source: noticePatchSource(list), enabled: true }]).get(NOTICE_PATCH_ID)!;
    code = applyRecords(BLANK, patchRecords([built]));
  });

  test('assembles; the hook jumps to the cave', () => {
    expect(built.errors).toEqual([]);
    const hook = disassemble(u32(code, 0x19aba0 - 0x100000), 0x19aba0);
    expect(hook.target).toBe(built.labels.get('wn_hook'));
  });

  test("the game's own scene comes first", () => {
    const r = run(code, built, { game: 0x8000000, state: () => 0, holds: () => true });
    expect(r.action).toBe(0x8000000);
    expect(r.first).toEqual([[0x123456, 4]]);
  });

  test('due notices are shown in order and recorded; the others are not', () => {
    // 29: progress holds; 30: no show condition, its hide condition does not hold; 31: 0x91[1] is not 1
    const r = run(code, built, { state: () => 0, holds: (_row, type) => type === 0x18 });
    expect(r.made).toBe(true);
    expect(r.shown).toEqual([0x2c00, 0x2c01]);
    expect(r.written).toEqual([[NOTICE_DUNGEON, 29, 1], [NOTICE_DUNGEON, 30, 1]]);
  });

  test('a fade, the party 3 cells south of the entrance, the message, and back; without its object, the message only', () => {
    const r = run(code, built, { state: () => 0, holds: (_row, type) => type === 0x18, placed: (row) => row === 29 });
    expect(r.order).toEqual(['out', 'move', 'in', 'message', 'out', 'move', 'in', 'release', 'done', 'message', 'done']);
    // the height kept, then the place it was at
    expect(r.moves).toEqual([[ENTRANCE_AT[0]!, PARTY[1]!, ENTRANCE_AT[2]! + 300], PARTY]);
  });

  test('on a vehicle, the vehicle is moved', () => {
    const r = run(code, built, { state: () => 0, holds: (_row, type) => type === 0x18, placed: (row) => row === 29, vehicle: true });
    expect(r.order.slice(0, 4)).toEqual(['out', 'move', 'in', 'message']);
    expect(r.moves.length).toBe(2);
  });

  test('a turn kept as a quaternion is put back on the node', () => {
    const r = run(code, built, { state: () => 0, holds: (_row, type) => type === 0x18, placed: (row) => row === 29, quat: true });
    expect(r.turns.map((t) => t[0])).toEqual(['euler', 'quat']);
    expect(r.turns[1]![1]).toBe(r.nodes.at(-1)!);
    const e = run(code, built, { state: () => 0, holds: (_row, type) => type === 0x18, placed: (row) => row === 29 });
    expect(e.turns.map((t) => t[0])).toEqual(['euler', 'euler']);
  });

  test('nothing is made once shown, or when nothing holds', () => {
    expect(run(code, built, { state: () => 1, holds: () => true }).action).toBe(0);
    expect(run(code, built, { state: () => 0, holds: (_r, type) => type === 0x37 }).action).toBe(0);
  });
});

describe('notices of the W01 table', () => {
  test('rows with a message in +0x40', () => {
    const rows = Array.from({ length: 31 }, () => new Uint8Array(0x50));
    rows[29]![0x4b] = 0x18;
    w32(rows[29]!, 0, 2);
    setNoticeMessage(rows[29]!, 0x2c05);
    const events = { dungeon: NOTICE_DUNGEON, rows: rows.length, capacity: 39, table: { row: (i: number) => rows[i]! } } as unknown as Parameters<typeof notices>[0];
    expect(notices(events)).toEqual([{ row: 29, message: 0x2c05, show: [0x18, 2], hide: [0, 0] }]);
    expect(noticePatch(events)?.source).toContain('.word 0x2C05');
    expect(notices({ ...events!, dungeon: 5 } as typeof events)).toEqual([]);
    setNoticeMessage(rows[29]!, 0);
    expect(noticePatch(events)).toBeNull();
  });
});

describe.skipIf(!hasCia)('notice patch on code.bin', () => {
  let game: Game;
  beforeAll(async () => {
    game = await Game.load(await openImage(Bun.file(CIA), 'cia'));
  });

  test("the hook replaces W01's tail call of FUN_0017e08c, and the patch runs the same", () => {
    const code = game.dump.code;
    const before = disassemble(u32(code, 0x19aba0 - 0x100000), 0x19aba0);
    expect(before.target).toBe(F.w01);
    expect(before.call).toBeFalsy();
    const list: Notice[] = [{ row: 29, message: 0x2c00, show: [0x18, 3], hide: [0, 0] }];
    const built = buildPatches(code, [{ id: NOTICE_PATCH_ID, title: '', source: noticePatchSource(list), enabled: true }]).get(NOTICE_PATCH_ID)!;
    expect(built.errors).toEqual([]);
    const patched = applyRecords(code, patchRecords([built]));
    const r = run(patched, built, { state: () => 0, holds: () => true });
    expect(r.shown).toEqual([0x2c00]);
    expect(r.written).toEqual([[NOTICE_DUNGEON, 29, 1]]);
  });

  test('W01: its table has room for notices, the template message is narration', async () => {
    const ev = (await game.eventTable(NOTICE_DUNGEON))!;
    expect(ev.roomLeft()).toBeGreaterThan(0);
    // "{msg:0088}が{ruby:開|ひら}いた！": a place name inserted, the same shape as the notices' text
    expect(game.master.texts.text(NOTICE_TEMPLATE)?.text).toMatch(/^\{msg:[0-9A-F]{4}\}が.*いた！$/);
    const w01 = game.worldMaps().find((w) => w.code === 'W01')!;
    const ents = parseEntrances(game.db.get(w01.sections[2]!));
    // the vanilla entrances with a row: none has a notice
    expect(notices(ev)).toEqual([]);
    expect(ents.filter((r) => ENT.event(r)).length).toBe(7);
  });
});
