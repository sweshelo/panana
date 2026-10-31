// The views of a world map page (RPG2's W01 / W02 …, RPG3's W01): the whole world (300 x 300 cells) as a 2D map and a
// 3D preview of the cells around the camera (worldscene.ts), with the tools both views share: select and drag the
// entrances and ranges, paint the terrain, undo. What the world holds and how it is drawn in 3D comes from a WorldSource
// (oahu/worldsource.ts, pages/worldsource.ts); the pages put the views in the shared frame (worldpage.tsx).
import type * as THREE from 'three';
import type { Ground } from '../game/worldmap';
import { Signal } from '../ui/useEditorState';
import { GridCanvas } from './gridcanvas';
import type { MapScene } from './mapscene';
import { PART_2, PART_2X2, WorldScene, type WorldMark } from './worldscene';

/** A terrain part to paint with (a worldmapParts row). */
export interface WorldPaletteRow {
  row: number;
  /** "flat_00", "種類 2" … */
  label: string;
  flags: number;
}

/** An entrance as the views draw it. */
export interface WorldPin {
  /** Centre in cells (fractional). */
  x: number;
  y: number;
  /** Without a model of its own (RPG3: where the player stands when coming out); drawn as a ring, layer "returns". */
  plain: boolean;
  color: string;
  /** A second ring (RPG3: the ship stops there). */
  ring?: string;
}

/** Ranges of cells drawn as rectangles (RPG3's encounter ranges), moved and resized in steps of `snap`. */
export interface WorldRangeSet {
  key: string;
  label: string;
  color: string;
  fill: string;
  snap: number;
  list(): { x: number; y: number; w: number; h: number }[];
  set(list: { x: number; y: number; w: number; h: number }[]): void;
}

/** Points drawn as marks (chests, props …), selected but not moved. */
export interface WorldPointSet {
  key: string;
  label: string;
  color: string;
  square?: boolean;
  list(): { x: number; y: number }[];
  /** The 3D model of a point (null: a marker ball). */
  mark3d?(i: number): Pick<WorldMark, 'make' | 'angle' | 'scale'> | null;
}

/** A grid drawn over the terrain (RPG3's dark sea): a colour per cell ('' = none), and in 3D how dark the sea is. */
export interface WorldOverlay {
  key: string;
  label: string;
  on: boolean;
  /** Colours by value (index 0 is not drawn). */
  colors: string[];
  value(x: number, y: number): number;
  /** Darkens the sea in 3D: value / steps. */
  steps?: number;
}

export interface WorldSource {
  readonly size: number;
  /** Called after every change of the data (edits, undo, other pages). */
  on(f: () => void): () => void;
  /** Bumped by every change (caches of the terrain picture follow it). */
  revision(): number;
  ground(): Ground | null;
  /** The parts to paint with (row 0 = none). */
  palette(): WorldPaletteRow[];
  partFlags(part: number): number;
  partColor(part: number): string;
  /** Put a part (0 = none) at a cell; false when nothing changed. */
  paint(x: number, y: number, part: number, rot: number): boolean;
  entrances(): WorldPin[];
  /** Move entrance i so that its centre is near (cx, cy); `by` moves it by whole cells instead. */
  moveEntrance(i: number, cx: number, cy: number): void;
  nudgeEntrance(i: number, dx: number, dy: number): void;
  rangeSets: WorldRangeSet[];
  pointSets: WorldPointSet[];
  overlays: WorldOverlay[];
  /** Where to look when nothing is selected (cells). */
  start: [number, number];
  /** An undo point: everything the tools edit, and back. */
  snapshot(): unknown;
  restore(s: unknown): void;
  // ---- 3D
  /** Loads the models; resolves to a message for the status bar ('' = all there). */
  load3d(): Promise<string>;
  hasPartModel(part: number): boolean;
  partModel(part: number): THREE.Object3D | null;
  seaModel?(): THREE.Object3D | null;
  /** The 3D model of an entrance (null: a marker ball). */
  entranceMark3d(i: number): Pick<WorldMark, 'make' | 'angle' | 'scale'> | null;
  /** Called by the view when a model it asked for came (sync the 3D view). */
  onModel: () => void;
  dispose(): void;
}

