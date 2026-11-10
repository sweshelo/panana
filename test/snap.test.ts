// The snapping of the map editors (src/editor/snap.ts): the grids, the alignment with other records and the encoding
// of a free position in the s16 + f32 offset of RPG3 / RPG FREE! records.
import { beforeAll, describe, expect, test } from 'bun:test';
import { placeRec, snapPoint, snapValue } from '../src/editor/snap';
import { LAYOUTS, recCellPos, type Rec } from '../src/game/sections';
import { lanaiContents } from '../src/lanai/contents';
import { LANAI_LAYOUTS, LanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { f32, wf32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const rec = (section: number, x: number, y: number, dx = 0, dy = 0): Rec => {
  const L = LANAI_LAYOUTS[section]!;
  const raw = new Uint8Array(L.size);
  wf32(raw, L.fxo!, dx);
  wf32(raw, L.fyo!, dy);
  return { raw, x, y };
};

describe('grids', () => {
  test('1 cell snaps to the centres, 1/5 to the s16 units, 1/2 and 1/10 from the corner', () => {
    expect(snapValue(7.31, 1)).toBe(7.5);
    expect(snapValue(7.96, 1)).toBe(7.5);
    expect(snapValue(8.01, 1)).toBe(8.5);
    expect(snapValue(7.31, 0.2)).toBe(7.3);
    expect(snapValue(7.42, 0.2)).toBe(7.5);
    expect(snapValue(7.26, 0.5)).toBe(7.5);
    expect(snapValue(7.36, 0.1)).toBe(7.4);
    // no grid: one world unit (1/500 cell)
    expect(snapValue(7.4013, 0)).toBe(7.402);
  });
});

describe('alignment', () => {
  test('an axis near another record takes its value, with a guide; the other axis keeps the grid', () => {
    const r = snapPoint(7.32, 3.13, { step: 0.5, align: true }, [[7.4, 9.5]], 0.15);
    expect(r.x).toBe(7.4);
    expect(r.y).toBe(3);
    expect(r.guides).toEqual([{ axis: 'x', at: 7.4, from: 3, to: 9.5 }]);
  });
  test('the nearest record wins; off: the grid only', () => {
    const others: [number, number][] = [
      [7.4, 1],
      [7.5, 2],
    ];
    expect(snapPoint(7.47, 5, { step: 0.1, align: true }, others, 0.15).x).toBe(7.5);
    const off = snapPoint(7.47, 5, { step: 0.2, align: false }, others, 0.15);
    expect(off.x).toBe(7.5);
    expect(off.guides).toEqual([]);
  });
});

describe('placing a record', () => {
  test('RPG FREE! props: any position goes into the s16 and the offset (world 50 + v × 100 + d × 100)', () => {
    const L = LANAI_LAYOUTS[2]!;
    const r = rec(2, 0, 0);
    placeRec(r, L, 7.4, 3.5);
    expect(r.x).toBe(36);
    expect(f32(r.raw, L.fxo!)).toBeCloseTo(0.5);
    expect(r.y).toBe(17);
    expect(f32(r.raw, L.fyo!)).toBe(0);
    const [px, py] = recCellPos(r, L);
    expect(px).toBeCloseTo(7.4, 6);
    expect(py).toBeCloseTo(3.5, 6);
    placeRec(r, L, 7.402, 3.5);
    expect(recCellPos(r, L)[0]).toBeCloseTo(7.402, 6);
  });

  test('characters start at 100 (FUN_0021c844): a cell centre is v + 0.5 (the usual offset of the ROM)', () => {
    const L = LANAI_LAYOUTS[5]!;
    const r = rec(5, 0, 0);
    placeRec(r, L, 7.5, 7.5);
    expect([r.x, r.y]).toEqual([36, 36]);
    expect(f32(r.raw, L.fxo!)).toBeCloseTo(0.5);
    expect(recCellPos(rec(5, 36, 36, 0.5, 0.5), L)).toEqual([7.5, 7.5]);
    expect(recCellPos(rec(5, 36, 36), L)).toEqual([7.4, 7.4]);
  });

  test("an axis that does not move keeps the ROM's own bytes (here v 36 + d 1.0)", () => {
    const L = LANAI_LAYOUTS[2]!;
    const r = rec(2, 36, 20, 1, 0.5);
    const [, y0] = recCellPos(r, L);
    placeRec(r, L, 9, y0);
    expect(r.x).toBe(44);
    expect(f32(r.raw, L.fxo!)).toBeCloseTo(0.5);
    expect(r.y).toBe(20);
    expect(f32(r.raw, L.fyo!)).toBeCloseTo(0.5);
  });

  test('RPG2 records have no offset: the position rounds to their 1/5 cell', () => {
    const L = LAYOUTS[2]!;
    const r: Rec = { raw: new Uint8Array(L.size), x: 0, y: 0 };
    placeRec(r, L, 7.42, 7.5);
    expect([r.x, r.y]).toEqual([37, 37]);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! maps (ROM)', () => {
  let all: LanaiMaps[];
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    const s = await LanaiSession.open(dump);
    all = [];
    for (const c of lanaiContents(s)) {
      try {
        all.push(await LanaiMaps.load(s, c));
      } catch {
        /* a content without maps */
      }
    }
  }, 300000);

  test('placing every record where it is changes no byte; moving it onto another record lands exactly there', () => {
    let n = 0;
    for (const m of all)
      for (const info of m.maps) {
        if (info.world) continue;
        const doc = m.doc(info);
        for (const k of [2, 4, 5, 8]) {
          const L = LANAI_LAYOUTS[k]!;
          const recs = doc.recs[k] ?? [];
          recs.forEach((r, i) => {
            const before = { raw: r.raw.slice(), x: r.x, y: r.y };
            const [px, py] = recCellPos(r, L);
            placeRec(r, L, px, py);
            expect({ raw: r.raw, x: r.x, y: r.y }).toEqual(before);
            const other = recs[(i + 1) % recs.length]!;
            const [ox, oy] = recCellPos(other, L);
            const copy: Rec = { raw: r.raw.slice(), x: r.x, y: r.y };
            placeRec(copy, L, ox, oy);
            const [cx, cy] = recCellPos(copy, L);
            expect(Math.abs(cx - ox) + Math.abs(cy - oy)).toBeLessThan(0.002);
            n++;
          });
        }
      }
    expect(n).toBeGreaterThan(15000);
  });

  test('characters (section 5) stand on cell centres with the 100 base, not with 50', () => {
    let at100 = 0,
      at50 = 0;
    const L = LANAI_LAYOUTS[5]!;
    const centre = (c: number): boolean => Math.abs(c - Math.floor(c) - 0.5) < 1e-3;
    for (const m of all)
      for (const info of m.maps) {
        if (info.world) continue;
        for (const r of m.doc(info).recs[5] ?? []) {
          const [x, y] = recCellPos(r, L);
          if (centre(x) && centre(y)) at100++;
          if (centre(x - 0.1) && centre(y - 0.1)) at50++;
        }
      }
    console.log(`section 5 on cell centres: base 100 ${at100}, base 50 ${at50}`);
    expect(at100).toBeGreaterThan(at50 * 3);
  });
});
