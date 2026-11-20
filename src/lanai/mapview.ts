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
import { lanaiAnimationIds, lanaiAnimationName, lanaiDenpaModel } from './animationModels';
import { scriptRowId, type ScriptWho } from './eventScript';
import { ModelFactory } from '../cgfx/three';
import type { TilesetModels } from '../cgfx/tileset';
import { Controller } from '../editor/controller';
import { drawHover, drawRoomCells, drawSelection, drawSnap, drawTiles } from '../editor/draw2d';
import { GridCanvas } from '../editor/gridcanvas';
import { partOf, type AutoProfile } from '../editor/autotile';
import { drawTerrainMinimap } from '../editor/minimap';
import { kindColor, SECTION_COLORS } from '../editor/legend';
import { CellOverlay, MapScene, MarkerMaterials, TileFallback, TileLayer } from '../editor/mapscene';
import { GRID, type EditEvent } from '../editor/model';
import { isIndoor } from '../game/objects';
import { CELL, letterIndex, recCellPos, WORLD_SNAP, type MapDoc } from '../game/sections';
import { Signal } from '../ui/useEditorState';
import { LANAI_EMPTY_KIND, lanaiRecEventRow, sourceChanged, type LanaiEditState } from './mapedit';
import { lanaiMapLinks, type LanaiMapLink } from './mapLinks';
import {
  LANAI_EVENT_SECTIONS,
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
import {
  cellToWorld,
  mapScriptMoves,
  moveWhoText,
  withScriptMove,
  worldToCell,
  type MapScriptMoves,
  type ScriptMove,
} from './scriptMoves';

/** A move() of the stage's script by its function and its place among the function's move() statements. */
export interface LanaiMoveRef {
  fn: string;
  k: number;
}
/** A move() on the map: where it is, and where whom it moves stands before it (null: not known). */
export interface LanaiMovePoint extends LanaiMoveRef {
  move: ScriptMove;
  from: [number, number] | null;
  /** The function, the move()'s number in it (1-based) and whom it moves, as the views label it. */
  label: string;
}
const MOVE_COLOR = '#ffb347';

interface LoadedModel {
  factory: ModelFactory;
  hash: number;
  name: string;
  pose: THREE.Object3D | null;
}

interface PreviewActor {
  group: THREE.Object3D;
  motion: AnimatedModel | null;
  factory: ModelFactory | null;
  started: number;
  frames: number;
  fallback: boolean;
}

/**
 * The model at the first frame of its first motion: "001_" (a closed chest or door), else "000_" (an NPC's wait);
 * null = it has none.
 */
function posed(f: ModelFactory, hash: number, material?: string): THREE.Object3D | null {
  const motions = f.set.models.get(hash)?.animations.filter((a) => a.kind === 'skeletal' && a.skeletal.length) ?? [];
  const first =
    motions.find((a) => animationKey(a.name) === '001_') ?? motions.find((a) => animationKey(a.name) === '000_');
  if (!first && !material) return null;
  const m = new AnimatedModel(f, hash);
  m.select(first?.name ?? null);
  // a material animation the record picks (the number of a level door: mapObjects.ts lanaiLevelDoorNumber)
  if (material) m.addMaterial(material);
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
  /** Draw the connections of the records in 2D (mapLinks.ts: a button and its door, a warp and where it leads). */
  showLinks = true;
  /** Draw the destinations of the script's move() statements (scriptMoves.ts), which can be dragged. */
  showMoves = true;
  /** The move() picked on the map (its numbers are shown on the page); null: none. */
  activeMove: LanaiMoveRef | null = null;
  /** The move() being dragged and where it is now, in world units (written to the script when the button is let go). */
  private moveDrag: (LanaiMoveRef & { x: number; z: number }) | null = null;
  private readonly moveGroup = new THREE.Group();
  private readonly moveGeo = new THREE.ConeGeometry(55, 140, 16).rotateX(Math.PI).translate(0, 70, 0);
  private readonly moveMat = new THREE.MeshLambertMaterial({ color: MOVE_COLOR, emissive: 0x442200 });
  private readonly moveMatActive = new THREE.MeshLambertMaterial({ color: '#fff1d6', emissive: 0x996633 });
  private readonly moveLineMat = new THREE.LineDashedMaterial({ color: MOVE_COLOR, dashSize: 80, gapSize: 50 });
  /** How the 2D view draws the tiles: the editor's symbols, or as the game's minimap does (floor, walls, entrances). */
  style2d: 'symbols' | 'minimap' = 'symbols';
  /** The last edit's error, shown in the status bar until the mouse moves. */
  errorMsg = '';
  /** Tile models of the map's tileset (the palette's thumbnails too). */
  factory: ModelFactory | null = null;
  /** The tile source the models were read for. */
  private loadedFor: LanaiTileSource | null = null;
  private readonly tileLayer = new TileLayer();
  private readonly fallback = new TileFallback();
  private readonly markers = new THREE.Group();
  /** The existing map visuals of each EventObject row; preview hides these without rebuilding the whole map. */
  private readonly recordVisuals = new Map<number, THREE.Object3D[]>();
  private readonly previewGroup = new THREE.Group();
  private readonly previewActors = new Map<string, PreviewActor>();
  private previewSelf: number | null = null;
  private previewRevision = 0;
  private previewFrame = 0;
  private previewLastFrame = 0;
  private previewCamera: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
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
  private readonly unsubscribeSession: () => void;
  private disposed = false;

  constructor(
    readonly st: LanaiEditState,
    readonly info: LanaiMapInfo,
    readonly hostWindow: Window = window,
  ) {
    this.ctl = new Controller(st);
    this.grid = new GridCanvas('view2d', (g, s) => this.paint(g, s), GRID);
    this.scene = new MapScene('view3d', 30, hostWindow);
    this.scene.scene.add(this.tileLayer.group, this.markers, this.overlay.group, this.moveGroup, this.previewGroup);
    // a move() point under the pointer is dragged instead of what the editor's tools do there
    const pointer = (tol: () => number, canvas: HTMLCanvasElement) => ({
      /** Whether the press picked a move() point (the editor's tools then get nothing). */
      grab: (cx: number, cy: number, e: { button: number }): boolean => {
        const hit = e.button === 0 ? this.moveAt(cx, cy, tol()) : null;
        if (!hit) return false;
        this.activeMove = { fn: hit.fn, k: hit.k };
        this.moveDrag = { fn: hit.fn, k: hit.k, x: hit.move.x, z: hit.move.z };
        this.drawMoves();
        this.signal.emit();
        return true;
      },
      move: (cx: number, cy: number, e: { altKey: boolean }): void => {
        const d = this.moveDrag;
        if (d) {
          // on the grid the doors on the walls sit on (50) unless Alt is held
          const snap = (c: number): number => {
            const w = cellToWorld(c);
            return e.altKey ? Math.round(w) : Math.round(w / WORLD_SNAP) * WORLD_SNAP;
          };
          [d.x, d.z] = [snap(cx), snap(cy)];
          this.drawMoves();
          return;
        }
        canvas.style.cursor = this.moveAt(cx, cy, tol()) ? 'grab' : '';
        this.ctl.move(cx, cy, { altKey: e.altKey, tol: tol() });
      },
      up: (): void => {
        if (this.moveDrag) this.endMoveDrag();
        else this.ctl.up();
      },
      leave: (): void => {
        if (!this.moveDrag) this.ctl.leave();
      },
    });
    const p2 = pointer(() => 8 / this.grid.scale, this.grid.canvas);
    const p3 = pointer(() => 0.3, this.scene.canvas);
    // A click in 2D also brings what it picked to the middle of the 3D view.
    this.grid.pointer = {
      ...p2,
      down: (cx, cy, e) => {
        if (p2.grab(cx, cy, e)) return;
        this.ctl.down(cx, cy, e);
        const f = e.button === 0 ? this.ctl.clickFocus(cx, cy) : null;
        if (f) this.scene.centerOn(f[0], f[1]);
      },
    };
    this.scene.pointer = {
      ...p3,
      down: (cx, cy, e) => {
        if (!p3.grab(cx, cy, e)) this.ctl.down(cx, cy, e);
      },
    };
    // the script is changed on the stage's page too
    this.unsubscribeSession = this.maps.session.onEdit(() => {
      if (this.disposed) return;
      this.drawMoves();
      this.signal.emit();
    });
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
    this.clearPreview();
    this.partImages.dispose();
    this.disposed = true;
    this.unsubscribe();
    this.unsubscribeSession();
    this.clearMoveGroup();
    this.moveGeo.dispose();
    this.moveMat.dispose();
    this.moveMatActive.dispose();
    this.moveLineMat.dispose();
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

  /** Bring a record to the middle of both views (a link to the record: MapPage.tsx). */
  centerOnRecord(section: number, index: number): void {
    const rec = this.doc.recs[section]?.[index];
    const L = LANAI_LAYOUTS[section];
    if (!rec || !L) return;
    const [x, y] = recCellPos(rec, L);
    this.grid.centerOn(x, y);
    this.scene.centerOn(x, y);
  }

  /** Redraw both views (after a display setting changed). */
  refresh(): void {
    this.grid.draw();
    this.sync3d();
    this.signal.emit();
  }

  /** Preview actors live only in this view. They never write to the map or session. */
  beginPreview(self: number | null): void {
    this.clearPreview();
    this.previewSelf = self;
    this.previewCamera = {
      position: this.scene.camera.position.clone(),
      target: this.scene.controls.target.clone(),
    };
  }

  private previewKey(who: ScriptWho): string {
    if (who.kind === 'hero') return 'hero';
    const row = who.kind === 'self' ? this.previewSelf : who.row;
    if (row === null) throw new Error('self の対象イベントがありません。関数をマップのイベントに割り当ててください。');
    return `chara:${row}`;
  }

  private previewRecord(row: number): { section: number; index: number; x: number; z: number } | null {
    // An EventObject row can have several records. For obj(), prefer the character over a linked door or range.
    for (const section of [5, 3, 4, 8] as const)
      for (let index = 0; index < (this.doc.recs[section]?.length ?? 0); index++) {
        const rec = this.doc.recs[section]![index]!;
        if (lanaiRecEventRow(section, rec.raw) !== row) continue;
        const [x, z] = recCellPos(rec, LANAI_LAYOUTS[section]!);
        return { section, index, x: cellToWorld(x), z: cellToWorld(z) };
      }
    return null;
  }

  async previewActor(who: ScriptWho): Promise<void> {
    const key = this.previewKey(who);
    if (this.previewActors.has(key)) return;
    const revision = this.previewRevision;
    const row = key === 'hero' ? null : Number(key.slice(6));
    const rec = row === null ? null : this.previewRecord(row);
    if (row !== null && !rec) throw new Error(`イベント ${row} はこのマップにありません。`);
    let factory: ModelFactory | null = null;
    let motion: AnimatedModel | null = null;
    let group: THREE.Object3D | null = null;
    let fallback = false;
    try {
      if (row === null) {
        const ref = lanaiDenpaModel(this.maps.session);
        const loaded = await ref.load();
        if (this.disposed || revision !== this.previewRevision) return;
        if (!loaded) throw new Error('先頭の電波人間のモデルを読めませんでした。');
        factory = new ModelFactory(loaded.set);
        motion = new AnimatedModel(factory, loaded.hash);
        group = motion.group;
      } else {
        const look = this.look(rec!.section, rec!.index);
        if (look?.model && look.model.type !== 'effect') {
          const loaded = await this.loadModel(look.model).catch(() => null);
          if (this.disposed || revision !== this.previewRevision) return loaded?.factory.dispose();
          if (loaded) {
            factory = loaded.factory;
            try {
              motion = new AnimatedModel(factory, loaded.hash);
              group = motion.group;
              if (look.model.type === 'object')
                group.scale.setScalar(lanaiObjectScale(this.maps.session.table('MapObject'), look.model.row));
              group.rotation.y = look.angle;
            } catch {
              factory.dispose();
              factory = null;
            }
          }
        }
      }
      if (!group) {
        fallback = true;
        group = new THREE.Mesh(
          new THREE.ConeGeometry(70, 190, 12),
          new THREE.MeshLambertMaterial({ color: key === 'hero' ? '#86dfff' : '#ffa967' }),
        );
        group.position.y = 95;
      }
      const tile = this.doc.tiles[0];
      if (rec) group.position.set(rec.x, group.position.y, rec.z);
      else if (tile) group.position.set(cellToWorld(tile.x), group.position.y, cellToWorld(tile.y));
      this.previewGroup.add(group);
      this.previewActors.set(key, { group, motion, factory, started: 0, frames: 0, fallback });
      if (row !== null) for (const visual of this.recordVisuals.get(row) ?? []) visual.visible = false;
      this.scene.draw();
    } catch (e) {
      factory?.dispose();
      throw e;
    }
  }

  previewPosition(who: ScriptWho): THREE.Vector3 {
    const actor = this.previewActors.get(this.previewKey(who));
    if (!actor) throw new Error('プレビューのキャラがありません。');
    return actor.group.position.clone();
  }

  previewSetPosition(who: ScriptWho, x: number, y: number, z: number): void {
    const actor = this.previewActors.get(this.previewKey(who))!;
    actor.group.position.set(x, y, z);
    this.scene.draw();
  }

  previewSetAngle(who: ScriptWho, degrees: number): void {
    this.previewActors.get(this.previewKey(who))!.group.rotation.y = (degrees * Math.PI) / 180;
    this.scene.draw();
  }

  previewSetVisible(who: ScriptWho, visible: boolean): void {
    this.previewActors.get(this.previewKey(who))!.group.visible = visible;
    this.scene.draw();
  }

  previewMotion(who: ScriptWho, id: number): number {
    const actor = this.previewActors.get(this.previewKey(who))!;
    const fullId = scriptRowId(id);
    const prefix = lanaiAnimationIds(this.maps.session).find((a) => a.id === fullId)?.prefix;
    if (!prefix)
      throw new Error(`アニメ 0x${id.toString(16)} (行 ID 0x${fullId.toString(16)}) は AnimData にありません。`);
    const animations = actor.motion?.model.animations ?? [];
    const name = lanaiAnimationName(animations, prefix);
    if (!name || !actor.motion) {
      const available = [...new Set(animations.map((a) => animationKey(a.name)))].slice(0, 12).join(', ');
      throw new Error(
        `アニメ 0x${id.toString(16)} (${prefix}) に対応するモーションがこのモデルにありません。${available ? `収録: ${available}` : 'モーションなし'}。`,
      );
    }
    actor.motion.select(name);
    actor.started = this.hostWindow.performance.now();
    actor.frames = actor.motion.frames;
    this.runPreviewFrames();
    return actor.frames / 60;
  }

  private runPreviewFrames(): void {
    if (this.previewFrame) return;
    const step = (now: number): void => {
      this.previewFrame = 0;
      // AnimatedModel skins vertices on the CPU. A second 60 Hz loop in the command runner used to do the work twice.
      if (now - this.previewLastFrame >= 50) {
        this.previewLastFrame = now;
        this.previewTick(now);
      }
      if (
        [...this.previewActors.values()].some(
          (a) =>
            a.motion &&
            a.started &&
            now - a.started < Math.min(a.motion.loop ? 3000 : Infinity, (a.frames / 60) * 1000),
        )
      )
        this.previewFrame = this.hostWindow.requestAnimationFrame(step);
    };
    this.previewFrame = this.hostWindow.requestAnimationFrame(step);
  }

  private previewTick(now: number): void {
    for (const actor of this.previewActors.values())
      if (actor.motion && actor.started) {
        const elapsed = now - actor.started;
        const limit = Math.min(actor.motion.loop ? 3000 : Infinity, (actor.frames / 60) * 1000);
        actor.motion.update((Math.min(elapsed, limit) / 1000) * 60);
        if (elapsed >= limit) actor.started = 0;
      }
    this.scene.draw();
  }

  previewFocus(who: ScriptWho): void {
    const p = this.previewPosition(who);
    this.scene.centerOn(p.x / CELL, p.z / CELL);
  }

  clearPreview(): void {
    this.previewRevision++;
    this.hostWindow.cancelAnimationFrame(this.previewFrame);
    this.previewFrame = 0;
    this.previewLastFrame = 0;
    for (const actor of this.previewActors.values()) {
      this.previewGroup.remove(actor.group);
      actor.factory?.dispose();
      if (actor.fallback && actor.group instanceof THREE.Mesh) {
        actor.group.geometry.dispose();
        (actor.group.material as THREE.Material).dispose();
      }
    }
    this.previewActors.clear();
    for (const visuals of this.recordVisuals.values()) for (const visual of visuals) visual.visible = true;
    this.previewSelf = null;
    if (this.previewCamera) {
      this.scene.camera.position.copy(this.previewCamera.position);
      this.scene.controls.target.copy(this.previewCamera.target);
      this.scene.controls.update();
      this.previewCamera = null;
    }
    if (!this.disposed) this.scene.draw();
  }

  private addRecordVisual(section: number, raw: Uint8Array, visual: THREE.Object3D): void {
    this.markers.add(visual);
    if (!(LANAI_EVENT_SECTIONS as readonly number[]).includes(section)) return;
    const row = lanaiRecEventRow(section, raw);
    let visuals = this.recordVisuals.get(row);
    if (!visuals) this.recordVisuals.set(row, (visuals = []));
    visuals.push(visual);
    visual.visible = !this.previewActors.has(`chara:${row}`);
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
    if (layers.tiles) {
      if (this.style2d === 'minimap') drawLanaiMinimap(g, s, doc, st.mapTopology);
      else drawTiles(g, s, doc.tiles, LANAI_ROT_DIR);
    }
    if (layers.room) drawRoomCells(g, s, doc);
    const events = this.maps.eventTable(this.info.dungeon);
    if (this.showLinks)
      for (const link of lanaiMapLinks(this.maps, this.info, doc))
        if (layers.sections[link.from[0]] && layers.sections[link.to[0]]) drawLink(g, s, link);
    for (const k of [...LANAI_POINT_SECTIONS].reverse()) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, LANAI_LAYOUTS[k]!);
        const x = px * s,
          y = py * s;
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        if (k === 8) drawRange(g, s, lanaiRange(r, events), selected);
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
    if (this.showMoves) this.paintMoves(g, s);
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
    return m.type === 'monster'
      ? `m${m.design}`
      : `o${m.row}${m.type === 'object' && m.material ? `/${m.material}` : ''}`;
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
    const material = m.type === 'object' ? m.material : undefined;
    return {
      factory,
      hash: got.hash,
      name: got.set.paths.get(got.hash) ?? '',
      pose: posed(factory, got.hash, material),
    };
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
    this.recordVisuals.clear();
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
          const wall = rangeWalls(lanaiRange(r, events).shape);
          if (wall) {
            const edges = new THREE.EdgesGeometry(wall, 30);
            this.rangeGeos.push(wall, edges);
            const m = selected ? this.rangeMats.selected : this.rangeMats.normal;
            this.addRecordVisual(k, r.raw, new THREE.Mesh(wall, m.fill));
            this.addRecordVisual(k, r.raw, new THREE.LineSegments(edges, m.line));
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
          this.addRecordVisual(k, r.raw, model);
          if (!selected) return;
        }
        const m = new THREE.Mesh(this.markerGeo, this.markerMats.get(SECTION_COLORS[k]!, selected));
        m.position.set(px * CELL, model ? 260 : 100, py * CELL);
        if (selected) m.scale.setScalar(1.4);
        this.addRecordVisual(k, r.raw, m);
      });
    }
    this.overlay.sync(doc, sel, layers.room);
    this.syncMoves();
    this.scene.draw();
  }

  // ---- move() of the script

  /** The stage's script functions that run on this map, with their move() statements (the applied text). */
  scriptMoves(): MapScriptMoves[] {
    const doc = this.st.current;
    const script = this.maps.session.stageScripts.get(this.maps.content.archive.toUpperCase())?.doc;
    if (!doc || doc.hash !== this.info.hash || !script) return [];
    return mapScriptMoves(script, this.info.dungeon, new Set(this.eventCells().keys()));
  }

  /** Where the records of each event row of this map stand (cells; the first record of a row). */
  private eventCells(): Map<number, [number, number]> {
    const out = new Map<number, [number, number]>();
    const doc = this.st.current;
    if (!doc) return out;
    for (const section of LANAI_EVENT_SECTIONS)
      for (const r of doc.recs[section] ?? []) {
        // the ranges of kind 100 and up are not events (stageScript.ts eventRecords)
        if (section === 8 && new DataView(r.raw.buffer, r.raw.byteOffset).getUint32(0, true) >= 100) continue;
        const row = lanaiRecEventRow(section, r.raw);
        if (!out.has(row)) out.set(row, recCellPos(r, LANAI_LAYOUTS[section]!));
      }
    return out;
  }

  /** The move() points on this map (the one being dragged where it is now); each starts where its mover stood. */
  movePoints(): LanaiMovePoint[] {
    const cells = this.eventCells();
    const d = this.moveDrag;
    const out: LanaiMovePoint[] = [];
    for (const f of this.scriptMoves()) {
      const last = new Map<string, [number, number]>();
      f.moves.forEach((m0, k) => {
        const move = d && d.fn === f.fn && d.k === k ? { ...m0, x: d.x, z: d.z } : m0;
        const who = moveWhoText(move.who);
        const start =
          move.who.kind === 'chara'
            ? cells.get(move.who.row)
            : move.who.kind === 'self' && f.rows.length
              ? cells.get(f.rows[0]!)
              : undefined;
        const at: [number, number] = [worldToCell(move.x), worldToCell(move.z)];
        out.push({ fn: f.fn, k, move, from: last.get(who) ?? start ?? null, label: `${f.fn} #${k + 1} ${who}` });
        last.set(who, at);
      });
    }
    return out;
  }

  /** The move() point nearest to a cell position within `tol` cells (null: none, or the layer is hidden). */
  private moveAt(cx: number, cy: number, tol: number): LanaiMovePoint | null {
    if (!this.showMoves) return null;
    let best: LanaiMovePoint | null = null,
      bestD = tol;
    for (const p of this.movePoints()) {
      const dist = Math.hypot(worldToCell(p.move.x) - cx, worldToCell(p.move.z) - cy);
      if (dist <= bestD) [best, bestD] = [p, dist];
    }
    return best;
  }

  /** Write a move()'s position into its function's text. */
  setMove(ref: LanaiMoveRef, x: number, y: number, z: number): void {
    const session = this.maps.session;
    const archive = this.maps.content.archive.toUpperCase();
    const script = session.stageScripts.get(archive)?.doc;
    const f = script?.functions.find((g) => g.name === ref.fn);
    if (!script || !f) return;
    const body = withScriptMove(f.body, ref.k, x, y, z);
    if (body === f.body) return;
    try {
      session.setStageScriptDoc(archive, {
        ...script,
        functions: script.functions.map((g) => (g === f ? { ...g, body } : g)),
      });
      session.edited();
    } catch (e) {
      this.errorMsg = (e as Error).message;
      this.signal.emit();
    }
  }

  private endMoveDrag(): void {
    const d = this.moveDrag!;
    this.moveDrag = null;
    const p = this.movePoints().find((m) => m.fn === d.fn && m.k === d.k);
    // the height (y) stays as it is written
    if (p && (p.move.x !== d.x || p.move.z !== d.z)) this.setMove(d, d.x, p.move.y, d.z);
    this.drawMoves();
  }

  /** Redraw the move() points in both views. */
  drawMoves(): void {
    this.grid.draw();
    this.syncMoves();
    this.scene.draw();
  }

  private paintMoves(g: CanvasRenderingContext2D, s: number): void {
    const points = this.movePoints();
    if (!points.length) return;
    const a = this.activeMove;
    g.save();
    g.strokeStyle = MOVE_COLOR;
    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    for (const p of points) {
      if (!p.from) continue;
      g.beginPath();
      g.moveTo(p.from[0] * s, p.from[1] * s);
      g.lineTo(worldToCell(p.move.x) * s, worldToCell(p.move.z) * s);
      g.stroke();
    }
    g.setLineDash([]);
    g.font = '11px sans-serif';
    for (const p of points) {
      const [x, y] = [worldToCell(p.move.x) * s, worldToCell(p.move.z) * s];
      const active = !!a && a.fn === p.fn && a.k === p.k;
      const rad = Math.max(6, s * 0.2);
      g.fillStyle = active ? '#fff1d6' : MOVE_COLOR;
      g.strokeStyle = active ? '#fff' : 'rgba(0,0,0,0.75)';
      g.lineWidth = active ? 2.5 : 1.2;
      g.beginPath();
      g.moveTo(x, y - rad);
      g.lineTo(x + rad, y);
      g.lineTo(x, y + rad);
      g.lineTo(x - rad, y);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#000';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(p.k + 1), x, y + 0.5);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.fillStyle = active ? '#fff' : '#ffe0b3';
      g.fillText(active ? `${p.label} (${p.move.x}, ${p.move.y}, ${p.move.z})` : p.label, x + rad + 3, y - rad);
    }
    g.restore();
  }

  private clearMoveGroup(): void {
    for (const o of this.moveGroup.children) if (o instanceof THREE.Line) o.geometry.dispose();
    this.moveGroup.clear();
  }

  private syncMoves(): void {
    this.clearMoveGroup();
    if (!this.showMoves) return;
    const a = this.activeMove;
    for (const p of this.movePoints()) {
      const active = !!a && a.fn === p.fn && a.k === p.k;
      const m = new THREE.Mesh(this.moveGeo, active ? this.moveMatActive : this.moveMat);
      m.position.set(p.move.x, p.move.y, p.move.z);
      if (active) m.scale.setScalar(1.3);
      this.moveGroup.add(m);
      if (!p.from) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(cellToWorld(p.from[0]), 30, cellToWorld(p.from[1])),
          new THREE.Vector3(p.move.x, p.move.y + 30, p.move.z),
        ]),
        this.moveLineMat,
      );
      line.computeLineDistances();
      this.moveGroup.add(line);
    }
  }
}