export type WorldTool = 'select' | 'paint';
export type WorldSelection =
  | { type: 'none' }
  | { type: 'entrance'; index: number }
  | { type: 'range'; set: string; index: number }
  | { type: 'point'; set: string; index: number };

type Drag =
  | { kind: 'entrance'; index: number; ox: number; oy: number; moved: boolean }
  | { kind: 'range'; set: WorldRangeSet; index: number; ox: number; oy: number; resize: boolean; moved: boolean }
  | { kind: 'paint' }
  | null;

const SEA_RGB: [number, number, number] = [29, 63, 110];

export class WorldView {
  readonly grid: GridCanvas;
  readonly world3d: WorldScene;
  /** Emitted when the data, selection, tool, brush, layers or status change (the panes re-render). */
  readonly signal = new Signal();
  /** Emitted when the hovered cell changes (the status bar). */
  readonly hoverSignal = new Signal();
  tool: WorldTool = 'select';
  brush = { part: 0, rot: 0 };
  sel: WorldSelection = { type: 'none' };
  /** terrain, entrances, returns and the keys of the source's ranges, points and overlays. */
  readonly layers: Record<string, boolean>;
  hover: [number, number] | null = null;
  status = '';
  /** Draw the models in 3D (else coloured slabs and marker balls). */
  showModels = true;
  onSelect: (sel: WorldSelection) => void = () => {};
  private drag: Drag = null;
  private readonly undoStack: unknown[] = [];
  private readonly redoStack: unknown[] = [];
  private terrain: HTMLCanvasElement | null = null;
  private terrainRevision = -1;
  private covered: Int32Array | null = null;
  private coveredRevision = -1;
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(readonly src: WorldSource) {
    const N = src.size;
    // the brush starts with the part the world has most of
    const counts = new Map<number, number>();
    for (const p of src.ground()?.parts ?? []) if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    this.brush.part = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? src.palette().find((p) => p.row)?.row ?? 0;
    this.layers = { terrain: true, entrances: true, returns: true };
    for (const r of src.rangeSets) this.layers[r.key] = false;
    for (const p of src.pointSets) this.layers[p.key] = true;
    for (const o of src.overlays) this.layers[o.key] = o.on;
    this.grid = new GridCanvas('view2d', (g, s) => this.paint2d(g, s), N);
    this.grid.minScale = 1;
    this.world3d = new WorldScene('view3d', N);
    this.world3d.terrain = {
      size: N,
      part: (i) => (this.layers.terrain ? src.ground()?.parts[i] ?? 0 : 0),
      rot: (i) => src.ground()?.rots[i] ?? 0,
      flags: (p) => src.partFlags(p),
      hasModel: (p) => this.showModels && src.hasPartModel(p),
      model: (p) => src.partModel(p),
      color: (p) => src.partColor(p),
    };
    const shade = src.overlays.find((o) => o.steps);
    if (shade) this.world3d.seaShade = (i) => (this.layers[shade.key] ? shade.value(i % N, Math.floor(i / N)) / shade.steps! : 0);
    this.world3d.seaModel = () => (this.showModels ? src.seaModel?.() ?? null : null);
    this.world3d.marks = () => this.marks3d();
    src.onModel = () => this.world3d.sync(true);
    const pointer = {
      down: (cx: number, cy: number, e: { shiftKey: boolean; altKey?: boolean; button: number }) => this.down(cx, cy, e),
      move: (cx: number, cy: number) => this.move(cx, cy),
      up: () => {
        this.drag = null;
      },
      leave: () => {
        this.hover = null;
        this.grid.draw();
        this.hoverSignal.emit();
      },
    };
    this.grid.pointer = pointer;
    this.scene.pointer = pointer;
    this.unsubscribe = src.on(() => this.refresh());
    void this.load3d();
  }

  get scene(): MapScene {
    return this.world3d.scene;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.src.dispose();
    this.world3d.dispose();
  }

  // ---- edits and undo

