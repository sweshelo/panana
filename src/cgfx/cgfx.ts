// CGFX (bcmdl / bcres, revision 5) reader: models (shapes, meshes, materials, skeleton) and textures.
// Layout follows Ohana3DS-Rebirth CGFX.cs. Materials keep the PICA fragment pipeline settings (texture
// combiners, blending, alpha test) so they can be reproduced in a shader (cgfx/tev.ts).
import { ascii, cstr, f32, s32, u16, u32, u8 } from '../util/bytes';
import { readAnimations, type CgfxAnimation } from './anim';
import { decodeTexture, textureDataSize } from './texture';

export interface CgfxTexture {
  name: string;
  width: number;
  height: number;
  format: number;
  rgba: Uint8Array;
}

export interface CgfxMaterial {
  name: string;
  /** Referenced texture names for units 0..2 (null = none). */
  textures: (string | null)[];
  /** Wrap modes of unit 0 (0 clamp, 1 border, 2 repeat, 3 mirror). */
  wrapS: number;
  wrapT: number;
  /** Rasterization cull mode (0 never / 1 front / 2 back). */
  cull: number;
  /** Translucency kind (0 opaque, 1 translucent, 2 subtractive, 3 additive). */
  layer: number;
  blend: boolean;
  alphaTest: boolean;
  depthWrite: boolean;
  /** GPUREG_DEPTH_COLOR_MASK (0x107): depth test and its function (0 never … 4 less, 5 lequal … 7 gequal). */
  depthTest: { enabled: boolean; func: number };
  /** Texture coordinator 0 transform. */
  uv: { scaleU: number; scaleV: number; rotate: number; translateU: number; translateV: number };
  /** Texture units 0..2 (coordinator i feeds unit i). */
  units: TexUnit[];
  /** Texture combiner stages 0..5 (null when the material has no fragment shader). */
  tev: TevStage[] | null;
  /** Combiner buffer (source 0x0D): initial colour (0xFD) and the stages 0..3 that update it (0xE0). */
  tevBuffer: { color: number[]; updateRgb: number; updateA: number };
  /** GPUREG_COLOR_OPERATION / BLEND_FUNC (0x100 / 0x101), BLEND_COLOR (0x103). */
  blendFunc: BlendFunc | null;
  /** GPUREG_FRAGOP_ALPHA_TEST (0x104). */
  alphaFunc: { enabled: boolean; func: number; ref: number } | null;
  /** Rasterization polygon offset (units), or 0. */
  polygonOffset: number;
}

export interface TexUnit {
  name: string | null;
  wrapS: number;
  wrapT: number;
  /** UV set read by the coordinator (0..2). */
  source: number;
  scaleU: number;
  scaleV: number;
  rotate: number;
  translateU: number;
  translateV: number;
}

export interface TevStage {
  srcRgb: number[];
  srcA: number[];
  opRgb: number[];
  opA: number[];
  combRgb: number;
  combA: number;
  scaleRgb: number;
  scaleA: number;
  /** Constant colour, RGBA 0..1. */
  color: number[];
}

export interface BlendFunc {
  /** false = logic op (treated as no blending). */
  blend: boolean;
  eqRgb: number;
  eqA: number;
  srcRgb: number;
  dstRgb: number;
  srcA: number;
  dstA: number;
  color: number[];
}

export interface CgfxMesh {
  name: string;
  material: number;
  priority: number;
  visible: boolean;
  positions: Float32Array; // xyz
  normals: Float32Array | null;
  uvs: Float32Array | null; // uv0
  uvs1: Float32Array | null;
  uvs2: Float32Array | null;
  colors: Float32Array | null; // rgba 0..1
  indices: Uint32Array;
  /**
   * Skinning: 4 skeleton bone indices and weights per vertex (null when no vertex follows a bone). Positions
   * stay in the rest pose (rigid vertices are moved there too), so a vertex moves by
   * sum(weight x animated world x inverse rest world).
   */
  skinIndices: Uint16Array | null;
  skinWeights: Float32Array | null;
}

export interface CgfxBone {
  name: string;
  parent: number;
  scale: [number, number, number];
  /** Euler angles (radians), R = Rz * Ry * Rx. */
  rotation: [number, number, number];
  translation: [number, number, number];
}

