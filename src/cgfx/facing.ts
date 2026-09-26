// Facing of "board" models (flat pictures such as most tool items): the plane of their vertices, so the
// viewer and the photos can look at them straight from the front.
import * as THREE from 'three';

/** A model counts as a board when its thinnest spread is below this share of its widest one. */
const FLAT_RATIO = 0.05;

/** Eigen decomposition of a symmetric 3x3 matrix (Jacobi): eigenvalues and their unit vectors (columns). */
function eigenSym3(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0]![1]! ** 2 + a[0]![2]! ** 2 + a[1]![2]! ** 2;
    if (off < 1e-20) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p]![q]!;
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k]![p]!, akq = a[k]![q]!;
        a[k]![p] = c * akp - s * akq;
        a[k]![q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p]![k]!, aqk = a[q]![k]!;
        a[p]![k] = c * apk - s * aqk;
        a[q]![k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k]![p]!, vkq = v[k]![q]!;
        v[k]![p] = c * vkp - s * vkq;
        v[k]![q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0]![0]!, a[1]![1]!, a[2]![2]!], vectors: v };
}

/**
 * Normal of the plane the points lie in (xyz triples), or null when they are not flat. The normal points
 * to the side the faces look at (`faceNormal`, the sum of the triangle normals) when that is known,
 * otherwise to the side of `prefer`.
 */
export function boardNormal(points: ArrayLike<number>, faceNormal: [number, number, number] | null, prefer: [number, number, number] = [0, 0, 1]): [number, number, number] | null {
  const n = Math.floor(points.length / 3);
  if (n < 3) return null;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) {
    mx += points[i * 3]!;
    my += points[i * 3 + 1]!;
    mz += points[i * 3 + 2]!;
  }
  mx /= n;
  my /= n;
  mz /= n;
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const d = [points[i * 3]! - mx, points[i * 3 + 1]! - my, points[i * 3 + 2]! - mz];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) c[j]![k]! += d[j]! * d[k]!;
  }
  const { values, vectors } = eigenSym3(c);
  const order = [0, 1, 2].sort((x, y) => values[x]! - values[y]!);
  const min = Math.max(values[order[0]!]!, 0), max = values[order[2]!]!;
  if (!(max > 0) || Math.sqrt(min / max) > FLAT_RATIO) return null;
  const k = order[0]!;
  const normal: [number, number, number] = [vectors[0]![k]!, vectors[1]![k]!, vectors[2]![k]!];
  const dot = (u: [number, number, number]): number => u[0] * normal[0] + u[1] * normal[1] + u[2] * normal[2];
  const len = faceNormal ? Math.hypot(...faceNormal) : 0;
  // front and back faces of a two-sided board cancel out; fall back to the preferred side then
  const side = len > 1e-6 && Math.abs(dot(faceNormal!)) / len > 0.5 ? dot(faceNormal!) : dot(prefer);
  return side < 0 ? [-normal[0], -normal[1], -normal[2]] : normal;
}

/** World-space direction a board model faces (camera goes this way from its center), or null. */
export function boardFacing(model: THREE.Object3D, prefer: [number, number, number] = [0, 0, 1]): THREE.Vector3 | null {
  model.updateMatrixWorld(true);
  const pts: number[] = [];
  const face = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const idx = (g: THREE.BufferGeometry, i: number): number => (g.index ? g.index.getX(i) : i);
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const g = o.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const world = (i: number, v: THREE.Vector3): THREE.Vector3 => v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      world(i, a);
      pts.push(a.x, a.y, a.z);
    }
    const count = g.index ? g.index.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      world(idx(g, i), a);
      world(idx(g, i + 1), b);
      world(idx(g, i + 2), c);
      face.add(b.sub(a).cross(c.sub(a)));
    }
  });
  const n = boardNormal(pts, [face.x, face.y, face.z], prefer);
  return n ? new THREE.Vector3(...n) : null;
}
