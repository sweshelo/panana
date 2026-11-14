// The views of a lanai map: the top-down grid and the 3D scene shared with the other map pages (editor/gridcanvas.ts,
// editor/mapscene.ts), driven by the editor's Controller (tools, selection, dragging) on the page's LanaiEditState.
// The tile models are the GSCs of the map's tileset (mapModels.ts): the map's own and every one of the palette, read
// again when an edit changes the map's MapData (indoor tiles; map.md §6.1). The 3D view draws the models the game
// places for records (mapObjects.ts) as RPG3's map page does (MapObject rows, and the monsters of MonsterDesign for the
// bosses' figures), a mark for the effects the game puts instead of a model (the clear warp, the recovery points) and
// markers for the others.
import * as THREE from 'three';
import { lanaiRange, type LanaiRange, type LanaiRangeShape } from './rangeShape';
import { AnimatedModel, animationKey } from '../cgfx/player';
import { ModelFactory } from '../cgfx/three';
import type { TilesetModels } from '../cgfx/tileset';
import { Controller } from '../editor/controller';
import { drawHover, drawRoomCells, drawSelection, drawSnap, drawTiles } from '../editor/draw2d';
import { GridCanvas } from '../editor/gridcanvas';
import { kindColor, SECTION_COLORS } from '../editor/legend';
import { CellOverlay, MapScene, MarkerMaterials, TileFallback, TileLayer } from '../editor/mapscene';
import { GRID, type EditEvent } from '../editor/model';
import { isIndoor } from '../game/objects';
import { CELL, letterIndex, recCellPos, type MapDoc } from '../game/sections';
import { Signal } from '../ui/useEditorState';
import { u32 } from '../util/bytes';
import { LANAI_EMPTY_KIND, lanaiButtonDoor, sourceChanged, type LanaiEditState } from './mapedit';
import {
  LANAI_LAYOUTS,
  LANAI_POINT_SECTIONS,
  LANAI_ROT_DIR,
  lanaiExitKind,
  type LanaiMapInfo,
  type LanaiPartRef,
  type LanaiTileSource,
} from './maps';
import { lanaiObjectModels, lanaiTileModels } from './mapModels';
import { PartThumbnails } from '../editor/part-thumbnails';
import {
  LANAI_EFFECT_NAMES,
  lanaiObjectRef,
  lanaiObjectScale,
  lanaiRecordLook,
  type LanaiRecordLook,
  type LanaiRecordModel,
} from './mapObjects';
import { lanaiMonsterModel } from './monsterModels';
import { lanaiMonsterDesign } from './monsters';

interface LoadedModel {
  factory: ModelFactory;
  hash: number;
  name: string;
  pose: THREE.Object3D | null;
}

/**
 * The model at the first frame of its first motion: "001_" (a closed chest or door), else "000_" (an NPC's wait);
 * null = it has none.
 */
