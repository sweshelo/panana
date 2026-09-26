// Tests that need no ROM data.
import { describe, expect, test } from 'bun:test';
import { lz10Compress, lz10Decompress } from '../src/archive/lz10';
import { parseArchive, rebuildArchive, unpackEntry } from '../src/archive/gsarc';
import { MapDb } from '../src/game/mapdb';
import { buildTiles, letterByte, letterIndex, parseTiles, setRecCellPos, LAYOUTS, recCellPos } from '../src/game/sections';
import { decodeTexture } from '../src/cgfx/texture';
import { evalBaked, evalChannel, type AnimCurve } from '../src/cgfx/anim';
import { equalBytes, u32, w16, w32 } from '../src/util/bytes';
import { Gmsg, MessageStore, plainText, previewText, textToUnits, unitsToText } from '../src/game/gmsg';
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

describe('item fields', () => {
  test('read and write the editable fields of an itemData row', async () => {
    const { readItemFields, writeItemFields } = await import('../src/game/items');
    const r = new Uint8Array(0x30);
    w32(r, 0, 80);
    w32(r, 4, 8);
    w32(r, 8, 0x12345601 | (1 << 5)); // other flag bits must survive a rarity change
    w32(r, 0x24, 7);
    r[0x2a] = 3;
    expect(readItemFields(r)).toEqual({ price: 80, sell: 8, rarity: 1, limit: 99, action: 7, chain: 3 });
    writeItemFields(r, { price: 120, rarity: 5, action: 9, chain: 0x1234 });
    expect(readItemFields(r)).toEqual({ price: 120, sell: 8, rarity: 5, limit: 99, action: 9, chain: 0x1234 });
    expect((new DataView(r.buffer).getUint32(8, true) & ~0xe0) >>> 0).toBe((0x12345601 & ~0xe0) >>> 0);
    // 99 keeps a byte of 0 (it already means 99); other limits are written as they are
    writeItemFields(r, { limit: 99 });
    expect(r[0x2f]).toBe(0);
    writeItemFields(r, { limit: 10 });
    expect([r[0x2f], readItemFields(r).limit]).toEqual([10, 10]);
    writeItemFields(r, { limit: 99 });
    expect(r[0x2f]).toBe(99);
  });
});

describe('board facing', () => {
  const plane = (normal: [number, number, number], jitter = 0): number[] => {
    // two in-plane axes of the normal, a 10 x 6 grid of points on them
    const [nx, ny, nz] = normal;
    const u = Math.abs(nx) < 0.9 ? [0, nz, -ny] : [-nz, 0, nx];
    const ul = Math.hypot(...u);
    const uu = u.map((x) => x / ul);
    const v = [ny * uu[2]! - nz * uu[1]!, nz * uu[0]! - nx * uu[2]!, nx * uu[1]! - ny * uu[0]!];
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 6; j++) {
      const a = i * 3 - 13, b = j * 2 - 5, c = ((i * 7 + j * 3) % 5 - 2) * jitter;
      for (let k = 0; k < 3; k++) pts.push(a * uu[k]! + b * v[k]! + c * normal[k]! + [4, -2, 9][k]!);
    }
    return pts;
  };
  const unit = (x: number, y: number, z: number): [number, number, number] => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };

  test('finds the normal of a tilted board, on the side its faces look at', async () => {
    const { boardNormal } = await import('../src/cgfx/facing');
    for (const n of [unit(0, 0, 1), unit(1, 0, 0), unit(0.3, 0.2, 0.9), unit(-0.5, 0.7, 0.2), unit(0, 1, 0)]) {
      const got = boardNormal(plane(n, 0.01), n)!;
      expect(got).not.toBeNull();
      for (let k = 0; k < 3; k++) expect(got[k]!).toBeCloseTo(n[k]!, 3);
      // faces looking the other way flip it
      const back = boardNormal(plane(n, 0.01), [-n[0], -n[1], -n[2]])!;
      for (let k = 0; k < 3; k++) expect(back[k]!).toBeCloseTo(-n[k]!, 3);
    }
  });

  test('two-sided boards take the preferred side; solid models are not boards', async () => {
    const { boardNormal } = await import('../src/cgfx/facing');
    const n = unit(0.2, 0.1, -0.95);
    const got = boardNormal(plane(n), [0, 0, 0], [0, 0, 1])!;
    for (let k = 0; k < 3; k++) expect(got[k]!).toBeCloseTo(-n[k]!, 4);
    expect(boardNormal(plane(n, 2), null)).toBeNull();
    const cube: number[] = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) cube.push(x, y, z);
    expect(boardNormal(cube, null)).toBeNull();
    expect(boardNormal([0, 0, 0, 1, 1, 1], null)).toBeNull();
  });
});

