// The views of a 初代 map: the top-down grid and the 3D scene shared with the other map pages (editor/gridcanvas.ts,
// editor/mapscene.ts), driven by the editor's Controller (hover, picking a tile or a record) on a view-only edit state,
// so the shared panes (layers, status bar) work as on RPG3's and RPG FREE!'s pages. The 2D view draws the tiles as
// glyphs with their kind and the records as marks facing their way. The 3D view draws the tiles' models (kind → part
// → mapParts row and variant → the floor's tileset; naauao honolulu/map.md §3.3), the props' models (mapObject rows,
// §3.2) and markers for the floor's exits, chests, people and groups. A floor with a designed room (designedMap) gets
// the room's model too: the game draws it instead of the tiles.
import * as THREE from 'three';
import { loadObjectModels, loadTileset, objKey } from '../cgfx/loader';
import { ModelFactory } from '../cgfx/three';
import { lowerPriorityFirst, type TilesetModels } from '../cgfx/tileset';
import { Controller } from '../editor/controller';
import { drawHover, drawSelection } from '../editor/draw2d';
import { drawTileGlyph, GridCanvas } from '../editor/gridcanvas';
import { SECTION_COLORS } from '../editor/legend';
import type { MapPageView } from '../editor/mappage';
import { CellOverlay, MapScene, MarkerMaterials, TileFallback, TileLayer } from '../editor/mapscene';
import { MapEditState, type EditEvent } from '../editor/model';
import { CELL, recCellPos, type MapDoc, type Rec } from '../game/sections';
import type { Dump } from '../rom/dump';
import { hex8, u32 } from '../util/bytes';
import { Signal } from '../ui/useEditorState';
import {
  HONOLULU_CHEST2_SECTION, HONOLULU_CHEST_SECTION, HONOLULU_DESIGNED_ROOMS, HONOLULU_EXIT_SECTION, HONOLULU_GRID, HONOLULU_LAYOUTS, HONOLULU_OBJECT_SECTION, HONOLULU_POINT_SECTIONS, HONOLULU_ROT_CODEC,
  HONOLULU_TILE_TEXTURES, type HonoluluFloor, type HonoluluMaps, type HonoluluTileSource,
} from './maps';

/** The open map (read only: the page does not edit 初代's maps yet). */
export class HonoluluMapState extends MapEditState<never, null> {
  override readonly readOnly = true;
  readonly layouts = HONOLULU_LAYOUTS;
  readonly pointSections = HONOLULU_POINT_SECTIONS;

  /** Shows `doc` (a map with what one of its floors places). */
  show(doc: MapDoc): void {
    this.docs.set(doc.hash, doc);
    this.current = doc;
    this.selection = { type: 'none' };
    this.emit('map');
  }

  protected saveTables(): null {
    return null;
  }
  protected restoreTables(): void {}
  placeStamp(): [number, number] {
    throw new Error('初代のマップは表示だけです');
  }
  duplicateRecord(): Rec {
    throw new Error('初代のマップは表示だけです');
  }
}

/** A colour per tile kind (their roles are not known: neighbouring kinds get far hues). */
export const honoluluKindColor = (k: number): string => `hsl(${(k * 47) % 360} 40% 62%)`;

/** The turn a record faces (+0x08 of the props; the others have none). */
export function recFacing(section: number, rec: Rec): number {
  return section === HONOLULU_OBJECT_SECTION ? Math.max(0, HONOLULU_ROT_CODEC.decode(rec.raw[8]!)) : -1;
}

/**
 * The Y turn of a prop facing N / E / S / W (turns 0..3): FUN_001983E8 turns the model by π, π/2, 0 and −π/2 (a model
 * faces south unturned).
 */
export const PROP_ANGLES = [Math.PI, Math.PI / 2, 0, -Math.PI / 2] as const;

/** A tile's Y turn in the scene from mapParts +0x110 (degrees). */
export const partTurn = (degrees: number): number => (degrees * Math.PI) / 180;

/** The caches' scope of 初代's archives (some have the names of RPG2's). */
const SCOPE = 'honolulu';

/** A model read for the view, with its factory. */
interface LoadedModel {
  factory: ModelFactory;
  hash: number;
}