function posed(f: ModelFactory, hash: number): THREE.Object3D | null {
  const motions = f.set.models.get(hash)?.animations.filter((a) => a.kind === 'skeletal' && a.skeletal.length) ?? [];
  const first =
    motions.find((a) => animationKey(a.name) === '001_') ?? motions.find((a) => animationKey(a.name) === '000_');
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
  private readonly overlay = new CellOverlay();
  /** Loaded models of records ("o<MapObject row>" / "m<MonsterDesign row>"); null while loading or when there is none. */
  private readonly objects = new Map<string, LoadedModel | null>();
  private readonly markerGeo = new THREE.SphereGeometry(60, 16, 12);
  private readonly markerMats = new MarkerMaterials();
  /** The mark of an effect (a glowing column standing on the cell). */
  private readonly effectGeo = new THREE.CylinderGeometry(70, 70, 160, 24, 1, true).translate(0, 80, 0);
  private readonly effectMat = new THREE.MeshBasicMaterial({
    color: 0x66ccff,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  /** The walls of the ranges (section 8): their hit shape standing on the ground, translucent (rangeShape.ts). */
  private readonly rangeMats = rangeMaterials();
  /** Geometries made for the ranges of the last sync (disposed at the next). */
  private rangeGeos: THREE.BufferGeometry[] = [];
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(
    readonly st: LanaiEditState,
    readonly info: LanaiMapInfo,
  ) {
    this.ctl = new Controller(st);
    this.grid = new GridCanvas('view2d', (g, s) => this.paint(g, s), GRID);
    this.scene = new MapScene('view3d');
    this.scene.scene.add(this.tileLayer.group, this.markers, this.overlay.group);
    const pointer = {
      down: (cx: number, cy: number, e: { shiftKey: boolean; button: number }) => this.ctl.down(cx, cy, e),
      move: (cx: number, cy: number, e: { altKey: boolean }) => this.ctl.move(cx, cy, { altKey: e.altKey, tol: 0.15 }),
      up: () => this.ctl.up(),
      leave: () => this.ctl.leave(),
    };
    // A click in 2D also brings what it picked to the middle of the 3D view.
    this.grid.pointer = {
      ...pointer,
      move: (cx, cy, e) => this.ctl.move(cx, cy, { altKey: e.altKey, tol: 8 / this.grid.scale }),
      down: (cx, cy, e) => {
        pointer.down(cx, cy, e);
        const f = e.button === 0 ? this.ctl.clickFocus(cx, cy) : null;
        if (f) this.scene.centerOn(f[0], f[1]);
      },
    };
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
    this.partImages.dispose();
    this.disposed = true;
    this.unsubscribe();
    this.factory?.dispose();
    for (const f of this.objects.values()) f?.factory.dispose();
    this.effectGeo.dispose();
    this.effectMat.dispose();
    for (const g of this.rangeGeos) g.dispose();
    for (const m of Object.values(this.rangeMats)) {
      m.fill.dispose();
      m.line.dispose();
    }
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
    if (this.loadedFor && sourceChanged(this.loadedFor, src)) void this.loadTiles();
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
    const st = this.st,
      layers = this.ctl.layers,
      sel = st.selection;
    if (layers.tiles) drawTiles(g, s, doc.tiles, LANAI_ROT_DIR);
    if (layers.room) drawRoomCells(g, s, doc);
    const events = this.maps.eventTable(this.info.dungeon);
    if (layers.sections[3] && layers.sections[5] && events) {
      const doors = new Map((doc.recs[3] ?? []).map((r) => [u32(r.raw, 4), r]));
      g.save();
      g.strokeStyle = '#48cdd3';
      g.fillStyle = '#14575d';
      g.lineWidth = 2;
      g.setLineDash([5, 4]);
      g.font = '11px sans-serif';
      for (const button of doc.recs[5] ?? []) {
        if (![4, 5, 6].includes(u32(button.raw, 0))) continue;
        const target = lanaiButtonDoor(this.maps, this.info.dungeon, u32(button.raw, 4));
        const door = target === null ? null : doors.get(target);
        if (!door) continue;
        const [bx, by] = recCellPos(button, LANAI_LAYOUTS[5]!);
        const [dx, dy] = recCellPos(door, LANAI_LAYOUTS[3]!);
        g.beginPath();
        g.moveTo(bx * s, by * s);
        g.lineTo(dx * s, dy * s);
        g.stroke();
        g.fillText('このボタンで開く', ((bx + dx) / 2) * s + 4, ((by + dy) / 2) * s - 4);
      }
      g.restore();
    }
    for (const k of [...LANAI_POINT_SECTIONS].reverse()) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, LANAI_LAYOUTS[k]!);
        const x = px * s,
          y = py * s;
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        if (k === 8) drawRange(g, s, lanaiRange(r.raw, events), selected);
        g.fillStyle = SECTION_COLORS[k]!;
        g.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.7)';
        g.lineWidth = selected ? 2.5 : 1;
        const rad = Math.max(3, s * (k === 3 ? 0.26 : 0.15));
        g.beginPath();
        if (k === 3) {
          const kind = lanaiExitKind(r.raw);
          if (kind === 2) {
            g.fillStyle = '#15465a';
            g.strokeStyle = selected ? '#fff' : '#48cdd3';
            g.lineWidth = Math.max(2, rad * 0.3);
            g.arc(x, y, rad, 0, Math.PI * 2);
          } else if (kind === 100) g.rect(x - rad, y - rad * 0.4, rad * 2, rad * 0.8);
          else {
            if (kind === 4) {
              g.fillStyle = '#15465a';
              g.strokeStyle = selected ? '#fff' : '#48cdd3';
            }
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
    drawSnap(g, s, st, this.ctl);
    drawSelection(g, s, st);
    drawHover(g, s, st, this.ctl.hover, LANAI_ROT_DIR);
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
    if (!rec) return null;
    return this.partLook(section, rec.raw);
  }

  partLook(section: number, raw: Uint8Array): LanaiRecordLook | null {
    const maps = this.maps;
    return lanaiRecordLook(section, raw, {
      mapObject: maps.session.table('MapObject'),
      mapChara: maps.contentTable('MapChara'),
      events: maps.eventTable(this.info.dungeon),
      indoor: isIndoor(this.doc),
    });
  }

  private readonly partImages = new PartThumbnails<LanaiRecordModel>((model) => this.loadModel(model));
  partThumb(model: LanaiRecordModel | null): Promise<string | null> {
    return model ? this.partImages.get(JSON.stringify(model), model) : Promise.resolve(null);
  }

  /** The name of a loaded model ("obj_box_01") or of an effect ("fx_bg_repair_point.ptcl"), '' while it is loading or when there is none. */
  modelName(m: LanaiRecordModel | null): string {
    if (m?.type === 'effect') return LANAI_EFFECT_NAMES[m.row] ?? '';
    return (m && this.objects.get(this.modelKey(m))?.name) || '';
  }

  private modelKey(m: LanaiRecordModel): string {
    return m.type === 'monster' ? `m${m.design}` : `o${m.row}`;
  }

  /** An instance of a record's model; starts loading it the first time (the view is redrawn when it is there). */
  private recordModel(m: LanaiRecordModel): THREE.Object3D | null {
    if (m.type === 'effect') return new THREE.Mesh(this.effectGeo, this.effectMat);
    const key = this.modelKey(m);
    if (!this.objects.has(key)) {
      this.objects.set(key, null);
      void this.loadModel(m).then(
        (loaded) => {
          if (this.disposed || !loaded) return loaded?.factory.dispose();
          this.objects.set(key, loaded);
          this.sync3d();
          this.signal.emit();
        },
        () => {},
      );
      return null;
    }
    const o = this.objects.get(key);
    if (!o) return null;
    return o.pose ? o.pose.clone() : o.factory.instance(o.hash);
  }

  private async loadModel(m: LanaiRecordModel): Promise<LoadedModel | null> {
    const session = this.maps.session;
    let got: { set: TilesetModels; hash: number } | null = null;
    if (m.type === 'object') {
      const ref = lanaiObjectRef(session.table('MapObject'), m.row);
      if (!ref) return null;
      const set = await lanaiObjectModels(session, ref);
      got = set.models.size ? { set, hash: ref.entry } : null;
    } else if (m.type === 'monster') {
      const d = lanaiMonsterDesign(session, m.design);
      const ref = d && lanaiMonsterModel(session, d);
      if (ref) got = await ref.load();
    }
    if (!got) return null;
    const factory = new ModelFactory(got.set);
    return { factory, hash: got.hash, name: got.set.paths.get(got.hash) ?? '', pose: posed(factory, got.hash) };
  }

  private sync3d(): void {
    const doc = this.st.current;
    if (!doc || doc.hash !== this.info.hash || this.disposed) return;
    const f = this.factory,
      layers = this.ctl.layers,
      sel = this.st.selection;
    const ts = this.loadedFor?.tileset ?? -1;
    this.tileLayer.sync(
      (layers.tiles ? doc.tiles : []).map((t) => ({
        x: t.x,
        y: t.y,
        sig: `${t.kind}/${t.rot}/${t.letter}/${f ? 1 : 0}/${ts}`,
        make: () => {
          const ref = f ? this.modelOf(t.kind, t.letter) : null;
          const m = ref ? f!.instance(ref.entry) : null;
          if (!m)
            return t.kind === LANAI_EMPTY_KIND && f ? new THREE.Group() : this.fallback.make(kindColor(t.kind), t.rot);
          m.rotation.y = (-t.rot * Math.PI) / 2;
          return m;
        },
      })),
    );
    this.markers.clear();
    for (const g of this.rangeGeos) g.dispose();
    this.rangeGeos = [];
    const events = this.maps.eventTable(this.info.dungeon);
    for (const k of LANAI_POINT_SECTIONS) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, LANAI_LAYOUTS[k]!);
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        // a range: its walls in place of the marker
        if (k === 8) {
          const wall = rangeWalls(lanaiRange(r.raw, events).shape);
          if (wall) {
            const edges = new THREE.EdgesGeometry(wall, 30);
            this.rangeGeos.push(wall, edges);
            const m = selected ? this.rangeMats.selected : this.rangeMats.normal;
            this.markers.add(new THREE.Mesh(wall, m.fill), new THREE.LineSegments(edges, m.line));
            return;
          }
        }
        const look = this.showModels ? this.look(k, i) : null;
        const model = look?.model ? this.recordModel(look.model) : null;
        if (model) {
          const [ox, oz] = look!.offset ?? [0, 0];
          model.position.set(px * CELL + ox, 0, py * CELL + oz);
          model.rotation.y = look!.angle;
          // monsters keep their own size (not checked against the game yet)
          if (look!.model!.type === 'object')
            model.scale.setScalar(lanaiObjectScale(this.maps.session.table('MapObject'), look!.model!.row));
          this.markers.add(model);
          if (!selected) return;
        }
        const m = new THREE.Mesh(this.markerGeo, this.markerMats.get(SECTION_COLORS[k]!, selected));
        m.position.set(px * CELL, model ? 260 : 100, py * CELL);
        if (selected) m.scale.setScalar(1.4);
        this.markers.add(m);
      });
    }
    this.overlay.sync(doc, sel, layers.room);
    this.scene.draw();
  }
}

