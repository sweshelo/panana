// The views of a lanai map: the top-down grid and the 3D scene shared with the other map pages (editor/gridcanvas.ts,
// editor/mapscene.ts), driven by the editor's Controller (tools, selection, dragging) on the page's LanaiEditState.
// The tile models are the GSCs of the map's tileset (mapModels.ts): the map's own and every one of the palette, read
// again when an edit changes the map's MapData (indoor tiles; map.md §6.1). The 3D view draws the models the game
// places for records (mapObjects.ts) as RPG3's map page does, and markers for the others.
import * as THREE from 'three';
import { AnimatedModel, animationKey } from '../cgfx/player';
import { ModelFactory } from '../cgfx/three';
import { Controller, norm } from '../editor/controller';
import { drawTileGlyph, GridCanvas, strokeCell } from '../editor/gridcanvas';
import { kindColor, ROOM_COLOR, ROT_ARROW, SECTION_COLORS } from '../editor/legend';
import { MapScene, TileFallback, TileLayer } from '../editor/mapscene';
import { GRID, type EditEvent } from '../editor/model';
import { CELL, letterIndex, letterLabel, recCellPos, type MapDoc } from '../game/sections';
import { Signal } from '../ui/useEditorState';
import { LANAI_EMPTY_KIND, type LanaiEditState } from './mapedit';
import { LANAI_LAYOUTS, LANAI_POINT_SECTIONS, LANAI_ROT_DIR, lanaiExitKind, type LanaiMapInfo, type LanaiPartRef, type LanaiTileSource } from './maps';
import { lanaiObjectModels, lanaiTileModels } from './mapModels';
import { lanaiObjectRef, lanaiRecordLook, type LanaiRecordLook, type LanaiRecordModel } from './mapObjects';

interface LoadedModel {
  factory: ModelFactory;
  hash: number;
  name: string;
  pose: THREE.Object3D | null;
}

/** The model at the first frame of its "001_" motion (an NPC's wait, a closed chest); null = it has none. */
function posed(f: ModelFactory, hash: number): THREE.Object3D | null {
  const motions = f.set.models.get(hash)?.animations.filter((a) => a.kind === 'skeletal' && a.skeletal.length) ?? [];
  const first = motions.find((a) => animationKey(a.name) === '001_');
  if (!first) return null;
  const m = new AnimatedModel(f, hash);
  m.select(first.name);
  return new THREE.Group().add(m.group);
}