export interface CgfxModel {
  name: string;
  meshes: CgfxMesh[];
  materials: CgfxMaterial[];
  /** Skeleton by bone index (empty without one). */
  bones: CgfxBone[];
  /** Animations of the file the model came from. */
  animations: CgfxAnimation[];
}

export interface CgfxFile {
  models: CgfxModel[];
  textures: CgfxTexture[];
}

type Mat34 = number[]; // row-major 3x4

const ATTR = { position: 0, normal: 1, tangent: 2, color: 3, uv0: 4, uv1: 5, uv2: 6, boneIndex: 7, boneWeight: 8 };

class Reader {
  constructor(readonly b: Uint8Array) {}
  u32 = (o: number): number => u32(this.b, o);
  s32 = (o: number): number => s32(this.b, o);
  f32 = (o: number): number => f32(this.b, o);
  /** Self-relative pointer; 0 stays 0. */
  rel = (o: number): number => {
    const v = this.u32(o);
    return v === 0 ? 0 : (o + v) >>> 0;
  };
  str = (o: number): string => {
    const p = this.rel(o);
    return p ? cstr(this.b, p) : '';
  };
  /** DICT reference {u32 count, rel offset} -> [{name, data}] */
  dict = (o: number): { name: string; data: number }[] => {
    const count = this.u32(o);
    const d = this.rel(o + 4);
    if (!count || !d) return [];
    if (ascii(this.b, d, 4) !== 'DICT') throw new Error('CGFX: DICT がありません');
    const out: { name: string; data: number }[] = [];
    const n = this.u32(d + 8);
    for (let i = 0; i < n; i++) {
      const e = d + 0x1c + i * 16; // after the header (12) and the root node (16)
      out.push({ name: this.str(e + 8), data: this.rel(e + 12) });
    }
    return out;
  };
  /** Pointer table {u32 count, rel table} -> absolute addresses. */
  ptrs = (count: number, table: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(this.rel(table + i * 4));
    return out;
  };
  mat = (o: number): Mat34 => {
    const m: number[] = [];
    for (let i = 0; i < 12; i++) m.push(this.f32(o + i * 4));
    return m;
  };
}

/** Column-vector 3x4 matrix of T * Rz * Ry * Rx * S. */
function composeTRS(sc: [number, number, number], rot: [number, number, number], t: [number, number, number]): Mat34 {
  const [cx, cy, cz] = rot.map(Math.cos) as [number, number, number];
  const [sx, sy, sz] = rot.map(Math.sin) as [number, number, number];
  // R = Rz * Ry * Rx
  const r = [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
  return [
    r[0]! * sc[0], r[1]! * sc[1], r[2]! * sc[2], t[0],
    r[3]! * sc[0], r[4]! * sc[1], r[5]! * sc[2], t[1],
    r[6]! * sc[0], r[7]! * sc[1], r[8]! * sc[2], t[2],
  ];
}

function mul34(a: Mat34, b: Mat34): Mat34 {
  const o: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++)
      o.push(a[i * 4]! * b[j]! + a[i * 4 + 1]! * b[4 + j]! + a[i * 4 + 2]! * b[8 + j]! + (j === 3 ? a[i * 4 + 3]! : 0));
  return o;
}

function transformPoint(m: Mat34, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
    m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
    m[8]! * x + m[9]! * y + m[10]! * z + m[11]!,
  ];
}
function transformDir(m: Mat34, x: number, y: number, z: number): [number, number, number] {
  return [m[0]! * x + m[1]! * y + m[2]! * z, m[4]! * x + m[5]! * y + m[6]! * z, m[8]! * x + m[9]! * y + m[10]! * z];
}

