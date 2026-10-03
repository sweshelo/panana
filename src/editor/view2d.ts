// Top-down 2D view on a canvas: tiles, section 6 cells, points; pan (right / middle drag), zoom (wheel).
import { LAYOUTS, P3, P7, POINT_SECTIONS, letterLabel, pointKindLabel, recCellPos, type MapDoc } from '../game/sections';
import { norm, type Controller } from './controller';
import { eventLinks } from './events';
import { kindColor, ROOM_COLOR, ROT_ARROW, SECTION_COLORS } from './legend';
import { drawTileGlyph, GridCanvas, strokeCell } from './gridcanvas';
import { GRID, tileAt, type EditorState } from './state';

export type Style2D = 'symbols' | 'minimap';

/** Angle (three.js rotation.y) of a section 7 door by +0x16, as recordPlacement (section 3's table). */
const QUARTER_2D: Record<number, number> = { 0: 0, 1: -Math.PI / 2, 2: Math.PI, 3: Math.PI / 2 };

export class View2D {
  readonly canvas: HTMLCanvasElement;
  private readonly gc: GridCanvas;
  style: Style2D = 'symbols';

  constructor(
    private readonly st: EditorState,
    private readonly ctl: Controller,
  ) {
    this.gc = new GridCanvas('view2d', (g, s) => this.render(g, s), GRID);
    this.canvas = this.gc.canvas;
    this.gc.pointer = {
      down: (cx, cy, e) => this.ctl.down(cx, cy, e),
      move: (cx, cy) => this.ctl.move(cx, cy),
      up: () => this.ctl.up(),
      leave: () => this.ctl.leave(),
    };
  }

  /** Fit the map's tiles in the view. */
  fit(): void {
    const doc = this.st.current;
    if (doc) this.gc.fitCells(doc.tiles);
  }

  draw(): void {
    this.gc.draw();
  }

  private render(g: CanvasRenderingContext2D, s: number): void {
    const doc = this.st.current;
    if (!doc) return;
    if (this.style === 'minimap') this.drawMinimap(doc, g, s);
    else if (this.ctl.layers.tiles) this.drawTiles(doc, g, s);

    if (this.ctl.layers.room) {
      g.fillStyle = ROOM_COLOR;
      for (const cell of doc.cells6) g.fillRect(cell.x * s + 2, cell.y * s + 2, s - 4, s - 4);
    }
    this.drawLinks(g, s);
    this.drawPoints(doc, g, s);
    this.drawSelection(doc, g, s);

    // hover / brush preview
    const hv = this.ctl.hover;
    if (hv) {
      const [x, y] = hv;
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      if (this.st.tool === 'paint') {
        g.globalAlpha = 0.6;
        this.drawTile(g, s, x, y, this.st.brush.kind, this.st.brush.rot, this.st.brush.letter);
        g.globalAlpha = 1;
      }
      if (this.st.clip && this.st.tool === 'rect') {
        g.setLineDash([4, 3]);
        g.strokeRect(x * s, y * s, this.st.clip.w * s, this.st.clip.h * s);
        g.setLineDash([]);
      }
      strokeCell(g, s, x, y);
    }
  }

  private drawTile(g: CanvasRenderingContext2D, s: number, x: number, y: number, kind: number, rot: number, letter: number): void {
    drawTileGlyph(g, s, x, y, kindColor(kind), rot, `${kind}${letterLabel(letter)}`, ROT_ARROW[rot]);
  }

  private drawTiles(doc: MapDoc, g: CanvasRenderingContext2D, s: number): void {
    for (const t of doc.tiles) this.drawTile(g, s, t.x, t.y, t.kind, t.rot, t.letter);
  }

