// What a range (section 8 record) is to the game: the shape it is hit by, in the map's cells (500 world units), for
// the map page to draw and tell. Read in the Update's code.bin (v17408; analysed 2026-11-14):
// - The ranges are made by 0x450324 from slot 7 of the map table (section 8) for the normal field (0x21BB4C) and for
//   the map made again (0x210DC0). Kinds >= 100 (props: MapObject 508〜510 by 0x21C3A8) make no range (0x450368), nor
//   a record whose EventObject row is 0, does not appear or has disappeared (0x45037C〜0x4503AC).
// - +0x1D (shape) 0 is a circle (a sphere: 0x450150 sums the squares of x, height and z), any other value a rectangle
//   along the axes (0x4503B4 maps 0 → 1, else → 2). The facing (+0x1C) is not read: rectangles do not turn.
// - Circle: the centre is 50 + 100 × (x + dx), 50 + 100 × (y + dy) world units (0x4503E0, 0x450560), the radius 100 ×
//   EventObject +0x5A (0x450588); the record's +0x14 / +0x18 are not read. A radius 0 hits nothing (strictly inside).
// - Rectangle: the corner of the smallest x / z is 100 × (x + dx), 100 × (y + dy) (no +50: 0x450414), the full width
//   and depth 100 × (+0x14), 100 × (+0x18) (0x4504BC; halved at the test 0x4500E4). The edges are inside.
// - What is tested is one point (the party's position) against the shape (0x20F7D8 → 0x450018), each time it is
//   called: there is no "entered / left" in it; the first range that holds the point wins.
// - EventObject +0x5C bit 15 picks the channel: set = 1, clear = 2 (0x4504DC). The per-frame path
//   (0x210598 -> 0x20FC68 / 0x20FC98) asks for 1; the A/L button path (0x2106C0 -> 0x20F7D8) asks for 2.
import { CELL, type Rec } from '../game/sections';
import { f32, u16, u32 } from '../util/bytes';
import type { LanaiTable } from './table';

/** The kinds of section 8 at and above which the record is a prop, not a range. */
export const LANAI_RANGE_PROP_KIND = 100;
/** EventObject +0x5A: a circle's radius in 100 world units. */
const EO_RADIUS = 0x5a;
/** EventObject +0x5C: bit 15 = channel 1 (entered by walking); clear = channel 2 (A/L button). */
const EO_CHANNEL = 0x5c;

export type LanaiRangeShape =
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number };

export interface LanaiRange {
  /** In cells (the map grid; 1 cell = 500 world units). Null: the record makes no range. */
  shape: LanaiRangeShape | null;
  /** Why it makes no range, or what keeps it from being walked into. */
  note: string;
  /** The range needs A/L while inside it, instead of starting when walked into. */
  pressToStart: boolean;
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

/** The range a section 8 record makes, with its EventObject table (the circle's radius and the channel are there). */
export function lanaiRange(rec: Rec, events: LanaiTable | undefined): LanaiRange {
  const { raw, x, y } = rec;
  const kind = u32(raw, 0);
  if (kind >= LANAI_RANGE_PROP_KIND)
    return { shape: null, note: '置物 (範囲の当たり判定は作られません)', pressToStart: false };
  const ev = u32(raw, 4);
  const row = events && ev > 0 && ev < events.rows ? events.row(ev) : null;
  if (!ev) return { shape: null, note: 'イベント番号が 0 なので、範囲は作られません', pressToStart: false };
  if (!row) return { shape: null, note: `イベント ${ev} が表にないので、範囲は作られません`, pressToStart: false };
  const ox = x + finite(f32(raw, 0x0c)),
    oy = y + finite(f32(raw, 0x10));
  const pressToStart = (u16(row, EO_CHANNEL) & 0x8000) === 0;
  const channel = pressToStart ? 'A ボタンを押すと起きます。' : '歩いて入ると起きます。';
  if (raw[0x1d] === 0) {
    const radius = u16(row, EO_RADIUS);
    const shape: LanaiRangeShape = {
      type: 'circle',
      cx: (50 + 100 * ox) / CELL,
      cy: (50 + 100 * oy) / CELL,
      r: (100 * radius) / CELL,
    };
    return {
      shape,
      pressToStart,
      note:
        (radius
          ? `円: 半径 ${radius * 100} (${shape.r.toFixed(1)} マス、イベントの +0x5A = ${radius})。`
          : '円: 半径が 0 (イベントの +0x5A = 0) なので、何にも当たりません。') + channel,
    };
  }
  const w = finite(f32(raw, 0x14)),
    h = finite(f32(raw, 0x18));
  const shape: LanaiRangeShape = {
    type: 'rect',
    x: (100 * ox) / CELL,
    y: (100 * oy) / CELL,
    w: (100 * w) / CELL,
    h: (100 * h) / CELL,
  };
  return {
    shape,
    pressToStart,
    note:
      `矩形: 幅 ${w * 100} × 奥行き ${h * 100} (${shape.w.toFixed(1)} × ${shape.h.toFixed(1)} マス)。位置は左上 (北西) の角で、向きでは回りません。` +
      (w <= 0 || h <= 0 ? '幅か奥行きが 0 なので、線か点にしか当たりません。' : '') +
      channel,
  };
}
