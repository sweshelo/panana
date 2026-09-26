// Tests that need no ROM data.
import { describe, expect, test } from 'bun:test';
import { lz10Compress, lz10Decompress } from '../src/archive/lz10';
import { parseArchive, rebuildArchive, unpackEntry } from '../src/archive/gsarc';
import { MapDb } from '../src/game/mapdb';
import { buildTiles, letterByte, letterIndex, parseTiles, setRecCellPos, LAYOUTS, recCellPos } from '../src/game/sections';
import { decodeTexture } from '../src/cgfx/texture';
import { evalBaked, evalChannel, type AnimCurve } from '../src/cgfx/anim';
import { equalBytes, u32, w16, w32 } from '../src/util/bytes';
import { fromUnits, Gmsg, MessageStore } from '../src/game/gmsg';
import { parseBody, plainText, previewText, textToUnits, unitsToText } from '../src/game/msgtext';
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

describe('shops', () => {
  test('decode Shop rows and merge them with ShopItem', async () => {
    const { buildShops, decodeShopRow, shopLabel } = await import('../src/game/shops');
    const { GsTable } = await import('../src/archive/gstable');
    const row = new Uint8Array(0x38);
    for (let i = 0; i < 10; i++) w32(row, 0x0c + i * 4, 0xe3 + i);
    row[0x34] = 2;
    expect(decodeShopRow(row)).toEqual({ messages: [0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec], variant: 2 });
    // a table of 2 rows (header 0x40 bytes): shop 0 and shop 1
    const data = new Uint8Array(0x40 + 2 * 0x38);
    w32(data, 0, 2);
    w32(data, 4, 0x38);
    w32(data, 0x10, 0x40);
    data.set(row, 0x40 + 0x38);
    const shops = buildShops(new Map([[1, [2, 12]], [3, [5]]]), new GsTable(data));
    expect(shops.map((s) => [s.id, s.items, s.variant])).toEqual([[0, [], 0], [1, [2, 12], 2], [3, [5], -1]]);
    expect(shops[1]!.messages[0]).toBe(0xe3);
    expect(shops[2]!.messages).toEqual([]);
    expect(buildShops(new Map([[0, [1]]]), null)[0]!.variant).toBe(-1);
    expect([shopLabel(3), shopLabel(17)]).toEqual(['店 3', '店 17 (妖精の里)']);
  });

  test('ShopItem rows round trip, and withRows rebuilds a table with a hash index', async () => {
    const { parseShopItems, shopItemRows } = await import('../src/game/shops');
    const { GsTable } = await import('../src/archive/gstable');
    const lists = new Map([[0, [1, 12, 28]], [1, []], [2, [93]]]);
    const rows = shopItemRows(lists);
    expect(rows.length).toBe(3 + 3 + 0 + 1);
    // a ShopItem-like table (8-byte rows) with a hash index: {hash, row} sorted, then {0, 0}
    const n = rows.length;
    const idx = 0x40 + n * 8;
    const data = new Uint8Array(idx + (n + 1) * 8);
    w32(data, 0, n);
    w32(data, 4, 8);
    w32(data, 0x10, 0x40);
    w32(data, 0x14, n * 8);
    w32(data, 0x18, data.length);
    w32(data, 0x20, idx);
    rows.forEach((r, i) => data.set(r, 0x40 + i * 8));
    for (let i = 0; i < n; i++) {
      w32(data, idx + i * 8, 0x1000 + i);
      w32(data, idx + i * 8 + 4, i);
    }
    const t = new GsTable(data);
    expect([...parseShopItems(t)]).toEqual([...lists]);
    // one item more: every row keeps its hash, the new row gets a new one
    const more = new GsTable(t.withRows(shopItemRows(new Map([[0, [1, 12, 28, 5]], [1, []], [2, [93]]]))));
    expect(more.rows).toBe(n + 1);
    expect(parseShopItems(more).get(0)).toEqual([1, 12, 28, 5]);
    const index = more.hashIndex();
    expect(index.size).toBe(n + 1);
    expect(new Set(index.values())).toEqual(new Set([...Array(n + 1).keys()]));
    expect(u32(more.data, 0x18)).toBe(more.data.length);
    expect(more.indexOffset % 8).toBe(0);
    // fewer rows: the index drops the rows that are gone
    const fewer = new GsTable(t.withRows(shopItemRows(new Map([[0, [1]], [1, []], [2, [93]]]))));
    expect(fewer.rows).toBe(n - 2);
    expect([...fewer.hashIndex().values()].every((r) => r < fewer.rows)).toBe(true);
    expect(fewer.hashIndex().size).toBe(n - 2);
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
  /** A GMSG with IDs 100.. holding the given messages (units, or bytes for a reading file). */
  const makeGmsg = (msgs: (number[] | Uint8Array)[], reading = false): Uint8Array => {
    const tbl = 0x20;
    const base = tbl + msgs.length * 4;
    const bodies = msgs.map((m) => (m instanceof Uint8Array ? m : fromUnits(Uint16Array.from(m))));
    const size = base + bodies.reduce((a, m) => a + m.length, 0);
    const b = new Uint8Array(size);
    b.set([0x47, 0x4d, 0x53, 0x47]);
    w32(b, 4, size);
    w32(b, 8, 100);
    w32(b, 12, 100 + msgs.length - 1);
    w32(b, 0x10, reading ? 1 : 0);
    w32(b, 0x14, 1);
    w32(b, 0x18, tbl);
    w32(b, 0x1c, base);
    let o = 0;
    bodies.forEach((m, i) => {
      w32(b, tbl + i * 4, o);
      b.set(m, base + o);
      o += m.length;
    });
    return b;
  };
  const u = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
  const T = 1; // tag
  const msgs = [
    [0x0001, T, 0x10e, ...u('こんにちは'), 0x0a, ...u('元気?'), 0],
    [0x0001, ...u('ここ、'), 2, 0x26, 102, 0, ...u('。'), T, 0x10, 0x0a, T, 0x101, ...u('の'), T, 0x27, ...u('祠'), T, 0x28, ...u('ほこら'), T, 0x29, T, 0x0a, 0],
    [0x0001, ...u('デンパタウン'), 0],
  ];

  test('parse, round trip and rebuild with a longer message', () => {
    const g = new Gmsg(makeGmsg(msgs));
    expect(g.roundTrips()).toBe(true);
    const longer = Uint16Array.from([0x0001, ...u('ずっと長い文になりました'), 0]);
    const built = g.build(new Map([[100, fromUnits(longer)]]));
    const out = new Gmsg(built);
    expect([...out.units(100)!]).toEqual([...longer]);
    expect([...out.units(101)!]).toEqual(msgs[1]!);
    expect(u32(built, 4)).toBe(built.length);
  });

  test('text form: tags, ruby, page breaks and references are kept', () => {
    for (const m of msgs) expect([...textToUnits(unitsToText(Uint16Array.from(m)))]).toEqual(m);
    expect(unitsToText(Uint16Array.from(msgs[0]!)).text).toBe('{tag:010E}こんにちは\n元気?');
    expect(unitsToText(Uint16Array.from(msgs[1]!)).text).toBe('ここ、{msg:0066}。{page}\n{tag:0101}の{ruby:祠|ほこら}{tag:000A}');
    const br = Uint16Array.from([1, ...u('{a|b}'), 0]);
    expect(unitsToText(br).text).toBe('{007B}a{007C}b{007D}');
    expect([...textToUnits(unitsToText(br))]).toEqual([...br]);
    expect(() => textToUnits({ kind: 1, text: '{zz}', tail: new Uint16Array([0]) })).toThrow();
    expect(() => textToUnits({ kind: 1, text: 'a}', tail: new Uint16Array([0]) })).toThrow();
    expect(() => textToUnits({ kind: 1, text: '{ruby:祠}', tail: new Uint16Array([0]) })).toThrow();
    expect(() => textToUnits({ kind: 1, text: '{tag:0024}', tail: new Uint16Array([0]) })).toThrow(); // takes 2 arguments
    expect([...textToUnits({ kind: 1, text: '{tag:0024,1,2}', tail: new Uint16Array([0]) })]).toEqual([1, T, 0x24, 1, 2, 0]);
  });

  test('previews and plain text', () => {
    const m1 = Uint16Array.from(msgs[1]!);
    expect(parseBody(m1).tokens.map((t) => t.t)).toEqual(['text', 'ref', 'text', 'tag', 'br', 'tag', 'text', 'ruby', 'tag']);
    // the page break eats its line break; [0001][000A] is a number, not a line break
    expect(previewText(m1, (id) => (id === 102 ? 'デンパタウン' : undefined))).toBe('ここ、デンパタウン。\n〈電波人間〉の祠〈数値〉');
    expect(previewText(Uint16Array.from(msgs[0]!), () => undefined)).toBe('こんにちは\n元気?'); // the voice tag is not shown
    expect(plainText(Uint16Array.from(msgs[0]!))).toBe('こんにちは 元気?');
    expect(plainText(m1)).toBe('ここ、。 āの祠');
  });

  test('store: edits, readings blanked, revert and replacements', () => {
    const reading = makeGmsg([new Uint8Array([0x41, 0x42, 0]), new Uint8Array([0x43, 0]), new Uint8Array([0x44, 0x45, 0x46, 0])], true);
    const store = new MessageStore([
      { name: 'MessageTest_JP.gsmb', entryIndex: 3, gmsg: new Gmsg(makeGmsg(msgs)), editable: true },
      { name: 'MessageTest_IN_JP.gsmb', entryIndex: 4, gmsg: new Gmsg(reading), editable: true },
    ]);
    expect(store.files.length).toBe(1);
    expect(store.readings.length).toBe(1);
    store.setText(100, '{tag:010F}やあ');
    expect(store.plain(100)).toBe('やあ');
    expect(store.preview(101, true)).toBe('ここ、デンパタウン。 〈電波人間〉の祠〈数値〉');
    const rep = store.replacements();
    expect([...rep.keys()].sort()).toEqual([3, 4]);
    expect(plainText(new Gmsg(rep.get(3)!).units(100)!)).toBe('やあ');
    const r = new Gmsg(rep.get(4)!);
    expect([...r.raw[0]!]).toEqual([0, 0, 0]);
    expect([...r.raw[2]!]).toEqual([0x44, 0x45, 0x46, 0]);
    store.setText(100, '{tag:010E}こんにちは\n元気?'); // back to the original text
    expect(store.changed()).toBe(false);
    store.setKind(102, 0x000c);
    const saved = store.saved();
    store.revert(102);
    expect(store.changed()).toBe(false);
    store.restore(saved);
    expect(store.text(102)!.kind).toBe(0x000c);
    expect(() => store.setText(99, 'x')).toThrow();
  });
});
