// Models of the books: a "photo" (rendered thumbnail, cached as a data URL) and an interactive viewer
// (drag to turn, wheel to zoom, save as PNG, play the motions of models that have them).
import * as THREE from 'three';
import { AnimatedModel, ANIMATION_FPS, animationKey } from '../cgfx/player';
import { ModelFactory } from '../cgfx/three';
import type { TilesetModels } from '../cgfx/tileset';
import { boardFacing } from '../cgfx/facing';
import { renderObjectThumb } from '../editor/thumbs';
import { clear, h } from '../editor/dom';
import { idbGet, idbSet } from '../util/idb';

/** A model to show: the converted set and the hash of the model in it. */
export interface ModelRef {
  key: string;
  load: () => Promise<{ set: TilesetModels; hash: number } | null>;
}

/** A model, or a picture for entries that only hold a texture (clothing patterns). */
type Loaded = { factory: ModelFactory; hash: number } | { image: string; name: string };
const factories = new Map<string, Promise<Loaded | null>>();

/** The first texture of a set as a PNG data URL (rows are stored top first). */
function textureImage(set: TilesetModels): { image: string; name: string } | null {
  const t = [...set.textures.values()][0];
  if (!t) return null;
  const c = document.createElement('canvas');
  c.width = t.width;
  c.height = t.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height), 0, 0);
  return { image: c.toDataURL('image/png'), name: t.name };
}

function factoryOf(ref: ModelRef): Promise<Loaded | null> {
  let p = factories.get(ref.key);
  if (!p) {
    p = ref.load()
      .then((r): Loaded | null => {
        if (!r) return null;
        if (r.set.models.has(r.hash)) return { factory: new ModelFactory(r.set), hash: r.hash };
        return textureImage(r.set);
      })
      .catch(() => null);
    factories.set(ref.key, p);
  }
  return p;
}

/** Default view directions (from the model to the camera) of the photos and the viewer. */
const THUMB_VIEW: [number, number, number] = [0.55, 0.6, 1];
const DEFAULT_YAW = 0.6;
const DEFAULT_PITCH = 0.25;
/** Highest pitch (just short of straight down, where the camera's up would be undefined). */
const MAX_PITCH = 1.56;

const photos = new Map<string, Promise<string | null>>();
/** Thumbnails are made one at a time so the list stays responsive. */
let chain: Promise<unknown> = Promise.resolve();

/** A photo (data URL) of a model, or null when it has none. */
export function modelPhoto(ref: ModelRef): Promise<string | null> {
  let p = photos.get(ref.key);
  if (!p) {
    const idbKey = `photo/${ref.key}/v5`;
    p = (async () => {
      const cached = await idbGet<string>(idbKey).catch(() => undefined);
      if (cached !== undefined) return cached || null;
      const job = chain.then(async () => {
        const f = await factoryOf(ref);
        if (f && 'image' in f) return f.image;
        const m = f ? f.factory.instance(f.hash) : null;
        return f && m ? renderObjectThumb(f.factory, m, boardFacing(m, THUMB_VIEW)) : null;
      });
      chain = job.catch(() => null);
      const url = await job;
      idbSet(idbKey, url ?? '').catch(() => {});
      return url;
    })();
    photos.set(ref.key, p);
  }
  return p;
}