/** PICA command list -> register values (only the first write per register is kept). */
function picaRegs(b: Uint8Array, o: number, words: number): Map<number, number> {
  const regs = new Map<number, number>();
  let i = 0;
  while (i + 1 < words) {
    const param = u32(b, o + i * 4);
    const header = u32(b, o + i * 4 + 4);
    const id = header & 0xffff;
    const extra = (header >>> 20) & 0x7ff;
    const consecutive = header >>> 31;
    if (!regs.has(id)) regs.set(id, param);
    for (let j = 0; j < extra; j++) {
      const reg = consecutive ? id + j + 1 : id;
      const v = u32(b, o + (i + 2 + j) * 4);
      if (!regs.has(reg)) regs.set(reg, v);
    }
    i += 2 + extra;
    if (extra & 1) i++; // padding keeps 8-byte alignment
  }
  return regs;
}

function readTexture(r: Reader, o: number): CgfxTexture | null {
  // type, 'TXOB', revision, name, user data (2), height, width, glFormat, glType, mipmaps, texObj, location,
  // format, 3 x u32, data length, rel data ...
  if (ascii(r.b, o + 4, 4) !== 'TXOB') return null;
  const name = r.str(o + 0x0c);
  const height = r.u32(o + 0x18);
  const width = r.u32(o + 0x1c);
  const format = r.u32(o + 0x34);
  const length = r.u32(o + 0x44);
  const data = r.rel(o + 0x48);
  if (!data || !width || !height || format > 13) return null;
  const need = textureDataSize(format, width, height);
  if (length < need) return null;
  return { name, width, height, format, rgba: decodeTexture(r.b.subarray(data, data + need), width, height, format) };
}

