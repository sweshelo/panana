// Appearance conditions of the world maps' entrances (game/worldconditions.ts) and the "〇〇が出現した！" notice patch
// (game/worldnotice.ts), run with the executor (game/arm.ts) on a blank code.bin with the game's functions stubbed,
// and on the ROM's code.bin when it is there.
import { beforeAll, describe, expect, test } from 'bun:test';
import { ArmMachine } from '../src/game/arm';
import { disassemble } from '../src/game/disasm';
import { Game } from '../src/game/game';
import { applyRecords, buildPatches, patchRecords, type BuiltPatch } from '../src/game/patch';
import { entranceRowUsers, newEntranceRow, setRowCondition, worldEventPlaces } from '../src/game/worldconditions';
import { KIND_ENTRANCE, NOTICE_DUNGEON, NOTICE_STATE, NOTICE_PATCH_ID, NOTICE_TEMPLATE, noticePatch, noticePatchSource, notices, repairNotices, setNoticeMessage, setNoticeSound, type Notice } from '../src/game/worldnotice';
import { ENT, ENTRANCE_SIZE, freeEntranceId, newEntrance, parseEntrances, setEntranceU32 } from '../src/game/worldmap';
import { openImage } from '../src/rom/dump';
import { readConditionTypes } from '../src/game/conditions';
import { STORY_CONDITIONS } from '../src/game/storyconditions';
import { u16, u32, w16, w32 } from '../src/util/bytes';
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
  w01: 0x17e08c, alloc: 0x33d690, base: 0x31b170, state: 0x31bff4, cond: 0x30b8a4, narrate: 0x30cc48, setState: 0x3048f8,
  vehicle: 0x303c70, leader: 0x319a6c, toEuler: 0x3063bc, warp: 0x308d44, scene: 0x3014f0, switch: 0x308bac, move: 0x30150c, turn: 0x331ca8,
  hide: 0x31c580, sound: 0x317524, fadeOut: 0x300dbc, fadeIn: 0x31745c,
};
/** The other functions of the notice (stubbed: they only matter by their order). */
const OTHERS = [0x31ba8c, 0x31c4bc, 0x301500, 0x31b67c, 0x3174e8, 0x3174c8, 0x3086e4, 0x31747c, 0x300854, 0x3007c0,
  F.hide, F.toEuler, F.sound, F.fadeOut, F.fadeIn, F.warp, F.scene, F.switch];
const SAVE = 0x6000000;
const PLACE = [0x44fa0000, 0xc2c80000, 0x45610000]; // where the party's leader stands, as float bits
const ANGLE = 0x3fc90fdb; // π/2

/** One load of W01: the hook (FUN_0019aa88's W01 branch) and, when it made the notice action, its [2], on `m`. */
/** FUN_003129bc(save, var, i, &v) calls of each machine, as [var, i, v...] read when called. */
const VARS = new WeakMap<ArmMachine, number[][]>();

function load(m: ArmMachine, built: BuiltPatch, o: { game?: number; vehicle?: boolean }) {
  m.calls.length = 0;
  const action = m.run(built.labels.get('wn_hook')!, [0x123456, 4]) >>> 0;
  const made = action !== 0 && action !== o.game;
  const hook = m.calls.slice();
  m.calls.length = 0;
  if (made) {
    expect(hook.find((c) => c.target === F.base)?.args[1]).toBe(0x1000000);
    const vtable = m.read(action, 4);
    expect(vtable).toBe(built.labels.get('wn_vtable')!);
    m.run(m.read(vtable + 8, 4), [action]);
  }
  const calls = m.calls.slice();
  const vars = (VARS.get(m) ?? []).splice(0);
  const names = new Map([[F.fadeOut, 'out'], [F.warp, 'warp'], [F.hide, 'hide'], [F.fadeIn, 'in'], [F.sound, 'sound'], [F.narrate, 'message'], [F.setState, 'done'], [F.move, 'place']]);
  return {
    action, made, hook,
    first: hook.filter((c) => c.target === F.w01).map((c) => c.args.slice(0, 2)),
    order: calls.filter((c) => names.has(c.target)).map((c) => names.get(c.target)!),
    warps: calls.filter((c) => c.target === F.warp).map((c) => [c.args[0]!, c.args[1]! >>> 0, c.args[2]! >>> 0]),
    shown: calls.filter((c) => c.target === F.narrate).map((c) => c.args[0]!),
    sounds: calls.filter((c) => c.target === F.sound).map((c) => c.args[0]!),
    written: calls.filter((c) => c.target === F.setState).map((c) => c.args.slice(0, 3)),
    euler: calls.filter((c) => c.target === F.toEuler).map((c) => c.args[1]! - c.args[0]!),
    moves: vars.filter((v) => v[0] === F.move).map((v) => v.slice(1)),
    turns: vars.filter((v) => v[0] === F.turn).map((v) => v.slice(2)),
    ship: calls.some((c) => c.target === 0x3012dc || c.target === 0x3012b0),
  };
}