describe('GMSG messages', () => {
  /** A GMSG with IDs 100.. holding the given messages (units). */
  const makeGmsg = (msgs: number[][]): Uint8Array => {
    const tbl = 0x20;
    const base = tbl + msgs.length * 4 + 4; // 4 bytes of gap
    const size = base + msgs.reduce((a, m) => a + m.length * 2, 0);
    const b = new Uint8Array(size);
    b.set([0x47, 0x4d, 0x53, 0x47]);
    w32(b, 4, size);
    w32(b, 8, 100);
    w32(b, 12, 100 + msgs.length - 1);
    w32(b, 0x18, tbl);
    w32(b, 0x1c, base);
    b.set([0xaa, 0xbb, 0xcc, 0xdd], base - 4);
    let o = 0;
    msgs.forEach((m, i) => {
      w32(b, tbl + i * 4, o);
      m.forEach((c, j) => w16(b, base + o + j * 2, c));
      o += m.length * 2;
    });
    return b;
  };
  const u = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
  const msgs = [[0x010e, ...u('こんにちは'), 0x0a, ...u('元気?'), 0], [0x0001, 0xe001, 0, 0x0003, ...u('名前'), 0, 0], [0x000c, 0, 0, 0]];

  test('parse, round trip and rebuild with a longer message', () => {
    const data = makeGmsg(msgs);
    const g = new Gmsg(data);
    expect(g.roundTrips()).toBe(true);
    expect(plainText(g.units(100)!)).toBe('こんにちは 元気?');
    const longer = Uint16Array.from([0x010e, ...u('ずっと長い文になりました'), 0]);
    const out = new Gmsg(g.build(new Map([[100, longer]])));
    expect([...out.units(100)!]).toEqual([...longer]);
    expect([...out.units(101)!]).toEqual(msgs[1]!);
    expect([...out.units(102)!]).toEqual(msgs[2]!);
    const built = g.build(new Map([[100, longer]]));
    expect(u32(built, 4)).toBe(built.length);
    expect([...built.subarray(u32(built, 0x1c) - 4, u32(built, 0x1c))]).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  test('text form keeps every unit', () => {
    for (const m of msgs) {
      const t = unitsToText(Uint16Array.from(m));
      expect([...textToUnits(t)]).toEqual(m);
    }
    const t = unitsToText(Uint16Array.from(msgs[1]!));
    expect(t.kind).toBe(1);
    expect(t.text).toBe('{E001}{0000}{0003}名前');
    expect(unitsToText(Uint16Array.from(msgs[0]!)).text).toBe('こんにちは\n元気?');
    // braces are escaped, and a bad code is refused
    const br = Uint16Array.from([1, ...u('{a}'), 0]);
    expect(unitsToText(br).text).toBe('{007B}a{007D}');
    expect([...textToUnits(unitsToText(br))]).toEqual([...br]);
    expect(() => textToUnits({ kind: 1, text: '{zz}', tail: new Uint16Array([0]) })).toThrow();
    expect(() => textToUnits({ kind: 1, text: 'a}', tail: new Uint16Array([0]) })).toThrow();
    // placeholders and "&" + message ID
    const ref = Uint16Array.from([0x010e, ...u('ここ、'), 0x26, 0xb0, ...u('。'), 0x0101, ...u('の家&'), 0]);
    const rt = unitsToText(ref);
    expect(rt.text).toBe('ここ、{&00B0}。{0101}の家{0026}');
    expect([...textToUnits(rt)]).toEqual([...ref]);
    expect(() => textToUnits({ kind: 1, text: 'A&B', tail: new Uint16Array([0]) })).toThrow();
    expect(previewText(ref, (id) => (id === 0xb0 ? 'デンパタウン' : undefined))).toBe('ここ、デンパタウン。〔0101〕の家&');
    expect(previewText(ref, () => undefined)).toBe('ここ、〔&00B0〕。〔0101〕の家&');
    // the type code is not part of the text
    expect(plainText(ref)).toBe('ここ、&°。āの家&');
  });

  test('store: edits, revert and replacements', () => {
    const store = new MessageStore([{ name: 'MessageTest_JP.gsmb', entryIndex: 3, gmsg: new Gmsg(makeGmsg(msgs)), editable: true }]);
    store.setText(100, 'やあ');
    expect(store.plain(100)).toBe('やあ');
    store.setKind(100, 0x010f);
    expect(store.text(100)!.kind).toBe(0x010f);
    store.setKind(100, 0x010e);
    expect(store.editedIds()).toEqual([100]);
    const rep = store.replacements();
    expect([...rep.keys()]).toEqual([3]);
    expect(plainText(new Gmsg(rep.get(3)!).units(100)!)).toBe('やあ');
    store.setText(100, 'こんにちは\n元気?'); // back to the original text
    expect(store.changed()).toBe(false);
    store.setText(102, 'x');
    const saved = store.saved();
    store.revert(102);
    expect(store.changed()).toBe(false);
    store.restore(saved);
    expect(store.plain(102)).toBe('x');
    expect(() => store.setText(99, 'x')).toThrow();
  });
});
