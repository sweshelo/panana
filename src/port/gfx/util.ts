// Helpers over the CGFX object model for converters: decoded animation keys, vertex attributes, index buffers and
// the bone links of a skeleton.
import {
  GfxGLDataType, KeyFrameQuantization, type GfxAttribute, type GfxBone, type GfxCurveSegment, type GfxFaceDescriptor,
  type GfxRawKey, type GfxSkeleton, type GfxVertexBuffer,
} from './types';

/** A decoded key: frame, value and slopes (SPICA KeyFrame). */
export interface KeyFrame {
  frame: number;
  value: number;
  inSlope: number;
  outSlope: number;
}

/** Interpolation of a segment: 0 step, 1 linear, 2 hermite. */
export const segmentInterpolation = (s: GfxCurveSegment): number => (s.formatFlags >>> 2) & 7;
export const segmentQuantization = (s: GfxCurveSegment): KeyFrameQuantization => s.formatFlags >>> 5;

/** Divisor of the stored slopes per quantization (slopes are not scaled by the value scale). */
const SLOPE_DIV = [1, 256, 32, 1, 256, 32, 1, 1];
/** Divisor of the stored frames (UnifiedHermite48 keeps 5 fraction bits). */
const FRAME_DIV = [1, 1, 1, 1, 32, 1, 1, 1];

/** Keys of a segment, decoded (frame × frameScale, value × valueScale + valueOffset). */
export function decodeKeys(s: GfxCurveSegment): KeyFrame[] {
  const q = segmentQuantization(s);
  const d = SLOPE_DIV[q] ?? 1;
  return s.keys.map((k) => ({
    frame: (k.frame / (FRAME_DIV[q] ?? 1)) * s.frameScale,
    value: k.value * s.valueScale + s.valueOffset,
    inSlope: k.inSlope / d,
    outSlope: k.outSlope / d,
  }));
}

/**
 * A segment from decoded keys, stored without loss: Hermite128 (interpolation 2) or StepLinear64 (0 step / 1 linear).
 */
export function encodeSegment(keys: KeyFrame[], interpolation: 0 | 1 | 2, startFrame?: number, endFrame?: number): GfxCurveSegment {
  const start = startFrame ?? keys[0]?.frame ?? 0;
  const end = endFrame ?? keys[keys.length - 1]?.frame ?? 0;
  const quant = interpolation === 2 ? KeyFrameQuantization.Hermite128 : KeyFrameQuantization.StepLinear64;
  const raw: GfxRawKey[] = keys.map((k) => ({
    frame: k.frame,
    value: k.value,
    inSlope: interpolation === 2 ? k.inSlope : 0,
    outSlope: interpolation === 2 ? k.outSlope : 0,
  }));
  return {
    startFrame: start,
    endFrame: end,
    formatFlags: (quant << 5) | (interpolation << 2) | (keys.length === 1 ? 1 : 0),
    invDuration: end > start ? 1 / (end - start) : 1,
    valueScale: 1,
    valueOffset: 0,
    frameScale: 1,
    keys: raw,
  };
}

const FORMAT_SIZE: Record<number, number> = {
  [GfxGLDataType.GL_BYTE]: 1,
  [GfxGLDataType.GL_UNSIGNED_BYTE]: 1,
  [GfxGLDataType.GL_SHORT]: 2,
  [GfxGLDataType.GL_UNSIGNED_SHORT]: 2,
  [GfxGLDataType.GL_FLOAT]: 4,
};

/** Number of vertices of a shape's vertex buffers (the interleaved one), 0 without one. */
export function vertexCount(buffers: GfxVertexBuffer[]): number {
  for (const v of buffers) if (v.kind === 'interleaved' && v.vertexStride) return v.rawBuffer.length / v.vertexStride;
  return 0;
}

/**
 * Values of an attribute (elements per vertex, scale applied) of an interleaved buffer (`buffer` = its owner) or of
 * a stream of its own. Bone indices come out as stored (their scale is 1).
 */
export function attributeValues(attr: GfxAttribute, buffer?: { rawBuffer: Uint8Array; vertexStride: number }): Float32Array {
  const size = FORMAT_SIZE[attr.format];
  if (!size) throw new Error(`CGFX: attribute format ${attr.format}`);
  const raw = buffer ? buffer.rawBuffer : attr.rawBuffer;
  if (!raw) throw new Error('CGFX: attribute without data');
  const stride = buffer ? buffer.vertexStride : attr.elements * size;
  const n = Math.floor(raw.length / stride);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Float32Array(n * attr.elements);
  for (let i = 0; i < n; i++)
    for (let e = 0; e < attr.elements; e++) {
      const o = i * stride + (buffer ? attr.offset : 0) + e * size;
      let v = 0;
      switch (attr.format) {
        case GfxGLDataType.GL_BYTE: v = dv.getInt8(o); break;
        case GfxGLDataType.GL_UNSIGNED_BYTE: v = dv.getUint8(o); break;
        case GfxGLDataType.GL_SHORT: v = dv.getInt16(o, true); break;
        case GfxGLDataType.GL_UNSIGNED_SHORT: v = dv.getUint16(o, true); break;
        case GfxGLDataType.GL_FLOAT: v = dv.getFloat32(o, true); break;
      }
      out[i * attr.elements + e] = v * attr.scale;
    }
  return out;
}

/** Vertex indices of a face descriptor. */
export function faceIndices(fd: GfxFaceDescriptor): Uint16Array {
  const b = fd.rawBuffer;
  if (fd.format === GfxGLDataType.GL_UNSIGNED_SHORT) {
    const out = new Uint16Array(b.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = b[i * 2]! | (b[i * 2 + 1]! << 8);
    return out;
  }
  return Uint16Array.from(b);
}

/** Index buffer bytes (u8 when every index fits, as the NW4C tools write it, else u16). */
export function encodeIndices(indices: ArrayLike<number>): { format: GfxGLDataType; rawBuffer: Uint8Array } {
  let max = 0;
  for (let i = 0; i < indices.length; i++) max = Math.max(max, indices[i]!);
  if (max < 256) return { format: GfxGLDataType.GL_UNSIGNED_BYTE, rawBuffer: Uint8Array.from(indices as ArrayLike<number>) };
  const out = new Uint8Array(indices.length * 2);
  for (let i = 0; i < indices.length; i++) {
    out[i * 2] = indices[i]! & 0xff;
    out[i * 2 + 1] = indices[i]! >> 8;
  }
  return { format: GfxGLDataType.GL_UNSIGNED_SHORT, rawBuffer: out };
}

/**
 * Sets the bone pointers (parent, first child, previous / next sibling) and the root from parentIndex, as the NW4C
 * tools do (children in bone order).
 */
export function linkBones(s: GfxSkeleton): void {
  const bones: GfxBone[] = s.bones;
  for (const b of bones) b.parent = b.child = b.prevSibling = b.nextSibling = -1;
  const last = new Map<number, number>();
  bones.forEach((b, i) => {
    b.parent = b.parentIndex >= 0 ? b.parentIndex : -1;
    const prev = last.get(b.parentIndex);
    if (prev === undefined) {
      if (b.parentIndex >= 0) bones[b.parentIndex]!.child = i;
    } else {
      b.prevSibling = prev;
      bones[prev]!.nextSibling = i;
    }
    last.set(b.parentIndex, i);
  });
  s.rootBone = bones.findIndex((b) => b.parentIndex < 0);
}
