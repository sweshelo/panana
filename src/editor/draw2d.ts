// What every game's top-down view draws the same way (RPG2's view2d.ts, RPG3's and RPG FREE!'s mapview.ts): the
// tiles, section 6's cells, the selection and the hovered cell with the brush or the copied range. Each view draws its
// records itself, between the cells and the selection.
import { letterLabel, type MapDoc, type Tile } from '../game/sections';
import { norm } from './controller';
import { drawTileGlyph, strokeCell } from './gridcanvas';
import { kindColor, ROOM_COLOR, ROT_ARROW } from './legend';
import type { MapEditState } from './model';

/**
 * A tile of `kind` turned `rot` (0..3). `rotDir` says where each turn faces, as an index of ROT_ARROW (default:
 * north, east, south, west; RPG FREE!: LANAI_ROT_DIR).
 */
export function drawTile(g: CanvasRenderingContext2D, s: number, x: number, y: number, kind: number, rot: number, letter: number, rotDir?: readonly number[]): void {
  const dir = rotDir?.[rot] ?? rot;
  drawTileGlyph(g, s, x, y, kindColor(kind), dir, `${kind}${letterLabel(letter)}`, ROT_ARROW[dir]);
}

export function drawTiles(g: CanvasRenderingContext2D, s: number, tiles: readonly Tile[], rotDir?: readonly number[]): void {
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
export function drawHover(g: CanvasRenderingContext2D, s: number, st: MapEditState, hover: [number, number] | null, rotDir?: readonly number[]): void {
  if (!hover) return;
  const [x, y] = hover;
  if (st.tool === 'paint') {
    g.globalAlpha = 0.6;
    drawTile(g, s, x, y, st.brush.kind, st.brush.rot, st.brush.letter, rotDir);
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