/** Interactive viewer (one WebGL context, reused for every model). */
export class ModelViewer {
  readonly el = h('div', { class: 'viewer' });
  private readonly canvas = h('canvas', {});
  private readonly note = h('div', { class: 'viewer-note muted small' });
  private readonly picture = h('img', { class: 'viewer-picture', alt: '' });
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 100000);
  private model: THREE.Object3D | null = null;
  private center = new THREE.Vector3();
  private radius = 100;
  private yaw = DEFAULT_YAW;
  private pitch = DEFAULT_PITCH;
  /** Front view of a board model (yaw, pitch), or null to use the default angle. */
  private front: [number, number] | null = null;
  private zoom = 1;
  private name = 'model';
  private token = 0;
  // Motions
  private animated: AnimatedModel | null = null;
  private frame = 0;
  private playing = false;
  private lastTime = 0;
  private readonly motionSelect = h('select', { title: 'モーション', onchange: () => this.selectMotion(this.motionSelect.value || null) });
  private readonly playButton = h('button', { title: '再生 / 一時停止', onclick: () => this.setPlaying(!this.playing) }, '⏸');
  private readonly slider = h('input', { type: 'range', min: 0, max: 0, step: 1, title: 'フレーム', oninput: () => this.seek(Number(this.slider.value)) });
  private readonly frameLabel = h('span', { class: 'viewer-frame small' });
  private readonly animBar = h('div', { class: 'viewer-anim' }, this.motionSelect, this.playButton, this.slider, this.frameLabel);

  /** @param motionHints What a motion is used for, by the first 4 characters of its name ("001_"). */
  constructor(private readonly motionHints: Record<string, string> = {}) {
    this.el.append(this.canvas, this.picture, this.note, this.animBar,
      h('div', { class: 'viewer-bar' },
        h('button', { title: '向きと大きさを戻す', onclick: () => this.reset() }, '正面'),
        h('button', { title: 'PNG で保存', onclick: () => this.save() }, '写真を保存')));
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      let x = e.clientX, y = e.clientY;
      const move = (ev: PointerEvent): void => {
        this.yaw -= (ev.clientX - x) * 0.01;
        this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + (ev.clientY - y) * 0.01));
        x = ev.clientX;
        y = ev.clientY;
        this.render();
      };
      const up = (): void => {
        this.canvas.removeEventListener('pointermove', move);
        this.canvas.removeEventListener('pointerup', up);
      };
      this.canvas.addEventListener('pointermove', move);
      this.canvas.addEventListener('pointerup', up);
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.3, Math.min(4, this.zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
      this.render();
    }, { passive: false });
    new ResizeObserver(() => this.render()).observe(this.el);
  }

  async show(ref: ModelRef | null, name: string): Promise<void> {
    const token = ++this.token;
    this.name = name;
    if (this.model) this.scene.remove(this.model);
    this.model = null;
    this.front = null;
    this.animated = null;
    this.playing = false;
    this.el.classList.remove('animated');
    this.el.classList.remove('picture');
    this.note.textContent = ref ? 'モデルを読み込み中…' : 'モデルがありません';
    this.render();
    if (!ref) return;
    const f = await factoryOf(ref);
    if (token !== this.token) return;
    if (f && 'image' in f) {
      this.picture.src = f.image;
      this.el.classList.add('picture');
      this.note.textContent = `${f.name} (テクスチャ)`;
      return;
    }
    const hasMotions = !!f?.factory.set.models.get(f.hash)?.animations.some((a) => a.kind === 'skeletal' && a.skeletal.length);
    const animated = f && hasMotions ? new AnimatedModel(f.factory, f.hash) : null;
    const m = animated?.group ?? f?.factory.instance(f.hash) ?? null;
    if (!f || !m) {
      this.note.textContent = 'モデルを読めませんでした';
      return;
    }
    this.note.textContent = f.factory.modelName(f.hash);
    this.model = m;
    this.scene.add(m);
    const box = new THREE.Box3().setFromObject(m);
    this.center = box.getCenter(new THREE.Vector3());
    this.radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1);
    const cp = Math.cos(DEFAULT_PITCH);
    const n = animated ? null : boardFacing(m, [Math.sin(DEFAULT_YAW) * cp, Math.sin(DEFAULT_PITCH), Math.cos(DEFAULT_YAW) * cp]);
    if (n) this.front = [Math.atan2(n.x, n.z), Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.asin(Math.max(-1, Math.min(1, n.y)))))];
    if (animated) this.showMotions(animated);
    this.reset();
  }

  /** Motion list of an animated model; starts with "001_" (the waiting motion) when there is one. */
  private showMotions(animated: AnimatedModel): void {
    this.animated = animated;
    this.el.classList.add('animated');
    clear(this.motionSelect);
    this.motionSelect.append(h('option', { value: '' }, '静止姿勢'));
    const motions = animated.motions;
    for (const a of motions) {
      const hint = this.motionHints[animationKey(a.name)];
      this.motionSelect.append(h('option', { value: a.name, title: hint ?? '' }, motionLabel(a.name) + (hint ? ` (${hint})` : '')));
    }
    const first = motions.find((a) => animationKey(a.name) === '001_') ?? motions[0];
    this.motionSelect.value = first?.name ?? '';
    this.selectMotion(first?.name ?? null);
  }

  private selectMotion(name: string | null): void {
    if (!this.animated) return;
    this.animated.select(name);
    this.frameMotion();
    this.slider.max = String(Math.max(0, Math.floor(this.animated.frames)));
    this.seek(0);
    this.setPlaying(!!name);
  }

  /** Aim the camera at the space the motion covers (flying monsters leave the rest pose's box). */
  private frameMotion(): void {
    const a = this.animated;
    if (!a || !this.model) return;
    const box = new THREE.Box3();
    const steps = a.frames > 0 ? 12 : 0;
    for (let i = 0; i <= steps; i++) {
      a.update((a.frames * i) / Math.max(steps, 1));
      this.model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.computeBoundingBox();
          box.union(o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld));
        }
      });
    }
    if (box.isEmpty()) return;
    this.center = box.getCenter(new THREE.Vector3());
    this.radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1);
  }

  /** Go to a time (frames since the motion started; looping motions keep counting). */
  private seek(time: number): void {
    const a = this.animated;
    if (!a) return;
    this.frame = time;
    a.update(time);
    const frames = a.frames;
    const shown = frames > 0 && a.loop ? time % frames : Math.min(time, frames);
    this.slider.value = String(Math.floor(shown));
    this.frameLabel.textContent = `${Math.floor(shown)} / ${Math.floor(frames)}`;
    this.render();
  }

  private setPlaying(on: boolean): void {
    const a = this.animated;
    if (on && a && a.frames > 0 && !a.loop && this.frame >= a.frames) this.frame = 0;
    this.playing = on && !!a && a.frames > 0;
    this.playButton.textContent = this.playing ? '⏸' : '▶';
    if (!this.playing) return;
    const token = this.token;
    this.lastTime = performance.now();
    const tick = (now: number): void => {
      if (!this.playing || token !== this.token || !this.animated) return;
      const frames = this.animated.frames;
      let f = this.frame + ((now - this.lastTime) / 1000) * ANIMATION_FPS;
      this.lastTime = now;
      if (f >= frames && !this.animated.loop) {
        f = frames;
        this.setPlaying(false);
      }
      if (this.el.isConnected) this.seek(f);
      else this.frame = f;
      if (this.playing) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Default angle, or straight at the front of a board model. */
  private reset(): void {
    [this.yaw, this.pitch] = this.front ?? [DEFAULT_YAW, DEFAULT_PITCH];
    this.zoom = 1;
    this.render();
  }

  private render(): void {
    const w = this.el.clientWidth, hgt = this.canvas.clientHeight;
    if (!w || !hgt) return;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.localClippingEnabled = true;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    const d = (this.radius / Math.sin(THREE.MathUtils.degToRad(15))) * this.zoom;
    this.camera.position.set(
      this.center.x + Math.sin(this.yaw) * Math.cos(this.pitch) * d,
      this.center.y + Math.sin(this.pitch) * d,
      this.center.z + Math.cos(this.yaw) * Math.cos(this.pitch) * d);
    this.camera.near = d / 100;
    this.camera.far = d * 10;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.center);
    this.renderer.render(this.scene, this.camera);
  }

  private save(): void {
    if (this.el.classList.contains('picture')) {
      const a = h('a', { href: this.picture.src, download: `${this.name}.png` });
      document.body.append(a);
      a.click();
      a.remove();
      return;
    }
    if (!this.model) return;
    this.render();
    const a = h('a', { href: this.canvas.toDataURL('image/png'), download: `${this.name}.png` });
    document.body.append(a);
    a.click();
    a.remove();
  }
}

/** "001_E03_wait" -> "001 wait". */
function motionLabel(name: string): string {
  const m = /^(\d{3})_[^_]+_(.+)$/.exec(name);
  return m ? `${m[1]} ${m[2]}` : name;
}
