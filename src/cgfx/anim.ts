// CGFX animations (CANM, DATA dictionaries 9 skeletal / 10 material), and their evaluation.
// Layouts were read from the monster models (470D2848); docs/monster-motion.md §7.
import { cstr, f32, s32, u16, u32 } from '../util/bytes';

/** One curve segment: keys (frame, value, in slope, out slope) evaluated with the interpolation. */
export interface AnimCurve {
  start: number;
  end: number;
  /** 0 step, 1 linear, 2 hermite. */
  interp: number;
  keys: Float32Array;
}

/** A channel: a constant value, a curve, or null (not animated: keep the rest value). */
export type AnimChannel = number | AnimCurve | null;

export interface SkeletalTrack {
  bone: string;
  /** Curves (type 5): scale xyz, rotation xyz (radians), unused, translation xyz. */
  channels?: AnimChannel[];
  /** Baked (type 8): one value per frame from `start`. Quaternions xyzw, vectors xyz. */
  baked?: { start: number; rotation: Float32Array | null; translation: Float32Array | null; scale: Float32Array | null };
}

export interface MaterialTrack {
  material: string;
  coordinator: number;
  /** Translate / Scale of a texture coordinator (u, v). */
  target: 'translate' | 'scale';
  channels: [AnimChannel, AnimChannel];
}

export interface CgfxAnimation {
  name: string;
  kind: 'skeletal' | 'material';
  loop: boolean;
  frames: number;
  skeletal: SkeletalTrack[];
  material: MaterialTrack[];
}

const rel = (b: Uint8Array, o: number): number => {
  const v = u32(b, o);
  return v === 0 ? 0 : (o + v) >>> 0;
};

function dict(b: Uint8Array, o: number): { name: string; data: number }[] {
  const count = u32(b, o);
  const d = rel(b, o + 4);
  if (!count || !d) return [];
  const out: { name: string; data: number }[] = [];
  for (let i = 0; i < u32(b, d + 8); i++) {
    const e = d + 0x1c + i * 16;
    out.push({ name: cstr(b, rel(b, e + 8)), data: rel(b, e + 12) });
  }
  return out;
}

/**
 * Curve: {f32 start, f32 end, u32, u32, u32 segment count (1), rel segment}. Segment: {f32 start, f32 end,
 * u32 flags (bit0 constant, bits 2-4 interpolation, bits 5-7 quantization), constant value | u32 key count,
 * f32 1 / duration, [f32 value scale, f32 value offset, f32 frame scale], keys}. Slopes are not scaled.
 */
function readCurve(b: Uint8Array, c: number): AnimChannel {
  const s = rel(b, c + 0x14);
  if (!s) return null;
  const flags = u32(b, s + 8);
  if (flags & 1) return f32(b, s + 0x0c);
  const interp = (flags >> 2) & 7;
  const quant = flags >> 5;
  const n = u32(b, s + 0x0c);
  let o = s + 0x14;
  let scale = 1, offset = 0, frameScale = 1;
  if (quant !== 0 && quant !== 3 && quant !== 6) {
    scale = f32(b, o);
    offset = f32(b, o + 4);
    frameScale = f32(b, o + 8);
    o += 12;
  }
  const keys = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    let fr = 0, v = 0, si = 0, so = 0;
    switch (quant) {
      case 0: // Hermite128
        fr = f32(b, o); v = f32(b, o + 4); si = f32(b, o + 8); so = f32(b, o + 12); o += 16; break;
      case 1: { // Hermite64
        const w = u32(b, o);
        fr = w & 0xfff; v = w >>> 12; si = ((u16(b, o + 4) << 16) >> 16) / 256; so = ((u16(b, o + 6) << 16) >> 16) / 256; o += 8; break;
      }
      case 2: { // Hermite48
        const lo = u32(b, o), hi = u16(b, o + 4);
        fr = lo & 0xff; v = (lo >>> 8) & 0xfff;
        const a = ((lo >>> 20) & 0xfff), c2 = hi & 0xfff; // bits 20-31, 32-43 (bits 44-47 unused)
        si = ((a << 20) >> 20) / 32; so = ((c2 << 20) >> 20) / 32; o += 6; break;
      }
      case 3: // UnifiedHermite96
        fr = f32(b, o); v = f32(b, o + 4); si = so = f32(b, o + 8); o += 12; break;
      case 4: // UnifiedHermite48
        fr = u16(b, o) / 32; v = u16(b, o + 2); si = so = ((u16(b, o + 4) << 16) >> 16) / 256; o += 6; break;
      case 5: { // UnifiedHermite32
        const w = u32(b, o);
        fr = w & 0xff; v = (w >>> 8) & 0xfff; si = so = (s32(b, o) >> 20) / 32; o += 4; break;
      }
      case 6: // StepLinear64
        fr = f32(b, o); v = f32(b, o + 4); o += 8; break;
      default: { // StepLinear32
        const w = u32(b, o);
        fr = w & 0xfff; v = w >>> 12; o += 4;
      }
    }
    keys[i * 4] = fr * frameScale;
    keys[i * 4 + 1] = v * scale + offset;
    keys[i * 4 + 2] = si;
    keys[i * 4 + 3] = so;
  }
  return { start: f32(b, s), end: f32(b, s + 4), interp, keys };
}

