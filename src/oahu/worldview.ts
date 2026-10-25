// The views of RPG3's world map page (oahu/WorldPage.tsx): the whole 300 x 300 world as a 2D map (the terrain coloured by
// what its models are, the entrances, the encounter ranges, chests, props and event ranges), and a 3D preview of the
// cells around the camera with the terrain's models (archive 0E820000) and the entrances' models. Both views share the
// tools: select and drag entrances and ranges, paint the terrain. Edits go to OahuWorld (worldmap.ts) with an undo stack.
import type * as THREE from 'three';
import { ModelFactory } from '../cgfx/three';
import { GridCanvas } from '../editor/gridcanvas';
import type { MapScene } from '../editor/mapscene';
import { WorldScene, type WorldMark } from '../editor/worldscene';
import type { Dump } from '../rom/dump';
import { Signal } from '../ui/useEditorState';
import { oahuObjectModels, oahuWorldModels } from './mapModels';
import {
  entranceCell, moveEntrance, oahuCoveredBy, OAHU_WORLD_MODELS, OAHU_WORLD_SIZE, OAHU_WORLD_TEXTURES, parseChests, parseEventRanges, parseProps,
  partColor, WE, WP_2, WP_2X2, WS, grid2, worldObjectAngle, type OahuWorld, type OahuWorldPoint, type OahuWorldRange,
} from './worldmap';

const N = OAHU_WORLD_SIZE;

export type WorldTool = 'select' | 'paint';
export type WorldSelection =
  | { type: 'none' }
  | { type: 'entrance'; index: number }
  | { type: 'range'; slot: typeof WS.land | typeof WS.sea; index: number }
  | { type: 'point'; slot: typeof WS.chests | typeof WS.props | typeof WS.events; index: number };

export const WORLD_LAYERS = {
  terrain: '地形',
  entrances: '入口 (町・ダンジョン)',
  returns: '出る位置 (模型なし)',
  land: 'エンカウントの範囲 (陸)',
  sea: 'エンカウントの範囲 (海)',
  chests: '宝箱',
  props: '置物',
  events: 'イベントの範囲',
  dark: '暗い海 (区画 1。濃いほど暗い)',
  explored: '区画 7 の初期値 (推定: 地図の開けた範囲)',
} as const;
export type WorldLayer = keyof typeof WORLD_LAYERS;

/** Colours of the entrances by worldmapParts row (88〜93), the layers' colours. */
export const ENTRANCE_COLORS: Record<number, string> = { 88: '#ff9f43', 89: '#ff6b6b', 90: '#48dbfb', 91: '#f368e0', 92: '#feca57', 93: '#1dd1a1' };
/** The dark sea's steps (slot 1: 1, 2, 3 = darkest) over the 2D map. */
const DARK_SEA = ['', 'rgba(0,0,12,0.22)', 'rgba(0,0,12,0.42)', 'rgba(0,0,12,0.62)'];
export const LAYER_COLORS: Partial<Record<WorldLayer, string>> = { land: '#b8f58a', sea: '#7fd3ff', chests: '#ffd54f', props: '#bdbdbd', events: '#b388ff', returns: '#ffffff' };

interface Snapshot {
  sections: [number, Uint8Array][];
  ground: Uint8Array | null;
}

type Drag =
  | { kind: 'entrance'; index: number; ox: number; oy: number; moved: boolean }
  | { kind: 'range'; slot: typeof WS.land | typeof WS.sea; index: number; ox: number; oy: number; resize: boolean; moved: boolean }
  | { kind: 'paint' }
  | null;

