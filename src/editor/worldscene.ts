// The 3D preview of a world map (RPG2's W01 / W02 and RPG3's W01): the terrain parts of the cells around the camera (the
// world is 300 x 300 cells, too many to draw at once), the sea under them and the marks (entrances, props …) the owner
// lists. World cells are 100 units wide, the scene's CELL (500): models are scaled by 5. Parts that cover 2 x 2 cells
// (worldmapParts flag 0x10) are centred on their block, 2-cell parts (0x20) on their pair (by the rotation).
import * as THREE from 'three';
import { CELL } from '../game/sections';
import { MapScene, MarkerMaterials, TileLayer } from './mapscene';

/** World units -> the scene's units. */
export const WORLD_SCALE = CELL / 100;
/** worldmapParts +4 flags (both games). */
export const PART_2X2 = 0x10;
export const PART_2 = 0x20;

export interface WorldTerrain {
  /** Cells per side (the world wraps around). */
  size: number;
  /** Part and rotation at cell index y * size + x (0 = none). */
  part(i: number): number;
  rot(i: number): number;
  flags(part: number): number;
  /** Whether a part's model is there to draw (else a slab of `color` is drawn). */
  hasModel(part: number): boolean;
  /** A new instance of a part's model in world units (null: none). */
  model(part: number): THREE.Object3D | null;
  color(part: number): string;
}

/** Something drawn on the world: a model (world units) or a marker ball. */
export interface WorldMark {
  /** Cells (fractional; the centre of cell x is x + 0.5). */
  x: number;
  y: number;
  angle?: number;
  /** Scale of the model (on top of WORLD_SCALE). */
  scale?: number;
  /** A new instance of the model (world units), called for the marks near the camera; null = a marker ball. */
  make?: () => THREE.Object3D | null;
  color: string;
  selected: boolean;
}