export class LanaiMapView {
  readonly grid: GridCanvas;
  readonly scene: MapScene;
  readonly ctl: Controller;
  /** Emitted when what the panes show besides the edit state changes (models, status). */
  readonly signal = new Signal();
  /** Emitted when the hovered cell changes (the status bar). */
  readonly hover = new Signal();
  status = '';
  /** Draw the models of props and the other records (else markers only). */
  showModels = true;
  /** The last edit's error, shown in the status bar until the mouse moves. */
  errorMsg = '';
  /** Tile models of the map's tileset (the palette's thumbnails too). */
  factory: ModelFactory | null = null;
  /** The tile source the models were read for. */
  private loadedFor: LanaiTileSource | null = null;
  private readonly tileLayer = new TileLayer();
  private readonly fallback = new TileFallback();
  private readonly markers = new THREE.Group();
  private readonly overlay = new THREE.Group();
  /** Loaded models of records ("o<MapObject row>"); null while loading or when there is none. */
  private readonly objects = new Map<string, LoadedModel | null>();
  private readonly markerGeo = new THREE.SphereGeometry(60, 16, 12);
  private readonly markerMats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly roomGeo = new THREE.PlaneGeometry(CELL * 0.9, CELL * 0.9).rotateX(-Math.PI / 2);
  private readonly roomMat = new THREE.MeshBasicMaterial({ color: 0x50c8ff, transparent: true, opacity: 0.35, depthWrite: false });
  private readonly selGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL, 40, CELL));
  private readonly selMat = new THREE.LineBasicMaterial({ color: 0xffeb3b });
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(readonly st: LanaiEditState, readonly info: LanaiMapInfo) {
    this.ctl = new Controller(st);
    this.grid = new GridCanvas('view2d', (g, s) => this.paint(g, s), GRID);
    this.scene = new MapScene('view3d');
    this.scene.scene.add(this.tileLayer.group, this.markers, this.overlay);
    const pointer = {
      down: (cx: number, cy: number, e: { shiftKey: boolean; button: number }) => this.ctl.down(cx, cy, e),
      move: (cx: number, cy: number) => this.ctl.move(cx, cy),
      up: () => this.ctl.up(),
      leave: () => this.ctl.leave(),
    };
    this.grid.pointer = pointer;
    this.scene.pointer = pointer;
    this.ctl.onHover = () => {
      this.grid.draw();
      this.errorMsg = '';
      this.hover.emit();
    };
    this.unsubscribe = st.on((what) => this.changed(what));
    void this.loadTiles();
  }

  get doc(): MapDoc {
    return this.st.current!;
  }

  get maps() {
    return this.st.maps;
  }

  /** The open map's tile source (MapData, tileset). */
  get source(): LanaiTileSource {
    return this.st.source ?? this.maps.tileSource(this.info, this.doc);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.factory?.dispose();
    for (const f of this.objects.values()) f?.factory.dispose();
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

  private changed(what: EditEvent): void {
    if (this.st.current?.hash !== this.info.hash || this.disposed) return;
    // an edit that switched the MapData (indoor tiles) needs the other tileset's models
    const src = this.source;
    if (this.loadedFor && (src.mapData !== this.loadedFor.mapData || src.tileset !== this.loadedFor.tileset)) void this.loadTiles();
    if (what === 'doc' || what === 'selection' || what === 'map') this.sync3d();
    this.grid.draw();
    if (this.st.error) {
      this.errorMsg = this.st.error;
      this.st.error = '';
      this.signal.emit();
    }
  }

  /** The model of a tile (null: none; the entry hash keys it in the factory). */
  modelOf(kind: number, letter: number): LanaiPartRef | null {
    return this.maps.partRef(this.source, kind, letterIndex(letter));
  }

  // ---- 2D

  private paint(g: CanvasRenderingContext2D, s: number): void {
    const doc = this.st.current;
    if (!doc || doc.hash !== this.info.hash) return;
    const st = this.st, layers = this.ctl.layers, sel = st.selection;
    if (layers.tiles) for (const t of doc.tiles) drawTileGlyph(g, s, t.x, t.y, kindColor(t.kind), LANAI_ROT_DIR[t.rot]!, `${t.kind}${letterLabel(t.letter)}`, ROT_ARROW[LANAI_ROT_DIR[t.rot]!]);
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
    if (sel.type === 'tiles') for (const [x, y] of sel.cells) g.strokeRect(x * s + 1, y * s + 1, s - 2, s - 2);
    if (sel.type === 'rect') {
      const r = norm(sel);
      g.setLineDash([6, 4]);
      g.strokeRect(r.x0 * s, r.y0 * s, (r.x1 - r.x0 + 1) * s, (r.y1 - r.y0 + 1) * s);
      g.setLineDash([]);
    }
    const hv = this.ctl.hover;
    if (hv) {
      const [x, y] = hv;
      if (st.tool === 'paint') {
        g.globalAlpha = 0.6;
        drawTileGlyph(g, s, x, y, kindColor(st.brush.kind), LANAI_ROT_DIR[st.brush.rot]!, `${st.brush.kind}${letterLabel(st.brush.letter)}`, ROT_ARROW[LANAI_ROT_DIR[st.brush.rot]!]);
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
  }

  // ---- 3D

  /** The models of the map's tiles and of every tile of the tileset's palette (painting finds its model). */
  private refs(src: LanaiTileSource): LanaiPartRef[] {
    const out: LanaiPartRef[] = [];
    const add = (kind: number, letter: number): void => {
      const r = this.maps.partRef(src, kind, letter);
      if (r) out.push(r);
    };
    for (const t of this.doc.tiles) add(t.kind, letterIndex(t.letter));
    for (const [kind, letters] of this.maps.palette(src.tileset)) for (const l of letters) add(kind, l);
    return out;
  }

  private async loadTiles(): Promise<void> {
    const src = this.source;
    this.loadedFor = src;
    this.status = 'タイルのモデルを読み込み中…';
    this.signal.emit();
    try {
      const set = await lanaiTileModels(this.maps.session, src, this.refs(src));
      if (this.disposed || this.loadedFor !== src) return;
      this.factory?.dispose();
      this.factory = new ModelFactory(set);
      this.factory.setCeilingVisible(false);
      this.tileLayer.clear();
      this.status = set.errors.length ? `モデルの一部を読めませんでした: ${set.errors.slice(0, 3).join(' / ')}` : '';
    } catch (err) {
      if (this.loadedFor !== src) return;
      this.status = `モデルを読み込めませんでした (記号で表示します): ${(err as Error).message}`;
    }
    this.refresh();
  }

  /** What the game places for a record (null = no model in this section). */
  look(section: number, index: number): LanaiRecordLook | null {
    const rec = this.doc.recs[section]?.[index];
    return rec ? lanaiRecordLook(section, rec.raw, { mapObject: this.maps.session.table('MapObject') }) : null;
  }

  /** The name of a loaded model ("obj_box_01"), '' while it is loading or when there is none. */
  modelName(m: LanaiRecordModel | null): string {
    return (m && this.objects.get(this.modelKey(m))?.name) || '';
  }

  private modelKey(m: LanaiRecordModel): string {
    return `o${m.row}`;
  }

  /** An instance of a record's model; starts loading it the first time (the view is redrawn when it is there). */
  private recordModel(m: LanaiRecordModel): THREE.Object3D | null {
    const key = this.modelKey(m);
    if (!this.objects.has(key)) {
      this.objects.set(key, null);
      void this.loadModel(m).then((loaded) => {
        if (this.disposed || !loaded) return loaded?.factory.dispose();
        this.objects.set(key, loaded);
        this.sync3d();
        this.signal.emit();
      }, () => {});
      return null;
    }
    const o = this.objects.get(key);
    if (!o) return null;
    return o.pose ? o.pose.clone() : o.factory.instance(o.hash);
  }

  private async loadModel(m: LanaiRecordModel): Promise<LoadedModel | null> {
    const ref = lanaiObjectRef(this.maps.session.table('MapObject'), m.row);
    if (!ref) return null;
    const set = await lanaiObjectModels(this.maps.session, ref);
    if (!set.models.size) return null;
    const factory = new ModelFactory(set);
    return { factory, hash: ref.entry, name: set.paths.get(ref.entry) ?? '', pose: posed(factory, ref.entry) };
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
    const doc = this.st.current;
    if (!doc || doc.hash !== this.info.hash || this.disposed) return;
    const f = this.factory, layers = this.ctl.layers, sel = this.st.selection;
    const ts = this.loadedFor?.tileset ?? -1;
    this.tileLayer.sync(
      (layers.tiles ? doc.tiles : []).map((t) => ({
        x: t.x,
        y: t.y,
        sig: `${t.kind}/${t.rot}/${t.letter}/${f ? 1 : 0}/${ts}`,
        make: () => {
          const ref = f ? this.modelOf(t.kind, t.letter) : null;
          const m = ref ? f!.instance(ref.entry) : null;
          if (!m) return t.kind === LANAI_EMPTY_KIND && f ? new THREE.Group() : this.fallback.make(kindColor(t.kind), t.rot);
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
        const look = this.showModels ? this.look(k, i) : null;
        const model = look?.model ? this.recordModel(look.model) : null;
        if (model) {
          model.position.set(px * CELL, 0, py * CELL);
          model.rotation.y = look!.angle;
          this.markers.add(model);
          if (!selected) return;
        }
        const m = new THREE.Mesh(this.markerGeo, this.markerMat(SECTION_COLORS[k]!, selected));
        m.position.set(px * CELL, model ? 260 : 100, py * CELL);
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
    const cells: [number, number][] = sel.type === 'tiles' ? [...sel.cells] : [];
    if (sel.type === 'rect') {
      const r = norm(sel);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) cells.push([x, y]);
    }
    for (const [x, y] of cells) {
      const box = new THREE.LineSegments(this.selGeo, this.selMat);
      box.position.set((x + 0.5) * CELL, 20, (y + 0.5) * CELL);
      this.overlay.add(box);
    }
    this.scene.draw();
  }
}
