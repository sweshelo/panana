// Snapping of the records moved and placed in the map editors (every game): a grid of a chosen step, alignment with
// the other records of the map (guide lines, like the smart guides of drawing tools), and the encoding of a free
// position in the records that have f32 offsets (RPG3 / RPG FREE!: world = base(v) + d × 100, the f32 d next to the
// s16 v). Records without offsets keep their own units (setRecCellPos rounds to them).
import { CELL, recCellPos, setRecCellPos, type Rec, type RecordLayout } from '../game/sections';
import { wf32 } from '../util/bytes';

/** Steps of the snap grid, in cells; 0 = no grid (free, to 1/500 cell). */
export const SNAP_STEPS = [1, 0.5, 0.2, 0.1, 0] as const;
export type SnapStep = (typeof SNAP_STEPS)[number];
export const SNAP_STEP_LABEL: Record<SnapStep, string> = {
  1: '1 マス (中心)',
  0.5: '1/2 マス',
  0.2: '1/5 マス (従来の整数)',
  0.1: '1/10 マス',
  0: 'なし (自由)',
};

export interface SnapSettings {
  /** The grid step in cells (0: free). */
  step: SnapStep;
  /** Snap to the x / y of the other records of the map (and show guides). */
  align: boolean;
  /** Show the grid of the step in the 2D view while placing or moving. */
  showGrid: boolean;
}

export const DEFAULT_SNAP: SnapSettings = { step: 0.1, align: true, showGrid: true };

/**
 * Where the grid of a step has its lines, in cells: the step 1 grid is the cell centres (the middle of a cell, where
 * most of the game's objects stand), the 1/5 grid the record's own s16 units (world 50 + v × 100 = 0.1 + v / 5), the
 * others start at the cell corner (they contain the centres).
 */
export function snapOrigin(step: number): number {
  return step === 1 ? 0.5 : step === 0.2 ? 0.1 : 0;
}

/** The free resolution: one world unit (1/500 cell). */
const FREE = 1 / CELL;

export function snapValue(v: number, step: number): number {
  const s = step || FREE,
    o = step ? snapOrigin(step) : 0;
  return Number((Math.round((v - o) / s) * s + o).toFixed(4));
}

/** A guide line of an alignment: the moved point lines up with another record along `axis` at `at`. */
export interface SnapGuide {
  /** 'x': a vertical line (same x), 'y': a horizontal one. */
  axis: 'x' | 'y';
  at: number;
  /** The extent of the line along the other axis (the two points it joins). */
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/**
 * Snap a point (cell coordinates): an axis within `tol` of another record's coordinate takes that coordinate (the
 * nearest one), else the grid's. `others`: the positions of the other records.
 */
export function snapPoint(
  cx: number,
  cy: number,
  set: Pick<SnapSettings, 'step' | 'align'>,
  others: readonly (readonly [number, number])[],
  tol: number,
): SnapResult {
  let x = snapValue(cx, set.step),
    y = snapValue(cy, set.step);
  const guides: SnapGuide[] = [];
  if (set.align) {
    let bx: number | null = null,
      by: number | null = null,
      dx = tol,
      dy = tol;
    for (const [ox, oy] of others) {
      const ax = Math.abs(ox - cx),
        ay = Math.abs(oy - cy);
      if (ax <= dx) [dx, bx] = [ax, ox];
      if (ay <= dy) [dy, by] = [ay, oy];
    }
    if (bx !== null) x = bx;
    if (by !== null) y = by;
    const eq = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4;
    if (bx !== null) {
      const ys = others.filter(([ox]) => eq(ox, bx!)).map(([, oy]) => oy);
      guides.push({ axis: 'x', at: x, from: Math.min(y, ...ys), to: Math.max(y, ...ys) });
    }
    if (by !== null) {
      const xs = others.filter(([, oy]) => eq(oy, by!)).map(([ox]) => ox);
      guides.push({ axis: 'y', at: y, from: Math.min(x, ...xs), to: Math.max(x, ...xs) });
    }
  }
  return { x, y, guides };
}

/** Whether records of a layout are moved in fractions of a cell (the snap applies); cell / world units are not. */
export const snapsIn = (L: RecordLayout): boolean => L.unit === 'fine' || L.unit === 'quarter';

/** Whether a layout can hold any position (an f32 offset next to fine / quarter units). */
export const freeIn = (L: RecordLayout): boolean =>
  snapsIn(L) && L.fxo !== undefined && L.fyo !== undefined && L.fxo + 4 <= L.size && L.fyo + 4 <= L.size;

/** World units of v (the s16) and of one step of it. */
function unitBase(L: RecordLayout): [number, number] {
  return L.unit === 'quarter' ? [125, 125] : [L.base ?? 50, 100];
}

/**
 * Put a record at (cx, cy) in cells. With f32 offsets, the s16 takes the unit at or below and the offset the rest
 * (world = base + v × k + d × 100), so the record sits exactly there; without them the record's units round it
 * (setRecCellPos, which also keeps its offsets).
 */
export function placeRec(r: Rec, L: RecordLayout, cx: number, cy: number): void {
  if (!freeIn(L)) {
    setRecCellPos(r, L, cx, cy);
    return;
  }
  const [b, k] = unitBase(L);
  const enc = (c: number): [number, number] => {
    const w = Math.round(c * CELL);
    // the unit at or below, the rest a positive offset (as the ROM's records: v + 0.5 is the usual form)
    const v = Math.max(0, Math.min(299, Math.floor((w - b) / k + 1e-9)));
    return [v, (w - b - v * k) / 100];
  };
  // an axis that stays where it is keeps its bytes (the ROM's own split of the s16 and the offset)
  const [px, py] = recCellPos(r, L);
  if (Math.abs(px - cx) * CELL >= 0.5) {
    const [v, d] = enc(cx);
    r.x = v;
    wf32(r.raw, L.fxo!, d);
  }
  if (Math.abs(py - cy) * CELL >= 0.5) {
    const [v, d] = enc(cy);
    r.y = v;
    wf32(r.raw, L.fyo!, d);
  }
}

/** Positions of the records of the given sections (cell coordinates), but one (the moved record). */
export function recPositions(
  recs: Record<number, Rec[] | undefined>,
  layouts: Record<number, RecordLayout>,
  sections: readonly number[],
  except?: { section: number; index: number },
): [number, number][] {
  const out: [number, number][] = [];
  for (const k of sections) {
    const L = layouts[k];
    if (!L) continue;
    (recs[k] ?? []).forEach((r, i) => {
      if (except && except.section === k && except.index === i) return;
      out.push(recCellPos(r, L));
    });
  }
  return out;
}
