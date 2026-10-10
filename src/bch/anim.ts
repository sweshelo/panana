// H3D animations (backward compatibility 8) -> the CGFX animation structures (cgfx/anim.ts) that cgfx/player.ts
// plays. Layouts follow SPICA (H3DAnimation, H3DAnimationElement, H3DAnimTransform, H3DAnimQuatTransform,
// H3DFloatKeyFrameGroup before version 0x20, KeyFrameQuantizationHelper).
import type { AnimChannel, AnimCurve, CgfxAnimation, MaterialTrack, SkeletalTrack } from '../cgfx/anim';
import { cstr, f32, u16, u32 } from '../util/bytes';

const str = (b: Uint8Array, o: number): string => (u32(b, o) ? cstr(b, u32(b, o)) : '');

/**
 * Curve {f32 start, f32 end, u8 pre, u8 post, u16 index, segment}; segment {f32 start, f32 end, u8 interpolation,
 * u8 quantization, u16 key count, f32 1 / duration, f32 value scale, f32 value offset, f32 frame scale, keys}.
 * From version 0x20 (RPG FREE! has 0x21) the segment is in the curve, after the index: u8 interpolation,
 * u8 quantization, u16 key count, f32 value scale, f32 value offset, f32 frame scale, f32 1 / duration, keys.
 */
function readCurve(b: Uint8Array, c: number, version: number): AnimCurve | null {
  const inline = version >= 0x20;
  const s = inline ? c + 4 : u32(b, c + 0x0c);
  if (!s) return null;
  const interp = b[s + 8]!;
  const quant = b[s + 9]!;
  const n = u16(b, s + 0x0a);
  const at = inline ? 0x0c : 0x10;
  const scale = f32(b, s + at), offset = f32(b, s + at + 4), frameScale = f32(b, s + at + 8);
  let o = u32(b, s + 0x1c);
  if (!o) return null;
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
      case 2: { // Hermite48: u8 frame, u16 value, 2 x 12-bit slopes
        fr = b[o]!; v = u16(b, o + 1);
        const sl = b[o + 3]! | (b[o + 4]! << 8) | (b[o + 5]! << 16);
        si = ((sl << 20) >> 20) / 32; so = ((sl << 8) >> 20) / 32; o += 6; break;
      }
      case 3: // UnifiedHermite96
        fr = f32(b, o); v = f32(b, o + 4); si = so = f32(b, o + 8); o += 12; break;
      case 4: // UnifiedHermite48
        fr = u16(b, o) / 32; v = u16(b, o + 2); si = so = ((u16(b, o + 4) << 16) >> 16) / 256; o += 6; break;
      case 5: { // UnifiedHermite32: u8 frame, 12-bit value, 12-bit slope
        const w = b[o + 1]! | (b[o + 2]! << 8) | (b[o + 3]! << 16);
        fr = b[o]!; v = w & 0xfff; si = so = ((w << 8) >> 20) / 32; o += 4; break;
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
  return { start: f32(b, c), end: f32(b, c + 4), interp, keys };
}

/** Slots after a u32 of flags: bit (constBit + i) = a constant in the slot, bit (absentBit + i) = absent, else a curve. */
function readSlots(b: Uint8Array, o: number, slots: number[], constBits: number[], absentBits: number[], version: number): AnimChannel[] {
  const flags = u32(b, o);
  return slots.map((slot, i) => {
    const at = o + 4 + slot * 4;
    if (flags & (1 << absentBits[i]!)) return null;
    if (flags & (1 << constBits[i]!)) return f32(b, at);
    return u32(b, at) ? readCurve(b, u32(b, at), version) : null;
  });
}

// Transform: scale xyz (const bits 6-8), rotation xyz (9-11), translation xyz (13-15); absent bits 16-24.
const TRANSFORM_CONST = [6, 7, 8, 9, 10, 11, 13, 14, 15];
const TRANSFORM_ABSENT = [16, 17, 18, 19, 20, 21, 22, 23, 24];

/** Quaternion transform: flags (translation / rotation / scale constant bits 0-2, absent 3-5), 3 pointers. */
function readQuatTransform(b: Uint8Array, o: number): SkeletalTrack['baked'] {
  const flags = u32(b, o);
  const part = (i: number, size: number, constBit: number, absentBit: number): Float32Array | null => {
    if (flags & (1 << absentBit)) return null;
    let p = u32(b, o + 4 + i * 4);
    if (!p) return null;
    let n = 1;
    if (!(flags & (1 << constBit))) {
      n = u32(b, p + 0x10);
      p = u32(b, p + 0x0c);
      if (!p) return null;
    }
    const out = new Float32Array(n * size);
    for (let k = 0; k < n * size; k++) out[k] = f32(b, p + k * 4);
    return out;
  };
  return { start: 0, scale: part(0, 3, 2, 5), rotation: part(1, 4, 1, 4), translation: part(2, 3, 0, 3) };
}

// Primitive types (SPICA H3DPrimitiveType) and the material targets we play.
const PRIM = { vector2: 2, transform: 4, quatTransform: 7 };
const TEXCOORD_TARGETS: Record<number, [number, 'scale' | 'translate']> = {
  19: [0, 'scale'], 21: [0, 'translate'], 22: [1, 'scale'], 24: [1, 'translate'], 25: [2, 'scale'], 27: [2, 'translate'],
};

/** H3DAnimation: name, u8 type (0 skeletal, 1 material, 2 visibility), u8 flags (bit 0 loop), u16 curves, f32 frames, elements, metadata. */
function readAnimation(b: Uint8Array, o: number, kind: 'skeletal' | 'material', version: number): CgfxAnimation {
  const anim: CgfxAnimation = { name: str(b, o), kind, loop: (b[o + 5]! & 1) === 1, frames: f32(b, o + 8), skeletal: [], material: [] };
  const list = u32(b, o + 0x0c), count = u32(b, o + 0x10);
  for (let i = 0; list && i < count; i++) {
    // H3DAnimationElement: name, u16 target, u16 primitive type, content.
    const e = u32(b, list + i * 4);
    if (!e) continue;
    const name = str(b, e);
    const target = u16(b, e + 4), prim = u16(b, e + 6);
    const c = e + 8;
    if (kind === 'skeletal' && prim === PRIM.transform) {
      const ch = readSlots(b, c, [0, 1, 2, 3, 4, 5, 6, 7, 8], TRANSFORM_CONST, TRANSFORM_ABSENT, version);
      // The player's channels: scale xyz, rotation xyz, (unused), translation xyz.
      anim.skeletal.push({ bone: name, channels: [...ch.slice(0, 6), null, ...ch.slice(6)] });
    } else if (kind === 'skeletal' && prim === PRIM.quatTransform) {
      anim.skeletal.push({ bone: name, baked: readQuatTransform(b, c) });
    } else if (kind === 'material' && prim === PRIM.vector2 && TEXCOORD_TARGETS[target]) {
      const [coordinator, what] = TEXCOORD_TARGETS[target]!;
      const [u, v] = readSlots(b, c, [0, 1], [0, 1], [8, 9], version);
      const track: MaterialTrack = { material: name, coordinator, target: what, channels: [u ?? null, v ?? null] };
      anim.material.push(track);
    }
  }
  return anim;
}

/** The skeletal and material animations (pointers from the H3D root dictionaries). */
export function readBchAnimations(b: Uint8Array, skeletal: number[], material: number[], version = 8): CgfxAnimation[] {
  return [...skeletal.map((p) => readAnimation(b, p, 'skeletal', version)), ...material.map((p) => readAnimation(b, p, 'material', version))];
}
