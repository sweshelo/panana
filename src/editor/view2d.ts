// Top-down 2D view on a canvas: tiles, section 6 cells, points; pan (right / middle drag), zoom (wheel).
import { LAYOUTS, P3, POINT_SECTIONS, letterLabel, pointKindLabel, recCellPos, type MapDoc } from '../game/sections';
import { norm, type Controller } from './controller';
import { eventLinks } from './events';
import { kindColor, ROOM_COLOR, ROT_ARROW, SECTION_COLORS } from './legend';
import { GRID, tileAt, type EditorState } from './state';

export type Style2D = 'symbols' | 'minimap';

export class View2D {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 28; // px per cell
  private ox = 20;
  private oy = 20;
  private pan: { x: number; y: number; ox: number; oy: number } | null = null;
  style: Style2D = 'symbols';
  private raf = 0;

  constructor(
    private readonly st: EditorState,
    private readonly ctl: Controller,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view2d';
    this.ctx = this.canvas.getContext('2d')!;
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2) {
        this.pan = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy };
        return;
      }
      const [cx, cy] = this.toCell(e);
      this.ctl.down(cx, cy, e);
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.pan) {
        this.ox = this.pan.ox + e.clientX - this.pan.x;
        this.oy = this.pan.oy + e.clientY - this.pan.y;
        this.draw();
        return;
      }
      const [cx, cy] = this.toCell(e);
      this.ctl.move(cx, cy);
    });
    c.addEventListener('pointerup', () => {
      this.pan = null;
      this.ctl.up();
    });
    c.addEventListener('pointerleave', () => this.ctl.leave());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const f = Math.exp(-e.deltaY * 0.0015);
        const ns = Math.max(6, Math.min(120, this.scale * f));
        this.ox = mx - ((mx - this.ox) * ns) / this.scale;
        this.oy = my - ((my - this.oy) * ns) / this.scale;
        this.scale = ns;
        this.draw();
      },
      { passive: false },
    );
    new ResizeObserver(() => this.draw()).observe(c);
  }

  private toCell(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.ox) / this.scale, (e.clientY - r.top - this.oy) / this.scale];
  }

  /** Fit the map's tiles in the view. */
  fit(): void {
    const doc = this.st.current;
    const r = this.canvas.getBoundingClientRect();
    if (!doc || !doc.tiles.length || !r.width) return;
    const xs = doc.tiles.map((t) => t.x);
    const ys = doc.tiles.map((t) => t.y);
    const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 2, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 2;
    this.scale = Math.max(6, Math.min(80, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
    this.ox = (r.width - (x1 - x0) * this.scale) / 2 - x0 * this.scale;
    this.oy = (r.height - (y1 - y0) * this.scale) / 2 - y0 * this.scale;
    this.draw();
  }

  draw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c);
    g.fillStyle = css.getPropertyValue('--view-bg') || '#1b1d22';
    g.fillRect(0, 0, w, h);
    const doc = this.st.current;
    if (!doc) return;
    const s = this.scale;
    g.save();
    g.translate(this.ox, this.oy);

    // grid
    g.strokeStyle = css.getPropertyValue('--grid') || 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= GRID; i++) {
      g.moveTo(i * s + 0.5, 0);
      g.lineTo(i * s + 0.5, GRID * s);
      g.moveTo(0, i * s + 0.5);
      g.lineTo(GRID * s, i * s + 0.5);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.strokeRect(0.5, 0.5, GRID * s, GRID * s);

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
      g.strokeRect(x * s + 1, y * s + 1, s - 2, s - 2);
    }
    g.restore();

    // axis labels
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.font = '10px system-ui, sans-serif';
    if (s >= 14)
      for (let i = 0; i < GRID; i++) {
        g.fillText(String(i), this.ox + i * s + s / 2 - 4, Math.max(10, this.oy - 4));
        g.fillText(String(i), Math.max(2, this.ox - 16), this.oy + i * s + s / 2 + 3);
      }
  }

  private drawTile(g: CanvasRenderingContext2D, s: number, x: number, y: number, kind: number, rot: number, letter: number): void {
    const px = x * s, py = y * s;
    g.fillStyle = kindColor(kind);
    g.fillRect(px + 1, py + 1, s - 2, s - 2);
    // orientation marker: a notch on the side the tile faces
    g.fillStyle = 'rgba(0,0,0,0.45)';
    const m = Math.max(2, s * 0.14);
    if (rot === 0) g.fillRect(px + 1, py + 1, s - 2, m);
    if (rot === 1) g.fillRect(px + s - 1 - m, py + 1, m, s - 2);
    if (rot === 2) g.fillRect(px + 1, py + s - 1 - m, s - 2, m);
    if (rot === 3) g.fillRect(px + 1, py + 1, m, s - 2);
    if (s >= 18) {
      g.fillStyle = '#111';
      g.font = `${Math.round(s * 0.36)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${kind}${letterLabel(letter)}`, px + s / 2, py + s / 2 + 1);
      if (s >= 30) {
        g.font = `${Math.round(s * 0.22)}px system-ui, sans-serif`;
        g.fillText(ROT_ARROW[rot]!, px + s * 0.82, py + s * 0.8);
      }
      g.textAlign = 'start';
      g.textBaseline = 'alphabetic';
    }
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