  /** Record an undo point before an edit. */
  mark(): void {
    this.undoStack.push(this.src.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  undo(): void {
    const s = this.undoStack.pop();
    if (s === undefined) return;
    this.redoStack.push(this.src.snapshot());
    this.src.restore(s);
  }
  redo(): void {
    const s = this.redoStack.pop();
    if (s === undefined) return;
    this.undoStack.push(this.src.snapshot());
    this.src.restore(s);
  }

  select(sel: WorldSelection, focus = false): void {
    this.sel = sel;
    if (focus) this.focus();
    this.refresh();
    this.onSelect(sel);
  }

  setTool(t: WorldTool): void {
    this.tool = t;
    this.signal.emit();
    this.grid.draw();
  }

  rangeSet(key: string): WorldRangeSet | undefined {
    return this.src.rangeSets.find((r) => r.key === key);
  }
  pointSet(key: string): WorldPointSet | undefined {
    return this.src.pointSets.find((p) => p.key === key);
  }

  /** The cell a selection is at. */
  private selCell(): [number, number] | null {
    const s = this.sel;
    if (s.type === 'entrance') {
      const p = this.src.entrances()[s.index];
      return p ? [p.x, p.y] : null;
    }
    if (s.type === 'range') {
      const r = this.rangeSet(s.set)?.list()[s.index];
      return r ? [r.x + r.w / 2, r.y + r.h / 2] : null;
    }
    if (s.type === 'point') {
      const p = this.pointSet(s.set)?.list()[s.index];
      return p ? [p.x, p.y] : null;
    }
    return null;
  }

  /** Centre both views on the selection (or the source's start when nothing is selected). */
  focus(): void {
    const [x, y] = this.selCell() ?? this.src.start;
    const r = this.grid.canvas.getBoundingClientRect();
    if (this.grid.scale < 6) this.grid.scale = 10;
    this.grid.ox = r.width / 2 - x * this.grid.scale;
    this.grid.oy = r.height / 2 - y * this.grid.scale;
    this.grid.draw();
    this.world3d.focus(x, y);
  }

  /** The cell at the centre of the 2D view. */
  viewCell(): [number, number] {
    const r = this.grid.canvas.getBoundingClientRect();
    const n = this.src.size;
    const wrap = (v: number): number => ((Math.floor(v) % n) + n) % n;
    return [wrap((r.width / 2 - this.grid.ox) / this.grid.scale), wrap((r.height / 2 - this.grid.oy) / this.grid.scale)];
  }

  /** The whole world in the 2D view. */
  fitWorld(): void {
    this.grid.fitBox(0, 0, this.src.size, this.src.size);
  }

  // ---- pointer (cells)

  private pinShown(p: WorldPin): boolean {
    return p.plain ? this.layers.returns! : this.layers.entrances!;
  }

  private hitEntrance(cx: number, cy: number): number {
    const rad = Math.max(0.8, 7 / this.grid.scale);
    let best = -1, bd = rad * rad;
    this.src.entrances().forEach((p, i) => {
      if (!this.pinShown(p)) return;
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < bd) [best, bd] = [i, d];
    });
    return best;
  }

  private hitRange(cx: number, cy: number): { set: WorldRangeSet; index: number; corner: boolean } | null {
    let best: { set: WorldRangeSet; index: number; corner: boolean; area: number } | null = null;
    for (const set of this.src.rangeSets) {
      if (!this.layers[set.key]) continue;
      set.list().forEach((r, index) => {
        if (cx < r.x || cy < r.y || cx >= r.x + r.w || cy >= r.y + r.h) return;
        const area = r.w * r.h;
        const corner = cx >= r.x + r.w - 0.8 && cy >= r.y + r.h - 0.8;
        if (!best || area < best.area) best = { set, index, corner, area };
      });
    }
    return best;
  }

  private hitPoint(cx: number, cy: number): WorldSelection | null {
    const rad = Math.max(0.6, 6 / this.grid.scale);
    for (const set of this.src.pointSets) {
      if (!this.layers[set.key]) continue;
      const i = set.list().findIndex((p) => (p.x - cx) ** 2 + (p.y - cy) ** 2 < rad * rad);
      if (i >= 0) return { type: 'point', set: set.key, index: i };
    }
    return null;
  }

  private down(cx: number, cy: number, e: { shiftKey: boolean; altKey?: boolean; button: number }): void {
    if (e.button !== 0) return;
    const x = Math.floor(cx), y = Math.floor(cy);
    if (this.tool === 'paint' && this.src.ground()) {
      if (e.altKey) {
        this.pick(x, y);
        return;
      }
      this.mark();
      this.drag = { kind: 'paint' };
      this.paintAt(x, y);
      return;
    }
    const ent = this.hitEntrance(cx, cy);
    if (ent >= 0) {
      const p = this.src.entrances()[ent]!;
      this.drag = { kind: 'entrance', index: ent, ox: cx - p.x, oy: cy - p.y, moved: false };
      this.select({ type: 'entrance', index: ent });
      return;
    }
    const pt = this.hitPoint(cx, cy);
    if (pt) {
      this.select(pt);
      return;
    }
    const rg = this.hitRange(cx, cy);
    if (rg) {
      const r = rg.set.list()[rg.index]!;
      this.drag = { kind: 'range', set: rg.set, index: rg.index, ox: cx - r.x, oy: cy - r.y, resize: rg.corner, moved: false };
      this.select({ type: 'range', set: rg.set.key, index: rg.index });
      return;
    }
    this.select({ type: 'none' });
  }

  private move(cx: number, cy: number): void {
    const x = Math.floor(cx), y = Math.floor(cy);
    if (!this.hover || this.hover[0] !== x || this.hover[1] !== y) {
      this.hover = [x, y];
      this.hoverSignal.emit();
      this.grid.draw();
    }
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'paint') {
      this.paintAt(x, y);
      return;
    }
    if (d.kind === 'entrance') {
      const p = this.src.entrances()[d.index]!;
      const tx = cx - d.ox, ty = cy - d.oy;
      // a whole cell away before it moves
      if (Math.abs(tx - p.x) < 0.5 && Math.abs(ty - p.y) < 0.5) return;
      if (!d.moved) this.mark();
      d.moved = true;
      this.src.moveEntrance(d.index, tx, ty);
      return;
    }
    const N = this.src.size;
    const list = d.set.list();
    const r = list[d.index]!;
    const snap = (v: number): number => Math.round(v / d.set.snap) * d.set.snap;
    const min = d.set.snap;
    const next = d.resize
      ? { ...r, w: Math.max(min, Math.min(255, snap(cx - r.x))), h: Math.max(min, Math.min(255, snap(cy - r.y))) }
      : { ...r, x: Math.max(0, Math.min(N - min, snap(cx - d.ox))), y: Math.max(0, Math.min(N - min, snap(cy - d.oy))) };
    if (next.x === r.x && next.y === r.y && next.w === r.w && next.h === r.h) return;
    if (!d.moved) this.mark();
    d.moved = true;
    list[d.index] = next;
    d.set.set(list);
  }

