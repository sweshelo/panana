// Preview of the performance of an action: its phases (the user's performance, then the target's …) one after the
// other, each on its own model with the camera on it, like the battle. A phase follows the timeline of its slot
// (performance.ts slotTimeline, as the game's FUN_0025af90): the effects come out, the sound effect plays and the motion
// (the animation whose name starts with the animData key) starts at their frames. Where the effects come out is marked
// (the particles themselves are not drawn: their format is not analysed yet).
import * as THREE from 'three';
import { AnimatedModel, ANIMATION_FPS, animationKey } from '../cgfx/player';
import { ModelFactory } from '../cgfx/three';
import { clear, h } from '../editor/dom';
import type { SlotTimeline } from '../game/performance';
import type { ModelRef } from './modelview';

/** An effect of a phase: where it comes out (all of a slot's effects start at its timeline's `effect`). */
export interface PreviewEffect {
  label: string;
  /** Bone name ('' = the unit's position). */
  bone: string;
  offset: [number, number, number];
  /** How long it is marked (frames). */
  length: number;
}

export interface PreviewPhase {
  /** "使用者: まおう". */
  title: string;
  /** The model (null: a stand-in, e.g. for 電波人間, whose models are not read). */
  model: ModelRef | null;
  /** Animation key ("010_"), '' = none. */
  anim: string;
  /** The slot's timeline for the length of the motion on the model (null = not known). */
  timeline: (motionFrames: number | null) => SlotTimeline;
  effects: PreviewEffect[];
  /** Plays the sound effect (at the timeline's `se`). */
  sound: (() => void) | null;
}

interface Loaded {
  object: THREE.Object3D;
  animated: AnimatedModel | null;
  center: THREE.Vector3;
  radius: number;
  timeline: SlotTimeline;
  /** Length of the motion on the model (null: none or not known). */
  motionFrames: number | null;
  note: string;
}

/** What the viewer found for a phase once its model is read. */
export interface PhaseTiming {
  timeline: SlotTimeline;
  motionFrames: number | null;
}

const models = new Map<string, Promise<{ factory: ModelFactory; hash: number } | null>>();

function factoryOf(ref: ModelRef): Promise<{ factory: ModelFactory; hash: number } | null> {
  let p = models.get(ref.key);
  if (!p) {
    p = ref.load().then((r) => (r && r.set.models.has(r.hash) ? { factory: new ModelFactory(r.set), hash: r.hash } : null)).catch(() => null);
    models.set(ref.key, p);
  }
  return p;
}

/** Heights (fractions of the stand-in) of the bones the effects use, for the stand-in without a skeleton. */
const STAND_IN_BONES: Record<string, number> = { head: 0.9, mouth: 0.85, neck: 0.8, jaw: 0.85, spine1: 0.65, spine: 0.6, waist: 0.5, hip: 0.5, body: 0.55, model: 0 };
const STAND_IN_HEIGHT = 100;

