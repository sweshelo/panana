// The views of RPG3's map page: the top-down grid and the 3D scene shared with RPG2's map editor
// (editor/gridcanvas.ts, editor/mapscene.ts), the selection (a tile or a record), and moving records by dragging.
// Edits go to the map's document and are written to the map database when the drag ends (OahuMaps.commit).
import * as THREE from 'three';
import { ModelFactory } from '../cgfx/three';
import { drawTileGlyph, GridCanvas, strokeCell } from '../editor/gridcanvas';
import { kindColor, ROT_ARROW, SECTION_COLORS } from '../editor/legend';
import { MapScene, TileFallback, TileLayer } from '../editor/mapscene';
import { CELL, letterIndex, letterLabel, recCellPos, setRecCellPos, type MapDoc } from '../game/sections';
import type { Dump } from '../rom/dump';
import { Signal } from '../ui/useEditorState';
import { OAHU_LAYOUTS, oahuExitKind, type OahuMapInfo, type OahuMaps } from './maps';
import { oahuObjectModels, oahuTileModels } from './mapModels';

/** Sections with positioned records, drawn last first (exits on top). */
export const OAHU_POINT_SECTIONS = [3, 4, 5, 8, 2, 1, 9] as const;

export type OahuSelection = { type: 'none' } | { type: 'tile'; index: number } | { type: 'rec'; section: number; index: number };

/** Whether a record's event is placed in the preview state (story.ts OahuConditions.placed). */
export type Placement = 'shown' | 'hidden' | 'gone' | 'unknown';

export class OahuMapView {
  readonly grid: GridCanvas;
  readonly scene: MapScene;
  /** Emitted when the selection or the document changes (the inspector re-renders). */
  readonly signal = new Signal();
  selection: OahuSelection = { type: 'none' };
  /** Sections shown. */
  readonly layers: Record<number, boolean> = { 1: true, 2: true, 3: true, 4: true, 5: true, 8: true, 9: true };
  /** The story preview (#87): whether the record's EventObject row is placed in the chosen state; null = no preview. */
  placement: ((section: number, index: number) => Placement) | null = null;
  status = '';
  private hover: [number, number] | null = null;
  private drag: { section: number; index: number; moved: boolean } | null = null;
  private readonly tileLayer = new TileLayer();
  private readonly fallback = new TileFallback();
  private readonly markers = new THREE.Group();
  private factory: ModelFactory | null = null;
  private tileset = 0;
  private readonly objects = new Map<number, ModelFactory | null>();
  private readonly markerGeo = new THREE.SphereGeometry(60, 16, 12);
  private readonly markerMats = new Map<string, THREE.MeshLambertMaterial>();
  private disposed = false;

  constructor(
    private readonly dump: Dump,
    private readonly maps: OahuMaps,
    readonly info: OahuMapInfo,
    readonly doc: MapDoc,
  ) {
    this.grid = new GridCanvas('view2d', (g, s) => this.paint(g, s));
    this.scene = new MapScene('view3d');
    this.scene.scene.add(this.tileLayer.group, this.markers);
    const pointer = {
      down: (cx: number, cy: number) => this.down(cx, cy),
      move: (cx: number, cy: number) => this.move(cx, cy),
      up: () => this.up(),
      leave: () => {
        this.hover = null;
        this.grid.draw();
      },
    };
    this.grid.pointer = pointer;
    this.scene.pointer = pointer;
    void this.loadTiles();
  }

  dispose(): void {
    this.disposed = true;
    this.factory?.dispose();
    for (const f of this.objects.values()) f?.dispose();
    this.scene.dispose();
  }

  fit(): void {
    this.grid.fitCells(this.doc.tiles);
    this.scene.fitCells(this.doc.tiles);
  }

  /** Redraw both views and tell the inspector. */
  refresh(): void {
    this.grid.draw();
    this.sync3d();
    this.signal.emit();
  }

  select(s: OahuSelection): void {
    this.selection = s;
    this.refresh();
  }

  /** The document was edited outside the views (the inspector): write it to the map database. */
  commit(): void {
    this.maps.commit(this.info);
    this.refresh();
  }

  // ---- pointer