  /** In-game minimap style: floor cells, room outlines, corridors. */
  private drawMinimap(doc: MapDoc, g: CanvasRenderingContext2D, s: number): void {
    const room = new Set(doc.cells6.map((c) => `${c.x},${c.y}`));
    for (const t of doc.tiles) {
      if (t.kind === 0 || t.kind === 6) continue;
      const isRoom = room.has(`${t.x},${t.y}`) || [5, 7, 9, 14].includes(t.kind);
      const px = t.x * s, py = t.y * s;
      if (isRoom) {
        g.fillStyle = '#3f7fd9';
        g.fillRect(px, py, s, s);
        continue;
      }
      // corridor: a square in the middle and a bar towards each walkable neighbour
      const c = s / 2, hw = s * 0.2;
      g.fillStyle = '#5d95d6';
      g.fillRect(px + c - hw, py + c - hw, hw * 2, hw * 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = tileAt(doc, t.x + dx, t.y + dy);
        if (!n || n.kind === 0 || n.kind === 6) continue;
        if (dx) g.fillRect(dx > 0 ? px + c : px, py + c - hw, c, hw * 2);
        else g.fillRect(px + c - hw, dy > 0 ? py + c : py, hw * 2, c);
      }
    }
    g.strokeStyle = '#cfe3ff';
    g.lineWidth = 2;
    for (const t of doc.tiles) {
      if (!(room.has(`${t.x},${t.y}`) || [5, 7, 9, 14].includes(t.kind))) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = tileAt(doc, t.x + dx, t.y + dy);
        const nRoom = n && (room.has(`${n.x},${n.y}`) || [5, 7, 9, 14].includes(n.kind));
        if (nRoom) continue;
        g.beginPath();
        const x0 = t.x * s + (dx > 0 ? s : 0), y0 = t.y * s + (dy > 0 ? s : 0);
        g.moveTo(x0, y0);
        g.lineTo(x0 + (dy ? s : 0), y0 + (dx ? s : 0));
        g.stroke();
      }
    }
  }

  private drawPoints(doc: MapDoc, g: CanvasRenderingContext2D, s: number): void {
    const sel = this.st.selection;
    for (const k of [...POINT_SECTIONS].reverse()) {
      if (!this.ctl.layers.sections[k]) continue;
      const L = LAYOUTS[k]!;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, L);
        const x = px * s, y = py * s;
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        g.fillStyle = SECTION_COLORS[k]!;
        g.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.7)';
        g.lineWidth = selected ? 2.5 : 1;
        const rad = Math.max(3, s * (k === 3 ? 0.3 : 0.16));
        g.beginPath();
        if (k === 3) {
          // exits: a square (doors) or a diamond (stairs / warp)
          const kind = P3.kind(r.raw);
          if ([11, 16, 17].includes(kind)) g.rect(x - rad, y - rad * 0.55, rad * 2, rad * 1.1);
          else {
            g.moveTo(x, y - rad);
            g.lineTo(x + rad, y);
            g.lineTo(x, y + rad);
            g.lineTo(x - rad, y);
            g.closePath();
          }
        } else if (k === 7) {
          // doors on walls: a bar along the wall, turned by +0x16; invisible exits: a small dot
          const a = -(QUARTER_2D[P7.dir(r.raw)] ?? 0);
          const w = s * 0.2, d = s * 0.06;
          if (P7.visible(r.raw)) {
            const c = Math.cos(a), sn = Math.sin(a);
            const pts = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([u, v]) => [x + u! * c - v! * sn, y + u! * sn + v! * c] as const);
            g.moveTo(pts[0]![0], pts[0]![1]);
            for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
            g.closePath();
          } else g.arc(x, y, Math.max(3, s * 0.12), 0, Math.PI * 2);
        } else if (k === 4) g.rect(x - rad, y - rad, rad * 2, rad * 2);
        else g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        if (k === 3 && s >= 22) {
          g.fillStyle = '#fff';
          g.font = `${Math.round(s * 0.22)}px system-ui, sans-serif`;
          g.fillText(pointKindLabel(P3.kind(r.raw)), x - rad, y + rad + s * 0.22);
        }
      });
    }
  }

  /** Switch -> target lines (generic switches solid, hard-coded script pairs dashed). */
  private drawLinks(g: CanvasRenderingContext2D, s: number): void {
    for (const l of eventLinks(this.st)) {
      g.strokeStyle = l.generic ? (l.selected ? '#7ff5ff' : 'rgba(80, 220, 255, 0.75)') : l.selected ? '#ffffff' : 'rgba(255, 255, 255, 0.45)';
      g.lineWidth = l.selected ? 3 : 2;
      g.setLineDash(l.generic ? [] : [5, 4]);
      g.beginPath();
      g.moveTo(l.from[0] * s, l.from[1] * s);
      g.lineTo(l.to[0] * s, l.to[1] * s);
      g.stroke();
      // arrow head at the target
      const ang = Math.atan2(l.to[1] - l.from[1], l.to[0] - l.from[0]);
      const tx = l.to[0] * s, ty = l.to[1] * s, a = Math.max(6, s * 0.25);
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx - a * Math.cos(ang - 0.4), ty - a * Math.sin(ang - 0.4));
      g.moveTo(tx, ty);
      g.lineTo(tx - a * Math.cos(ang + 0.4), ty - a * Math.sin(ang + 0.4));
      g.stroke();
    }
    g.setLineDash([]);
  }

  private drawSelection(doc: MapDoc, g: CanvasRenderingContext2D, s: number): void {
    const sel = this.st.selection;
    g.strokeStyle = '#ffeb3b';
    g.lineWidth = 2;
    if (sel.type === 'tiles') for (const [x, y] of sel.cells) g.strokeRect(x * s + 1, y * s + 1, s - 2, s - 2);
    if (sel.type === 'rect') {
      const r = norm(sel);
      g.setLineDash([6, 4]);
      g.strokeRect(r.x0 * s, r.y0 * s, (r.x1 - r.x0 + 1) * s, (r.y1 - r.y0 + 1) * s);
      g.setLineDash([]);
    }
    void doc;
  }
}
