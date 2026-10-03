// The 3D scene of a map, shared by RPG2's map editor (view3d.ts) and RPG3's map page: renderer, lights, the grid on
// the ground, an orbit camera (right drag turns, middle drag pans), picking cells on the ground plane, fitting the
// camera to a map's tiles, and the tile layer (one object per cell, rebuilt when the cell's signature changes).
// Cells are CELL (500) units wide; cell (x, y) is centred on ((x + 0.5) * CELL, 0, (y + 0.5) * CELL).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CELL } from '../game/sections';
import type { GridPointer } from './gridcanvas';

export class MapScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 50, 100000);
  readonly controls: OrbitControls;
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();
  private raf = 0;
  private pointerDown = false;
  pointer: GridPointer | null = null;

  constructor(className: string, grid = 30) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = className;
    this.scene.background = new THREE.Color(0x15171c);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.4, 1, 0.3);
    this.scene.add(sun);
    const g = new THREE.GridHelper(grid * CELL, grid, 0x3a4050, 0x2a2f3a);
    g.position.set((grid * CELL) / 2, -2, (grid * CELL) / 2);
    this.scene.add(g);

    this.camera.position.set(8000, 9000, 16000);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('change', () => this.draw());

    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = this.pick(e);
      if (!p) return;
      this.pointerDown = true;
      c.setPointerCapture(e.pointerId);
      this.pointer?.down(p[0], p[1], e);
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pick(e);
      if (p) this.pointer?.move(p[0], p[1], e);
    });
    c.addEventListener('pointerup', (e) => {
      if (this.pointerDown) this.pointer?.up(e);
      this.pointerDown = false;
    });
    c.addEventListener('pointerleave', () => this.pointer?.leave());
    new ResizeObserver(() => this.resize()).observe(c);
  }

  /** Pointer -> cell coordinates on the ground plane (y = 0). */
  pick(e: { clientX: number; clientY: number }): [number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return null;
    return [hit.x / CELL, hit.z / CELL];
  }

  private resize(): void {
    const c = this.canvas;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  /** Look at a map's tiles from above and in front. */
  fitCells(cells: readonly { x: number; y: number }[]): void {
    if (!cells.length) return;
    const xs = cells.map((t) => t.x), ys = cells.map((t) => t.y);
    const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * CELL;
    const cz = ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * CELL;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 2;
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx, span * CELL * 1.05, cz + span * CELL * 0.75);
    this.controls.update();
    this.draw();
  }

  /** Top-down camera. */
  topView(): void {
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t);
    this.camera.position.set(t.x, t.y + d, t.z + 1);
    this.controls.update();
  }

  draw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
  }
}

/** A tile wanted in a cell: its signature (rebuilt when it changes) and how to build it. */
export interface TileWant {
  x: number;
  y: number;
  sig: string;
  make(): THREE.Object3D;
}

/** One object per cell, kept while the cell's signature stays the same. */
export class TileLayer {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, { sig: string; obj: THREE.Object3D }>();

  sync(want: Iterable<TileWant>): void {
    const next = new Map<string, TileWant>();
    for (const w of want) next.set(`${w.x},${w.y}`, w);
    for (const [key, cur] of this.tiles) {
      const w = next.get(key);
      if (!w || w.sig !== cur.sig) {
        this.group.remove(cur.obj);
        this.tiles.delete(key);
      }
    }
    for (const [key, w] of next) {
      if (this.tiles.has(key)) continue;
      const obj = w.make();
      obj.position.set((w.x + 0.5) * CELL, 0, (w.y + 0.5) * CELL);
      this.group.add(obj);
      this.tiles.set(key, { sig: w.sig, obj });
    }
  }

  /** Drop every tile (the models changed). */
  clear(): void {
    for (const t of this.tiles.values()) this.group.remove(t.obj);
    this.tiles.clear();
  }
}

/** A flat slab coloured by kind with an arrow for the orientation (a tile without a model). */
export class TileFallback {
  private readonly mats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly geo = new THREE.BoxGeometry(CELL * 0.96, 20, CELL * 0.96);
  private readonly arrowGeo = new THREE.ConeGeometry(60, 140, 3);

  make(color: string, rot: number): THREE.Object3D {
    const g = new THREE.Group();
    let mat = this.mats.get(color);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
      this.mats.set(color, mat);
    }
    g.add(new THREE.Mesh(this.geo, mat));
    const arrow = new THREE.Mesh(this.arrowGeo, mat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 20, -120);
    g.add(arrow);
    g.rotation.y = (-rot * Math.PI) / 2;
    return g;
  }
}
