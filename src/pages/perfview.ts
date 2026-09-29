// Preview of the performance of an action: its phases (the user's performance, then the target's …) one after the
// other, each on its own model with the camera on it, like the battle. A phase plays the motion (the animation whose
// name starts with the animData key), the sound effect at its start, and marks where the effects come out (the
// particles themselves are not drawn: their format is not analysed yet).
import * as THREE from 'three';
import { AnimatedModel, ANIMATION_FPS, animationKey } from '../cgfx/player';
import { ModelFactory } from '../cgfx/three';
import { clear, h } from '../editor/dom';
import type { ModelRef } from './modelview';

/** An effect of a phase: where and when it comes out. */
export interface PreviewEffect {
  label: string;
  /** Bone name ('' = the unit's position). */
  bone: string;
  offset: [number, number, number];
  /** Frames since the phase started. */
  start: number;
  length: number;
}

export interface PreviewPhase {
  /** "使用者: まおう". */
  title: string;
  /** The model (null: a stand-in, e.g. for 電波人間, whose models are not read). */
  model: ModelRef | null;
  /** Animation key ("010_"), '' = none. */
  anim: string;
  /** Length in frames (0 = the motion's length, or 60). */
  length: number;
  /** Add the motion's length to `length` (directData +0x09 bit0). */
  addLength: boolean;
  effects: PreviewEffect[];
  /** Plays the sound effect (called at the start of the phase). */
  sound: (() => void) | null;
}

interface Loaded {
  object: THREE.Object3D;
  animated: AnimatedModel | null;
  center: THREE.Vector3;
  radius: number;
  /** Length of the phase in frames. */
  frames: number;
  note: string;
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
    let motionFrames = 0;
    if (animated && p.anim) {
      const a = animated.motions.find((m) => animationKey(m.name) === p.anim);
      animated.select(a?.name ?? null);
      if (a) motionFrames = animated.frames;
      else note = `モデルにモーション ${p.anim} がありません`;
    }
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
    const base = p.length > 0 && !p.addLength ? p.length : motionFrames + (p.addLength ? p.length : 0);
    const effectsEnd = Math.max(0, ...p.effects.map((e) => e.start + e.length));
    const frames = Math.max(base || 60, p.length > 0 ? 0 : Math.min(effectsEnd, 240));
    return { object, animated, center, radius, frames, note };
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
    l.animated?.update(frame);
    const out = p.effects.filter((e) => frame >= e.start && frame < e.start + Math.max(e.length, 1));
    for (const e of out) {
      const pos = this.effectPosition(l, e);
      const t = (frame - e.start) / Math.max(e.length, 1);
      const m = new THREE.Mesh(new THREE.SphereGeometry(l.radius * 0.08 * (1 + 0.5 * Math.sin(t * Math.PI)), 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.75, depthTest: false }));
      m.position.copy(pos);
      m.renderOrder = 10;
      this.markers.add(m);
    }
    clear(this.effectsLabel);
    for (const e of out) this.effectsLabel.append(h('div', {}, `✦ ${e.label}`));
    this.frameLabel.textContent = `${Math.floor(frame)} / ${Math.floor(l.frames)}`;
    this.render();
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
    this.setPhase(0);
    this.phases[0]?.sound?.();
    const tick = (now: number): void => {
      if (!this.playing || token !== this.token) return;
      let f = ((now - start) / 1000) * ANIMATION_FPS;
      if (f >= this.loaded[phase]!.frames) {
        phase++;
        if (phase >= this.loaded.length) {
          this.seek(this.loaded[phase - 1]!.frames);
          this.stop();
          return;
        }
        start = now;
        f = 0;
        this.setPhase(phase);
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