function machine(code: Uint8Array, o: { game?: number; state: (row: number) => number; holds: (row: number, type: number, value: number) => boolean; vehicle?: boolean; noLeader?: boolean; quaternion?: boolean }) {
  const stubs = new Map<number, (m: ArmMachine) => number>([
    ...OTHERS.map((a) => [a, () => 0] as [number, (m: ArmMachine) => number]),
    [F.vehicle, () => (o.vehicle ? 0x7000000 : 0)],
    [F.move, (m) => (VARS.get(m)!.push([F.move, m.r[1]!, m.r[2]!, m.r[3]!, ...[0, 4, 8].map((i) => m.read(m.r[0]! + i, 4) >>> 0)]), 0)],
    [F.turn, (m) => (VARS.get(m)!.push([F.turn, m.r[0]!, ...[0, 4, 8].map((i) => m.read(m.r[1]! + i, 4) >>> 0)]), 0)],
    [F.leader, (m) => {
      if (o.noLeader) return 0;
      // the party's leader: its transform T at +0x10, position T+0x14, angle T+0x30, T+0x10 bit 3 = quaternion
      const obj = m.alloc(0x20), t = m.alloc(0x60);
      m.write(obj + 0x10, t, 4);
      m.write(t + 0x10, o.quaternion ? 8 : 0, 4);
      PLACE.forEach((v, i) => m.write(t + 0x14 + i * 4, v, 4));
      m.write(t + 0x30, ANGLE, 4);
      return obj;
    }],
    [F.w01, () => o.game ?? 0],
    [F.alloc, (m) => m.alloc(0x10)],
    [F.base, (m) => m.r[0]!],
    [F.state, (m) => o.state(m.r[1]!)],
    [F.cond, (m) => (o.holds(m.r[0]!, m.r[1]!, m.r[2]!) ? 1 : 0)],
    [F.narrate, () => 0],
    [F.setState, () => 0],
  ]);
  const m = new ArmMachine(code, { stubs, maxDepth: 6 });
  VARS.set(m, []);
  m.write(0x564638, SAVE, 4);
  return m;
}