  /** The record under a point (nearest within 0.4 cell), else the tile. */
  private hit(cx: number, cy: number): OahuSelection {
    let best: OahuSelection = { type: 'none' }, bd = 0.4 * 0.4;
    for (const k of OAHU_POINT_SECTIONS) {
      if (!this.layers[k]) continue;
      (this.doc.recs[k] ?? []).forEach((r, i) => {
        const [x, y] = recCellPos(r, OAHU_LAYOUTS[k]!);
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bd) {
          bd = d;
          best = { type: 'rec', section: k, index: i };
        }
      });
    }
    if (best.type !== 'none') return best;
    const tx = Math.floor(cx), ty = Math.floor(cy);
    const index = this.doc.tiles.findIndex((t) => t.x === tx && t.y === ty);
    return index >= 0 ? { type: 'tile', index } : { type: 'none' };
  }

  private down(cx: number, cy: number): void {
    const s = this.hit(cx, cy);
    this.drag = s.type === 'rec' && !this.info.world ? { section: s.section, index: s.index, moved: false } : null;
    this.select(s);
  }

  private move(cx: number, cy: number): void {
    if (this.drag) {
      const r = this.doc.recs[this.drag.section]?.[this.drag.index];
      if (!r) return;
      const [ox, oy] = [r.x, r.y];
      setRecCellPos(r, OAHU_LAYOUTS[this.drag.section]!, cx, cy);
      if (r.x !== ox || r.y !== oy) {
        this.drag.moved = true;
        this.refresh();
      }
      return;
    }
    const h: [number, number] = [Math.floor(cx), Math.floor(cy)];
    if (this.hover?.[0] !== h[0] || this.hover?.[1] !== h[1]) {
      this.hover = h;
      this.grid.draw();
    }
  }

  private up(): void {
    if (this.drag?.moved) this.commit();
    this.drag = null;
  }

  // ---- 2D

  private paint(g: CanvasRenderingContext2D, s: number): void {
    const sel = this.selection;
    for (const t of this.doc.tiles) drawTileGlyph(g, s, t.x, t.y, kindColor(t.kind), t.rot, `${t.kind}${letterLabel(t.letter)}`, ROT_ARROW[t.rot]);
    for (const k of [...OAHU_POINT_SECTIONS].reverse()) {
      if (!this.layers[k]) continue;
      (this.doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, OAHU_LAYOUTS[k]!);
        const x = px * s, y = py * s;
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        const placed = this.placement?.(k, i) ?? 'shown';
        g.globalAlpha = placed === 'hidden' || placed === 'gone' ? 0.25 : 1;
        g.setLineDash(placed === 'hidden' || placed === 'gone' ? [3, 2] : []);
        g.fillStyle = SECTION_COLORS[k]!;
        g.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.7)';
        g.lineWidth = selected ? 2.5 : 1;
        const rad = Math.max(3, s * (k === 3 ? 0.26 : 0.15));
        g.beginPath();
        if (k === 3) {
          if (oahuExitKind(r.raw) === 0x64) g.rect(x - rad, y - rad * 0.4, rad * 2, rad * 0.8);
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
        g.globalAlpha = 1;
        g.setLineDash([]);
        if (placed === 'unknown') {
          g.fillStyle = '#fff';
          g.font = `bold ${Math.max(9, rad * 1.4)}px sans-serif`;
          g.fillText('?', x + rad * 0.8, y - rad * 0.6);
        }
      });
    }
    g.strokeStyle = '#ffeb3b';
    g.lineWidth = 2;
    if (sel.type === 'tile') {
      const t = this.doc.tiles[sel.index];
      if (t) strokeCell(g, s, t.x, t.y);
    }
    if (this.hover) {
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      strokeCell(g, s, this.hover[0], this.hover[1]);
    }
  }

  // ---- 3D

  private async loadTiles(): Promise<void> {
    const src = this.maps.tileSource(this.info, this.doc);
    this.tileset = src.tileset;
    const hashes = this.doc.tiles.map((t) => this.maps.partModel(t.kind, src.tileset, letterIndex(t.letter)));
    // every letter of the kinds in the map, so that edits find their model
    for (const k of new Set(this.doc.tiles.map((t) => t.kind))) for (let l = 0; l < 8; l++) hashes.push(this.maps.partModel(k, src.tileset, l));
    this.status = 'タイルのモデルを読み込み中…';
    this.signal.emit();
    try {
      const set = await oahuTileModels(this.dump, src, hashes);
      if (this.disposed) return;
      this.factory = new ModelFactory(set);
      this.factory.setCeilingVisible(false);
      this.tileLayer.clear();
      this.status = set.errors.length ? `モデルの一部を読めませんでした: ${set.errors.slice(0, 3).join(' / ')}` : '';
    } catch (err) {
      this.status = `モデルを読み込めませんでした (記号で表示します): ${(err as Error).message}`;
    }
    this.refresh();
  }

  private objectModel(row: number): THREE.Object3D | null {
    if (!this.objects.has(row)) {
      this.objects.set(row, null);
      const ref = this.maps.objectModel(row);
      if (ref)
        oahuObjectModels(this.dump, ref).then((set) => {
          if (this.disposed || !set.models.size) return;
          this.objects.set(row, new ModelFactory(set));
          this.sync3d();
        }, () => {});
      return null;
    }
    const f = this.objects.get(row);
    const ref = this.maps.objectModel(row);
    return f && ref ? f.instance(ref.entry) : null;
  }

  private markerMat(color: string, selected: boolean): THREE.MeshLambertMaterial {
    const key = color + selected;
    let m = this.markerMats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(selected ? 0x777777 : 0) });
      this.markerMats.set(key, m);
    }
    return m;
  }

  private sync3d(): void {
    const f = this.factory, ts = this.tileset;
    this.tileLayer.sync(
      this.doc.tiles.map((t) => ({
        x: t.x,
        y: t.y,
        sig: `${t.kind}/${t.rot}/${t.letter}/${f ? 1 : 0}`,
        make: () => {
          const h = f ? this.maps.partModel(t.kind, ts, letterIndex(t.letter)) : 0;
          const m = h ? f!.instance(h) : null;
          if (!m) return this.fallback.make(kindColor(t.kind), t.rot);
          m.rotation.y = (-t.rot * Math.PI) / 2;
          return m;
        },
      })),
    );
    this.markers.clear();
    const sel = this.selection;
    for (const k of OAHU_POINT_SECTIONS) {
      if (!this.layers[k]) continue;
      (this.doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, OAHU_LAYOUTS[k]!);
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        const placed = this.placement?.(k, i) ?? 'shown';
        if ((placed === 'hidden' || placed === 'gone') && !selected) return;
        const model = k === 2 ? this.objectModel(r.raw[0]! | (r.raw[1]! << 8)) : null;
        if (model) {
          model.position.set(px * CELL, 0, py * CELL);
          model.rotation.y = (-(r.raw[0x10]! & 3) * Math.PI) / 2;
          this.markers.add(model);
        }
        if (model && !selected) return;
        const m = new THREE.Mesh(this.markerGeo, this.markerMat(SECTION_COLORS[k]!, selected));
        m.position.set(px * CELL, model ? 260 : 100, py * CELL);
        if (selected) m.scale.setScalar(1.4);
        this.markers.add(m);
      });
    }
    this.scene.draw();
  }
}
