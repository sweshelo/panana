// The views of a lanai map (read only for now): the top-down grid and the 3D scene shared with the other map pages
// (editor/gridcanvas.ts, editor/mapscene.ts). The tile models are the GSCs of the map's tileset (mapModels.ts); records
// are markers. Clicking picks a tile or a record (the page shows it); the editing state (LanaiEditState) comes later.
import * as THREE from 'three';
import { ModelFactory } from '../cgfx/three';
import { drawTileGlyph, GridCanvas, strokeCell } from '../editor/gridcanvas';
import { kindColor, ROOM_COLOR, ROT_ARROW, SECTION_COLORS } from '../editor/legend';
import { MapScene, TileFallback, TileLayer } from '../editor/mapscene';
import { GRID, tileAt } from '../editor/state';
import { CELL, letterIndex, letterLabel, recCellPos, type MapDoc } from '../game/sections';
import { Signal } from '../ui/useEditorState';
import { LANAI_LAYOUTS, LANAI_POINT_SECTIONS, lanaiExitKind, type LanaiMapInfo, type LanaiMaps, type LanaiPartRef, type LanaiTileSource } from './maps';
import { lanaiTileModels } from './mapModels';

export type LanaiSelection = { type: 'none' } | { type: 'tile'; x: number; y: number } | { type: 'rec'; section: number; index: number };

/** The kind of the tiles the game leaves empty (map.md §6.3). */
const EMPTY_KIND = 33;

