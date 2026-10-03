// 3D view: tile models placed like the game (cell centre ((x + 0.5) * 500, 0, (y + 0.5) * 500), rotation =
// -rot * 90° about Y; docs/map-editor-design.md §6), markers for points, editing on the ground plane.
import * as THREE from 'three';
import { CELL, LAYOUTS, P3, P7, POINT_SECTIONS, letterIndex, recCellPos, type MapDoc } from '../game/sections';
import { ModelFactory } from '../cgfx/three';
import { AnimatedModel, animationKey } from '../cgfx/player';
import { loadComposite, loadObjectModels, objKey } from '../cgfx/loader';
import { charaMonsterDesign } from '../game/boss';
import { MONSTER_MODEL_ARCHIVE } from '../game/monsters';
import type { EventTable } from '../game/events';
import { renderObjectThumb } from './thumbs';
import { OBJ_INVISIBLE, recordObjectRow, recordPlacement, type ObjectContext } from '../game/objects';
import { norm, type Controller } from './controller';
import { eventLinks } from './events';
import { kindColor, SECTION_COLORS } from './legend';
import { MapScene, TileFallback, TileLayer } from './mapscene';
import { GRID, tileAt, type EditorState } from './state';

const MARKER_Y = 40;
/** Height of a monster shown on the map (a boss's character; a cell is 500). */
const BOSS_HEIGHT = 420;

export class View3D {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  private readonly view: MapScene;
  private readonly tileLayer = new TileLayer();
  private readonly fallback = new TileFallback();
  private readonly markerGroup = new THREE.Group();
  private readonly overlay = new THREE.Group();
  readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
  showCeiling = false;
  factory: ModelFactory | null = null;
  private readonly markerGeo = {
    box: new THREE.BoxGeometry(120, 80, 120),
    door: new THREE.BoxGeometry(260, 180, 60),
    stair: new THREE.ConeGeometry(120, 160, 4),
    sphere: new THREE.SphereGeometry(55, 16, 12),
    cyl: new THREE.CylinderGeometry(50, 50, 90, 12),
    ring: new THREE.RingGeometry(70, 95, 24),
  };
  private readonly markerMats = new Map<string, THREE.MeshLambertMaterial>();

  constructor(
    private readonly st: EditorState,
    private readonly ctl: Controller,
  ) {
    this.view = new MapScene('view3d', GRID);
    this.renderer = this.view.renderer;
    this.canvas = this.view.canvas;
    this.view.scene.add(this.tileLayer.group, this.markerGroup, this.overlay);
    this.view.pointer = {
      down: (cx, cy, e) => this.ctl.down(cx, cy, e),
      move: (cx, cy) => this.ctl.move(cx, cy),
      up: () => this.ctl.up(),
      leave: () => this.ctl.leave(),
    };
  }

  setFactory(f: ModelFactory | null): void {
    this.tileLayer.clear();
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
    if (doc) this.view.fitCells(doc.tiles);
  }

  /** Top-down camera. */
  topView(): void {
    this.view.topView();
  }

  draw(): void {
    this.view.draw();
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
    return this.fallback.make(kindColor(kind), rot);
  }