function readMaterial(r: Reader, o: number): CgfxMaterial {
  const name = r.str(o + 0x0c);
  const layer = r.u32(o + 0x20);
  const cull = r.u32(o + 0x104);
  const depthFlags = r.u32(o + 0x118);
  const blendMode = r.u32(o + 0x12c);
  const coord = o + 0x16c; // 3 coordinators of 0x58 bytes
  const uv = {
    scaleU: r.f32(coord + 0x10),
    scaleV: r.f32(coord + 0x14),
    rotate: r.f32(coord + 0x18),
    translateU: r.f32(coord + 0x1c),
    translateV: r.f32(coord + 0x20),
  };
  const mappers = o + 0x16c + 3 * 0x58;
  const textures: (string | null)[] = [];
  let wrapS = 2, wrapT = 2;
  for (let i = 0; i < 3; i++) {
    const m = r.rel(mappers + i * 4);
    if (!m) {
      textures.push(null);
      continue;
    }
    const texRef = r.rel(m + 8);
    textures.push(texRef ? r.str(texRef + 0x18) || r.str(texRef + 0x0c) : null);
    if (i === 0) {
      const regs = picaRegs(r.b, m + 0x10, 13);
      const param = regs.get(0x83);
      if (param !== undefined) {
        wrapT = (param >> 8) & 7;
        wrapS = (param >> 12) & 7;
      }
    }
  }
  // Per-unit texture settings: coordinator i (source UV set + transform) and the mapper's wrap mode.
  const units: TexUnit[] = [];
  for (let i = 0; i < 3; i++) {
    const c = coord + i * 0x58;
    const m = r.rel(mappers + i * 4);
    let ws = 2, wt = 2;
    if (m) {
      const param = picaRegs(r.b, m + 0x10, 13).get([0x83, 0x93, 0x9b][i]!);
      if (param !== undefined) {
        wt = (param >> 8) & 7;
        ws = (param >> 12) & 7;
      }
    }
    units.push({
      name: textures[i] ?? null,
      wrapS: ws,
      wrapT: wt,
      source: r.u32(c) & 3,
      scaleU: r.f32(c + 0x10),
      scaleV: r.f32(c + 0x14),
      rotate: r.f32(c + 0x18),
      translateU: r.f32(c + 0x1c),
      translateV: r.f32(c + 0x20),
    });
  }

  // Fragment operations: blend commands follow the blend mode and colour (Ohana3DS).
  const blendRegs = picaRegs(r.b, o + 0x140, 5);
  const op = blendRegs.get(0x100);
  const bf = blendRegs.get(0x101);
  const bc = blendRegs.get(0x103) ?? 0;
  const blendFunc: BlendFunc | null =
    op === undefined || bf === undefined
      ? null
      : {
          blend: ((op >> 8) & 1) === 1,
          eqRgb: bf & 7,
          eqA: (bf >> 8) & 7,
          srcRgb: (bf >> 16) & 15,
          dstRgb: (bf >> 20) & 15,
          srcA: (bf >> 24) & 15,
          dstA: (bf >>> 28) & 15,
          color: [bc & 255, (bc >> 8) & 255, (bc >> 16) & 255, bc >>> 24].map((v) => v / 255),
        };

  // Fragment shader: combiner commands (6 words each, 0x1C apart) and the alpha test.
  let tev: TevStage[] | null = null;
  let alphaFunc: CgfxMaterial['alphaFunc'] = null;
  const tevBuffer: CgfxMaterial['tevBuffer'] = { color: [0, 0, 0, 0], updateRgb: 0, updateA: 0 };
  const fs = r.rel(o + 0x288);
  if (fs) {
    const bases = [0xc0, 0xc8, 0xd0, 0xd8, 0xf0, 0xf8];
    tev = bases.map((base, k) => {
      const regs = picaRegs(r.b, fs + 0x30 + k * 0x1c, 6);
      const src = regs.get(base) ?? 0x0f0f0f0f;
      const opr = regs.get(base + 1) ?? 0;
      const comb = regs.get(base + 2) ?? 0;
      const col = regs.get(base + 3) ?? 0;
      const sc = regs.get(base + 4) ?? 0;
      return {
        srcRgb: [src & 15, (src >> 4) & 15, (src >> 8) & 15],
        srcA: [(src >> 16) & 15, (src >> 20) & 15, (src >> 24) & 15],
        opRgb: [opr & 15, (opr >> 4) & 15, (opr >> 8) & 15],
        opA: [(opr >> 12) & 7, (opr >> 15) & 7, (opr >> 18) & 7],
        combRgb: comb & 15,
        combA: (comb >> 16) & 15,
        scaleRgb: sc & 3,
        scaleA: (sc >> 16) & 3,
        color: [col & 255, (col >> 8) & 255, (col >> 16) & 255, col >>> 24].map((v) => v / 255),
      };
    });
    // Alpha test, then the combiner buffer colour and update flags.
    const after = picaRegs(r.b, fs + 0x30 + 5 * 0x1c + 0x18, 6);
    const at = after.get(0x104);
    if (at !== undefined) alphaFunc = { enabled: (at & 1) === 1, func: (at >> 4) & 7, ref: ((at >> 8) & 255) / 255 };
    const bc = after.get(0xfd);
    if (bc !== undefined) tevBuffer.color = [bc & 255, (bc >> 8) & 255, (bc >> 16) & 255, bc >>> 24].map((v) => v / 255);
    const up = after.get(0xe0);
    if (up !== undefined) {
      tevBuffer.updateRgb = (up >> 8) & 15;
      tevBuffer.updateA = (up >> 12) & 15;
    }
  }
  const depth = picaRegs(r.b, o + 0x11c, 2).get(0x107);
  const depthTest = depth === undefined ? { enabled: true, func: 5 } : { enabled: (depth & 1) === 1, func: (depth >> 4) & 7 };
  const polygonOffset = r.u32(o + 0x100) & 1 ? r.f32(o + 0x108) || 1 : 0;

  return {
    units,
    tev,
    tevBuffer,
    blendFunc,
    alphaFunc,
    polygonOffset,
    name,
    textures,
    wrapS,
    wrapT,
    cull,
    layer,
    blend: blendMode === 1 || blendMode === 2,
    alphaTest: layer === 0,
    depthWrite: (depthFlags & 2) !== 0,
    depthTest,
    uv,
  };
}

interface Attr {
  usage: number;
  type: number; // 0 s8, 1 u8, 2 s16, 6 f32
  elements: number;
  scale: number;
  offset: number;
  /** Fixed (constant) attribute value. */
  fixed?: number[];
}

function readValue(b: Uint8Array, o: number, a: Attr, out: number[]): void {
  for (let i = 0; i < 4; i++) out[i] = i === 3 ? 1 : 0;
  for (let i = 0; i < a.elements && i < 4; i++) {
    switch (a.type) {
      case 0: out[i] = (b[o + i]! << 24) >> 24; break;
      case 1: out[i] = b[o + i]!; break;
      case 2: out[i] = (u16(b, o + i * 2) << 16) >> 16; break;
      case 6: out[i] = f32(b, o + i * 4); break;
    }
  }
}

