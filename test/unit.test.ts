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
import { ENT, ENTRANCE_SIZE, WORLD_SIZE, WORLD_TABLE, buildEntrances, coveredParts, groundFromTiles, moveEntrance, parseEntrances, parseGround, readWorldTable, setEntranceU32 } from '../src/game/worldmap';
import { validateWorld } from '../src/editor/validate';
import type { Game } from '../src/game/game';
import { findCodeMessageRefs, groupByFunction } from '../src/game/codemessages';
import { ArmMachine } from '../src/game/arm';
import { disassemble } from '../src/game/disasm';
import { askClaude, setApiKey } from '../src/ai/claude';
import { assembleLine } from '../src/game/asm';
import { buildPatches } from '../src/game/patch';
import { extractPatch } from '../src/ui/PatchPanel';
import { recordPlacement, section2Offset, slotOffset } from '../src/game/objects';
import type { MapDoc, Rec } from '../src/game/sections';
import type { Master } from '../src/game/master';

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

  test('drops on a shop list: rows move, new items are inserted, sold items move', async () => {
    const { dropInto } = await import('../src/game/shops');
    const l = [1, 2, 3, 4];
    expect(dropInto(l, { kind: 'row', index: 0 }, 4)).toEqual([2, 3, 4, 1]);
    expect(dropInto(l, { kind: 'row', index: 3 }, 0)).toEqual([4, 1, 2, 3]);
    expect(dropInto(l, { kind: 'row', index: 1 }, 1)).toEqual(l);
    expect(dropInto(l, { kind: 'row', index: 1 }, 2)).toEqual(l);
    expect(dropInto(l, { kind: 'row', index: 1 }, 3)).toEqual([1, 3, 2, 4]);
    expect(dropInto(l, { kind: 'item', id: 9 }, 2)).toEqual([1, 2, 9, 3, 4]);
    expect(dropInto(l, { kind: 'item', id: 9 }, 99)).toEqual([1, 2, 3, 4, 9]);
    expect(dropInto(l, { kind: 'item', id: 4 }, 0)).toEqual([4, 1, 2, 3]);
    expect(dropInto([], { kind: 'item', id: 5 }, 0)).toEqual([5]);
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
    expect(more.indexOffset % 16).toBe(0);
    // fewer rows: the index drops the rows that are gone
    const fewer = new GsTable(t.withRows(shopItemRows(new Map([[0, [1]], [1, []], [2, [93]]]))));
    expect(fewer.rows).toBe(n - 2);
    expect([...fewer.hashIndex().values()].every((r) => r < fewer.rows)).toBe(true);
    expect(fewer.hashIndex().size).toBe(n - 2);
    // without an index, the rows are padded with zeros to 16 bytes (the file size counts the padding)
    const plain = data.slice(0, idx);
    w32(plain, 0x18, idx);
    w32(plain, 0x20, 0);
    const padded = new GsTable(new GsTable(plain).withRows(rows.slice(0, 5)));
    expect(padded.data.length).toBe(0x40 + 5 * 8 + 8);
    expect(u32(padded.data, 0x18)).toBe(padded.data.length);
    expect(u32(padded.data, 0x14)).toBe(5 * 8);
    expect(padded.data.subarray(0x40 + 5 * 8).every((b) => b === 0)).toBe(true);
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

describe('world maps', () => {
  const entrance = (id: number, dest: number, point: number, x: number, y: number): Uint8Array => {
    const r = new Uint8Array(ENTRANCE_SIZE);
    w32(r, 0, 75);
    w32(r, 4, id);
    w32(r, 8, dest);
    w32(r, 0x0c, point);
    w16(r, 0x1c, x);
    w16(r, 0x1e, y);
    r[0x20] = 0x41; // rotation 1, upper bits kept
    r[0x23] = 0x99;
    return r;
  };

  test('world table rows and entrance fields', () => {
    const code = new Uint8Array(WORLD_TABLE - 0x100000 + 4 * 32);
    for (let i = 0; i < 32; i++) w32(code, WORLD_TABLE - 0x100000 + i * 4, 0x1000 + i);
    const ws = readWorldTable(code, 0x100000);
    expect(ws.map((w) => w.code)).toEqual(['W01', 'W02', 'W98', 'W99']);
    expect(ws[0]!.hash).toBe(0xa8654391);
    expect(ws[1]!.sections[2]).toBe(0x100a);
    expect(ws[0]!.groundFile).toBe('W01_ground.bin');
    expect(ws[2]!.groundFile).toBeNull();
    expect(readWorldTable(new Uint8Array(16), 0x100000)).toEqual([]);

    const a = entrance(0x11, 0x98ec3fef, 0x22, 10, 299);
    const list = parseEntrances(buildEntrances([a, entrance(0x12, 0, 0, 1, 2)]));
    expect(list.length).toBe(2);
    expect(equalBytes(list[0]!, a)).toBe(true);
    expect([ENT.id(a), ENT.destMap(a), ENT.destPoint(a), ENT.x(a), ENT.y(a), ENT.rot(a)]).toEqual([0x11, 0x98ec3fef, 0x22, 10, 299, 1]);
    const m = moveEntrance(a, 400, -3, 2);
    expect([ENT.x(m), ENT.y(m), ENT.rot(m), m[0x20], m[0x23]]).toEqual([299, 0, 2, 0x42, 0x99]);
    expect(ENT.x(a)).toBe(10); // copies, not in place
    expect(ENT.destMap(setEntranceU32(a, 0x08, 0xa8654391))).toBe(0xa8654391);
  });

  test('ground.bin and section 0 terrain', () => {
    const b = new Uint8Array(0x10 + WORLD_SIZE * WORLD_SIZE * 2 + 81 * 8);
    w32(b, 0, 1);
    w32(b, 4, 0x10);
    b[0x10 + (5 * WORLD_SIZE + 7) * 2] = 12;
    b[0x11 + (5 * WORLD_SIZE + 7) * 2] = 0x83;
    const g = parseGround(b)!;
    expect([g.parts[5 * WORLD_SIZE + 7], g.rots[5 * WORLD_SIZE + 7], g.parts[0]]).toEqual([12, 3, 0]);
    expect(parseGround(b.subarray(0, 100))).toBeNull();
    const t = buildTiles([{ kind: 9, x: 299, y: 1, rot: 2, rotHi: 0, letter: 0, pad: 0 }, { kind: 3, x: 300, y: 0, rot: 0, rotHi: 0, letter: 0, pad: 0 }]);
    const g2 = groundFromTiles(t);
    expect([g2.parts[WORLD_SIZE + 299], g2.rots[WORLD_SIZE + 299]]).toEqual([9, 2]);
    expect(g2.parts.reduce((a, v) => a + v, 0)).toBe(9);
  });

  test('parts cover 2 x 2 and 2 cells, wrapping, without overwriting other parts', () => {
    const N = WORLD_SIZE;
    const g = { parts: new Uint8Array(N * N), rots: new Uint8Array(N * N) };
    const at = (x: number, y: number): number => y * N + x;
    g.parts[at(299, 299)] = 1; // 2 x 2 at the corner: wraps to x 0 / y 0
    g.parts[at(10, 10)] = 2; // 2 cells, rotation 0: x+1
    g.parts[at(20, 20)] = 2;
    g.rots[at(20, 20)] = 1; // rotation 1: y+1
    g.parts[at(30, 30)] = 1;
    g.parts[at(31, 31)] = 3; // a part of its own is kept
    const c = coveredParts(g, (p) => (p === 1 ? 0x10 : p === 2 ? 0x20 : 0));
    expect([c[at(0, 299)], c[at(299, 0)], c[at(0, 0)]]).toEqual([1, 1, 1]);
    expect([c[at(11, 10)], c[at(10, 11)]]).toEqual([2, 0]);
    expect([c[at(20, 21)], c[at(21, 20)]]).toEqual([2, 0]);
    expect([c[at(31, 30)], c[at(30, 31)], c[at(31, 31)]]).toEqual([1, 1, 3]);
    expect(g.parts[at(11, 10)]).toBe(0); // the ground itself is not changed
  });

  test('checks of edited entrances: missing point, lead back, duplicate IDs', () => {
    const W = 0xa8654391;
    const dungeon = { hash: 0x98ec3fef, name: 'D01B02001', dungeon: 1, dungeonCode: 'D01', floor: -2, mapDataKey: 0, sections: [0x98ec3fef, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
    const p3 = (id: number, dest: number, point: number): Uint8Array => {
      const r = new Uint8Array(28);
      w32(r, 0, id);
      w32(r, 4, dest);
      w32(r, 8, point);
      return r;
    };
    const sec3 = new Uint8Array([...p3(0x22, W, 0x11), ...p3(0x23, W, 0x99)]);
    const game = {
      code: { byHash: (h: number) => (h === dungeon.hash ? dungeon : undefined), world: (h: number) => (h === W ? { hash: W, code: 'W01' } : undefined) },
      db: { get: (h: number) => (h === 3 ? sec3 : new Uint8Array(0)) },
    } as unknown as Game;
    const orig = [entrance(0x11, dungeon.hash, 0x22, 1, 1), entrance(0x12, dungeon.hash, 0x22, 2, 2), entrance(0x13, dungeon.hash, 0x22, 3, 3)];
    expect(validateWorld(game, W, orig, orig, new Map())).toEqual([]); // unedited ones are not checked
    const edited = [
      moveEntrance(orig[0]!, 5, 5), // still leads back
      setEntranceU32(orig[1]!, 0x0c, 0x23), // point 0x23 leads to entrance 0x99
      setEntranceU32(setEntranceU32(orig[2]!, 0x04 as never, 0x11), 0x0c, 0x77), // duplicate ID, missing point
    ];
    const issues = validateWorld(game, W, edited, orig, new Map());
    expect(issues.map((i) => [i.index, i.level, i.key])).toEqual([
      [0, 'error', 'wdup/00000011'],
      [1, 'warn', 'wback/00000012'],
      [2, 'error', 'wdup/00000011'],
      [2, 'error', 'wpoint/00000011'],
    ]);
  });
});

describe('messages in code.bin', () => {
  test('literal-pool loads and movw are found, and grouped by the push before them', () => {
    const code = new Uint8Array(0x40);
    const words = [
      0xe92d4010, // 0x100000 push {r4, lr}
      0xe59f0008, // 0x100004 ldr r0, [pc, #8] -> 0x100014
      0xe3010c0b, // 0x100008 movw r0, #0x1c0b
      0xe8bd8010, // 0x10000c pop {r4, pc}
      0xe92d4000, // 0x100010 push {lr}
      0x00001c0c, // 0x100014 literal (not an instruction: no push before it counts)
      0xe51f0010, // 0x100018 ldr r0, [pc, #-16] -> 0x100010 (0xE92D4000: out of range)
      0xe59f0000, // 0x10001c ldr r0, [pc, #0] -> 0x100024
      0xe8bd8000, // 0x100020 pop {pc}
      0x00001c0a, // 0x100024 literal
    ];
    words.forEach((w, i) => w32(code, i * 4, w));
    const refs = findCodeMessageRefs(code, 0x1bdf, 0x21af);
    expect(refs).toEqual([
      { id: 0x1c0c, at: 0x100004 },
      { id: 0x1c0b, at: 0x100008 },
      { id: 0x1c0a, at: 0x10001c },
    ]);
    expect(groupByFunction(code, refs).map((g) => [g.fn, g.ids])).toEqual([
      [0x100010, [0x1c0a]],
      [0x100000, [0x1c0b, 0x1c0c]],
    ]);
  });
});

describe('ARM interpreter (game/arm.ts)', () => {
  // A tiny code.bin at 0x100000: f(a, b) = callee(a) + b with a branch on the flags; callee(x) = x * 3 (stubbed below)
  const words = [
    0xe92d4010, // 100000 push {r4, lr}
    0xe1a04001, // 100004 mov r4, r1
    0xeb000005, // 100008 bl 0x100024
    0xe0800004, // 10000C add r0, r0, r4
    0xe3500010, // 100010 cmp r0, #0x10
    0xc3a00001, // 100014 movgt r0, #1
    0xe8bd8010, // 100018 pop {r4, pc}
    0xe1a00000, // 10001C nop
    0xe1a00000, // 100020 nop
    0xe0800080, // 100024 add r0, r0, r0, lsl #1
    0xe12fff1e, // 100028 bx lr
  ];
  const code = new Uint8Array(words.length * 4);
  words.forEach((w, i) => new DataView(code.buffer).setUint32(i * 4, w, true));

  test('runs calls, shifts, conditions and returns', () => {
    const m = new ArmMachine(code);
    expect(m.run(0x100000, [2, 3])).toBe(9); // 2 * 3 + 3
    expect(m.run(0x100000, [5, 3])).toBe(1); // 18 > 16
    expect(m.calls.some((c) => c.target === 0x100024)).toBe(true);
  });

  test('stubs replace calls', () => {
    const m = new ArmMachine(code, { stubs: new Map([[0x100024, () => 7]]) });
    expect(m.run(0x100000, [2, 3])).toBe(10);
  });
});

describe('ARM disassembler (game/disasm.ts)', () => {
  const d = (w: number, a = 0x100000) => disassemble(w, a).text;
  test('capstone-style text', () => {
    expect(d(0xe92d4010)).toBe('push {r4, lr}');
    expect(d(0xe8bd8010)).toBe('pop {r4, pc}');
    expect(d(0xe3500010)).toBe('cmp r0, #0x10');
    expect(d(0xc3a00001)).toBe('movgt r0, #1');
    expect(d(0xe0800080)).toBe('add r0, r0, r0, lsl #1');
    expect(d(0xe1a00801)).toBe('lsl r0, r1, #0x10');
    expect(d(0xe59f0024, 0x31bae0)).toBe('ldr r0, [pc, #0x24]');
    expect(disassemble(0xe59f0024, 0x31bae0).literal).toBe(0x31bb0c);
    expect(d(0xe5c60080)).toBe('strb r0, [r6, #0x80]');
    expect(d(0xe1d430b2)).toBe('ldrh r3, [r4, #2]');
    expect(d(0xeb03089e, 0x2587ac)).toBe('bl #0x31aa2c');
    expect(d(0x0a000014, 0x1d1984)).toBe('beq #0x1d19dc');
    expect(d(0xe12fff1e)).toBe('bx lr');
    expect(d(0xe6ff2071)).toBe('uxth r2, r1');
    expect(d(0xed2d8b02)).toBe('vpush {d8}');
    expect(d(0xed9f8a9d)).toBe('vldr s16, [pc, #0x274]');
    expect(d(0xeef1fa10)).toBe('vmrs apsr_nzcv, fpscr');
    expect(d(0xeeb70a00)).toBe('vmov.f32 s0, #1');
  });
});

describe('asking Claude (ai/claude.ts)', () => {
  test('streams the answer and sends the context as a cached system prompt', async () => {
    let sent: { url: string; headers: Headers; body: any } | null = null;
    const events = [
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'スイッチを' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '押すと扉が開く' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } },
      { type: 'message_stop' },
    ];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
      const sse = events.map((e) => `event: ${e.type}
data: ${JSON.stringify(e)}

`).join('');
      return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    setApiKey('sk-ant-test', false);
    let streamed = '';
    const r = await askClaude({ system: 'ゲームの説明', prompt: 'イベント', onText: (d) => (streamed += d), fetch: fakeFetch });
    setApiKey('', false);
    expect(streamed).toBe('スイッチを押すと扉が開く');
    expect(r.text).toBe(streamed);
    expect(r.outputTokens).toBe(7);
    expect(sent!.url).toContain('/v1/messages');
    expect(sent!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(sent!.body.model).toBe('claude-opus-5');
    expect(sent!.body.fallbacks).toBe('default');
    expect(sent!.body.thinking).toEqual({ type: 'adaptive' });
    expect(sent!.body.system[1]).toEqual({ type: 'text', text: 'ゲームの説明', cache_control: { type: 'ephemeral' } });
    expect(sent!.body.messages).toEqual([{ role: 'user', content: 'イベント' }]);
  });
});

describe('ARM assembler and code patches (game/asm.ts, game/patch.ts)', () => {
  const a = (t: string, addr = 0x100000) => assembleLine(t, addr).words[0]!;
  test('the inverse of the disassembler', () => {
    const lines: [string, number, number?][] = [
      ['push {r4, lr}', 0xe92d4010], ['pop {r4, pc}', 0xe8bd8010], ['push {lr}', 0xe52de004], ['cmp r0, #0x10', 0xe3500010],
      ['movgt r0, #1', 0xc3a00001], ['add r0, r0, r0, lsl #1', 0xe0800080], ['lsl r0, r1, #0x10', 0xe1a00801],
      ['ldr r0, [pc, #0x24]', 0xe59f0024], ['strb r0, [r6, #0x80]', 0xe5c60080], ['ldrh r3, [r4, #2]', 0xe1d430b2],
      ['bl #0x31aa2c', 0xeb03089e, 0x2587ac], ['beq #0x1d19dc', 0x0a000014, 0x1d1984], ['bx lr', 0xe12fff1e], ['uxth r2, r1', 0xe6ff2071],
      ['vpush {d8}', 0xed2d8b02], ['vldr s16, [pc, #0x274]', 0xed9f8a9d], ['vmrs apsr_nzcv, fpscr', 0xeef1fa10], ['vmov.f32 s1, s17', 0xeef00a68],
      ['mov r0, #-1', 0xe3e00000], ['nop', 0xe320f000], ['vcvt.f32.s32 s0, s0', 0xeeb80ac0], ['mul r0, r1, r2', 0xe0000291],
    ];
    for (const [t, w, at] of lines) expect([t, a(t, at).toString(16)]).toEqual([t, w.toString(16)]);
    expect(() => a('movw r0, #1')).toThrow();
    expect(() => a('mov r0, #0x12345')).toThrow();
  });

  test('blocks, the cave, literal pools and errors', () => {
    const code = new Uint8Array(0x3c0000); // zero .text: the whole cave is free
    const src = `@0x2587A4\n  bl two ; call the cave\n@cave two\n  push {r4, lr}\n  ldr r0, =0x1C77\n  vldr s0, =1.0\n  pop {r4, pc}\n`;
    const b = buildPatches(code, [{ id: 'a', title: 'a', source: src, enabled: true }]).get('a')!;
    expect(b.errors).toEqual([]);
    const cave = b.blocks[1]!;
    expect(cave.addr).toBe(0x4bff80 - 24);
    expect(b.labels.get('two')).toBe(cave.addr);
    expect(cave.lines.map((l) => l.word.toString(16))).toEqual(['e92d4010', 'e59f0004', 'ed9f0a01', 'e8bd8010', '1c77', '3f800000']);
    expect(b.blocks[0]!.lines[0]!.word).toBe(assembleLine('bl two', 0x2587a4, () => cave.addr).words[0]!);
    const bad = buildPatches(code, [{ id: 'b', title: 'b', source: '@0x2587A4\n  ldr r0, =1\n@0x4BF100\n  nop\n  foo r0\n', enabled: true }]).get('b')!;
    expect(bad.errors.map((e) => e.line)).toEqual([2, 3, 5]);
  });

  test('the patch block of an AI answer', () => {
    expect(extractPatch('方針\n```patch\n@0x100\n  nop\n```\nおわり')).toBe('@0x100\n  nop\n');
    expect(extractPatch('なし')).toBeNull();
  });
});

describe('object placement (FUN_001c6b64, FUN_002effa0)', () => {
  const doc = (tiles: MapDoc['tiles'] = []): MapDoc => ({ hash: 0, name: '', dungeon: 0, floor: 0, tiles, recs: {}, sec6Header: new Uint8Array(0), cells6: [], raw: {} });
  const master = { mapParts: { rows: 0 } } as unknown as Master;
  const rec2 = (id: number, dir: number): Rec => {
    const raw = new Uint8Array(12);
    w32(raw, 0, id);
    raw[8] = dir;
    return { raw, x: 0, y: 0 };
  };
  const rec3 = (kind: number, aux: number, slot: number, step = 0): Rec => {
    const raw = new Uint8Array(28);
    raw[0x14] = kind;
    raw[0x15] = aux;
    raw[0x19] = slot;
    raw[0x1a] = step;
    return { raw, x: 0, y: 0 };
  };
  const round = (p: { angle: number; ox: number; oy: number; oz: number }) => ({ angle: Math.round((p.angle * 180) / Math.PI), ox: Math.round(p.ox * 10) / 10, oy: p.oy, oz: Math.round(p.oz * 10) / 10 });

  test('section 2: angle table is the section 3 one turned by 180°', () => {
    expect([0, 1, 2, 3, 7].map((d) => round(recordPlacement(2, rec2(0xc1, d), doc(), master)).angle)).toEqual([180, 90, 0, -90, 180]);
  });

  test('section 2: offsets by mapObject row', () => {
    // jump table of FUN_001c6b64: odd rows 0x9F..0xAD are pushed to the wall, even rows 0x9E..0xAC only sink
    expect([0, 1, 2, 3].map((d) => section2Offset(0x9f, d))).toEqual([[0, -5, 50], [50, -5, 0], [0, -5, -50], [-50, -5, 0]]);
    expect(section2Offset(0xad, 1)).toEqual([50, -5, 0]);
    expect(section2Offset(0x9e, 1)).toEqual([0, -5, 0]);
    expect(section2Offset(0xaa, 2)).toEqual([0, -5, 0]);
    expect([0, 1, 2, 3].map((d) => section2Offset(0xba, d))).toEqual([[-20, 0, -20], [30, 0, -130], [30, 0, -20], [-20, 0, 30]]);
    expect(section2Offset(0xda, 1)).toEqual([0, 0, 250]);
    expect(section2Offset(0xc1, 0)).toEqual([0, 0, 0]);
  });

  test('section 3: slot inside the cell', () => {
    expect(slotOffset(4)).toEqual([0, 0]);
    expect(slotOffset(0).map(Math.round)).toEqual([-167, -167]);
    expect(slotOffset(8).map(Math.round)).toEqual([167, 167]);
  });

  test('section 3: indoor stairs move to their slot and 50 towards +0x15 (S10B01AAA)', () => {
    const indoor = doc([{ kind: 15, x: 0, y: 0, rot: 0, rotHi: 0, letter: 0x7a, pad: 0 }]);
    expect(round(recordPlacement(3, rec3(4, 3, 8), indoor, master))).toEqual({ angle: 0, ox: 116.7, oy: 0, oz: 166.7 });
    expect(round(recordPlacement(3, rec3(4, 3, 2), indoor, master))).toEqual({ angle: 0, ox: 116.7, oy: 0, oz: -166.7 });
  });

  test('section 3: doors step 100, or 250 with +0x1A', () => {
    expect(round(recordPlacement(3, rec3(11, 1, 4), doc(), master))).toEqual({ angle: -90, ox: 100, oy: 0, oz: 0 });
    expect(round(recordPlacement(3, rec3(11, 1, 4, 1), doc(), master))).toEqual({ angle: -90, ox: 250, oy: 0, oz: 0 });
  });
});