export class HonoluluMapView implements MapPageView {
  readonly grid: GridCanvas;
  readonly scene: MapScene;
  readonly ctl: Controller;
  readonly signal = new Signal();
  readonly hover = new Signal();
  status = '';
  errorMsg = '';
  /** Draw the props' and the designed room's models (else markers only). */
  showModels = true;
  /** Where the shown floor's tile models come from (null until a floor is shown). */
  source: HonoluluTileSource | null = null;
  /** The tile models of the source's tileset (null while loading or when they could not be read). */
  private factory: ModelFactory | null = null;
  private loadedFor = '';
  private readonly tileLayer = new TileLayer();
  private readonly fallback = new TileFallback();
  private readonly markers = new THREE.Group();
  private readonly room = new THREE.Group();
  private readonly overlay = new CellOverlay();
  /** Props' and rooms' models by "archive/entry"; null while loading or when there is none. */
  private readonly objects = new Map<string, LoadedModel | null>();
  private readonly markerGeo = new THREE.SphereGeometry(60, 16, 12);
  private readonly markerMats = new MarkerMaterials();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(
    readonly st: HonoluluMapState,
    private readonly dump: Dump,
    private readonly maps: HonoluluMaps,
  ) {
    this.ctl = new Controller(st);
    this.grid = new GridCanvas('view2d', (g, s) => this.paint(g, s), HONOLULU_GRID);
    this.scene = new MapScene('view3d', HONOLULU_GRID);
    this.scene.scene.add(this.tileLayer.group, this.room, this.markers, this.overlay.group);
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
      this.hover.emit();
    };
    this.unsubscribe = st.on((what) => this.changed(what));
  }

  get doc(): MapDoc {
    return this.st.current!;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.factory?.dispose();
    for (const o of this.objects.values()) o?.factory.dispose();
    this.scene.dispose();
  }

  /** Shows a floor of the map (its tileset, its designed room); the state shows the floor's doc. */
  showFloor(floor: HonoluluFloor | null): void {
    this.source = this.maps.tileSource(floor);
    const key = `${this.source.modelArchive}/${this.source.textureEntry}`;
    if (key !== this.loadedFor) {
      this.loadedFor = key;
      void this.loadTiles(this.source, key);
    }
    this.refresh();
  }

  fit(): void {
    this.grid.fitCells(this.doc.tiles);
    this.scene.fitCells(this.doc.tiles);
  }

  refresh(): void {
    this.grid.draw();
    this.sync3d();
    this.signal.emit();
  }

  private changed(what: EditEvent): void {
    if (what === 'selection' || what === 'map' || what === 'doc') this.sync3d();
    this.grid.draw();
  }

  /** The model of a tile kind in the shown tileset (0 = none). */
  tileModel(kind: number): number {
    return this.source ? this.maps.partModel(kind, this.source.tileset) : 0;
  }

  /** The file name of a loaded tile model ("room_28"), '' while loading or when there is none. */
  tileModelName(kind: number): string {
    const h = this.tileModel(kind);
    return (h && this.factory?.set.paths.get(h)) || '';
  }

  private async loadTiles(src: HonoluluTileSource, key: string): Promise<void> {
    this.factory?.dispose();
    this.factory = null;
    this.tileLayer.clear();
    if (!src.modelArchive) {
      this.status = 'このタイルセットのモデルのアーカイブが分かりません (記号で表示します)';
      this.signal.emit();
      return;
    }
    this.status = 'タイルのモデルを読み込み中…';
    this.signal.emit();
    try {
      const set = await loadTileset({ dump: this.dump }, { modelArchive: src.modelArchive, textureArchive: HONOLULU_TILE_TEXTURES, textureEntry: src.textureEntry }, SCOPE);
      if (this.disposed || key !== this.loadedFor) return;
      // 初代 draws the lower render priority first (as for the monsters)
      this.factory = new ModelFactory(lowerPriorityFirst(set));
      this.tileLayer.clear();
      this.status = set.errors.length ? `モデルの一部を読めませんでした: ${set.errors.slice(0, 3).join(' / ')}` : '';
    } catch (err) {
      this.status = `モデルを読み込めませんでした (記号で表示します): ${(err as Error).message}`;
    }
    this.refresh();
  }

  /**
   * An instance of an object file's model (a prop, a room); starts loading it the first time (redrawn when it is there).
   * `textures` (by name) fill in the ones the file does not hold: a designed room uses its tileset's (469B3DC6).
   */
  private objectModel(archive: number, entry: number, textures?: { key: string; byName: TilesetModels['textures'] }): THREE.Object3D | null {
    const key = `${hex8(archive)}/${hex8(entry)}${textures ? `/${textures.key}` : ''}`;
    if (!this.objects.has(key)) {
      this.objects.set(key, null);
      void loadObjectModels({ dump: this.dump }, [{ archive, entry }], SCOPE).then((sets) => {
        const set = sets.get(objKey(archive, entry, SCOPE));
        if (this.disposed || !set?.models.size) return;
        const full = textures ? { ...set, textures: new Map([...textures.byName, ...set.textures]) } : set;
        this.objects.set(key, { factory: new ModelFactory(lowerPriorityFirst(full)), hash: entry });
        this.sync3d();
        this.signal.emit();
      }, () => {});
      return null;
    }
    const o = this.objects.get(key);
    return o ? o.factory.instance(o.hash) : null;
  }

  // ---- 2D

  private paint(g: CanvasRenderingContext2D, s: number): void {
    const doc = this.st.current;
    if (!doc) return;
    const layers = this.ctl.layers, sel = this.st.selection;
    if (layers.tiles) for (const t of doc.tiles) drawTileGlyph(g, s, t.x, t.y, honoluluKindColor(t.kind), -1, String(t.kind));
    for (const k of [...HONOLULU_POINT_SECTIONS].reverse()) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, HONOLULU_LAYOUTS[k]!);
        const x = px * s, y = py * s;
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        const rad = Math.max(3, s * (k === HONOLULU_OBJECT_SECTION ? 0.3 : 0.2));
        g.fillStyle = SECTION_COLORS[k]!;
        g.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.7)';
        g.lineWidth = selected ? 2.5 : 1;
        g.beginPath();
        const dir = recFacing(k, r);
        if (dir >= 0) {
          // a triangle pointing the way the prop faces (0 = up)
          const a = (dir * Math.PI) / 2;
          for (const [dx, dy] of [[0, -1], [0.8, 0.7], [-0.8, 0.7]] as const) {
            const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
            g.lineTo(x + rx * rad, y + ry * rad);
          }
          g.closePath();
        } else if (k === HONOLULU_CHEST_SECTION || k === HONOLULU_CHEST2_SECTION) g.rect(x - rad, y - rad, rad * 2, rad * 2);
        else if (k === HONOLULU_EXIT_SECTION) {
          g.moveTo(x, y - rad);
          g.lineTo(x + rad, y);
          g.lineTo(x, y + rad);
          g.lineTo(x - rad, y);
          g.closePath();
        } else g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
    }
    drawSelection(g, s, this.st);
    drawHover(g, s, this.st, this.ctl.hover);
  }

  // ---- 3D

  private sync3d(): void {
    const doc = this.st.current;
    if (!doc || this.disposed) return;
    const f = this.factory, layers = this.ctl.layers;
    const ts = this.source?.tileset ?? -1;
    this.room.clear();
    const src = this.source;
    if (this.showModels && layers.tiles && src?.designedModel && f) {
      // the rooms hold only their own textures; the ground and walls are the tileset's (else drawn untextured)
      const m = this.objectModel(parseInt(HONOLULU_DESIGNED_ROOMS, 16), src.designedModel, { key: this.loadedFor, byName: f.set.textures });
      if (m && doc.tiles.length) {
        // the room is centred on the middle of the map's tiles (estimated: so its walls meet the tiles')
        const xs = doc.tiles.map((t) => t.x), ys = doc.tiles.map((t) => t.y);
        m.position.set(((Math.min(...xs) + Math.max(...xs) + 1) / 2) * CELL, 0, ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * CELL);
        this.room.add(m);
      }
    }
    // the game draws a designed room instead of the tiles
    this.tileLayer.sync(
      (layers.tiles && !this.room.children.length ? doc.tiles : []).map((t) => ({
        x: t.x,
        y: t.y,
        sig: `${t.kind}/${ts}/${f ? 1 : 0}`,
        make: () => {
          const h = f ? this.tileModel(t.kind) : 0;
          const m = h ? f!.instance(h) : null;
          if (!m) return this.fallback.make(honoluluKindColor(t.kind), 0);
          m.rotation.y = partTurn(this.maps.partAngle(t.kind));
          return m;
        },
      })),
    );
    this.markers.clear();
    const sel = this.st.selection;
    for (const k of HONOLULU_POINT_SECTIONS) {
      if (!layers.sections[k]) continue;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, HONOLULU_LAYOUTS[k]!);
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        let model: THREE.Object3D | null = null;
        if (k === HONOLULU_OBJECT_SECTION && this.showModels) {
          const ref = this.maps.objectModel(u32(r.raw, 0));
          model = ref && this.objectModel(ref.archive, ref.entry);
          if (model) {
            model.position.set(px * CELL, 0, py * CELL);
            model.rotation.y = PROP_ANGLES[recFacing(k, r)]!;
            model.scale.setScalar(ref!.scale);
            this.markers.add(model);
          }
        }
        if (model && !selected) return;
        const m = new THREE.Mesh(this.markerGeo, this.markerMats.get(SECTION_COLORS[k]!, selected));
        m.position.set(px * CELL, model ? 260 : 100, py * CELL);
        if (selected) m.scale.setScalar(1.4);
        this.markers.add(m);
      });
    }
    this.overlay.sync(doc, sel, false);
    this.scene.draw();
  }
}