function readModel(r: Reader, o: number): CgfxModel {
  const flags = r.u32(o);
  const name = r.str(o + 0x0c);
  const objCount = r.u32(o + 0xb4);
  const objTable = r.rel(o + 0xb8);
  const materials = r.dict(o + 0xbc).map((e) => readMaterial(r, e.data));
  const shapeCount = r.u32(o + 0xc4);
  const shapeTable = r.rel(o + 0xc8);
  const objectNodes = r.dict(o + 0xcc).map((e) => ({ name: r.str(e.data), visible: r.u32(e.data + 4) === 1 }));

  // Skeleton: bone world matrices (rigid skinning moves vertices by these). The stored world matrix is
  // often empty, so compose scale / rotation / translation up the parent chain (like Ohana3DS).
  const boneWorld: Mat34[] = [];
  const skeleton: CgfxBone[] = [];
  if (flags & 0x80) {
    const sk = r.rel(o + 0xe0);
    const bones: { parent: number; local: Mat34 }[] = [];
    if (sk)
      for (const e of r.dict(sk + 0x18)) {
        const b = e.data;
        const v = (off: number): [number, number, number] => [r.f32(b + off), r.f32(b + off + 4), r.f32(b + off + 8)];
        const index = r.u32(b + 8);
        bones[index] = { parent: r.s32(b + 0x0c), local: composeTRS(v(0x20), v(0x2c), v(0x38)) };
        skeleton[index] = { name: e.name, parent: r.s32(b + 0x0c), scale: v(0x20), rotation: v(0x2c), translation: v(0x38) };
      }
    const world = (i: number, depth = 0): Mat34 => {
      if (boneWorld[i]) return boneWorld[i]!;
      const bone = bones[i]!;
      const m = bone.parent >= 0 && bones[bone.parent] && depth < 64 ? mul34(world(bone.parent, depth + 1), bone.local) : bone.local;
      boneWorld[i] = m;
      return m;
    };
    bones.forEach((b, i) => b && world(i));
  }

  const shapes = r.ptrs(shapeCount, shapeTable).map((s) => readShape(r, s, boneWorld));
  const meshes: CgfxMesh[] = [];
  for (const m of r.ptrs(objCount, objTable)) {
    const shapeIndex = r.u32(m + 0x18);
    const material = r.u32(m + 0x1c);
    const visibleFlag = u8(r.b, m + 0x24) & 1;
    const priority = u8(r.b, m + 0x25);
    const nodeIndex = u16(r.b, m + 0x26);
    const node = objectNodes[nodeIndex];
    const shape = shapes[shapeIndex];
    if (!shape) continue;
    meshes.push({
      ...shape,
      name: node?.name ?? r.str(m + 0x0c),
      material,
      priority,
      visible: node ? node.visible : visibleFlag === 1,
    });
  }
  for (let i = 0; i < skeleton.length; i++) skeleton[i] ??= { name: '', parent: -1, scale: [1, 1, 1], rotation: [0, 0, 0], translation: [0, 0, 0] };
  return { name, meshes, materials, bones: skeleton, animations: [] };
}

type Shape = Omit<CgfxMesh, 'name' | 'material' | 'priority' | 'visible'>;

