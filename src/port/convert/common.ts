// Shared pieces of the converters: the games, bone matrices and the animation name prefixes.

import type { TitleKey } from '../../rom/titles';

/** The games looks are ported between (the first game, honolulu, not yet). */
export type PortTitle = 'kahara' | 'oahu' | 'lanai';

export const isPortTitle = (k: TitleKey): k is PortTitle => k === 'kahara' || k === 'oahu' || k === 'lanai';

/** The H3D header each H3D game's own files have. */
export const H3D_HEADER = {
  oahu: { backward: 8, forward: 8, converter: 39824, flags: 4 },
  lanai: { backward: 0x21, forward: 0x21, converter: 42921, flags: 5 },
} as const;

export type Mat34 = number[];

export const IDENTITY34: Mat34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** Row-major 3×4 matrix of T · Rz · Ry · Rx · S (the bones' convention in both formats). */
export function composeTRS(s: readonly number[], r: readonly number[], t: readonly number[]): Mat34 {
  const [cx, cy, cz] = [Math.cos(r[0]!), Math.cos(r[1]!), Math.cos(r[2]!)];
  const [sx, sy, sz] = [Math.sin(r[0]!), Math.sin(r[1]!), Math.sin(r[2]!)];
  const m = [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
  return [
    m[0]! * s[0]!, m[1]! * s[1]!, m[2]! * s[2]!, t[0]!,
    m[3]! * s[0]!, m[4]! * s[1]!, m[5]! * s[2]!, t[1]!,
    m[6]! * s[0]!, m[7]! * s[1]!, m[8]! * s[2]!, t[2]!,
  ];
}

export function mul34(a: Mat34, b: Mat34): Mat34 {
  const o: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++) o.push(a[i * 4]! * b[j]! + a[i * 4 + 1]! * b[4 + j]! + a[i * 4 + 2]! * b[8 + j]! + (j === 3 ? a[i * 4 + 3]! : 0));
  return o;
}

export function invert34(m: Mat34): Mat34 {
  const [a, b, c, d, e, f, g, h, i, j, k, l] = m as [number, number, number, number, number, number, number, number, number, number, number, number];
  const det = a * (f * k - g * j) - b * (e * k - g * i) + c * (e * j - f * i);
  const s = det ? 1 / det : 0;
  const r = [
    (f * k - g * j) * s, (c * j - b * k) * s, (b * g - c * f) * s,
    (g * i - e * k) * s, (a * k - c * i) * s, (c * e - a * g) * s,
    (e * j - f * i) * s, (b * i - a * j) * s, (a * f - b * e) * s,
  ];
  return [
    r[0]!, r[1]!, r[2]!, -(r[0]! * d + r[1]! * h + r[2]! * l),
    r[3]!, r[4]!, r[5]!, -(r[3]! * d + r[4]! * h + r[5]! * l),
    r[6]!, r[7]!, r[8]!, -(r[6]! * d + r[7]! * h + r[8]! * l),
  ];
}

export interface BonePose {
  parent: number;
  scale: readonly number[];
  rotation: readonly number[];
  translation: readonly number[];
  /** Maya segment scale compensate: the parent's scale is not passed on to the rotation and scale. */
  ssc: boolean;
}

/** Local matrices of bones (with segment scale compensation). */
export function localMatrix(b: BonePose, parent?: BonePose): Mat34 {
  const m = composeTRS(b.scale, b.rotation, b.translation);
  if (b.ssc && parent)
    for (let row = 0; row < 3; row++) {
      const k = parent.scale[row] ? 1 / parent.scale[row]! : 1;
      for (let col = 0; col < 3; col++) m[row * 4 + col]! *= k;
    }
  return m;
}

/** World matrices of a skeleton (parents before children not required). */
export function worldMatrices(bones: BonePose[]): Mat34[] {
  const out: Mat34[] = [];
  const get = (i: number, depth = 0): Mat34 => {
    if (out[i]) return out[i]!;
    const b = bones[i]!;
    const p = b.parent >= 0 && b.parent < bones.length && b.parent !== i && depth < 128 ? b.parent : -1;
    const local = localMatrix(b, p >= 0 ? bones[p] : undefined);
    return (out[i] = p >= 0 ? mul34(get(p, depth + 1), local) : local);
  };
  bones.forEach((_, i) => get(i));
  return out;
}

/** The motion key of an animation (the game plays animations by their first 4 bytes). */
export const motionKey = (name: string): string => name.slice(0, 4);

/** Motions RPG3 / RPG FREE! keep in the battle motion file (the others go into the model file). */
export const BATTLE_MOTIONS = new Set(['002_', '005_', '006_', '007_', '008_', '009_', '010_', '011_', '012_', '013_']);
