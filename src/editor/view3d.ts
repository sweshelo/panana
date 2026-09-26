// 3D view: tile models placed like the game (cell centre ((x + 0.5) * 500, 0, (y + 0.5) * 500), rotation =
// -rot * 90° about Y; docs/map-editor-design.md §6), markers for points, editing on the ground plane.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CELL, LAYOUTS, P3, POINT_SECTIONS, letterIndex, recCellPos, type MapDoc } from '../game/sections';
import { ModelFactory } from '../cgfx/three';
import { loadObjectModels, objKey } from '../cgfx/loader';
import { OBJ_INVISIBLE, recordObjectRow, recordPlacement, type ObjectContext } from '../game/objects';
import { norm, type Controller } from './controller';
import { kindColor, SECTION_COLORS } from './legend';
import { GRID, tileAt, type EditorState } from './state';

const MARKER_Y = 40;

export class View3D {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 50, 100000);
  private readonly controls: OrbitControls;
  private readonly tileGroup = new THREE.Group();
  private readonly markerGroup = new THREE.Group();
  private readonly overlay = new THREE.Group();
  private readonly tiles = new Map<string, { sig: string; obj: THREE.Object3D }>();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();
  readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
  showCeiling = false;
  factory: ModelFactory | null = null;
  private raf = 0;
  private pointerDown = false;
  private readonly markerGeo = {
    box: new THREE.BoxGeometry(120, 80, 120),
    door: new THREE.BoxGeometry(260, 180, 60),
    stair: new THREE.ConeGeometry(120, 160, 4),
    sphere: new THREE.SphereGeometry(55, 16, 12),
    cyl: new THREE.CylinderGeometry(50, 50, 90, 12),
    ring: new THREE.RingGeometry(70, 95, 24),
  };
  private readonly markerMats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly fallbackMats = new Map<number, THREE.MeshLambertMaterial>();
  private readonly fallbackGeo = new THREE.BoxGeometry(CELL * 0.96, 20, CELL * 0.96);
  private readonly arrowGeo = new THREE.ConeGeometry(60, 140, 3);

  constructor(
    private readonly st: EditorState,
    private readonly ctl: Controller,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'view3d';
    this.scene.background = new THREE.Color(0x15171c);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.4, 1, 0.3);
    this.scene.add(sun);
    this.scene.add(this.tileGroup, this.markerGroup, this.overlay);

    const grid = new THREE.GridHelper(GRID * CELL, GRID, 0x3a4050, 0x2a2f3a);
    grid.position.set((GRID * CELL) / 2, -2, (GRID * CELL) / 2);
    this.scene.add(grid);

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
      this.ctl.down(p[0], p[1], e);
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pick(e);
      if (p) this.ctl.move(p[0], p[1]);
    });
    c.addEventListener('pointerup', () => {
      if (this.pointerDown) this.ctl.up();
      this.pointerDown = false;
    });
    c.addEventListener('pointerleave', () => this.ctl.leave());
    new ResizeObserver(() => this.resize()).observe(c);
  }

  /** Pointer -> cell coordinates on the ground plane (y = 0). */
  private pick(e: { clientX: number; clientY: number }): [number, number] | null {
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

  setFactory(f: ModelFactory | null): void {
    for (const t of this.tiles.values()) this.tileGroup.remove(t.obj);
    this.tiles.clear();
    this.factory = f;
    if (f) {
      f.clipping = [this.clipPlane];
      f.setCeilingVisible(this.showCeiling);
    }
    this.sync();
  }

  /** Cut everything above a height (null = no cut). */
  setClip(height: number | null): void {
    this.clipPlane.constant = height ?? 1e9;
    this.draw();
  }

  setCeilingVisible(v: boolean): void {
    this.showCeiling = v;
    this.factory?.setCeilingVisible(v);
    this.draw();
  }

  fit(): void {
    const doc = this.st.current;
    if (!doc || !doc.tiles.length) return;
    const xs = doc.tiles.map((t) => t.x), ys = doc.tiles.map((t) => t.y);
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

  /** Bring the scene in line with the document. */
  sync(): void {
    const doc = this.st.current;
    if (!doc) return;
    this.syncTiles(doc);
    this.syncMarkers(doc);
    this.syncOverlay(doc);
    this.draw();
  }

  private tileObject(kind: number, rot: number, letter: number): THREE.Object3D {
    const f = this.factory;
    const hash = f ? this.st.game.master.partModel(kind, this.st.tileset, letterIndex(letter)) : 0;
    const model = f && hash ? f.instance(hash) : null;
    if (model) {
      model.rotation.y = (-rot * Math.PI) / 2;
      return model;
    }
    // No model: a flat coloured slab with an arrow for the orientation.
    const g = new THREE.Group();
    let mat = this.fallbackMats.get(kind);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(kindColor(kind)) });
      this.fallbackMats.set(kind, mat);
    }
    g.add(new THREE.Mesh(this.fallbackGeo, mat));
    const arrow = new THREE.Mesh(this.arrowGeo, mat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 20, -120);
    g.add(arrow);
    g.rotation.y = (-rot * Math.PI) / 2;
    return g;
  }

  private syncTiles(doc: MapDoc): void {
    const want = new Map<string, { sig: string; kind: number; rot: number; letter: number; x: number; y: number }>();
    if (this.ctl.layers.tiles)
      for (const t of doc.tiles) {
        const key = `${t.x},${t.y}`;
        want.set(key, { sig: `${t.kind}/${t.rot}/${t.letter}/${this.st.tileset}`, kind: t.kind, rot: t.rot, letter: t.letter, x: t.x, y: t.y });
      }
    for (const [key, cur] of this.tiles) {
      const w = want.get(key);
      if (!w || w.sig !== cur.sig) {
        this.tileGroup.remove(cur.obj);
        this.tiles.delete(key);
      }
    }
    for (const [key, w] of want) {
      if (this.tiles.has(key)) continue;
      const obj = this.tileObject(w.kind, w.rot, w.letter);
      obj.position.set((w.x + 0.5) * CELL, 0, (w.y + 0.5) * CELL);
      this.tileGroup.add(obj);
      this.tiles.set(key, { sig: w.sig, obj });
    }
  }

  private markerMat(color: string, selected: boolean): THREE.MeshLambertMaterial {
    const key = color + selected;
    let m = this.markerMats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), emissive: selected ? new THREE.Color(0x777777) : new THREE.Color(0) });
      this.markerMats.set(key, m);
    }
    return m;
  }

  /** Object models by mapObject row (loaded on demand). */
  private readonly objects = new Map<number, ModelFactory | null>();
  private objectRequest = new Set<number>();
  objectContext: (() => ObjectContext | null) | null = null;
  showObjects = true;

  /** Model name of a mapObject row ('' until loaded). */
  objectName(row: number): string {
    const f = this.objects.get(row);
    const ref = this.st.game.master.objectModel(row);
    return f && ref ? f.modelName(ref.entry) : '';
  }

  private objectModel(row: number): THREE.Object3D | null {
    const f = this.objects.get(row);
    if (f === undefined) {
      this.objectRequest.add(row);
      return null;
    }
    if (!f) return null;
    const ref = this.st.game.master.objectModel(row);
    const m = ref ? f.instance(ref.entry) : null;
    if (!m) return null;
    // Some models rest below the floor in their bind pose (e.g. gates that rise when closed); lift them
    // so they can be seen.
    let lift = this.objectLift.get(row);
    if (lift === undefined) {
      const box = new THREE.Box3().setFromObject(m);
      lift = box.max.y <= 1 ? -box.min.y : 0;
      this.objectLift.set(row, lift);
    }
    const g = new THREE.Group();
    m.position.y = lift;
    g.add(m);
    return g;
  }
  private readonly objectLift = new Map<number, number>();

  /** Load the object models requested by the last sync, then sync again. */
  private loadRequestedObjects(): void {
    const rows = [...this.objectRequest].filter((r) => !this.objects.has(r));
    this.objectRequest.clear();
    if (!rows.length) return;
    const master = this.st.game.master;
    for (const r of rows) this.objects.set(r, null);
    const refs = rows.map((r) => master.objectModel(r)).filter((x): x is NonNullable<typeof x> => !!x);
    loadObjectModels(this.st.game, refs)
      .then((sets) => {
        for (const r of rows) {
          const ref = master.objectModel(r);
          const set = ref ? sets.get(objKey(ref.archive, ref.entry)) : undefined;
          if (!set || !set.models.size) continue;
          const f = new ModelFactory(set);
          f.clipping = [this.clipPlane];
          f.setCeilingVisible(true);
          this.objects.set(r, f);
        }
        this.syncSelection();
      })
      .catch((err) => console.warn('object models', err));
  }

  private syncMarkers(doc: MapDoc): void {
    this.markerGroup.clear();
    const sel = this.st.selection;
    const ctx = this.showObjects ? this.objectContext?.() ?? null : null;
    for (const k of POINT_SECTIONS) {
      if (!this.ctl.layers.sections[k]) continue;
      const L = LAYOUTS[k]!;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, L);
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        // the game's model, when there is one
        const row = ctx ? recordObjectRow(k, r, ctx) : 0;
        const model = row && row !== OBJ_INVISIBLE ? this.objectModel(row) : null;
        const place = recordPlacement(k, r, doc, this.st.game.master);
        const rotY = place.angle;
        const ox = place.ox, oz = place.oz;
        if (model) {
          model.position.set(px * CELL + ox, 0, py * CELL + oz);
          model.rotation.y = rotY;
          this.markerGroup.add(model);
          const ring = new THREE.Mesh(this.markerGeo.ring, this.markerMat(SECTION_COLORS[k]!, selected));
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(px * CELL, 4, py * CELL);
          if (selected) ring.scale.setScalar(1.4);
          this.markerGroup.add(ring);
          return;
        }
        let geo: THREE.BufferGeometry = this.markerGeo.sphere;
        let y = MARKER_Y + 60;
        if (k === 3) {
          if ([11, 16, 17].includes(P3.kind(r.raw))) {
            geo = this.markerGeo.door;
            y = 90;
          } else {
            geo = this.markerGeo.stair;
            y = 100;
          }
        } else if (k === 4) {
          geo = this.markerGeo.box;
          y = 40;
        } else if (k === 1) {
          geo = this.markerGeo.cyl;
          y = 45;
        }
        const m = new THREE.Mesh(geo, this.markerMat(SECTION_COLORS[k]!, selected));
        m.position.set(px * CELL, y, py * CELL);
        m.rotation.y = rotY;
        if (selected) m.scale.setScalar(1.25);
        this.markerGroup.add(m);
      });
    }
    this.loadRequestedObjects();
  }

  private overlayTrash: { dispose(): void }[] = [];

  private syncOverlay(doc: MapDoc): void {
    this.overlay.clear();
    for (const d of this.overlayTrash) d.dispose();
    this.overlayTrash = [];
    const sel = this.st.selection;
    const addRect = (x0: number, y0: number, x1: number, y1: number, color: number, fill = false): void => {
      const w = (x1 - x0 + 1) * CELL, h = (y1 - y0 + 1) * CELL;
      const geo = new THREE.PlaneGeometry(w, h);
      geo.rotateX(-Math.PI / 2);
      let obj: THREE.Mesh | THREE.LineSegments;
      if (fill) {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false });
        obj = new THREE.Mesh(geo, mat);
        this.overlayTrash.push(geo, mat);
      } else {
        const edges = new THREE.EdgesGeometry(geo);
        const mat = new THREE.LineBasicMaterial({ color });
        obj = new THREE.LineSegments(edges, mat);
        this.overlayTrash.push(geo, edges, mat);
      }
      obj.position.set(x0 * CELL + w / 2, 6, y0 * CELL + h / 2);
      this.overlay.add(obj);
    };
    if (this.ctl.layers.room) for (const c of doc.cells6) addRect(c.x, c.y, c.x, c.y, 0x50c8ff, true);
    if (sel.type === 'tiles') for (const [x, y] of sel.cells) addRect(x, y, x, y, 0xffeb3b);
    if (sel.type === 'rect') {
      const r = norm(sel);
      addRect(r.x0, r.y0, r.x1, r.y1, 0xffeb3b);
    }
    const hv = this.ctl.hover;
    if (hv) {
      addRect(hv[0], hv[1], hv[0], hv[1], 0xffffff);
      if (this.st.tool === 'paint') {
        const ghost = this.tileObject(this.st.brush.kind, this.st.brush.rot, this.st.brush.letter);
        ghost.position.set((hv[0] + 0.5) * CELL, 1, (hv[1] + 0.5) * CELL);
        ghost.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const m = (o.material as THREE.Material).clone();
            m.transparent = true;
            m.opacity = 0.55;
            o.material = m;
            this.overlayTrash.push(m);
          }
        });
        this.overlay.add(ghost);
      }
    }
  }

  /** Hover changed. */
  syncOverlayOnly(): void {
    const doc = this.st.current;
    if (!doc) return;
    this.syncOverlay(doc);
    this.draw();
  }

  /** Selection (or the loaded object models) changed. */
  syncSelection(): void {
    const doc = this.st.current;
    if (!doc) return;
    this.syncOverlay(doc);
    this.syncMarkers(doc);
    this.draw();
  }
}
