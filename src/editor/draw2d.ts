// What every game's top-down view draws the same way (RPG2's view2d.ts, RPG3's and RPG FREE!'s mapview.ts): the
// tiles, section 6's cells, the selection and the hovered cell with the brush or the copied range. Each view draws its
// records itself, between the cells and the selection.
import { letterLabel, type MapDoc, type Tile } from '../game/sections';
import { norm, type Controller } from './controller';
import { drawTileGlyph, strokeCell } from './gridcanvas';
import { kindColor, ROOM_COLOR, ROT_ARROW } from './legend';
import { GRID, type MapEditState } from './model';
import { snapOrigin } from './snap';

/**
 * A tile of `kind` turned `rot` (0..3). `rotDir` says where each turn faces, as an index of ROT_ARROW (default:
 * north, east, south, west; RPG FREE!: LANAI_ROT_DIR).
 */
export function drawTile(
  g: CanvasRenderingContext2D,
  s: number,
  x: number,
  y: number,
  kind: number,
  rot: number,
  letter: number,
  rotDir?: readonly number[],
): void {
  const dir = rotDir?.[rot] ?? rot;
  drawTileGlyph(g, s, x, y, kindColor(kind), dir, `${kind}${letterLabel(letter)}`, ROT_ARROW[dir]);
}

export function drawTiles(
  g: CanvasRenderingContext2D,
  s: number,
  tiles: readonly Tile[],
  rotDir?: readonly number[],
): void {
  for (const t of tiles) drawTile(g, s, t.x, t.y, t.kind, t.rot, t.letter, rotDir);
}

/** Section 6's cells (no random battles). */
export function drawRoomCells(g: CanvasRenderingContext2D, s: number, doc: MapDoc): void {
  g.fillStyle = ROOM_COLOR;
  for (const c of doc.cells6) g.fillRect(c.x * s + 2, c.y * s + 2, s - 4, s - 4);
}

/** The selected cells or range. */
export function drawSelection(g: CanvasRenderingContext2D, s: number, st: MapEditState): void {
  const sel = st.selection;
  g.strokeStyle = '#ffeb3b';
  g.lineWidth = 2;
  if (sel.type === 'tiles') for (const [x, y] of sel.cells) g.strokeRect(x * s + 1, y * s + 1, s - 2, s - 2);
  if (sel.type === 'rect') {
    const r = norm(sel);
    g.setLineDash([6, 4]);
    g.strokeRect(r.x0 * s, r.y0 * s, (r.x1 - r.x0 + 1) * s, (r.y1 - r.y0 + 1) * s);
    g.setLineDash([]);
  }
}

/** The hovered cell: the brush when painting, the copied range when selecting a range, and its outline. */
export function drawHover(
  g: CanvasRenderingContext2D,
  s: number,
  st: MapEditState,
  hover: [number, number] | null,
  rotDir?: readonly number[],
): void {
  if (!hover) return;
  const [x, y] = hover;
  if (st.tool === 'paint') {
    const brush = st.brushAt(x, y);
    g.globalAlpha = 0.6;
    if (brush) drawTile(g, s, x, y, brush.kind, brush.rot, brush.letter, rotDir);
    g.globalAlpha = 1;
  }
  g.strokeStyle = '#fff';
  g.lineWidth = 1.5;
  if (st.clip && st.tool === 'rect') {
    g.setLineDash([4, 3]);
    g.strokeRect(x * s, y * s, st.clip.w * s, st.clip.h * s);
    g.setLineDash([]);
  }
  strokeCell(g, s, x, y);
}

const GUIDE = '#ff4fd8';

/**
 * The snapping while a record is moved or placed: the grid of the step (faint, when its lines are far enough apart),
 * the alignment guides with the other records, and the place tool's point. Drawn after the records.
 */
export function drawSnap(g: CanvasRenderingContext2D, s: number, st: MapEditState, ctl: Controller): void {
  const active = ctl.dragging || !!ctl.placePoint;
  if (!active) return;
  const step = st.snap.step;
  if (st.snap.showGrid && step && step < 1 && step * s >= 5) {
    const o = snapOrigin(step);
    g.strokeStyle = 'rgba(120,200,255,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    for (let v = o; v <= GRID; v += step) {
      const p = Math.round(v * s) + 0.5;
      g.moveTo(p, 0);
      g.lineTo(p, GRID * s);
      g.moveTo(0, p);
      g.lineTo(GRID * s, p);
    }
    g.stroke();
  }
  if (st.snap.showGrid && step === 1 && s >= 8) {
    // the cell centres
    g.fillStyle = 'rgba(120,200,255,0.45)';
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) g.fillRect((x + 0.5) * s - 1, (y + 0.5) * s - 1, 2, 2);
  }
  g.strokeStyle = GUIDE;
  g.fillStyle = GUIDE;
  g.lineWidth = 1;
  for (const gd of ctl.snapGuides) {
    const a = gd.at * s,
      f = gd.from * s - s * 0.3,
      t = gd.to * s + s * 0.3;
    g.beginPath();
    if (gd.axis === 'x') {
      g.moveTo(a, f);
      g.lineTo(a, t);
    } else {
      g.moveTo(f, a);
      g.lineTo(t, a);
    }
    g.stroke();
  }
  if (ctl.placePoint) {
    const [x, y] = ctl.placePoint;
    const r = Math.max(4, s * 0.15);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x * s, y * s, r, 0, Math.PI * 2);
    g.moveTo(x * s - r * 1.6, y * s);
    g.lineTo(x * s + r * 1.6, y * s);
    g.moveTo(x * s, y * s - r * 1.6);
    g.lineTo(x * s, y * s + r * 1.6);
    g.stroke();
  }
}