/**
 * The tiles as the game's minimap shows them (kahara's "ミニマップ風", editor/minimap.ts): rooms, corridors, walls and
 * entrances from the openings of the tiles (the automatic brush's profile). Maps the profile does not cover (indoor
 * tiles) are drawn as one floor with walls where no tile is next to it.
 */
function drawLanaiMinimap(g: CanvasRenderingContext2D, s: number, doc: MapDoc, profile: AutoProfile | undefined): void {
  if (profile) {
    // tiles the profile has no part for are still floor: drawn plain, under the rest
    g.fillStyle = '#345f9e';
    for (const t of doc.tiles)
      if (t.kind !== LANAI_EMPTY_KIND && !partOf(t, profile)) g.fillRect(t.x * s, t.y * s, s, s);
    drawTerrainMinimap(g, s, doc.tiles, profile);
    return;
  }
  const floor = doc.tiles.filter((t) => t.kind !== LANAI_EMPTY_KIND);
  const has = new Set(floor.map((t) => `${t.x},${t.y}`));
  g.fillStyle = '#3f7fd9';
  for (const t of floor) g.fillRect(t.x * s, t.y * s, s, s);
  g.strokeStyle = '#cfe3ff';
  g.lineWidth = Math.max(1, Math.min(2, s * 0.06));
  g.beginPath();
  for (const t of floor)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (has.has(`${t.x + dx},${t.y + dy}`)) continue;
      const x0 = (t.x + (dx > 0 ? 1 : 0)) * s,
        y0 = (t.y + (dy > 0 ? 1 : 0)) * s;
      g.moveTo(x0, y0);
      g.lineTo(x0 + (dy ? s : 0), y0 + (dx ? s : 0));
    }
  g.stroke();
}

