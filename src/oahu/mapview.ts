// The views of RPG3's map page: the top-down grid and the 3D scene shared with RPG2's map editor
// (editor/gridcanvas.ts, editor/mapscene.ts), driven by the editor's Controller (tools, selection, dragging) on the
// page's OahuEditState. The views follow the state's events; the edits go to the map database (mapedit.ts). The 3D view
// draws the models the game places for props, chests and the characters and objects of section 5 (mapObjects.ts).
import * as THREE from 'three';
import { AnimatedModel, animationKey } from '../cgfx/player';
import type { TilesetModels } from '../cgfx/tileset';
import { ModelFactory } from '../cgfx/three';
import { norm, Controller } from '../editor/controller';
import { drawTileGlyph, GridCanvas, strokeCell } from '../editor/gridcanvas';
import { kindColor, ROOM_COLOR, ROT_ARROW, SECTION_COLORS } from '../editor/legend';
import { MapScene, TileFallback, TileLayer } from '../editor/mapscene';
import { GRID, type EditEvent } from '../editor/state';
import { isIndoor } from '../game/objects';
import { CELL, letterIndex, letterLabel, recCellPos, type MapDoc } from '../game/sections';
import type { ModelRef } from '../pages/modelview';
import type { Dump } from '../rom/dump';
import { Signal } from '../ui/useEditorState';
import { OahuDenpaModels } from './denpaModels';
import { OAHU_POINT_SECTIONS, type OahuEditState } from './mapedit';
import { OAHU_LAYOUTS, oahuExitKind, type OahuMapInfo } from './maps';
import { oahuObjectModels, oahuTileModels } from './mapModels';
import { oahuRecordLook, type OahuRecordLook, type OahuRecordModel } from './mapObjects';

/** Whether a record's event is placed in the preview state (story.ts OahuConditions.placed). */
export type Placement = 'shown' | 'hidden' | 'gone' | 'unknown';

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