  private paintAt(x: number, y: number): void {
    const N = this.src.size;
    this.src.paint(((x % N) + N) % N, ((y % N) + N) % N, this.brush.part, this.brush.rot);
  }

  /** Take the brush from a cell (the part covering it). */
  pick(x: number, y: number): void {
    const g = this.src.ground(), N = this.src.size;
    if (!g || x < 0 || y < 0 || x >= N || y >= N) return;
    const c = this.coveredCells()[y * N + x]!;
    this.brush = c >= 0 ? { part: g.parts[c]!, rot: g.rots[c]! } : { part: 0, rot: 0 };
    this.signal.emit();
  }

  setBrush(b: { part: number; rot: number }): void {
    this.brush = b;
    this.signal.emit();
    this.grid.draw();
  }

  rotateBrush(step = 1): void {
    this.setBrush({ ...this.brush, rot: (this.brush.rot + step + 4) & 3 });
  }

  /** Keyboard shortcuts; true when the key was used. */
  key(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return false;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      this.redo();
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'v' || e.key === 'Escape') this.setTool('select');
    else if (e.key === 'b' && this.src.ground()) this.setTool('paint');
    else if (e.key === 'r') this.rotateBrush(e.shiftKey ? -1 : 1);
    else if (e.key === 'f') this.focus();
    else if (this.sel.type === 'entrance' && e.key.startsWith('Arrow')) {
      const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key] ?? [0, 0];
      this.mark();
      this.src.nudgeEntrance(this.sel.index, dx!, dy!);
    } else return false;
    return true;
  }

  // ---- drawing

  /** Redraw both views (after an edit or a display setting changed). */
  refresh(): void {
    if (this.disposed) return;
    this.grid.draw();
    this.world3d.sync(true);
    this.signal.emit();
  }

  /** The cell whose part covers each cell (-1 = none): 2 x 2 parts (0x10) and 2-cell parts (0x20) cover more. */
  private coveredCells(): Int32Array {
    if (this.covered && this.coveredRevision === this.src.revision()) return this.covered;
    const N = this.src.size, g = this.src.ground();
    const out = new Int32Array(N * N).fill(-1);
    if (g) {
      for (let i = 0; i < N * N; i++) if (g.parts[i]) out[i] = i;
      const cover = (x: number, y: number, from: number): void => {
        if (x < N && y < N && !g.parts[y * N + x]) out[y * N + x] = from;
      };
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const i = y * N + x, p = g.parts[i]!;
          if (!p) continue;
          const f = this.src.partFlags(p);
          if (f & PART_2X2) {
            cover(x + 1, y, i);
            cover(x, y + 1, i);
            cover(x + 1, y + 1, i);
          } else if (f & PART_2) {
            if (g.rots[i]! & 1) cover(x, y + 1, i);
            else cover(x + 1, y, i);
          }
        }
    }
    this.covered = out;
    this.coveredRevision = this.src.revision();
    return out;
  }

  /** The terrain as a picture of one pixel a cell, rebuilt after edits. */
  private terrainImage(): HTMLCanvasElement | null {
    const g = this.src.ground(), N = this.src.size;
    if (!g) return null;
    if (this.terrain && this.terrainRevision === this.src.revision()) return this.terrain;
    const cov = this.coveredCells();
    this.terrainRevision = this.src.revision();
    const c = (this.terrain ??= document.createElement('canvas'));
    c.width = N;
    c.height = N;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    const colors = new Map<number, [number, number, number]>();
    for (let i = 0; i < N * N; i++) {
      const o = cov[i]!;
      let rgb = SEA_RGB;
      if (o >= 0) {
        const p = g.parts[o]!;
        let c2 = colors.get(p);
        if (!c2) colors.set(p, (c2 = hexRgb(this.src.partColor(p))));
        rgb = c2;
      }
      const dim = o >= 0 && o !== i ? 0.88 : 1;
      img.data[i * 4] = rgb[0] * dim;
      img.data[i * 4 + 1] = rgb[1] * dim;
      img.data[i * 4 + 2] = rgb[2] * dim;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private paint2d(g: CanvasRenderingContext2D, s: number): void {
    const src = this.src, L = this.layers, N = src.size;
    const terrain = L.terrain ? this.terrainImage() : null;
    if (terrain) {
      g.imageSmoothingEnabled = false;
      g.drawImage(terrain, 0, 0, N * s, N * s);
    } else {
      g.fillStyle = `rgb(${SEA_RGB.join(',')})`;
      g.fillRect(0, 0, N * s, N * s);
    }
    const [x0, y0, x1, y1] = this.visibleCells(s);
    for (const o of src.overlays) {
      if (!L[o.key]) continue;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const c = o.colors[o.value(x, y)];
          if (!c) continue;
          g.fillStyle = c;
          g.fillRect(x * s, y * s, s, s);
        }
    }
    const ground = src.ground();
    if (s >= 10 && terrain && ground) {
      // the parts' directions
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = y * N + x;
          if (!ground.parts[i]) continue;
          const r = ground.rots[i]!, m = Math.max(1.5, s * 0.12);
          if (r === 0) g.fillRect(x * s, y * s, s, m);
          if (r === 1) g.fillRect((x + 1) * s - m, y * s, m, s);
          if (r === 2) g.fillRect(x * s, (y + 1) * s - m, s, m);
          if (r === 3) g.fillRect(x * s, y * s, m, s);
        }
    }
    const sel = this.sel;
    for (const set of src.rangeSets) {
      if (!L[set.key]) continue;
      set.list().forEach((r, i) => {
        const selected = sel.type === 'range' && sel.set === set.key && sel.index === i;
        g.fillStyle = set.fill;
        g.fillRect(r.x * s, r.y * s, r.w * s, r.h * s);
        g.strokeStyle = selected ? '#fff' : set.color;
        g.lineWidth = selected ? 2 : 1;
        g.strokeRect(r.x * s + 0.5, r.y * s + 0.5, r.w * s - 1, r.h * s - 1);
      });
    }
    for (const set of src.pointSets) {
      if (!L[set.key]) continue;
      set.list().forEach((p, i) => {
        const selected = sel.type === 'point' && sel.set === set.key && sel.index === i;
        const rad = Math.max(2.5, s * 0.3);
        g.fillStyle = set.color;
        g.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.8)';
        g.lineWidth = selected ? 2 : 1;
        g.beginPath();
        if (set.square) g.rect(p.x * s - rad, p.y * s - rad, rad * 2, rad * 2);
        else g.arc(p.x * s, p.y * s, rad, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
    }
    src.entrances().forEach((p, i) => {
      if (!this.pinShown(p)) return;
      const selected = sel.type === 'entrance' && sel.index === i;
      const rad = p.plain ? Math.max(2, s * 0.25) : Math.max(3.5, s * 0.45);
      g.beginPath();
      g.arc(p.x * s, p.y * s, rad, 0, Math.PI * 2);
      if (!p.plain) {
        g.fillStyle = p.color;
        g.fill();
      }
      g.strokeStyle = selected ? '#fff' : p.plain ? p.color : 'rgba(0,0,0,0.85)';
      g.lineWidth = selected ? 2.5 : 1.2;
      g.stroke();
      if (p.ring) {
        g.strokeStyle = p.ring;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(p.x * s, p.y * s, rad + 2.5, 0, Math.PI * 2);
        g.stroke();
      }
      if (selected) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(p.x * s, p.y * s, rad + 6, 0, Math.PI * 2);
        g.stroke();
      }
    });
    // the hovered cell (and what the brush would cover)
    const h = this.hover;
    if (h) {
      g.strokeStyle = this.tool === 'paint' ? '#ffeb3b' : 'rgba(255,255,255,0.6)';
      g.lineWidth = 1;
      const f = this.tool === 'paint' ? src.partFlags(this.brush.part) : 0;
      const wCells = f & PART_2X2 || (f & PART_2 && !(this.brush.rot & 1)) ? 2 : 1;
      const hCells = f & PART_2X2 || (f & PART_2 && this.brush.rot & 1) ? 2 : 1;
      g.strokeRect(h[0] * s + 0.5, h[1] * s + 0.5, wCells * s - 1, hCells * s - 1);
    }
  }

  /** Cells inside the 2D view: [x0, y0, x1, y1). */
  private visibleCells(s: number): [number, number, number, number] {
    const c = this.grid.canvas, N = this.src.size;
    const x0 = Math.max(0, Math.floor(-this.grid.ox / s)), y0 = Math.max(0, Math.floor(-this.grid.oy / s));
    return [x0, y0, Math.min(N, Math.ceil((c.clientWidth - this.grid.ox) / s)), Math.min(N, Math.ceil((c.clientHeight - this.grid.oy) / s))];
  }

  // ---- 3D

  private async load3d(): Promise<void> {
    this.status = 'モデルを読み込み中…';
    this.signal.emit();
    try {
      this.status = await this.src.load3d();
    } catch (err) {
      this.status = `モデルを読み込めませんでした (色の板で表示します): ${(err as Error).message}`;
    }
    if (this.disposed) return;
    this.world3d.clear();
    this.refresh();
  }

  /** What the 3D view draws besides the terrain: the entrances' and points' models, markers for the rest. */
  private marks3d(): WorldMark[] {
    const src = this.src, sel = this.sel, L = this.layers;
    const out: WorldMark[] = [];
    src.entrances().forEach((p, i) => {
      if (!this.pinShown(p)) return;
      const m = this.showModels ? src.entranceMark3d(i) : null;
      out.push({ x: p.x, y: p.y, ...m, color: p.color, selected: sel.type === 'entrance' && sel.index === i });
    });
    for (const set of src.pointSets) {
      if (!L[set.key]) continue;
      set.list().forEach((p, i) => {
        const m = this.showModels ? set.mark3d?.(i) ?? null : null;
        out.push({ x: p.x, y: p.y, ...m, color: set.color, selected: sel.type === 'point' && sel.set === set.key && sel.index === i });
      });
    }
    return out;
  }
}

function hexRgb(c: string): [number, number, number] {
  const v = parseInt(c.slice(1, 7), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
