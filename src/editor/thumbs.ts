// Thumbnails of tile models for the palette (rendered once per tileset with a small offscreen renderer).
import * as THREE from 'three';
import type { ModelFactory } from '../cgfx/three';

let renderer: THREE.WebGLRenderer | null = null;
const SIZE = 96;

export function renderThumb(factory: ModelFactory, hash: number): string | null {
  const model = factory.instance(hash);
  if (!model) return null;
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
  // Slightly tilted top view; north (-Z) is up like the 2D view.
  const cam = new THREE.OrthographicCamera(-290, 290, 290, -290, 1, 5000);
  cam.position.set(0, 1500, 420);
  cam.lookAt(0, 0, 0);
  const saved = factory.clipping.map((p) => p.constant);
  for (const p of factory.clipping) p.constant = 1e9;
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  factory.clipping.forEach((p, i) => (p.constant = saved[i]!));
  return renderer.domElement.toDataURL('image/png');
}