export class OahuWorldView {
  readonly grid: GridCanvas;
  readonly world3d: WorldScene;
  /** Emitted when the selection, tool, brush, layers or status change (the panes re-render). */
  readonly signal = new Signal();
  /** Emitted when the hovered cell changes (the status bar). */
  readonly hoverSignal = new Signal();
  tool: WorldTool = 'select';
  brush = { part: 2, rot: 0 };
  sel: WorldSelection = { type: 'none' };
  layers: Record<WorldLayer, boolean> = { terrain: true, entrances: true, returns: true, land: false, sea: false, chests: true, props: true, events: true, dark: true, explored: false };
  hover: [number, number] | null = null;
  status = '';
  /** Draw the terrain's models in 3D (else coloured slabs). */
  showModels = true;
  onSelect: (sel: WorldSelection) => void = () => {};
  private drag: Drag = null;
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private terrain: HTMLCanvasElement | null = null;
  private terrainRevision = -1;
  private covered: Int32Array | null = null;
  // 3D
  private factory: ModelFactory | null = null;
  private readonly objects = new Map<number, ModelFactory | null>();
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly dump: Dump,
    readonly world: OahuWorld,
  ) {
    this.grid = new GridCanvas('view2d', (g, s) => this.paint2d(g, s), N);
    this.grid.minScale = 1;
    this.world3d = new WorldScene('view3d', N);
    const ground = world.ground;
    this.world3d.terrain = ground && {
      size: N,
      part: (i) => (this.layers.terrain ? ground.parts[i]! : 0),
      rot: (i) => ground.rots[i]!,
      flags: world.partFlags,
      hasModel: (p) => !!(this.showModels && this.factory && world.parts[p]?.model && this.factory.set.models.has(world.parts[p]!.model)),
      model: (p) => this.factory?.instance(world.parts[p]?.model ?? 0) ?? null,
      color: (p) => partColor(world.parts[p]),
    };
    this.world3d.seaShade = (i) => (this.layers.dark ? grid2(world.section(WS.dark), i % N, Math.floor(i / N)) / 3 : 0);
    this.world3d.seaModel = () => (this.showModels && this.factory && world.parts[1]?.model ? this.factory.instance(world.parts[1].model) : null);
    this.world3d.marks = () => this.marks3d();
    const pointer = {
      down: (cx: number, cy: number, e: { shiftKey: boolean; altKey?: boolean; button: number }) => this.down(cx, cy, e),
      move: (cx: number, cy: number) => this.move(cx, cy),
      up: () => this.up(),
      leave: () => {
        this.hover = null;
        this.grid.draw();
        this.hoverSignal.emit();
      },
    };
    this.grid.pointer = pointer;
    this.scene.pointer = pointer;
    this.unsubscribe = world.maps.on(() => this.refresh());
    void this.loadTerrain();
  }

  get scene(): MapScene {
    return this.world3d.scene;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.factory?.dispose();
    for (const f of this.objects.values()) f?.dispose();
    this.world3d.dispose();
  }

  // ---- edits and undo

  private snapshot(): Snapshot {
    const w = this.world;
    return { sections: [WS.entrances, WS.land, WS.sea].map((k): [number, Uint8Array] => [k, w.section(k).slice()]), ground: w.groundSnapshot() };
  }
  private restoreSnapshot(s: Snapshot): void {
    for (const [k, b] of s.sections) this.world.setSection(k, b);
    if (s.ground) this.world.restoreGround(s.ground);
  }
  /** Record an undo point before an edit. */
  mark(): void {
    this.undoStack.push(this.snapshot());
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
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restoreSnapshot(s);
  }
  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restoreSnapshot(s);
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

  /** The cell a selection is at. */
  private selCell(): [number, number] | null {
    const s = this.sel;
    if (s.type === 'entrance') {
      const r = this.world.entrances()[s.index];
      return r ? entranceCell(r) : null;
    }
    if (s.type === 'range') {
      const r = this.world.ranges(s.slot)[s.index];
      return r ? [r.x + r.w / 2, r.y + r.h / 2] : null;
    }
    if (s.type === 'point') {
      const p = this.points(s.slot)[s.index];
      return p ? [p.x, p.y] : null;
    }
    return null;
  }

  points(slot: typeof WS.chests | typeof WS.props | typeof WS.events): OahuWorldPoint[] {
    const b = this.world.section(slot);
    return slot === WS.chests ? parseChests(b) : slot === WS.props ? parseProps(b) : parseEventRanges(b);
  }

  /** Centre both views on the selection (or the start of the game when nothing is selected). */
  focus(): void {
    const [x, y] = this.selCell() ?? [218, 260];
    const r = this.grid.canvas.getBoundingClientRect();
    if (this.grid.scale < 6) this.grid.scale = 10;
    this.grid.ox = r.width / 2 - x * this.grid.scale;
    this.grid.oy = r.height / 2 - y * this.grid.scale;
    this.grid.draw();
    this.world3d.focus(x, y);
  }

  /** The whole world in the 2D view. */
  fitWorld(): void {
    this.grid.fitBox(0, 0, N, N);
  }

  // ---- pointer (cells)

  private hitEntrance(cx: number, cy: number): number {
    if (!this.layers.entrances && !this.layers.returns) return -1;
    const rad = Math.max(0.8, 7 / this.grid.scale);
    let best = -1, bd = rad * rad;
    this.world.entrances().forEach((r, i) => {
      if (!this.entranceShown(r)) return;
      const [x, y] = entranceCell(r);
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bd) [best, bd] = [i, d];
    });
    return best;
  }

  private hitRange(cx: number, cy: number): { slot: typeof WS.land | typeof WS.sea; index: number; corner: boolean } | null {
    let best: { slot: typeof WS.land | typeof WS.sea; index: number; corner: boolean; area: number } | null = null;
    for (const slot of [WS.land, WS.sea] as const) {
      if (!this.layers[slot === WS.land ? 'land' : 'sea']) continue;
      this.world.ranges(slot).forEach((r, index) => {
        if (cx < r.x || cy < r.y || cx >= r.x + r.w || cy >= r.y + r.h) return;
        const area = r.w * r.h;
        const corner = cx >= r.x + r.w - 0.8 && cy >= r.y + r.h - 0.8;
        if (!best || area < best.area) best = { slot, index, corner, area };
      });
    }
    return best;
  }

  private hitPoint(cx: number, cy: number): WorldSelection | null {
    const rad = Math.max(0.6, 6 / this.grid.scale);
    for (const [slot, layer] of [[WS.chests, 'chests'], [WS.props, 'props'], [WS.events, 'events']] as const) {
      if (!this.layers[layer]) continue;
      const i = this.points(slot).findIndex((p) => (p.x - cx) ** 2 + (p.y - cy) ** 2 < rad * rad);
      if (i >= 0) return { type: 'point', slot, index: i };
    }
    return null;
  }

  private down(cx: number, cy: number, e: { shiftKey: boolean; altKey?: boolean; button: number }): void {
    if (e.button !== 0) return;
    const x = Math.floor(cx), y = Math.floor(cy);
    if (this.tool === 'paint') {
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
      const [ex, ey] = entranceCell(this.world.entrances()[ent]!);
      this.drag = { kind: 'entrance', index: ent, ox: cx - ex, oy: cy - ey, moved: false };
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
      const r = this.world.ranges(rg.slot)[rg.index]!;
      this.drag = { kind: 'range', slot: rg.slot, index: rg.index, ox: cx - r.x, oy: cy - r.y, resize: rg.corner, moved: false };
      this.select({ type: 'range', slot: rg.slot, index: rg.index });
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
      const r = this.world.entrances()[d.index]!;
      const nx = Math.round(cx - d.ox - 0.5 - WE.dx(r)), ny = Math.round(cy - d.oy - 0.5 - WE.dy(r));
      if (nx === WE.x(r) && ny === WE.y(r)) return;
      if (!d.moved) this.mark();
      d.moved = true;
      this.world.setEntrance(d.index, moveEntrance(r, nx, ny));
      return;
    }
    const list = this.world.ranges(d.slot);
    const r = list[d.index]!;
    const snap = (v: number): number => Math.round(v / 3) * 3;
    const next: OahuWorldRange = d.resize
      ? { ...r, w: Math.max(3, Math.min(255, snap(cx - r.x))), h: Math.max(3, Math.min(255, snap(cy - r.y))) }
      : { ...r, x: Math.max(0, Math.min(N - 3, snap(cx - d.ox))), y: Math.max(0, Math.min(N - 3, snap(cy - d.oy))) };
    if (next.x === r.x && next.y === r.y && next.w === r.w && next.h === r.h) return;
    if (!d.moved) this.mark();
    d.moved = true;
    list[d.index] = next;
    this.world.setRanges(d.slot, list);
  }

  private up(): void {
    this.drag = null;
  }

  private paintAt(x: number, y: number): void {
    const xx = ((x % N) + N) % N, yy = ((y % N) + N) % N;
    this.world.paint(xx, yy, this.brush.part, this.brush.rot);
  }

  /** Take the brush from a cell (the part covering it). */
  pick(x: number, y: number): void {
    const g = this.world.ground;
    if (!g || x < 0 || y < 0 || x >= N || y >= N) return;
    const c = this.coveredCells()[y * N + x]!;
    this.brush = c >= 0 ? { part: g.parts[c]!, rot: g.rots[c]! } : { part: 0, rot: 0 };
    this.signal.emit();
  }

  rotateBrush(step = 1): void {
    this.brush = { ...this.brush, rot: (this.brush.rot + step + 4) & 3 };
    this.signal.emit();
    this.grid.draw();
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
    else if (e.key === 'b') this.setTool('paint');
    else if (e.key === 'r') this.rotateBrush(e.shiftKey ? -1 : 1);
    else if (e.key === 'f') this.focus();
    else if (this.sel.type === 'entrance' && e.key.startsWith('Arrow')) {
      const r = this.world.entrances()[this.sel.index];
      if (!r) return false;
      const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key] ?? [0, 0];
      this.mark();
      this.world.setEntrance(this.sel.index, moveEntrance(r, WE.x(r) + dx!, WE.y(r) + dy!));
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

  private entranceShown(r: Uint8Array): boolean {
    return WE.part(r) ? this.layers.entrances : this.layers.returns;
  }

  private coveredCells(): Int32Array {
    if (!this.covered || this.terrainRevision !== this.world.revision) {
      const g = this.world.ground;
      this.covered = g ? oahuCoveredBy(g, this.world.partFlags) : new Int32Array(N * N).fill(-1);
    }
    return this.covered;
  }

  /** The terrain as a 300 x 300 picture (one pixel a cell), rebuilt after edits. */
  private terrainImage(): HTMLCanvasElement | null {
    const g = this.world.ground;
    if (!g) return null;
    if (this.terrain && this.terrainRevision === this.world.revision) return this.terrain;
    this.covered = null;
    const cov = this.coveredCells();
    this.terrainRevision = this.world.revision;
    const c = (this.terrain ??= document.createElement('canvas'));
    c.width = N;
    c.height = N;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    const colors = this.world.parts.map((p) => hexRgb(partColor(p)));
    const sea = hexRgb('#1d3f6e');
    for (let i = 0; i < N * N; i++) {
      const o = cov[i]!;
      const rgb = o >= 0 ? colors[g.parts[o]!] ?? [255, 0, 255] : sea;
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
    const w = this.world, L = this.layers;
    const terrain = L.terrain ? this.terrainImage() : null;
    if (terrain) {
      g.imageSmoothingEnabled = false;
      g.drawImage(terrain, 0, 0, N * s, N * s);
    }
    if (L.dark) this.paintGrid2(g, s, w.section(WS.dark), ['', DARK_SEA[1]!, DARK_SEA[2]!, DARK_SEA[3]!]);
    if (L.explored) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (const [x, y] of w.explored()) g.fillRect(x * s, y * s, s, s);
    }
    if (s >= 10 && terrain) {
      // the parts' directions
      const ground = w.ground!;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      const [x0, y0, x1, y1] = this.visibleCells(s);
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
    for (const slot of [WS.sea, WS.land] as const) {
      const layer = slot === WS.land ? 'land' : 'sea';
      if (!L[layer]) continue;
      g.lineWidth = 1;
      w.ranges(slot).forEach((r, i) => {
        const selected = sel.type === 'range' && sel.slot === slot && sel.index === i;
        g.fillStyle = slot === WS.land ? 'rgba(184,245,138,0.10)' : 'rgba(127,211,255,0.10)';
        g.fillRect(r.x * s, r.y * s, r.w * s, r.h * s);
        g.strokeStyle = selected ? '#fff' : LAYER_COLORS[layer]!;
        g.lineWidth = selected ? 2 : 1;
        g.strokeRect(r.x * s + 0.5, r.y * s + 0.5, r.w * s - 1, r.h * s - 1);
      });
    }
    for (const [slot, layer] of [[WS.events, 'events'], [WS.props, 'props'], [WS.chests, 'chests']] as const) {
      if (!L[layer]) continue;
      this.points(slot).forEach((p, i) => {
        const selected = sel.type === 'point' && sel.slot === slot && sel.index === i;
        const rad = Math.max(2.5, s * 0.3);
        g.fillStyle = LAYER_COLORS[layer]!;
        g.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.8)';
        g.lineWidth = selected ? 2 : 1;
        g.beginPath();
        if (slot === WS.chests) g.rect(p.x * s - rad, p.y * s - rad, rad * 2, rad * 2);
        else g.arc(p.x * s, p.y * s, rad, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
    }
    w.entrances().forEach((r, i) => {
      if (!this.entranceShown(r)) return;
      const [x, y] = entranceCell(r);
      const selected = sel.type === 'entrance' && sel.index === i;
      const part = WE.part(r);
      const rad = part ? Math.max(3.5, s * 0.45) : Math.max(2, s * 0.25);
      g.beginPath();
      g.arc(x * s, y * s, rad, 0, Math.PI * 2);
      if (part) {
        g.fillStyle = ENTRANCE_COLORS[part] ?? '#fff';
        g.fill();
      }
      g.strokeStyle = selected ? '#fff' : part ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.8)';
      g.lineWidth = selected ? 2.5 : 1.2;
      g.stroke();
      if (this.world.ports.has(WE.id(r))) {
        g.strokeStyle = '#7fd3ff';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x * s, y * s, rad + 2.5, 0, Math.PI * 2);
        g.stroke();
      }
      if (selected) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x * s, y * s, rad + 6, 0, Math.PI * 2);
        g.stroke();
      }
    });
    // the hovered cell (and what the brush would cover)
    const h = this.hover;
    if (h) {
      g.strokeStyle = this.tool === 'paint' ? '#ffeb3b' : 'rgba(255,255,255,0.6)';
      g.lineWidth = 1;
      const f = this.tool === 'paint' ? this.world.partFlags(this.brush.part) : 0;
      const wCells = f & WP_2X2 || (f & WP_2 && !(this.brush.rot & 1)) ? 2 : 1;
      const hCells = f & WP_2X2 || (f & WP_2 && this.brush.rot & 1) ? 2 : 1;
      g.strokeRect(h[0] * s + 0.5, h[1] * s + 0.5, wCells * s - 1, hCells * s - 1);
    }
  }

  private paintGrid2(g: CanvasRenderingContext2D, s: number, b: Uint8Array, colors: string[]): void {
    const [x0, y0, x1, y1] = this.visibleCells(s);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const v = grid2(b, x, y);
        if (!v || !colors[v]) continue;
        g.fillStyle = colors[v]!;
        g.fillRect(x * s, y * s, s, s);
      }
  }

  /** Cells inside the 2D view: [x0, y0, x1, y1). */
  private visibleCells(s: number): [number, number, number, number] {
    const c = this.grid.canvas;
    const x0 = Math.max(0, Math.floor(-this.grid.ox / s)), y0 = Math.max(0, Math.floor(-this.grid.oy / s));
    return [x0, y0, Math.min(N, Math.ceil((c.clientWidth - this.grid.ox) / s)), Math.min(N, Math.ceil((c.clientHeight - this.grid.oy) / s))];
  }

  // ---- 3D

  private async loadTerrain(): Promise<void> {
    this.status = '地形のモデルを読み込み中…';
    this.signal.emit();
    try {
      await this.world.load(this.dump);
      const set = await oahuWorldModels(this.dump, OAHU_WORLD_MODELS, OAHU_WORLD_TEXTURES, this.world.parts.map((p) => p.model));
      if (this.disposed) return;
      this.factory = new ModelFactory(set);
      this.status = set.errors.length ? `モデルの一部を読めませんでした: ${set.errors.slice(0, 3).join(' / ')}` : '';
    } catch (err) {
      this.status = `地形のモデルを読み込めませんでした (色の板で表示します): ${(err as Error).message}`;
    }
    this.world3d.clear();
    this.refresh();
  }

  private objectModel(row: number): THREE.Object3D | null {
    if (!this.objects.has(row)) {
      this.objects.set(row, null);
      const ref = this.world.maps.objectModel(row);
      if (ref)
        void oahuObjectModels(this.dump, ref).then((set) => {
          if (this.disposed || !set.models.size) return;
          this.objects.set(row, new ModelFactory(set));
          this.world3d.sync(true);
        }, () => {});
      return null;
    }
    const f = this.objects.get(row);
    const ref = this.world.maps.objectModel(row);
    return f && ref ? f.instance(ref.entry) : null;
  }

  /** What the 3D view draws besides the terrain: the entrances' and props' models, markers for the rest. */
  private marks3d(): WorldMark[] {
    const w = this.world, sel = this.sel, L = this.layers;
    const out: WorldMark[] = [];
    w.entrances().forEach((r, i) => {
      if (!this.entranceShown(r)) return;
      const [x, y] = entranceCell(r);
      const row = WE.model(r) || (WE.part(r) ? w.parts[WE.part(r)]?.object ?? 0 : 0);
      out.push({
        x, y, angle: worldObjectAngle(WE.dir(r)), scale: w.maps.objectScale(row),
        make: row && this.showModels ? () => this.objectModel(row) : undefined,
        color: WE.part(r) ? ENTRANCE_COLORS[WE.part(r)] ?? '#ffffff' : '#ffffff',
        selected: sel.type === 'entrance' && sel.index === i,
      });
    });
    for (const [slot, layer] of [[WS.chests, 'chests'], [WS.props, 'props'], [WS.events, 'events']] as const) {
      if (!L[layer]) continue;
      this.points(slot).forEach((p, i) => {
        out.push({
          x: p.x, y: p.y, angle: p.dir !== undefined ? worldObjectAngle(p.dir) : 0, scale: slot === WS.props ? w.maps.objectScale(p.value) : 1,
          make: slot === WS.props && this.showModels ? () => this.objectModel(p.value) : undefined,
          color: LAYER_COLORS[layer]!,
          selected: sel.type === 'point' && sel.slot === slot && sel.index === i,
        });
      });
    }
    return out;
  }
}

function hexRgb(c: string): [number, number, number] {
  const v = parseInt(c.slice(1, 7), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
