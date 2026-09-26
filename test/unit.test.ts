// Tests that need no ROM data.
import { describe, expect, test } from 'bun:test';
import { lz10Compress, lz10Decompress } from '../src/archive/lz10';
import { parseArchive, rebuildArchive, unpackEntry } from '../src/archive/gsarc';
import { MapDb } from '../src/game/mapdb';
import { buildTiles, letterByte, letterIndex, parseTiles, setRecCellPos, LAYOUTS, recCellPos } from '../src/game/sections';
import { decodeTexture } from '../src/cgfx/texture';
import { evalBaked, evalChannel, type AnimCurve } from '../src/cgfx/anim';
import { equalBytes, w32 } from '../src/util/bytes';
import { applyIps, switchPatchVersion } from '../src/rom/ips';

describe('LZ10', () => {
  test('round trip of random and repetitive data', () => {
    const samples = [new Uint8Array(0), new Uint8Array(1000).fill(7), Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919) % 251)];
    const rnd = new Uint8Array(20000);
    let s = 1;
    for (let i = 0; i < rnd.length; i++) rnd[i] = (s = (s * 1103515245 + 12345) >>> 0) >>> 24 & (i % 3 ? 0xff : 0x0f);
    samples.push(rnd);
    for (const d of samples) expect(equalBytes(lz10Decompress(lz10Compress(d)), d)).toBe(true);
  });
});

describe('archive', () => {
  test('rebuild with a replaced LZ10 entry', () => {
    const body1 = new TextEncoder().encode('hello hello hello hello');
    const body2 = new Uint8Array([1, 2, 3, 4]);
    const blob1 = lz10Compress(body1);
    const hdr = new Uint8Array(12 + 28 * 2);
    w32(hdr, 0, 5); w32(hdr, 4, 0xa90c8038); w32(hdr, 8, 2);
    const entries = [[0x11, 0, blob1.length, hdr.length, 6, 0xffffffff, body1.length], [0x22, 0, 4, hdr.length + blob1.length, 0, 0xffffffff, 4]];
    entries.forEach((e, i) => e.forEach((v, j) => w32(hdr, 12 + i * 28 + j * 4, v)));
    const data = new Uint8Array([...hdr, ...blob1, ...body2]);
    const arc = parseArchive(data);
    expect(equalBytes(rebuildArchive(arc, new Map()), data)).toBe(true);
    const re = parseArchive(rebuildArchive(arc, new Map([[0, new Uint8Array([9, 9, 9])]])));
    expect(Array.from(unpackEntry(re, re.entries[0]!).body)).toEqual([9, 9, 9]);
    expect(Array.from(unpackEntry(re, re.entries[1]!).body)).toEqual([1, 2, 3, 4]);
  });
});

describe('map DB', () => {
  test('rebuild keeps empty entries in place and recomputes offsets', () => {
    // count 3: A (4 bytes), B (empty, shares the next offset), C (2 bytes)
    const idx = [[0x10, 0, 4], [0x20, 4, 0], [0x30, 4, 2]];
    const b = new Uint8Array(4 + 36 + 6);
    w32(b, 0, 3);
    idx.forEach((e, i) => e.forEach((v, j) => w32(b, 4 + i * 12 + j * 4, v)));
    b.set([1, 2, 3, 4, 5, 6], 40);
    const db = new MapDb(b);
    expect(equalBytes(db.build(), b)).toBe(true);
    db.set(0x10, new Uint8Array([9]));
    const out = new MapDb(db.build());
    expect(Array.from(out.get(0x10))).toEqual([9]);
    expect(Array.from(out.get(0x30))).toEqual([5, 6]);
    expect(out.get(0x20).length).toBe(0);
  });
});