/** A range's hit shape (rangeShape.ts): filled lightly, dashed when walking does not hit it, brighter when selected. */
function drawRange(g: CanvasRenderingContext2D, s: number, range: LanaiRange, selected: boolean): void {
  const shape = range.shape;
  if (!shape) return;
  g.save();
  g.strokeStyle = SECTION_COLORS[8]!;
  g.fillStyle = SECTION_COLORS[8]!;
  g.lineWidth = selected ? 2 : 1.25;
  g.setLineDash(range.otherChannel ? [4, 3] : []);
  g.beginPath();
  if (shape.type === 'circle') {
    if (shape.r <= 0) {
      g.restore();
      return;
    }
    g.arc(shape.cx * s, shape.cy * s, shape.r * s, 0, Math.PI * 2);
  } else g.rect(shape.x * s, shape.y * s, Math.max(1, shape.w * s), Math.max(1, shape.h * s));
  g.globalAlpha = selected ? 0.28 : 0.14;
  g.fill();
  g.globalAlpha = selected ? 1 : 0.7;
  g.stroke();
  g.restore();
}

/** How tall the walls of a range stand (world units; a cell is 500, the party about 200). */
const RANGE_WALL_HEIGHT = 300;

function rangeMaterials(): Record<'normal' | 'selected', { fill: THREE.Material; line: THREE.LineBasicMaterial }> {
  const color = new THREE.Color(SECTION_COLORS[8]!);
  const make = (opacity: number, lineOpacity: number) => ({
    fill: new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    line: new THREE.LineBasicMaterial({ color, transparent: true, opacity: lineOpacity }),
  });
  return { normal: make(0.18, 0.7), selected: make(0.38, 1) };
}