export class WorldScene {
  readonly scene: MapScene;
  /** Cells drawn on each side of the camera's target. */
  window = 22;
  terrain: WorldTerrain | null = null;
  /** The sea model (world units) and how many cells it is wide; null = a flat blue plane. */
  seaModel: (() => THREE.Object3D | null) | null = null;
  seaCells = 25;
  /** How dark the sea is at cell index y * size + x (0 = as it is .. 1 = darkest; RPG3's dark sea). */
  seaShade: ((i: number) => number) | null = null;
  private readonly shadeGeo = new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2);
  private readonly shadeMats = new Map<number, THREE.MeshBasicMaterial>();
  /** The marks to draw (called on each sync; only those near the camera are added). */
  marks: () => WorldMark[] = () => [];
  private readonly tiles = new TileLayer();
  private readonly sea = new THREE.Group();
  private readonly marksGroup = new THREE.Group();
  private readonly markerGeo = new THREE.SphereGeometry(CELL * 0.14, 14, 10);
  private readonly markerMats = new MarkerMaterials();
  private readonly slabGeo = new THREE.BoxGeometry(CELL * 0.96, 20, CELL * 0.96);
  private readonly slabMats = new Map<string, THREE.MeshBasicMaterial>();
  private readonly seaMat = new THREE.MeshBasicMaterial({ color: 0x2b5d9c });
  private seaGeo: THREE.PlaneGeometry | null = null;
  private center: [number, number] = [-1e9, -1e9];
  private disposed = false;

  constructor(className: string, readonly size = 300) {
    this.scene = new MapScene(className, size);
    this.scene.camera.far = 60000;
    this.scene.camera.updateProjectionMatrix();
    this.scene.scene.add(this.sea, this.tiles.group, this.marksGroup);
    // the grid on the ground would show through the sea
    for (const o of this.scene.scene.children) if (o instanceof THREE.GridHelper) o.visible = false;
    this.scene.controls.addEventListener('change', () => this.follow());
  }

  dispose(): void {
    this.disposed = true;
    this.scene.dispose();
  }

  /** Drop the terrain's objects (the models were loaded or changed). */
  clear(): void {
    this.tiles.clear();
    this.sync(true);
  }

  /** Look at cell (x, y), keeping the camera's angle (or from above and in front the first time). */
  focus(x: number, y: number): void {
    const t = this.scene.controls.target;
    const d = this.scene.camera.position.clone().sub(t);
    t.set(x * CELL, 0, y * CELL);
    if (d.length() < CELL * 4 || d.length() > CELL * 60) d.set(0, CELL * 14, CELL * 12);
    this.scene.camera.position.copy(t).add(d);
    this.scene.controls.update();
    this.sync(true);
  }

  /** Re-draw the window when the camera moved far enough. */
  private follow(): void {
    const t = this.scene.controls.target;
    const cx = Math.round(t.x / CELL), cy = Math.round(t.z / CELL);
    if (Math.abs(cx - this.center[0]) >= 4 || Math.abs(cy - this.center[1]) >= 4) this.sync(false);
  }

  private slab(color: string): THREE.Object3D {
    let m = this.slabMats.get(color);
    if (!m) this.slabMats.set(color, (m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color.slice(0, 7)) })));
    return new THREE.Mesh(this.slabGeo, m);
  }

  /** Rebuild what is around the camera (`force`: also when the camera did not move, after an edit). */
  sync(force = true): void {
    if (this.disposed) return;
    const t = this.scene.controls.target;
    const cx = Math.round(t.x / CELL), cy = Math.round(t.z / CELL);
    if (!force && cx === this.center[0] && cy === this.center[1]) return;
    this.center = [cx, cy];
    const T = this.terrain, N = this.size, W = this.window;
    const wants: { x: number; y: number; sig: string; make: () => THREE.Object3D }[] = [];
    if (T)
      for (let y = cy - W; y <= cy + W; y++)
        for (let x = cx - W; x <= cx + W; x++) {
          const i = (((y % N) + N) % N) * N + (((x % N) + N) % N);
          const part = T.part(i), rot = T.rot(i);
          if (!part) continue;
          const has = T.hasModel(part);
          wants.push({
            x, y, sig: `${part}/${rot}/${has ? 1 : 0}`,
            make: () => {
              const outer = new THREE.Group();
              const m = has ? T.model(part) : null;
              const inner = m ?? this.slab(T.color(part));
              if (m) inner.scale.setScalar(WORLD_SCALE);
              inner.rotation.y = (-rot * Math.PI) / 2;
              const f = T.flags(part);
              if (f & PART_2X2) inner.position.set(CELL / 2, 0, CELL / 2);
              else if (f & PART_2) inner.position.set(rot & 1 ? 0 : CELL / 2, 0, rot & 1 ? CELL / 2 : 0);
              outer.add(inner);
              return outer;
            },
          });
        }
    this.tiles.sync(wants);
    // the sea under the window
    this.sea.clear();
    const S = this.seaCells;
    for (let gy = Math.floor((cy - W) / S); gy <= Math.floor((cy + W) / S); gy++)
      for (let gx = Math.floor((cx - W) / S); gx <= Math.floor((cx + W) / S); gx++) {
        const m = this.seaModel?.() ?? null;
        let o: THREE.Object3D;
        if (m) {
          m.scale.setScalar(WORLD_SCALE);
          o = m;
        } else {
          this.seaGeo ??= new THREE.PlaneGeometry(S * CELL, S * CELL).rotateX(-Math.PI / 2);
          o = new THREE.Mesh(this.seaGeo, this.seaMat);
          o.position.y = -100;
        }
        o.position.x = (gx + 0.5) * S * CELL;
        o.position.z = (gy + 0.5) * S * CELL;
        this.sea.add(o);
      }
    // the dark sea: a see-through black square over each dark cell, just above the sea
    if (this.seaShade)
      for (let y = cy - W; y <= cy + W; y++)
        for (let x = cx - W; x <= cx + W; x++) {
          const v = Math.round(this.seaShade((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 3);
          if (!v) continue;
          let mat = this.shadeMats.get(v);
          if (!mat) this.shadeMats.set(v, (mat = new THREE.MeshBasicMaterial({ color: 0x00000c, transparent: true, opacity: 0.22 * v, depthWrite: false })));
          const m = new THREE.Mesh(this.shadeGeo, mat);
          m.position.set((x + 0.5) * CELL, -100 * WORLD_SCALE + 10, (y + 0.5) * CELL);
          this.sea.add(m);
        }
    // the marks near the camera
    this.marksGroup.clear();
    for (const k of this.marks()) {
      if (Math.abs(k.x - cx) > W + 2 || Math.abs(k.y - cy) > W + 2) continue;
      const model = k.make?.() ?? null;
      if (model) {
        model.position.set(k.x * CELL, 0, k.y * CELL);
        model.rotation.y = k.angle ?? 0;
        model.scale.setScalar(WORLD_SCALE * (k.scale ?? 1));
        this.marksGroup.add(model);
      }
      if (!model || k.selected) {
        const m = new THREE.Mesh(this.markerGeo, this.markerMats.get(k.color.slice(0, 7), k.selected));
        m.position.set(k.x * CELL, model ? CELL * 2.2 : CELL * 0.3, k.y * CELL);
        if (k.selected) m.scale.setScalar(1.5);
        this.marksGroup.add(m);
      }
    }
    this.scene.draw();
  }
}