  private syncTiles(doc: MapDoc): void {
    const ts = this.st.tileset;
    this.tileLayer.sync(
      this.ctl.layers.tiles
        ? doc.tiles.map((t) => ({ x: t.x, y: t.y, sig: `${t.kind}/${t.rot}/${t.letter}/${ts}`, make: () => this.tileObject(t.kind, t.rot, t.letter) }))
        : [],
    );
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
  /** Show doors and gates in their open pose (their "002_" animation) instead of closed ("001_"). */
  doorsOpen = false;

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
    if (!ref) return null;
    const posed = this.doorModel(row, f, ref.entry);
    if (posed) return posed;
    const m = f.instance(ref.entry);
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

  /** Posed doors / gates by "row/open" (a template to clone; null = the model has no open / closed poses). */
  private readonly doorPoses = new Map<string, THREE.Object3D | null>();

  /**
   * A door or gate (mapObject rows 4..19) in its closed ("001_close", "001_closed") or open ("002_open",
   * "002_opend") pose. Gates whose rest pose is under the floor (gimk_03_gate_08) stand up when closed.
   */
  private doorModel(row: number, f: ModelFactory, entry: number): THREE.Object3D | null {
    if (row < 4 || row > 19) return null;
    const key = `${row}/${this.doorsOpen ? 1 : 0}`;
    let tmpl = this.doorPoses.get(key);
    if (tmpl === undefined) {
      tmpl = null;
      const motions = f.set.models.get(entry)?.animations.filter((a) => a.kind === 'skeletal' && a.skeletal.length) ?? [];
      const pose = motions.find((a) => animationKey(a.name) === (this.doorsOpen ? '002_' : '001_'));
      if (pose) {
        const m = new AnimatedModel(f, entry);
        m.select(pose.name);
        m.update(pose.frames);
        tmpl = new THREE.Group().add(m.group);
      }
      this.doorPoses.set(key, tmpl);
    }
    return tmpl ? tmpl.clone() : null;
  }

  setDoorsOpen(open: boolean): void {
    if (this.doorsOpen === open) return;
    this.doorsOpen = open;
    this.sync();
  }

  /** Load the object models requested by the last sync, then sync again. */
  private loadRequestedObjects(): void {
    const rows = [...this.objectRequest].filter((r) => !this.objects.has(r));
    this.objectRequest.clear();
    if (rows.length) this.loadObjects(rows).then(() => this.syncSelection());
  }

  private readonly objectLoads = new Map<number, Promise<void>>();

  /** Load the models of mapObject rows (once each). */
  loadObjects(rows: number[]): Promise<void> {
    const todo = rows.filter((r) => !this.objects.has(r));
    if (todo.length) {
      const master = this.st.game.master;
      for (const r of todo) this.objects.set(r, null);
      const refs = todo.map((r) => master.objectModel(r)).filter((x): x is NonNullable<typeof x> => !!x);
      const job = loadObjectModels(this.st.game, refs)
        .then((sets) => {
          for (const r of todo) {
            const ref = master.objectModel(r);
            const set = ref ? sets.get(objKey(ref.archive, ref.entry)) : undefined;
            if (!set || !set.models.size) continue;
            const f = new ModelFactory(set);
            f.clipping = [this.clipPlane];
            f.setCeilingVisible(true);
            this.objects.set(r, f);
          }
        })
        .catch((err) => console.warn('object models', err));
      for (const r of todo) this.objectLoads.set(r, job);
    }
    return Promise.all(rows.map((r) => this.objectLoads.get(r))).then(() => {});
  }

  private readonly objectThumbs = new Map<number, string | null>();

  /** Thumbnail (data URL) of a mapObject row's model, or null when it has none. */
  async objectThumb(row: number): Promise<string | null> {
    const done = this.objectThumbs.get(row);
    if (done !== undefined) return done;
    await this.loadObjects([row]);
    const f = this.objects.get(row);
    const m = f ? this.objectModel(row) : null;
    const url = f && m ? renderObjectThumb(f, m) : null;
    this.objectThumbs.set(row, url);
    return url;
  }

  /** Idle-posed monster models by MonsterDesign row (a template to clone; null = none / loading). */
  private readonly bossModels = new Map<number, THREE.Object3D | null>();
  private readonly bossRequest = new Set<number>();

  /**
   * MonsterDesign row shown by a section-5 character whose mapChara row is a monster (a boss placed by Panana, or
   * the game's own), or -1. The range of a boss battle (section 8) has no model in the game, so none is shown here.
   */
  private charaMonster(events: EventTable | null, section: number, raw: Uint8Array): number {
    if (section !== 5 || raw[8] !== 0 || !events) return -1;
    const row = raw[0]! | (raw[1]! << 8) | (raw[2]! << 16) | (raw[3]! << 24);
    if (!events.has(row)) return -1;
    return charaMonsterDesign(this.st.game.master, events.model(row)) ?? -1;
  }

  private bossModel(monster: number): THREE.Object3D | null {
    if (!this.bossModels.has(monster)) {
      this.bossRequest.add(monster);
      return null;
    }
    return this.bossModels.get(monster)?.clone() ?? null;
  }

  /**
   * Load the monster models asked for by the last sync: the idle motion ("001_", the museum's 0x41) at its first
   * frame, scaled to about a cell (the game shows nothing in the range; this is where the battle happens).
   */
  private loadRequestedBosses(): void {
    const todo = [...this.bossRequest].filter((m) => !this.bossModels.has(m));
    this.bossRequest.clear();
    if (!todo.length) return;
    for (const m of todo) this.bossModels.set(m, null);
    const game = this.st.game;
    game.monsters().then((book) =>
      Promise.all(todo.map(async (design) => {
        const mon = book.monsters.find((m) => m.design === design);
        const ref = mon ? book.modelOf(mon) : null;
        if (!ref) return;
        const set = await loadComposite(game, MONSTER_MODEL_ARCHIVE, ref.model, ref.texture);
        const f = new ModelFactory(set);
        if (!set.models.has(ref.model)) return;
        const m = new AnimatedModel(f, ref.model);
        const idle = m.motions.find((a) => animationKey(a.name) === '001_');
        if (idle) m.select(idle.name);
        const box = new THREE.Box3().setFromObject(m.group);
        const size = box.getSize(new THREE.Vector3());
        const scale = size.y > 0 ? BOSS_HEIGHT / Math.max(size.y, size.x * 0.6, size.z * 0.6) : 1;
        m.group.scale.setScalar(scale);
        m.group.position.y = -box.min.y * scale;
        this.bossModels.set(design, new THREE.Group().add(m.group));
      })),
    ).then(() => this.syncSelection(), (err) => console.warn('boss models', err));
  }

  private syncMarkers(doc: MapDoc): void {
    this.markerGroup.clear();
    const sel = this.st.selection;
    const ctx = this.showObjects ? this.objectContext?.() ?? null : null;
    const events = this.objectContext?.()?.events ?? null;
    for (const k of POINT_SECTIONS) {
      if (!this.ctl.layers.sections[k]) continue;
      const L = LAYOUTS[k]!;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, L);
        const selected = sel.type === 'rec' && sel.section === k && sel.index === i;
        // the game's model, when there is one
        const row = ctx ? recordObjectRow(k, r, ctx) : 0;
        const boss = ctx ? this.charaMonster(events, k, r.raw) : -1;
        const model = boss >= 0 ? this.bossModel(boss) : row && row !== OBJ_INVISIBLE ? this.objectModel(row) : null;
        const place = recordPlacement(k, r, doc, this.st.game.master, events);
        const rotY = place.angle;
        const ox = place.ox, oz = place.oz;
        if (model) {
          model.position.set(px * CELL + ox, place.oy, py * CELL + oz);
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
        if (k === 7) {
          geo = P7.visible(r.raw) ? this.markerGeo.door : this.markerGeo.sphere;
          y = P7.visible(r.raw) ? 90 : MARKER_Y + 60;
        } else if (k === 3) {
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
    this.loadRequestedBosses();
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
    for (const l of eventLinks(this.st)) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(l.from[0] * CELL, 120, l.from[1] * CELL),
        new THREE.Vector3(l.to[0] * CELL, 120, l.to[1] * CELL),
      ]);
      const mat = new THREE.LineBasicMaterial({ color: l.generic ? 0x50dcff : 0xffffff, transparent: true, opacity: l.selected ? 1 : 0.6, depthTest: false });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 10;
      this.overlay.add(line);
      this.overlayTrash.push(geo, mat);
    }
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
