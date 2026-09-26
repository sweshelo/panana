// Thumbnails of tile and object models for the palette and the add panel (rendered once per tileset with a small offscreen renderer).
import * as THREE from 'three';
import type { ModelFactory } from '../cgfx/three';

let renderer: THREE.WebGLRenderer | null = null;
const SIZE = 96;

export function renderThumb(factory: ModelFactory, hash: number): string | null {
  const model = factory.instance(hash);
  if (!model) return null;
  // Slightly tilted top view; north (-Z) is up like the 2D view.
  const cam = new THREE.OrthographicCamera(-290, 290, 290, -290, 1, 5000);
  cam.position.set(0, 1500, 420);
  cam.lookAt(0, 0, 0);
  return render(factory, model, cam);
}

/**
 * Thumbnail of an object (prop, gimmick) seen from the front and above, framed to its size. `dir` is the
 * direction from the model to the camera instead (e.g. straight at a board model).
 */
export function renderObjectThumb(factory: ModelFactory, model: THREE.Object3D, dir: THREE.Vector3 | null = null): string | null {
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1);
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, r * 0.1, r * 10);
  const d = (dir ?? new THREE.Vector3(0.55, 0.6, 1)).clone().normalize();
  if (Math.abs(d.y) > 0.999) cam.up.set(0, 0, -1); // straight down: north up
  cam.position.copy(center).add(d.multiplyScalar(r * 4));
  cam.lookAt(center);
  return render(factory, model, cam);
}

function render(factory: ModelFactory, model: THREE.Object3D, cam: THREE.Camera): string {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE, false);
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.4, 1, 0.3);
  scene.add(sun, model);
  const saved = factory.clipping.map((p) => p.constant);
  for (const p of factory.clipping) p.constant = 1e9;
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  factory.clipping.forEach((p, i) => (p.constant = saved[i]!));
  return renderer.domElement.toDataURL('image/png');
}