/**
 * The walls of a range's hit shape (rangeShape.ts, in cells): an open cylinder for a circle, four walls for a
 * rectangle, standing from the ground. Null when the shape hits nothing to show (no shape, a radius of 0).
 */
export function rangeWalls(shape: LanaiRangeShape | null): THREE.BufferGeometry | null {
  if (!shape) return null;
  let loop: [number, number][];
  if (shape.type === 'circle') {
    if (shape.r <= 0) return null;
    const n = 48;
    loop = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [(shape.cx + Math.cos(a) * shape.r) * CELL, (shape.cy + Math.sin(a) * shape.r) * CELL];
    });
  } else {
    // a rectangle of width or depth 0 is a line (the game tests it with the edges inside): drawn a little thick
    const w = Math.max(shape.w, 0.01),
      h = Math.max(shape.h, 0.01);
    const [x0, z0, x1, z1] = [shape.x * CELL, shape.y * CELL, (shape.x + w) * CELL, (shape.y + h) * CELL];
    loop = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
  }
  const pos: number[] = [];
  for (let i = 0; i < loop.length; i++) {
    const [ax, az] = loop[i]!,
      [bx, bz] = loop[(i + 1) % loop.length]!;
    pos.push(
      ax,
      0,
      az,
      bx,
      0,
      bz,
      bx,
      RANGE_WALL_HEIGHT,
      bz,
      ax,
      0,
      az,
      bx,
      RANGE_WALL_HEIGHT,
      bz,
      ax,
      RANGE_WALL_HEIGHT,
      az,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