export class OahuMapView {
  readonly grid: GridCanvas;
  readonly scene: MapScene;
  readonly ctl: Controller;
  /** Emitted when what the panes show besides the edit state changes (models, status). */
  readonly signal = new Signal();
  /** Emitted when the hovered cell changes (the status bar). */
  readonly hover = new Signal();
  /** The story preview (#87): whether the record's EventObject row is placed in the chosen state; null = no preview. */
  placement: ((section: number, index: number) => Placement) | null = null;
  status = '';
  /** Draw the models of props, chests and characters (else markers only). */
  showModels = true;
  /** The last edit's error, shown in the status bar until the mouse moves. */
  errorMsg = '';
  /** Tile models of the map's tileset (the palette's thumbnails too). */
  factory: ModelFactory | null = null;
  private readonly tileLayer = new TileLayer();
  private readonly fallback = new TileFallback();
  private readonly markers = new THREE.Group();
  private readonly overlay = new THREE.Group();
  /**
   * Loaded models of records ("o<mapObject row>" / "m<monsterDesign row>"); null while loading or when there is none.
   * `pose` is the model at the first frame of its "001_" motion (NPCs wait, chests are closed) when it has one.
   */
  private readonly objects = new Map<string, LoadedModel | null>();
  private denpaModels: OahuDenpaModels | null = null;
  private readonly markerGeo = new THREE.SphereGeometry(60, 16, 12);
  private readonly markerMats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly roomGeo = new THREE.PlaneGeometry(CELL * 0.9, CELL * 0.9).rotateX(-Math.PI / 2);
  private readonly roomMat = new THREE.MeshBasicMaterial({ color: 0x50c8ff, transparent: true, opacity: 0.35, depthWrite: false });
  private readonly selGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL, 40, CELL));
  private readonly selMat = new THREE.LineBasicMaterial({ color: 0xffeb3b });
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(
    private readonly dump: Dump,
    readonly st: OahuEditState,
    readonly info: OahuMapInfo,
    /** The model of a monsterDesign row (OahuBattle.designModel). */
    private readonly designModel: (design: number) => ModelRef | null = () => null,
  ) {
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
    if (this.st.current?.hash !== this.info.hash) return;
    if (what === 'doc' || what === 'selection' || what === 'map') this.sync3d();
    this.grid.draw();
    if (this.st.error) {
      this.errorMsg = this.st.error;
      this.st.error = '';
      this.signal.emit();
    }
  }

  // ---- 2D

  private paint(g: CanvasRenderingContext2D, s: number): void {
    const doc = this.st.current;
    if (!doc || doc.hash !== this.info.hash) return;
    const st = this.st, layers = this.ctl.layers, sel = st.selection;
    if (layers.tiles) for (const t of doc.tiles) drawTileGlyph(g, s, t.x, t.y, kindColor(t.kind), t.rot, `${t.kind}${letterLabel(t.letter)}`, ROT_ARROW[t.rot]);
    if (layers.room) {
      g.fillStyle = ROOM_COLOR;
      for (const c of doc.cells6) g.fillRect(c.x * s + 2, c.y * s + 2, s - 4, s - 4);
    }
    for (const k of [...OAHU_POINT_SECTIONS].reverse()) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
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
        drawTileGlyph(g, s, x, y, kindColor(st.brush.kind), st.brush.rot, `${st.brush.kind}${letterLabel(st.brush.letter)}`, ROT_ARROW[st.brush.rot]);
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

  /** Every model of the tileset's palette (painting finds its model), and the map's own tiles. */
  private async loadTiles(): Promise<void> {
    const maps = this.st.maps;
    const src = maps.tileSource(this.info, this.doc);
    const hashes = this.doc.tiles.map((t) => maps.partModel(t.kind, src.tileset, letterIndex(t.letter)));
    for (const [kind, letters] of maps.palette(src.tileset)) for (const l of letters) hashes.push(maps.partModel(kind, src.tileset, l));
    for (const k of new Set(this.doc.tiles.map((t) => t.kind))) for (let l = 0; l < 8; l++) hashes.push(maps.partModel(k, src.tileset, l));
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

  /** What the game places for a record (null = no model in this section). */
  look(section: number, index: number): OahuRecordLook | null {
    const rec = this.doc.recs[section]?.[index];
    if (!rec) return null;
    const maps = this.st.maps;
    const d = maps.dungeonOf(this.info);
    const events = d ? maps.loadedEventTable(d) : null;
    return oahuRecordLook(section, rec.raw, { events, mapChara: maps.master.table('mapChara.bin'), indoor: isIndoor(this.doc) });
  }

  /** The file name of a loaded model ("npc_22"), '' while it is loading or when there is none. */
  modelName(m: OahuRecordModel | null): string {
    const key = m && this.modelKey(m);
    return (key && this.objects.get(key)?.name) || '';
  }

  private modelKey(m: OahuRecordModel): string | null {
    return m.type === 'object' ? `o${m.row}` : m.type === 'monster' ? `m${m.design}` : `d${m.kind}/${m.id}`;
  }

  /** An instance of a record's model; starts loading it the first time (the view is redrawn when it is there). */
  private recordModel(m: OahuRecordModel): THREE.Object3D | null {
    const key = this.modelKey(m);
    if (!key) return null;
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

  private async loadModel(m: OahuRecordModel): Promise<LoadedModel | null> {
    let got: { set: TilesetModels; hash: number } | null | undefined = null;
    if (m.type === 'object') {
      const ref = this.st.maps.objectModel(m.row);
      if (!ref) return null;
      const set = await oahuObjectModels(this.dump, ref);
      got = set.models.size ? { set, hash: ref.entry } : null;
    } else if (m.type === 'monster') {
      got = await this.designModel(m.design)?.load();
    } else {
      this.denpaModels ??= new OahuDenpaModels(this.dump, this.st.maps.master);
      got = await this.denpaModels.load(m);
    }
    if (!got) return null;
    const factory = new ModelFactory(got.set);
    return { factory, hash: got.hash, name: got.set.paths.get(got.hash) ?? '', pose: posed(factory, got.hash) };
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
    const maps = this.st.maps;
    const f = this.factory, ts = this.st.tileset, layers = this.ctl.layers;
    this.tileLayer.sync(
      (layers.tiles ? doc.tiles : []).map((t) => ({
        x: t.x,
        y: t.y,
        sig: `${t.kind}/${t.rot}/${t.letter}/${f ? 1 : 0}`,
        make: () => {
          const h = f ? maps.partModel(t.kind, ts, letterIndex(t.letter)) : 0;
          const m = h ? f!.instance(h) : null;
          if (!m) return this.fallback.make(kindColor(t.kind), t.rot);
          m.rotation.y = (-t.rot * Math.PI) / 2;
          return m;
        },
      })),
    );
    this.markers.clear();
    const sel = this.st.selection;
    for (const k of OAHU_POINT_SECTIONS) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, OAHU_LAYOUTS[k]!);
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        const placed = this.placement?.(k, i) ?? 'shown';
        if ((placed === 'hidden' || placed === 'gone') && !selected) return;
        const look = this.showModels ? this.look(k, i) : null;
        const model = look?.model ? this.recordModel(look.model) : null;
        if (model) {
          model.position.set(px * CELL, 0, py * CELL);
          model.rotation.y = look!.angle;
          if (look!.model!.type === 'object') model.scale.setScalar(maps.objectScale(look!.model!.row));
          this.markers.add(model);
        }
        if (model && !selected) return;
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
    const cells: [number, number][] = sel.type === 'tiles' ? sel.cells : [];
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
