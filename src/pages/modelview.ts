// Models of the books: a "photo" (rendered thumbnail, cached as a data URL) and an interactive viewer
// (drag to turn, wheel to zoom, save as PNG).
import * as THREE from 'three';
import { ModelFactory } from '../cgfx/three';
import type { TilesetModels } from '../cgfx/tileset';
import { renderObjectThumb } from '../editor/thumbs';
import { h } from '../editor/dom';
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

const photos = new Map<string, Promise<string | null>>();
/** Thumbnails are made one at a time so the list stays responsive. */
let chain: Promise<unknown> = Promise.resolve();

/** A photo (data URL) of a model, or null when it has none. */
export function modelPhoto(ref: ModelRef): Promise<string | null> {
  let p = photos.get(ref.key);
  if (!p) {
    const idbKey = `photo/${ref.key}/v3`;
    p = (async () => {
      const cached = await idbGet<string>(idbKey).catch(() => undefined);
      if (cached !== undefined) return cached || null;
      const job = chain.then(async () => {
        const f = await factoryOf(ref);
        if (f && 'image' in f) return f.image;
        const m = f ? f.factory.instance(f.hash) : null;
        return f && m ? renderObjectThumb(f.factory, m) : null;
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

/** An <img> that gets the photo once it scrolls into view. */
export function lazyPhoto(ref: ModelRef | null, cls = 'photo'): HTMLElement {
  const box = h('span', { class: cls });
  if (!ref) return box;
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    modelPhoto(ref).then((url) => {
      if (url) box.append(h('img', { src: url, alt: '' }));
    });
  });
  io.observe(box);
  return box;
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
  private yaw = 0.6;
  private pitch = 0.25;
  private zoom = 1;
  private name = 'model';
  private token = 0;

  constructor() {
    this.el.append(this.canvas, this.picture, this.note,
      h('div', { class: 'viewer-bar' },
        h('button', { title: '向きと大きさを戻す', onclick: () => this.reset() }, '正面'),
        h('button', { title: 'PNG で保存', onclick: () => this.save() }, '写真を保存')));
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      let x = e.clientX, y = e.clientY;
      const move = (ev: PointerEvent): void => {
        this.yaw -= (ev.clientX - x) * 0.01;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (ev.clientY - y) * 0.01));
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
    const m = f?.factory.instance(f.hash) ?? null;
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
    this.reset();
  }

  private reset(): void {
    this.yaw = 0.6;
    this.pitch = 0.25;
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
