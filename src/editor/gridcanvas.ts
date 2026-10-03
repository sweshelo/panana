// A top-down canvas over a grid of map cells, shared by RPG2's map editor (view2d.ts) and RPG3's map page: pan
// (right / middle drag), zoom (wheel), fitting a box of cells, the grid and its axis labels, and the tile glyph. What
// is drawn on the cells is up to the owner (`paint`, in cell units scaled by `s`).

/** Pointer handlers in cell coordinates (fractional). */
export interface GridPointer {
  down(cx: number, cy: number, e: PointerEvent): void;
  move(cx: number, cy: number, e: PointerEvent): void;
  up(e: PointerEvent): void;
  leave(): void;
}

export class GridCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Pixels per cell. */
  scale = 28;
  ox = 20;
  oy = 20;
  private pan: { x: number; y: number; ox: number; oy: number } | null = null;
  private raf = 0;
  pointer: GridPointer | null = null;

  /**
   * `paint` draws in a context translated to the grid's origin; `grid` is the size of the grid lines (cells per
   * side).
   */
  constructor(
    className: string,
    private readonly paint: (g: CanvasRenderingContext2D, s: number, css: CSSStyleDeclaration) => void,
    public grid = 30,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = className;
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
      this.pointer?.down(cx, cy, e);
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
      this.pointer?.move(cx, cy, e);
    });
    c.addEventListener('pointerup', (e) => {
      this.pan = null;
      this.pointer?.up(e);
    });
    c.addEventListener('pointerleave', () => this.pointer?.leave());
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

  toCell(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.ox) / this.scale, (e.clientY - r.top - this.oy) / this.scale];
  }

  /** Fit cells x0..x1, y0..y1 (exclusive ends) in the view. */
  fitBox(x0: number, y0: number, x1: number, y1: number): void {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || x1 <= x0 || y1 <= y0) return;
    this.scale = Math.max(6, Math.min(80, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
    this.ox = (r.width - (x1 - x0) * this.scale) / 2 - x0 * this.scale;
    this.oy = (r.height - (y1 - y0) * this.scale) / 2 - y0 * this.scale;
    this.draw();
  }

  /** Fit cells with a margin of one cell around them. */
  fitCells(cells: readonly { x: number; y: number }[]): void {
    if (!cells.length) return;
    const xs = cells.map((t) => t.x), ys = cells.map((t) => t.y);
    this.fitBox(Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 2, Math.max(...ys) + 2);
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
    const s = this.scale, n = this.grid;
    g.save();
    g.translate(this.ox, this.oy);
    g.strokeStyle = css.getPropertyValue('--grid') || 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      g.moveTo(i * s + 0.5, 0);
      g.lineTo(i * s + 0.5, n * s);
      g.moveTo(0, i * s + 0.5);
      g.lineTo(n * s, i * s + 0.5);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.strokeRect(0.5, 0.5, n * s, n * s);
    this.paint(g, s, css);
    g.restore();

    // axis labels
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.font = '10px system-ui, sans-serif';
    if (s >= 14)
      for (let i = 0; i < n; i++) {
        g.fillText(String(i), this.ox + i * s + s / 2 - 4, Math.max(10, this.oy - 4));
        g.fillText(String(i), Math.max(2, this.ox - 16), this.oy + i * s + s / 2 + 3);
      }
  }
}

/**
 * A tile: a coloured square with a notch on the side it faces (rot 0..3 = up, right, down, left), its label when the
 * cells are big enough, and an arrow in the corner when bigger still.
 */
export function drawTileGlyph(g: CanvasRenderingContext2D, s: number, x: number, y: number, color: string, rot: number, label: string, arrow?: string): void {
  const px = x * s, py = y * s;
  g.fillStyle = color;
  g.fillRect(px + 1, py + 1, s - 2, s - 2);
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
    g.fillText(label, px + s / 2, py + s / 2 + 1);
    if (s >= 30 && arrow) {
      g.font = `${Math.round(s * 0.22)}px system-ui, sans-serif`;
      g.fillText(arrow, px + s * 0.82, py + s * 0.8);
    }
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
  }
}

/** Outline of a cell (selection, hover). */
export function strokeCell(g: CanvasRenderingContext2D, s: number, x: number, y: number): void {
  g.strokeRect(x * s + 1, y * s + 1, s - 2, s - 2);
}
