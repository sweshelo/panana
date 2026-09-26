// Tests that need no ROM data.
import { describe, expect, test } from 'bun:test';
import { lz10Compress, lz10Decompress } from '../src/archive/lz10';
import { parseArchive, rebuildArchive, unpackEntry } from '../src/archive/gsarc';
import { MapDb } from '../src/game/mapdb';
import { buildTiles, letterByte, letterIndex, parseTiles, setRecCellPos, LAYOUTS, recCellPos } from '../src/game/sections';
import { decodeTexture } from '../src/cgfx/texture';
import { equalBytes, w32 } from '../src/util/bytes';

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