const LINK_STYLE = {
  button: { stroke: '#48cdd3', text: '#bdf3f6', dash: [5, 4], label: 'このボタンで開く' },
  warp: { stroke: '#e58cff', text: '#f3d2ff', dash: [], label: '' },
} as const;

/**
 * A connection of two records (mapLinks.ts): a dashed line from a button to its door, a line between two warps that
 * lead to each other, an arrow from a warp to a destination that does not lead back.
 */
function drawLink(g: CanvasRenderingContext2D, s: number, link: LanaiMapLink): void {
  const style = LINK_STYLE[link.type];
  const [ax, ay] = [link.a[0] * s, link.a[1] * s],
    [bx, by] = [link.b[0] * s, link.b[1] * s];
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;
  const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
  g.save();
  g.strokeStyle = style.stroke;
  g.fillStyle = style.stroke;
  g.lineWidth = 2;
  g.setLineDash(style.dash);
  // an arrow stops at the edge of the destination's mark
  const arrow = link.type === 'warp' && link.oneWay;
  const head = Math.max(7, Math.min(14, s * 0.3)),
    gap = arrow ? Math.min(len / 2, Math.max(3, s * 0.26)) : 0;
  const [ex, ey] = [bx - ux * gap, by - uy * gap];
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(arrow ? ex - ux * head * 0.8 : ex, arrow ? ey - uy * head * 0.8 : ey);
  g.stroke();
  if (arrow) {
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(ex - ux * head - uy * head * 0.5, ey - uy * head + ux * head * 0.5);
    g.lineTo(ex - ux * head + uy * head * 0.5, ey - uy * head - ux * head * 0.5);
    g.closePath();
    g.fill();
  }
  if (style.label) {
    g.font = '11px sans-serif';
    g.fillStyle = style.text;
    g.fillText(style.label, (ax + bx) / 2 + 4, (ay + by) / 2 - 4);
  }
  g.restore();
}

/** A range's hit shape (rangeShape.ts): filled lightly, dashed when walking does not hit it, brighter when selected. */
function drawRange(g: CanvasRenderingContext2D, s: number, range: LanaiRange, selected: boolean): void {
  const shape = range.shape;
  if (!shape) return;
  g.save();
  g.strokeStyle = SECTION_COLORS[8]!;
  g.fillStyle = SECTION_COLORS[8]!;
  g.lineWidth = selected ? 2 : 1.25;
  g.setLineDash(range.pressToStart ? [4, 3] : []);
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