function readShape(r: Reader, s: number, boneWorld: Mat34[]): Shape {
  const posOffset = [r.f32(s + 0x20), r.f32(s + 0x24), r.f32(s + 0x28)];
  const faceCount = r.u32(s + 0x2c);
  const faceTable = r.rel(s + 0x30);
  const vgCount = r.u32(s + 0x38);
  const vgTable = r.rel(s + 0x3c);

  // Vertex buffers: one interleaved buffer (0x40000002, its attributes are 0x40000001) + fixed attributes
  // (0x80000000).
  let vbuf = 0, stride = 0;
  const attrs: Attr[] = [];
  for (const vg of r.ptrs(vgCount, vgTable)) {
    const type = r.u32(vg);
    if (type === 0x40000002) {
      vbuf = r.rel(vg + 0x18);
      stride = r.u32(vg + 0x24);
      for (const a of r.ptrs(r.u32(vg + 0x28), r.rel(vg + 0x2c))) {
        attrs.push({
          usage: r.u32(a + 4),
          type: r.u32(a + 0x24) & 0xf,
          elements: r.u32(a + 0x28),
          scale: r.f32(a + 0x2c),
          offset: r.u32(a + 0x30),
        });
      }
    } else if (type === 0x80000000) {
      // {type, usage, flags, GL format, elements, scale (0 = 1), value count, rel values}
      const usage = r.u32(vg + 4);
      const elements = r.u32(vg + 0x10);
      const scale = r.f32(vg + 0x14);
      const count = r.u32(vg + 0x18);
      const values = r.rel(vg + 0x1c);
      const fixed: number[] = [0, 0, 0, 1];
      if (values) for (let i = 0; i < Math.min(count, 4); i++) fixed[i] = r.f32(values + i * 4);
      attrs.push({ usage, type: 6, elements, scale: scale || 1, offset: 0, fixed });
    }
  }

  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], uv1: number[] = [], uv2: number[] = [], col: number[] = [], idx: number[] = [];
  const skinIdx: number[] = [], skinW: number[] = [];
  let skinned = false;
  const has = (u: number): boolean => attrs.some((a) => a.usage === u);
  const tmp = [0, 0, 0, 0];
  const vmap = new Map<number, number>(); // (face group, vertex index) -> output vertex

  for (const fg of r.ptrs(faceCount, faceTable)) {
    const nodeCount = r.u32(fg);
    const nodeList = r.rel(fg + 4);
    const skinning = r.u32(fg + 8);
    const nodes: number[] = [];
    for (let i = 0; i < nodeCount; i++) nodes.push(r.u32(nodeList + i * 4));
    vmap.clear();
    for (const fm of r.ptrs(r.u32(fg + 0x0c), r.rel(fg + 0x10))) {
      for (const fd of r.ptrs(r.u32(fm), r.rel(fm + 4))) {
        const shortIdx = (r.u32(fd) & 2) !== 0;
        const len = r.u32(fd + 8);
        const data = r.rel(fd + 0x0c);
        const n = shortIdx ? len >> 1 : len;
        for (let i = 0; i < n; i++) {
          const vi = shortIdx ? u16(r.b, data + i * 2) : r.b[data + i]!;
          let out = vmap.get(vi);
          if (out === undefined) {
            out = pos.length / 3;
            vmap.set(vi, out);
            const base = vbuf + vi * stride;
            let p = [0, 0, 0], nn = [0, 1, 0], bone = -1;
            const bi = [-1, -1, -1, -1], bw = [0, 0, 0, 0];
            let hasWeights = false;
            let c = [1, 1, 1, 1], t = [0, 0], t1 = [0, 0], t2 = [0, 0];
            for (const a of attrs) {
              if (a.fixed) for (let k = 0; k < 4; k++) tmp[k] = a.fixed[k]! * a.scale;
              else {
                readValue(r.b, base + a.offset, a, tmp);
                for (let k = 0; k < 4; k++) tmp[k] = tmp[k]! * a.scale;
              }
              switch (a.usage) {
                case ATTR.position: p = [tmp[0]! + posOffset[0]!, tmp[1]! + posOffset[1]!, tmp[2]! + posOffset[2]!]; break;
                case ATTR.normal: nn = [tmp[0]!, tmp[1]!, tmp[2]!]; break;
                case ATTR.color: c = [tmp[0]!, tmp[1]!, tmp[2]!, a.elements > 3 || a.fixed ? tmp[3]! : 1]; break;
                case ATTR.uv0: t = [tmp[0]!, tmp[1]!]; break;
                case ATTR.uv1: t1 = [tmp[0]!, tmp[1]!]; break;
                case ATTR.uv2: t2 = [tmp[0]!, tmp[1]!]; break;
                case ATTR.boneIndex: {
                  // Bone indices are raw integers (the scale applies to other attributes only).
                  for (let k = 0; k < Math.min(a.elements, 4); k++) {
                    const raw = a.fixed ? a.fixed[k]! : tmp[k]! / (a.scale || 1);
                    bi[k] = nodes[Math.round(raw)] ?? -1;
                  }
                  bone = bi[0]!;
                  break;
                }
                case ATTR.boneWeight:
                  hasWeights = true;
                  for (let k = 0; k < Math.min(a.elements, 4); k++) bw[k] = tmp[k]!;
                  break;
              }
            }
            if (bone < 0 && nodes.length === 1) bone = bi[0] = nodes[0]!;
            // Rigid (and unskinned, single-bone) vertices follow one bone; smooth ones use the weights.
            if (skinning !== 2 || !hasWeights) {
              bw[0] = bone >= 0 ? 1 : 0;
              bw[1] = bw[2] = bw[3] = 0;
            }
            for (let k = 0; k < 4; k++) {
              if (bi[k]! < 0) bw[k] = 0;
              skinIdx.push(Math.max(0, bi[k]!));
              skinW.push(bw[k]!);
              if (bw[k]! > 0) skinned = true;
            }
            // Rigid skinning (and unskinned shapes bound to a single bone) are stored in bone space.
            if (skinning !== 2 && bone >= 0 && boneWorld[bone]) {
              p = transformPoint(boneWorld[bone]!, p[0]!, p[1]!, p[2]!);
              nn = transformDir(boneWorld[bone]!, nn[0]!, nn[1]!, nn[2]!);
            }
            pos.push(p[0]!, p[1]!, p[2]!);
            nrm.push(nn[0]!, nn[1]!, nn[2]!);
            uv.push(t[0]!, t[1]!);
            uv1.push(t1[0]!, t1[1]!);
            uv2.push(t2[0]!, t2[1]!);
            col.push(c[0]!, c[1]!, c[2]!, c[3]!);
          }
          idx.push(out);
        }
      }
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: has(ATTR.normal) ? new Float32Array(nrm) : null,
    uvs: has(ATTR.uv0) ? new Float32Array(uv) : null,
    uvs1: has(ATTR.uv1) ? new Float32Array(uv1) : null,
    uvs2: has(ATTR.uv2) ? new Float32Array(uv2) : null,
    colors: has(ATTR.color) ? new Float32Array(col) : null,
    indices: new Uint32Array(idx),
    skinIndices: skinned ? new Uint16Array(skinIdx) : null,
    skinWeights: skinned ? new Float32Array(skinW) : null,
  };
}