export class LanaiMapView {
  readonly grid: GridCanvas;
  readonly scene: MapScene;
  /** Emitted when what the panes show changes (layers, models, selection, hover). */
  readonly signal = new Signal();
  readonly doc: MapDoc;
  readonly source: LanaiTileSource;
  selection: LanaiSelection = { type: 'none' };
  hover: [number, number] | null = null;
  status = '';
  readonly layers = { tiles: true, room: true, sections: Object.fromEntries(LANAI_POINT_SECTIONS.map((k) => [k, true])) as Record<number, boolean> };
  factory: ModelFactory | null = null;
  private readonly tileLayer = new TileLayer();
  private readonly fallback = new TileFallback();
  private readonly markers = new THREE.Group();
  private readonly overlay = new THREE.Group();
  private readonly markerGeo = new THREE.SphereGeometry(60, 16, 12);
  private readonly markerMats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly roomGeo = new THREE.PlaneGeometry(CELL * 0.9, CELL * 0.9).rotateX(-Math.PI / 2);
  private readonly roomMat = new THREE.MeshBasicMaterial({ color: 0x50c8ff, transparent: true, opacity: 0.35, depthWrite: false });
  private readonly selGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL, 40, CELL));
  private readonly selMat = new THREE.LineBasicMaterial({ color: 0xffeb3b });
  private disposed = false;

  constructor(readonly maps: LanaiMaps, readonly info: LanaiMapInfo) {
    this.doc = maps.doc(info);
    this.source = maps.tileSource(info, this.doc);
    this.grid = new GridCanvas('view2d', (g, s) => this.paint(g, s), GRID);
    this.scene = new MapScene('view3d');
    this.scene.scene.add(this.tileLayer.group, this.markers, this.overlay);
    const pointer = {
      down: (cx: number, cy: number) => this.pick(cx, cy),
      move: (cx: number, cy: number) => this.setHover([Math.floor(cx), Math.floor(cy)]),
      up: () => {},
      leave: () => this.setHover(null),
    };
    this.grid.pointer = pointer;
    this.scene.pointer = pointer;
    void this.loadTiles();
  }

  dispose(): void {
    this.disposed = true;
    this.factory?.dispose();
    this.scene.dispose();
  }

  fit(): void {
    this.grid.fitCells(this.doc.tiles);
    this.scene.fitCells(this.doc.tiles);
  }

  /** Redraw both views (after a display setting changed). */
  refresh(): void {
    this.grid.draw();
    this.sync3d();
    this.signal.emit();
  }

  select(s: LanaiSelection): void {
    this.selection = s;
    this.refresh();
  }

  private setHover(c: [number, number] | null): void {
    if (c?.[0] === this.hover?.[0] && c?.[1] === this.hover?.[1]) return;
    this.hover = c;
    this.grid.draw();
    this.signal.emit();
  }

  /** The nearest visible record within half a cell of (cx, cy), else the tile there. */
  private pick(cx: number, cy: number): void {
    let best: LanaiSelection = { type: 'none' };
    let d = 0.5;
    for (const k of LANAI_POINT_SECTIONS) {
      if (!this.layers.sections[k]) continue;
      (this.doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, LANAI_LAYOUTS[k]!);
        const dist = Math.hypot(px - cx, py - cy);
        if (dist < d) {
          d = dist;
          best = { type: 'rec', section: k, index: i };
        }
      });
    }
    if (best.type === 'none') {
      const x = Math.floor(cx), y = Math.floor(cy);
      if (tileAt(this.doc, x, y)) best = { type: 'tile', x, y };
    }
    this.select(best);
  }

  // ---- 2D

  private paint(g: CanvasRenderingContext2D, s: number): void {
    const doc = this.doc, layers = this.layers, sel = this.selection;
    if (layers.tiles) for (const t of doc.tiles) drawTileGlyph(g, s, t.x, t.y, kindColor(t.kind), t.rot, `${t.kind}${letterLabel(t.letter)}`, ROT_ARROW[t.rot]);
    if (layers.room) {
      g.fillStyle = ROOM_COLOR;
      for (const c of doc.cells6) g.fillRect(c.x * s + 2, c.y * s + 2, s - 4, s - 4);
    }
    for (const k of [...LANAI_POINT_SECTIONS].reverse()) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, LANAI_LAYOUTS[k]!);
        const x = px * s, y = py * s;
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        g.fillStyle = SECTION_COLORS[k]!;
        g.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.7)';
        g.lineWidth = selected ? 2.5 : 1;
        const rad = Math.max(3, s * (k === 3 ? 0.26 : 0.15));
        g.beginPath();
        if (k === 3) {
          if (lanaiExitKind(r.raw) === 100) g.rect(x - rad, y - rad * 0.4, rad * 2, rad * 0.8);
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
      });
    }
    g.strokeStyle = '#ffeb3b';
    g.lineWidth = 2;
    if (sel.type === 'tile') strokeCell(g, s, sel.x, sel.y);
    if (this.hover) {
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      strokeCell(g, s, this.hover[0], this.hover[1]);
    }
  }

  // ---- 3D

  /** The models of every tile of the map. */
  private refs(): LanaiPartRef[] {
    const out: LanaiPartRef[] = [];
    for (const t of this.doc.tiles) {
      const r = this.maps.partRef(this.source, t.kind, letterIndex(t.letter));
      if (r) out.push(r);
    }
    return out;
  }

  /** The model of a tile (null: none; the entry hash keys it in the factory). */
  modelOf(kind: number, letter: number): LanaiPartRef | null {
    return this.maps.partRef(this.source, kind, letterIndex(letter));
  }

  private async loadTiles(): Promise<void> {
    this.status = 'タイルのモデルを読み込み中…';
    this.signal.emit();
    try {
      const set = await lanaiTileModels(this.maps.session, this.source, this.refs());
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
    if (this.disposed) return;
    const doc = this.doc, f = this.factory, layers = this.layers, sel = this.selection;
    this.tileLayer.sync(
      (layers.tiles ? doc.tiles : []).map((t) => ({
        x: t.x,
        y: t.y,
        sig: `${t.kind}/${t.rot}/${t.letter}/${f ? 1 : 0}`,
        make: () => {
          const ref = f ? this.modelOf(t.kind, t.letter) : null;
          const m = ref ? f!.instance(ref.entry) : null;
          if (!m) return t.kind === EMPTY_KIND && f ? new THREE.Group() : this.fallback.make(kindColor(t.kind), t.rot);
          m.rotation.y = (-t.rot * Math.PI) / 2;
          return m;
        },
      })),
    );
    this.markers.clear();
    for (const k of LANAI_POINT_SECTIONS) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, LANAI_LAYOUTS[k]!);
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        const m = new THREE.Mesh(this.markerGeo, this.markerMat(SECTION_COLORS[k]!, selected));
        m.position.set(px * CELL, 100, py * CELL);
        if (selected) m.scale.setScalar(1.4);
        this.markers.add(m);
      });
    }
    this.overlay.clear();
    if (layers.room)
      for (const c of doc.cells6) {
        const m = new THREE.Mesh(this.roomGeo, this.roomMat);
        m.position.set((c.x + 0.5) * CELL, 8, (c.y + 0.5) * CELL);
        this.overlay.add(m);
      }
    if (sel.type === 'tile') {
      const box = new THREE.LineSegments(this.selGeo, this.selMat);
      box.position.set((sel.x + 0.5) * CELL, 20, (sel.y + 0.5) * CELL);
      this.overlay.add(box);
    }
    this.scene.draw();
  }
}