describe('sections', () => {
  test('tiles keep unknown bits', () => {
    const raw = new Uint8Array([5, 0, 0, 0, 3, 0, 4, 0, 0x81, 0x61, 0x34, 0x12]);
    const t = parseTiles(raw);
    expect(t[0]).toMatchObject({ kind: 5, x: 3, y: 4, rot: 1, letter: 0x61 });
    expect(equalBytes(buildTiles(t), raw)).toBe(true);
  });
  test('letters', () => {
    expect(letterIndex(0x7a)).toBe(0);
    expect(letterIndex(0)).toBe(0);
    expect(letterIndex(0x63)).toBe(3);
    expect(letterByte(0)).toBe(0x7a);
    expect(letterByte(7)).toBe(0x67);
  });
  test('fine coordinates snap and clamp to 0..299', () => {
    const r = { raw: new Uint8Array(12), x: 0, y: 0 };
    setRecCellPos(r, LAYOUTS[4]!, 18.7, 9.7);
    expect([r.x, r.y]).toEqual([93, 48]);
    const [cx] = recCellPos(r, LAYOUTS[4]!);
    expect(cx).toBeCloseTo(18.7, 6);
    setRecCellPos(r, LAYOUTS[4]!, 100, -3);
    expect([r.x, r.y]).toEqual([299, 0]);
  });
});

describe('textures', () => {
  test('RGBA8 tile order', () => {
    // 8x8 RGBA8: pixel i of the tile is stored at Morton position; bytes are A B G R.
    const data = new Uint8Array(8 * 8 * 4);
    data.set([0xff, 0x03, 0x02, 0x01], 4 * 2); // third stored pixel = (0, 1)
    const out = decodeTexture(data, 8, 8, 0);
    expect(Array.from(out.subarray((1 * 8 + 0) * 4, (1 * 8 + 0) * 4 + 4))).toEqual([1, 2, 3, 0xff]);
  });
  test('ETC1 solid block', () => {
    // individual mode, colours 0x8/0x8/0x8 in both halves, table 0, all indices 0 (+2)
    const data = new Uint8Array(8 * 8 / 2);
    for (let b = 0; b < 4; b++) data.set([0, 0, 0, 0, 0x00, 0x88, 0x88, 0x88], b * 8);
    const out = decodeTexture(data, 8, 8, 12);
    expect(Array.from(out.subarray(0, 4))).toEqual([0x88 + 2, 0x88 + 2, 0x88 + 2, 255]);
  });
});

describe('IPS', () => {
  test('records, RLE and the switch marker', () => {
    const base = new Uint8Array(0x3c0000 + 16);
    const rec = (off: number, data: number[]) => [(off >> 16) & 255, (off >> 8) & 255, off & 255, data.length >> 8, data.length & 255, ...data];
    const ips = new Uint8Array([...new TextEncoder().encode('PATCH'), ...rec(2, [9, 8]),
      0, 0, 10, 0, 0, 0, 3, 7, // RLE: 3 x 7 at 10
      ...rec(0x4bf680 - 0x100000, [0x50, 0x4e, 0x53, 0x57, 1, 0, 0, 0]), ...new TextEncoder().encode('EOF')]);
    const out = applyIps(base, ips);
    expect(Array.from(out.subarray(0, 14))).toEqual([0, 0, 9, 8, 0, 0, 0, 0, 0, 0, 7, 7, 7, 0]);
    expect(switchPatchVersion(out)).toBe(1);
    expect(switchPatchVersion(base)).toBe(0);
  });
});