describe('notice patch (blank code.bin)', () => {
  const list: Notice[] = [
    { row: 29, message: 0x2c00, sound: 0x2f, show: [0x18, 3], hide: [0, 0], entrance: 0xd3e36ef0 },
    { row: 30, message: 0x2c01, sound: 0, show: [0, 0], hide: [0x37, 1], entrance: 0x1234 },
    { row: 31, message: 0x2c02, sound: 0x58, show: [0xaf, 1], hide: [0, 0], entrance: 0x5678 },
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
    const m = machine(code, { game: 0x8000000, state: () => 0, holds: () => true });
    const r = load(m, built, { game: 0x8000000 });
    expect(r.action).toBe(0x8000000);
    expect(r.first).toEqual([[0x123456, 4]]);
  });

  test('a due notice: warp next to its entrance, the message there, then warp back to where the party stood', () => {
    // 29: progress holds; 30: no show condition, its hide condition does not hold; 31: 0x91[1] is not 1
    const states = new Map<number, number>();
    const m = machine(code, { state: (row) => states.get(row) ?? 0, holds: (_row, type) => type === 0x18 });
    const W01 = 0xa8654391;
    // 1st load: keeps the place, warps next to entrance of row 29
    const a = load(m, built, {});
    expect(a.made).toBe(true);
    expect(a.order).toEqual(['out', 'warp']);
    expect(a.warps).toEqual([[SAVE + 0x404, W01, 0xd3e36ef0]]);
    expect(m.read(NOTICE_STATE, 4)).toBe(0x4e574e50);
    expect([4, 8].map((o) => m.read(NOTICE_STATE + o, 4))).toEqual([1, 29]);
    // 2nd load (next to the entrance): the camera, the sound and the message, recorded, then back to point 0
    const b = load(m, built, {});
    expect(b.made).toBe(true);
    expect(b.order).toEqual(['hide', 'in', 'sound', 'message', 'done', 'out', 'place', 'warp']);
    expect(b.shown).toEqual([0x2c00]);
    expect(b.sounds).toEqual([0x2f]);
    expect(b.written).toEqual([[NOTICE_DUNGEON, 29, 1]]);
    // the party itself is moved back (the teardown saves it to 0x5A / 0x5B), not 0x58 (the ship's)
    expect(b.moves).toEqual([[3, 1, 0, ...PLACE]]);
    expect(b.turns).toEqual([[0, ANGLE, 0]]);
    expect(b.ship).toBe(false);
    expect(m.read(SAVE + 0x404, 1)).toBe(1); // as after loading a save on W01, so 0x5A[0] is kept
    expect(b.warps).toEqual([[SAVE + 0x404, W01, 0]]);
    expect(m.calls.some((c) => c.target === 0x3008dc)).toBe(false); // FUN_003008dc heals the party
    states.set(29, 1);
    // 3rd load (back): nothing, the phase cleared
    const c = load(m, built, {});
    expect(c.made).toBe(false);
    expect(m.read(NOTICE_STATE + 4, 4)).toBe(0);
    // 4th load: row 30 is still due
    const d = load(m, built, {});
    expect(d.warps).toEqual([[SAVE + 0x404, W01, 0x1234]]);
  });

  test("the place kept is the leader's own (0x58 is stale out of a town); a quaternion is turned to angles first", () => {
    const m = machine(code, { state: () => 0, holds: (_row, type) => type === 0x18, quaternion: true });
    const a = load(m, built, {});
    expect(a.euler).toEqual([0x38 - 0x2c]);
    expect([0xc, 0x10, 0x14, 0x18].map((o) => m.read(NOTICE_STATE + o, 4) >>> 0)).toEqual([...PLACE, ANGLE]);
    expect(a.warps).toEqual([[SAVE + 0x404, 0xa8654391, 0xd3e36ef0]]);
    expect(load(m, built, {}).moves).toEqual([[3, 1, 0, ...PLACE]]);
  });

  test('no leader: nothing shown', () => {
    const m = machine(code, { state: () => 0, holds: (_row, type) => type === 0x18, noLeader: true });
    const a = load(m, built, {});
    expect(a.warps).toEqual([]);
    expect(m.read(NOTICE_STATE + 4, 4)).toBe(0);
  });

  test('nothing on a vehicle, once shown, or when nothing holds; a stale state without the mark is ignored', () => {
    expect(load(machine(code, { state: () => 0, holds: () => true, vehicle: true }), built, {}).action).toBe(0);
    expect(load(machine(code, { state: () => 1, holds: () => true }), built, {}).action).toBe(0);
    expect(load(machine(code, { state: () => 0, holds: (_r, type) => type === 0x37 }), built, {}).action).toBe(0);
    const m = machine(code, { state: () => 1, holds: () => true });
    m.write(NOTICE_STATE + 4, 1, 4); // phase 1 but no mark (memory left from before)
    expect(load(m, built, {}).action).toBe(0);
  });
});

describe('notices of the W01 table', () => {
  test('rows with a message in +0x40 and an entrance', () => {
    const rows = Array.from({ length: 31 }, () => new Uint8Array(0x50));
    rows[29]![0x4b] = 0x18;
    w32(rows[29]!, 0, 2);
    setNoticeMessage(rows[29]!, 0x2c05);
    const events = { dungeon: NOTICE_DUNGEON, rows: rows.length, capacity: 39, table: { row: (i: number) => rows[i]! } } as unknown as Parameters<typeof notices>[0];
    const ent = setEntranceU32(new Uint8Array(ENTRANCE_SIZE), 0x10, 29);
    w32(ent, 0x04, 0xabcd);
    expect(notices(events, [ent])).toEqual([{ row: 29, message: 0x2c05, sound: 0, show: [0x18, 2], hide: [0, 0], entrance: 0xabcd }]);
    expect(notices(events, [])).toEqual([]);
    expect(noticePatch(events, [ent])?.source).toContain('.word 0x2C05');
    expect(notices({ ...events!, dungeon: 5 } as typeof events, [ent])).toEqual([]);
    setNoticeMessage(rows[29]!, 0);
    expect(noticePatch(events, [ent])).toBeNull();
  });
});