/** Parse a CGFX file (bytes must start at the 'CGFX' magic). */
export function parseCgfx(b: Uint8Array): CgfxFile {
  if (ascii(b, 0, 4) !== 'CGFX') throw new Error('CGFX ではありません');
  const r = new Reader(b);
  const data = u16(b, 6); // header length
  if (ascii(b, data, 4) !== 'DATA') throw new Error('CGFX: DATA がありません');
  const dicts = data + 8;
  const models = r.dict(dicts).map((e) => readModel(r, e.data));
  const animations = readAnimations(b, data);
  for (const m of models) m.animations = animations;
  const textures: CgfxTexture[] = [];
  for (const e of r.dict(dicts + 8)) {
    const t = readTexture(r, e.data);
    if (t) textures.push(t);
  }
  return { models, textures };
}

/** t8.bin entries in model archives: 0x180-byte header (path at +0x54, UTF-16) + CGFX. */
export function unwrapT8(b: Uint8Array): { path: string; cgfx: Uint8Array } {
  let path = '';
  for (let o = 0x54; o + 1 < 0x180; o += 2) {
    const c = b[o]! | (b[o + 1]! << 8);
    if (!c) break;
    path += String.fromCharCode(c);
  }
  const start = ascii(b, 0x180, 4) === 'CGFX' ? 0x180 : findMagic(b, 'CGFX');
  if (start < 0) throw new Error('CGFX が見つかりません');
  return { path, cgfx: b.subarray(start) };
}

function findMagic(b: Uint8Array, m: string): number {
  outer: for (let i = 0; i + 4 <= b.length; i += 4) {
    for (let j = 0; j < 4; j++) if (b[i + j] !== m.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}