describe('CGFX animation curves', () => {
  const curve = (interp: number, keys: number[]): AnimCurve => ({ start: 0, end: 10, interp, keys: new Float32Array(keys) });

  test('hermite passes through the keys and uses the slopes', () => {
    const c = curve(2, [0, 0, 0, 1, 10, 10, 1, 0]);
    expect(evalChannel(c, 0, 99)).toBe(0);
    expect(evalChannel(c, 10, 99)).toBe(10);
    // Slope 1 on both ends of a straight line: linear.
    expect(evalChannel(c, 5, 99)).toBeCloseTo(5, 5);
    expect(evalChannel(curve(2, [0, 0, 0, 0, 10, 10, 0, 0]), 5, 99)).toBeCloseTo(5, 5);
    expect(evalChannel(curve(2, [0, 0, 0, 0, 10, 10, 0, 0]), 2, 99)).toBeCloseTo(10 * (3 * 0.04 - 2 * 0.008), 5);
  });

  test('step, linear, clamping, constants and absent channels', () => {
    const keys = [0, 1, 0, 0, 4, 3, 0, 0, 8, 7, 0, 0];
    expect(evalChannel(curve(0, keys), 5, 0)).toBe(3);
    expect(evalChannel(curve(1, keys), 6, 0)).toBeCloseTo(5, 5);
    expect(evalChannel(curve(1, keys), -3, 0)).toBe(1);
    expect(evalChannel(curve(1, keys), 30, 0)).toBe(7);
    expect(evalChannel(2.5, 3, 0)).toBe(2.5);
    expect(evalChannel(null, 3, 0.75)).toBe(0.75);
  });

  test('baked values interpolate between frames and hold a single value', () => {
    const out = [0, 0, 0];
    evalBaked(new Float32Array([0, 0, 0, 2, 4, 6, 4, 8, 12]), 3, 0, 0.5, out);
    expect(out).toEqual([1, 2, 3]);
    evalBaked(new Float32Array([0, 0, 0, 2, 4, 6, 4, 8, 12]), 3, 0, 99, out);
    expect(out).toEqual([4, 8, 12]);
    evalBaked(new Float32Array([5, 6, 7]), 3, 0, 20, out);
    expect(out).toEqual([5, 6, 7]);
  });
});

describe('monster groups', () => {
  test('slots: decode skips empty slots, encode packs to the front and keeps the rest of the row', async () => {
    const { decodeGroupSlots, encodeGroupSlots } = await import('../src/game/monsters');
    const row = new Uint8Array(0x30);
    row.fill(0xee, 0x28);
    // leads: slot 0 = monster 3 (weight 10, count 5), slot 2 = monster 7 (weight 0: skipped), slot 4 = monster 9
    row.set([3, 0, 10, 5], 0);
    row.set([7, 0, 0, 1], 8);
    row.set([9, 0, 20, 0], 16);
    row.set([0x2c, 0x01, 1, 2], 0x14); // mate: monster 300
    expect(decodeGroupSlots(row)).toEqual({
      leads: [{ monster: 3, weight: 10, count: 5 }, { monster: 9, weight: 20, count: 0 }],
      mates: [{ monster: 300, weight: 1, count: 2 }],
    });
    const leads = [{ monster: 9, weight: 300, count: 1 }];
    const mates = [{ monster: 3, weight: 4, count: 6 }, { monster: 5, weight: 1, count: 0 }];
    encodeGroupSlots(row, leads, mates);
    expect(decodeGroupSlots(row)).toEqual({ leads: [{ monster: 9, weight: 255, count: 1 }], mates });
    expect(Array.from(row.subarray(4, 0x14))).toEqual(new Array(16).fill(0));
    expect(Array.from(row.subarray(0x28))).toEqual(new Array(8).fill(0xee));
    expect(() => encodeGroupSlots(row, new Array(6).fill(leads[0]), [])).toThrow();
  });
});

describe('actions', () => {
  test('item action fields and effect text', async () => {
    const { decodeAction, itemEffect, cleanActionName } = await import('../src/game/actions');
    const r = new Uint8Array(0x20);
    // kind 2 (item), type 0 (HP), level 3, usable on the field and in battle
    w32(r, 0, ((2 << 1) | (0 << 3) | (3 << 13) | (1 << 31) | (1 << 29)) >>> 0);
    w32(r, 4, 1234);
    r.set([40, 0, 30, 0], 0x18);
    const f = decodeAction(r);
    expect([f.kind, f.type, f.level, f.nameId]).toEqual([2, 0, 3, 1234]);
    expect(f.scenes).toEqual(['フィールド', '戦闘']);
    expect(itemEffect(f)).toBe('HP 回復 30〜40 (フィールド・戦闘)');
    // status recovery: no amount; other kinds: no item effect
    w32(r, 0, ((2 << 1) | (2 << 3)) >>> 0);
    expect(itemEffect(decodeAction(r))).toBe('状態の回復');
    w32(r, 0, 1 << 1);
    expect(itemEffect(decodeAction(r))).toBe('');
    expect(cleanActionName('Ąは　ぶつかってきた！')).toBe('ぶつかってきた');
  });
});