describe('the sound and the state slot', () => {
  const table = (rows: Uint8Array[], original: number) => {
    const slot = (i: number) => (u16(rows[i]!, 0x44) === 0xffff ? i : u16(rows[i]!, 0x44));
    return {
      dungeon: NOTICE_DUNGEON, rows: rows.length, capacity: 39, table: { row: (i: number) => rows[i]! }, slot,
      originalRow: (i: number) => (i < original ? rows[i] : undefined),
      freeSlot: () => { const used = new Set(rows.map((_, i) => slot(i))); for (let s = 0; s < 39; s++) if (!used.has(s)) return s; return -1; },
    } as unknown as Parameters<typeof repairNotices>[0];
  };

  test('the sound is kept apart from the state slot (+0x44) and model (+0x46)', () => {
    const r = new Uint8Array(0x50);
    w16(r, 0x44, 28);
    w16(r, 0x46, 7);
    setNoticeSound(r, 0x2f);
    expect([u16(r, 0x44), u16(r, 0x46), u32(r, 0x3c)]).toEqual([28, 7, 0x2f]);
  });

  test('rows whose slot the old sound overwrote get a free slot and the sound at +0x3C', () => {
    const rows = Array.from({ length: 30 }, (_, i) => { const r = new Uint8Array(0x50); w16(r, 0x44, i); return r; });
    setNoticeMessage(rows[29]!, 0x2c00);
    w32(rows[29]!, 0x44, 0x2f); // the old setNoticeSound: slot 47 is past the table
    rows.push(new Uint8Array(0x50));
    setNoticeMessage(rows[30]!, 0x2c01);
    w32(rows[30]!, 0x44, 5); // slot 5 is row 5's
    rows.push(new Uint8Array(0x50));
    setNoticeMessage(rows[31]!, 0x2c02);
    w16(rows[31]!, 0x44, 31); // fine
    const t = table(rows, 29);
    expect(repairNotices(t)).toEqual([29, 30]);
    expect([u16(rows[29]!, 0x44), u32(rows[29]!, 0x3c)]).toEqual([29, 0x2f]);
    expect([u16(rows[30]!, 0x44), u32(rows[30]!, 0x3c)]).toEqual([30, 5]);
    expect(u16(rows[31]!, 0x44)).toBe(31);
    expect(repairNotices(t)).toEqual([]);
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
    const list: Notice[] = [{ row: 29, message: 0x2c00, sound: 0x2f, show: [0x18, 3], hide: [0, 0], entrance: 0xd3e36ef0 }];
    const built = buildPatches(code, [{ id: NOTICE_PATCH_ID, title: '', source: noticePatchSource(list), enabled: true }]).get(NOTICE_PATCH_ID)!;
    expect(built.errors).toEqual([]);
    const patched = applyRecords(code, patchRecords([built]));
    const m = machine(patched, { state: () => 0, holds: () => true });
    expect(load(m, built, {}).warps.map((w) => w[2])).toEqual([0xd3e36ef0]);
    const r = load(m, built, {});
    expect(r.shown).toEqual([0x2c00]);
    expect(r.written).toEqual([[NOTICE_DUNGEON, 29, 1]]);
    expect(r.warps.map((w) => w[2])).toEqual([0]);
  });

  test("the notice's state is past everything code.bin points at (the end of .bss's last page)", () => {
    const code = game.dump.code;
    // .bss ends at 0x63F4B4 (crt0's bound, the only word in [0x63F4B4, 0x640000))
    const inside: number[] = [];
    for (let o = 0; o + 4 <= code.length; o += 4) {
      const w = u32(code, o);
      if (w >= 0x63f4b4 && w < 0x640000) inside.push(w);
    }
    expect(inside).toEqual([0x63f4b4]);
    expect(NOTICE_STATE).toBeGreaterThan(0x63f4b4);
    expect(NOTICE_STATE + 0x20).toBeLessThanOrEqual(0x640000);
  });

  test('W01: its table has room for notices, the template message is narration', async () => {
    const ev = (await game.eventTable(NOTICE_DUNGEON))!;
    expect(ev.roomLeft()).toBeGreaterThan(0);
    // "{msg:0088}が{ruby:開|ひら}いた！": a place name inserted, the same shape as the notices' text
    expect(game.master.texts.text(NOTICE_TEMPLATE)?.text).toMatch(/^\{msg:[0-9A-F]{4}\}が.*いた！$/);
    const w01 = game.worldMaps().find((w) => w.code === 'W01')!;
    const ents = parseEntrances(game.db.get(w01.sections[2]!));
    // the vanilla entrances with a row: none has a notice
    expect(notices(ev, ents)).toEqual([]);
    expect(ents.filter((r) => ENT.event(r)).length).toBe(7);
  });

  test("the story milestones are this ROM's condition types", () => {
    const types = readConditionTypes(game.dump.code);
    // a boss beaten: 0x91[値] = 2; the endings: 0x8D[8] / 0x8D[9] at least the value
    expect(types.get(0xb0)).toMatchObject({ getter: 'value91', test: 'equals', eq: 2 });
    expect(types.get(0x20)).toMatchObject({ getter: 'progress', index: 8, test: 'atLeast' });
    expect(types.get(0x21)).toMatchObject({ getter: 'progress', index: 9, test: 'atLeast' });
    expect(STORY_CONDITIONS.every((c) => types.has(c.type))).toBe(true);
  });
});