export class PerformanceViewer {
  readonly el = h('div', { class: 'viewer perf-viewer' });
  private readonly canvas = h('canvas', {});
  private readonly note = h('div', { class: 'viewer-note muted small' });
  private readonly effectsLabel = h('div', { class: 'perf-effects small' });
  private readonly phaseLabel = h('span', { class: 'small' });
  private readonly frameLabel = h('span', { class: 'viewer-frame small' });
  private readonly playButton = h('button', { title: '最初から再生 / 止める', onclick: () => (this.playing ? this.stop() : this.play()) }, '▶');
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 100000);
  private readonly markers = new THREE.Group();
  private phases: PreviewPhase[] = [];
  private loaded: Loaded[] = [];
  private current = -1;
  /** The model in the scene (removed before another is shown, even when the phases were replaced). */
  private shown: THREE.Object3D | null = null;
  private playing = false;
  private token = 0;
  /** Called with the timelines once the models are read (the lengths depend on the motions). */
  onTimelines: (t: PhaseTiming[]) => void = () => {};
  /** Called whenever the shown phase or frame changes. */
  onFrame: (phase: number, frame: number) => void = () => {};

  constructor() {
    this.el.append(this.canvas, this.note, this.effectsLabel,
      h('div', { class: 'viewer-anim' }, this.playButton, this.phaseLabel, this.frameLabel));
    this.el.classList.add('animated');
    this.scene.add(this.markers);
    new ResizeObserver(() => this.render()).observe(this.el);
  }

  /** Load the models of the phases and show the first one (still). */
  async show(phases: PreviewPhase[]): Promise<void> {
    const token = ++this.token;
    this.stop();
    this.phases = phases;
    this.note.textContent = phases.length ? 'モデルを読み込み中…' : '演出がありません';
    this.loaded = [];
    this.setPhase(-1);
    const loaded = await Promise.all(phases.map((p) => this.load(p)));
    if (token !== this.token) return;
    this.loaded = loaded;
    this.note.textContent = '';
    if (phases.length) this.setPhase(0);
    this.seek(0);
    this.onTimelines(loaded.map((l) => ({ timeline: l.timeline, motionFrames: l.motionFrames })));
  }

  /** Show a phase at a frame (still). */
  showAt(phase: number, frame: number): void {
    if (!this.loaded[phase]) return;
    this.stop();
    if (phase !== this.current) this.setPhase(phase);
    this.seek(Math.max(0, Math.min(frame, this.loaded[phase]!.timeline.length)));
  }

  private async load(p: PreviewPhase): Promise<Loaded> {
    const f = p.model ? await factoryOf(p.model) : null;
    let object: THREE.Object3D | null = null;
    let animated: AnimatedModel | null = null;
    let note = '';
    if (f) {
      const hasMotions = !!f.factory.set.models.get(f.hash)?.animations.some((a) => a.kind === 'skeletal' && a.skeletal.length);
      animated = hasMotions ? new AnimatedModel(f.factory, f.hash) : null;
      object = animated?.group ?? f.factory.instance(f.hash);
    }
    let motionFrames: number | null = null;
    if (animated && p.anim) {
      const a = animated.motions.find((m) => animationKey(m.name) === p.anim);
      animated.select(a?.name ?? null);
      if (a) motionFrames = animated.frames;
      else note = `モデルにモーション ${p.anim} がありません`;
    } else if (animated) animated.select(null);
    if (!object) {
      // A stand-in: a capsule as tall as a person.
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(18, STAND_IN_HEIGHT - 36, 4, 12), new THREE.MeshBasicMaterial({ color: 0x5a6b85, wireframe: true }));
      mesh.position.y = STAND_IN_HEIGHT / 2;
      g.add(mesh);
      object = g;
      if (p.model === null) note ||= 'モデルなし (仮の姿)';
      else note ||= 'モデルを読めませんでした';
    }
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 30);
    return { object, animated, center, radius, timeline: p.timeline(motionFrames), motionFrames, note };
  }

  private setPhase(i: number): void {
    if (this.shown) this.scene.remove(this.shown);
    this.current = i;
    const l = this.loaded[i];
    this.shown = l?.object ?? null;
    if (this.shown) this.scene.add(this.shown);
    const p = this.phases[i];
    this.phaseLabel.textContent = p ? `${i + 1} / ${this.phases.length}  ${p.title}` : '';
    this.note.textContent = l?.note ?? this.note.textContent;
  }

  /** Put the current phase at a frame: the pose and the markers of the effects that are out. */
  private seek(frame: number): void {
    const l = this.loaded[this.current];
    const p = this.phases[this.current];
    for (const m of this.markers.children as THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.markers.clear();
    if (!l || !p) {
      this.render();
      return;
    }
    const tl = l.timeline;
    l.animated?.update(Math.max(0, frame - tl.motion));
    const out = p.effects.filter((e) => frame >= tl.effect && frame < tl.effect + Math.max(e.length, 1));
    for (const e of out) {
      const pos = this.effectPosition(l, e);
      const t = (frame - tl.effect) / Math.max(e.length, 1);
      const m = new THREE.Mesh(new THREE.SphereGeometry(l.radius * 0.08 * (1 + 0.5 * Math.sin(t * Math.PI)), 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.75, depthTest: false }));
      m.position.copy(pos);
      m.renderOrder = 10;
      this.markers.add(m);
    }
    clear(this.effectsLabel);
    for (const e of out) this.effectsLabel.append(h('div', {}, `✦ ${e.label}`));
    this.frameLabel.textContent = `${Math.floor(frame)} / ${Math.floor(tl.length)}`;
    this.render();
    this.onFrame(this.current, frame);
  }

  private effectPosition(l: Loaded, e: PreviewEffect): THREE.Vector3 {
    const off = new THREE.Vector3(...e.offset);
    const m = e.bone && l.animated ? l.animated.boneMatrix(e.bone) : null;
    if (m) return new THREE.Vector3().setFromMatrixPosition(m).add(off);
    if (!l.animated && e.bone) return new THREE.Vector3(0, (STAND_IN_BONES[e.bone] ?? 0.5) * STAND_IN_HEIGHT, 0).add(off);
    return off; // the unit's position (or a bone the model does not have)
  }

  play(): void {
    if (!this.loaded.length) return;
    this.stop();
    const token = this.token;
    this.playing = true;
    this.playButton.textContent = '■';
    let phase = 0;
    let start = performance.now();
    let sounded = false;
    this.setPhase(0);
    const tick = (now: number): void => {
      if (!this.playing || token !== this.token) return;
      let f = ((now - start) / 1000) * ANIMATION_FPS;
      if (f >= this.loaded[phase]!.timeline.length) {
        phase++;
        if (phase >= this.loaded.length) {
          this.seek(this.loaded[phase - 1]!.timeline.length);
          this.stop();
          return;
        }
        start = now;
        f = 0;
        sounded = false;
        this.setPhase(phase);
      }
      // The sound effect once, when its frame is reached (FUN_0025af90).
      const se = this.loaded[phase]!.timeline.se;
      if (!sounded && se !== null && f >= se) {
        sounded = true;
        this.phases[phase]?.sound?.();
      }
      if (this.el.isConnected) this.seek(f);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.playing = false;
    this.playButton.textContent = '▶';
  }

  private render(): void {
    const w = this.el.clientWidth, hgt = this.canvas.clientHeight;
    if (!w || !hgt) return;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, hgt, false);
    const l = this.loaded[this.current];
    const center = l?.center ?? new THREE.Vector3(0, 50, 0);
    const radius = l?.radius ?? 100;
    this.camera.aspect = w / hgt;
    const d = radius / Math.sin(THREE.MathUtils.degToRad(15));
    const yaw = 0.6, pitch = 0.25;
    this.camera.position.set(center.x + Math.sin(yaw) * Math.cos(pitch) * d, center.y + Math.sin(pitch) * d, center.z + Math.cos(yaw) * Math.cos(pitch) * d);
    this.camera.near = d / 100;
    this.camera.far = d * 10;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);
    this.renderer.render(this.scene, this.camera);
  }
}