/** Slots of an element: bit (constBase + i) = constant (value in the slot), bit (absentBase + i) = absent. */
function readSlots(b: Uint8Array, e: number, count: number, constBase: number, absentBase: number): AnimChannel[] {
  const flags = u32(b, e);
  const out: AnimChannel[] = [];
  for (let i = 0; i < count; i++) {
    const slot = e + 0x0c + i * 4;
    if (flags & (1 << (absentBase + i))) out.push(null);
    else if (flags & (1 << (constBase + i))) out.push(f32(b, slot));
    else out.push(rel(b, slot) ? readCurve(b, rel(b, slot)) : null);
  }
  return out;
}

/** Baked values: {f32 start, f32 end, u32, u32 flags (bit0 = constant: one value), (end - start + 2) x {value, u32 flags}}. */
function readBaked(b: Uint8Array, p: number, size: number): { start: number; values: Float32Array } | null {
  if (!p) return null;
  const start = f32(b, p);
  const n = u32(b, p + 0x0c) & 1 ? 1 : Math.max(0, Math.floor(f32(b, p + 4) - start)) + 2;
  const values = new Float32Array(n * size);
  for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) values[i * size + k] = f32(b, p + 0x10 + i * (size + 1) * 4 + k * 4);
  return { start, values };
}

const MATERIAL_PATH = /^Materials\["(.+)"\]\.TextureCoordinators\[(\d)\]\.(Translate|Scale)$/;

function readAnimation(b: Uint8Array, o: number, kind: 'skeletal' | 'material'): CgfxAnimation {
  const anim: CgfxAnimation = {
    name: cstr(b, rel(b, o + 8)),
    kind,
    loop: b[o + 0x10] === 1,
    frames: f32(b, o + 0x14),
    skeletal: [],
    material: [],
  };
  for (const { name, data: e } of dict(b, o + 0x18)) {
    const type = u32(b, e + 8);
    if (kind === 'skeletal' && type === 5) {
      anim.skeletal.push({ bone: name, channels: readSlots(b, e, 10, 6, 16) });
    } else if (kind === 'skeletal' && type === 8) {
      const rot = readBaked(b, rel(b, e + 0x0c), 4);
      const tr = readBaked(b, rel(b, e + 0x10), 3);
      const sc = readBaked(b, rel(b, e + 0x14), 3);
      anim.skeletal.push({
        bone: name,
        baked: { start: rot?.start ?? tr?.start ?? sc?.start ?? 0, rotation: rot?.values ?? null, translation: tr?.values ?? null, scale: sc?.values ?? null },
      });
    } else if (kind === 'material' && type === 3) {
      const m = MATERIAL_PATH.exec(name);
      if (!m) continue;
      const [u, v] = readSlots(b, e, 2, 0, 2);
      anim.material.push({ material: m[1]!, coordinator: Number(m[2]), target: m[3] === 'Scale' ? 'scale' : 'translate', channels: [u ?? null, v ?? null] });
    }
  }
  return anim;
}

/** Skeletal and material animations of a CGFX file (DATA at `data`). */
export function readAnimations(b: Uint8Array, data: number): CgfxAnimation[] {
  const dicts = data + 8;
  return [
    ...dict(b, dicts + 9 * 8).map((e) => readAnimation(b, e.data, 'skeletal')),
    ...dict(b, dicts + 10 * 8).map((e) => readAnimation(b, e.data, 'material')),
  ];
}

// ---- evaluation

export function evalChannel(ch: AnimChannel, frame: number, rest: number): number {
  if (ch === null) return rest;
  if (typeof ch === 'number') return ch;
  const k = ch.keys;
  const n = k.length / 4;
  if (!n) return rest;
  if (frame <= k[0]!) return k[1]!;
  if (frame >= k[(n - 1) * 4]!) return k[(n - 1) * 4 + 1]!;
  let i = 0;
  while (i < n - 2 && frame >= k[(i + 1) * 4]!) i++;
  const f0 = k[i * 4]!, v0 = k[i * 4 + 1]!, out0 = k[i * 4 + 3]!;
  const f1 = k[i * 4 + 4]!, v1 = k[i * 4 + 5]!, in1 = k[i * 4 + 6]!;
  const d = f1 - f0;
  if (d <= 0 || ch.interp === 0) return v0;
  const t = (frame - f0) / d;
  if (ch.interp === 1) return v0 + (v1 - v0) * t;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * out0 * d + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * in1 * d;
}

/** Baked value at a frame (linear between frames), written to out[0..size). */
export function evalBaked(values: Float32Array, size: number, start: number, frame: number, out: number[]): void {
  const n = values.length / size;
  const f = Math.max(0, Math.min(n - 1, frame - start));
  const i = Math.min(n - 2, Math.floor(f));
  const t = n > 1 ? f - Math.max(0, i) : 0;
  const a = Math.max(0, i) * size, c = Math.min(n - 1, Math.max(0, i) + 1) * size;
  for (let k = 0; k < size; k++) out[k] = values[a + k]! + (values[c + k]! - values[a + k]!) * t;
}
