// BCH (H3D, the models of 電波人間のRPG3) reader: models (meshes, materials, skeleton) and textures, as the same
// structures as the CGFX reader (cgfx/cgfx.ts) so that cgfx/three.ts, cgfx/tev.ts and cgfx/player.ts draw them.
// Layouts follow SPICA (gdkchan, public domain) H3D for backward compatibility 8, the only version RPG3 has
// (converter 39824). naauao oahu/analysis.md §4: entry types 2 and 10 are BCH, type 8 is a 0x180-byte header + BCH.
import type { CgfxBone, CgfxFile, CgfxMaterial, CgfxMesh, CgfxModel, CgfxTexture, TevStage, TexUnit } from '../cgfx/cgfx';
import { decodeTexture, textureDataSize } from '../cgfx/texture';
import { ascii, cstr, f32, s16, u16, u32, u8 } from '../util/bytes';
import { readBchAnimations } from './anim';
import { readPica, type PicaState } from './pica';

export interface BchHeader {
  backward: number;
  forward: number;
  converter: number;
  contents: number;
  strings: number;
  commands: number;
  rawData: number;
  rawExt: number;
  relocation: number;
  contentsLength: number;
  stringsLength: number;
  commandsLength: number;
  rawDataLength: number;
  rawExtLength: number;
  relocationLength: number;
}

/** Where the BCH starts in `b` (0, or 0x180 for type 8 entries), or -1. */
export function bchOffset(b: Uint8Array): number {
  if (b.length >= 0x44 && ascii(b, 0, 4) === 'BCH\0') return 0;
  if (b.length >= 0x1c4 && ascii(b, 0x180, 4) === 'BCH\0') return 0x180;
  return -1;
}

export const isBch = (b: Uint8Array): boolean => bchOffset(b) >= 0;

export function readBchHeader(b: Uint8Array): BchHeader {
  if (ascii(b, 0, 4) !== 'BCH\0') throw new Error('BCH ではありません');
  const backward = b[4]!;
  const ext = backward >= 0x21;
  let o = 8;
  const next = (): number => {
    const v = u32(b, o);
    o += 4;
    return v;
  };
  const contents = next(), strings = next(), commands = next(), rawData = next();
  const rawExt = ext ? next() : 0;
  const relocation = next();
  const contentsLength = next(), stringsLength = next(), commandsLength = next(), rawDataLength = next();
  const rawExtLength = ext ? next() : 0;
  const relocationLength = next();
  return {
    backward, forward: b[5]!, converter: u16(b, 6), contents, strings, commands, rawData, rawExt, relocation,
    contentsLength, stringsLength, commandsLength, rawDataLength, rawExtLength, relocationLength,
  };
}

// Sections of the relocation table (SPICA H3DSection).
const enum Sec { Contents, Strings, Commands, CommandsSrc, RawData, RawDataTexture, RawDataVertex, RawDataIndex16, RawDataIndex8, RawExt, RawExtTexture, RawExtVertex, RawExtIndex16, RawExtIndex8 }

function sectionAddress(h: BchHeader, s: number): number {
  const ext = h.rawExt || h.rawData;
  switch (s) {
    case Sec.Contents: return h.contents;
    case Sec.Strings: return h.strings;
    case Sec.Commands: case Sec.CommandsSrc: return h.commands;
    case Sec.RawData: case Sec.RawDataTexture: case Sec.RawDataVertex: case Sec.RawDataIndex8: return h.rawData;
    case Sec.RawDataIndex16: return (h.rawData | 0x80000000) >>> 0;
    case Sec.RawExt: case Sec.RawExtTexture: case Sec.RawExtVertex: case Sec.RawExtIndex8: return ext;
    case Sec.RawExtIndex16: return (ext | 0x80000000) >>> 0;
  }
  return 0;
}

/**
 * A copy of the BCH with its pointers made absolute (offsets from the start of the BCH), as the game does after
 * loading it. Index buffer pointers get bit 31 when the indices are 16-bit.
 */
export function relocateBch(src: Uint8Array): { b: Uint8Array; h: BchHeader } {
  const h = readBchHeader(src);
  const b = src.slice();
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let o = 0; o < h.relocationLength; o += 4) {
    const v = u32(b, h.relocation + o);
    let ptr = v & 0x1ffffff;
    let target = (v >>> 25) & 0xf;
    const source = v >>> 29;
    // Older versions numbered the sections before RawDataVertex differently.
    if (h.backward > 7 && h.backward < 0x21 && target >= Sec.RawDataVertex) target--;
    else if (h.backward < 7 && target >= Sec.CommandsSrc) target++;
    if (target !== Sec.Strings) ptr <<= 2;
    const at = sectionAddress(h, source) + ptr;
    if (at + 4 > b.length) continue;
    dv.setUint32(at, (dv.getUint32(at, true) + sectionAddress(h, target)) >>> 0, true);
  }
  return { b, h };
}

class Reader {
  constructor(readonly b: Uint8Array) {}
  u32 = (o: number): number => u32(this.b, o);
  f32 = (o: number): number => f32(this.b, o);
  str = (o: number): string => {
    const p = this.u32(o);
    return p ? cstr(this.b, p) : '';
  };
  /** List {u32 pointer, u32 count} of pointers. */
  ptrList = (o: number): number[] => {
    const p = this.u32(o), n = this.u32(o + 4);
    const out: number[] = [];
    if (p) for (let i = 0; i < n; i++) out.push(this.u32(p + i * 4));
    return out;
  };
  /** List {u32 pointer, u32 count} of inline structs of `size` bytes. */
  inlineList = (o: number, size: number): number[] => {
    const p = this.u32(o), n = this.u32(o + 4);
    const out: number[] = [];
    if (p) for (let i = 0; i < n; i++) out.push(p + i * size);
    return out;
  };
  /** Command list {u32 pointer, u32 words}. */
  pica = (o: number): PicaState => {
    const p = this.u32(o), n = this.u32(o + 4);
    return p ? readPica(this.b, p, n) : { regs: new Map(), uniforms: new Map(), fixed: new Map() };
  };
  vec3 = (o: number): [number, number, number] => [this.f32(o), this.f32(o + 4), this.f32(o + 8)];
}

// ---- Textures

/** H3DTexture: 3 command lists (units 0-2), u8 format, u8 mipmaps, name. */
function readTexture(r: Reader, o: number): CgfxTexture | null {
  const cmd = r.pica(o);
  const name = r.str(o + 0x1c);
  const format = u8(r.b, o + 0x18);
  const dim = cmd.regs.get(0x82);
  const addr = cmd.regs.get(0x85);
  if (dim === undefined || addr === undefined || format > 13) return null;
  const height = dim & 0x7ff, width = (dim >>> 16) & 0x7ff;
  const need = textureDataSize(format, width, height);
  if (!width || !height || addr + need > r.b.length) return null;
  return { name, width, height, format, rgba: decodeTexture(r.b.subarray(addr, addr + need), width, height, format) };
}

// ---- Materials

const rgba = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24].map((x) => x / 255);

/**
 * H3DMaterial (0x58 bytes for versions before 0x21): params, 3 textures, texture commands, 3 mappers (0x10 each:
 * sampler, wrap U, wrap V, mag, min, LOD, bias, border), 3 texture names and the name.
 */
function readMaterial(r: Reader, o: number): CgfxMaterial {
  const params = r.u32(o);
  const names = [r.str(o + 0x48), r.str(o + 0x4c), r.str(o + 0x50)];
  const name = r.str(o + 0x54);
  const textures = names.map((n) => n || null);
  const mapper = (i: number): { wrapS: number; wrapT: number } => ({ wrapS: u8(r.b, o + 0x18 + i * 0x10 + 1), wrapT: u8(r.b, o + 0x18 + i * 0x10 + 2) });

  // H3DMaterialParams: 3 texture coordinators at +0x0C (0x18 each), colours at +0x58 (constants 0-5 at +0x6C),
  // constant assignment at +0xC0, polygon offset at +0xC4, fragment shader commands at +0xC8.
  const units: TexUnit[] = [];
  let tev: TevStage[] | null = null;
  let tevBuffer: CgfxMaterial['tevBuffer'] = { color: [0, 0, 0, 0], updateRgb: 0, updateA: 0 };
  let blendFunc: CgfxMaterial['blendFunc'] = null;
  let alphaFunc: CgfxMaterial['alphaFunc'] = null;
  let depthTest = { enabled: true, func: 5 };
  let depthWrite = true;
  let cull = 0;
  let polygonOffset = 0;
  const p = params || 0;
  const fs = p ? r.pica(p + 0xc8) : null;
  // Vertex uniform 10: the UV set each texture unit reads (0-2; higher = environment maps).
  const sources = fs?.uniforms.get(10) ?? [0, 1, 2, 2];
  for (let i = 0; i < 3; i++) {
    const c = p + 0x0c + i * 0x18;
    const src = Math.round(sources[i]!);
    units.push({
      name: textures[i] ?? null,
      ...mapper(i),
      source: src >= 0 && src <= 2 ? src : i,
      transform: p ? u8(r.b, c + 1) : 0,
      scaleU: p ? r.f32(c + 4) : 1,
      scaleV: p ? r.f32(c + 8) : 1,
      rotate: p ? r.f32(c + 0x0c) : 0,
      translateU: p ? r.f32(c + 0x10) : 0,
      translateV: p ? r.f32(c + 0x14) : 0,
    });
  }
  if (p && fs) {
    const constants = Array.from({ length: 6 }, (_, i) => rgba(r.u32(p + 0x6c + i * 4)));
    const assign = r.u32(p + 0xc0);
    const bases = [0xc0, 0xc8, 0xd0, 0xd8, 0xf0, 0xf8];
    tev = bases.map((base, k) => {
      const src = fs.regs.get(base) ?? 0x0f0f0f0f;
      const opr = fs.regs.get(base + 1) ?? 0;
      const comb = fs.regs.get(base + 2) ?? 0;
      const sc = fs.regs.get(base + 4) ?? 0;
      return {
        srcRgb: [src & 15, (src >> 4) & 15, (src >> 8) & 15],
        srcA: [(src >> 16) & 15, (src >> 20) & 15, (src >> 24) & 15],
        opRgb: [opr & 15, (opr >> 4) & 15, (opr >> 8) & 15],
        opA: [(opr >> 12) & 7, (opr >> 15) & 7, (opr >> 18) & 7],
        combRgb: comb & 15,
        combA: (comb >> 16) & 15,
        scaleRgb: sc & 3,
        scaleA: (sc >> 16) & 3,
        // The game sets each stage's constant from the material's constant colours by this assignment.
        color: constants[(assign >> (k * 4)) & 15] ?? rgba(fs.regs.get(base + 3) ?? 0),
      };
    });
    const bc = fs.regs.get(0xfd);
    const up = fs.regs.get(0xe0) ?? 0;
    tevBuffer = { color: bc === undefined ? [0, 0, 0, 0] : rgba(bc), updateRgb: (up >> 8) & 15, updateA: (up >> 12) & 15 };
    const op = fs.regs.get(0x100);
    const bf = fs.regs.get(0x101);
    if (op !== undefined && bf !== undefined)
      blendFunc = {
        blend: ((op >> 8) & 1) === 1,
        eqRgb: bf & 7,
        eqA: (bf >> 8) & 7,
        srcRgb: (bf >> 16) & 15,
        dstRgb: (bf >> 20) & 15,
        srcA: (bf >> 24) & 15,
        dstA: (bf >>> 28) & 15,
        color: rgba(r.u32(p + 0x84)),
      };
    const at = fs.regs.get(0x104);
    if (at !== undefined) alphaFunc = { enabled: (at & 1) === 1, func: (at >> 4) & 7, ref: ((at >> 8) & 255) / 255 };
    const depth = fs.regs.get(0x107);
    if (depth !== undefined) {
      depthTest = { enabled: (depth & 1) === 1, func: (depth >> 4) & 7 };
      depthWrite = ((depth >> 12) & 1) === 1;
    }
    const dw = fs.regs.get(0x115);
    if (dw !== undefined) depthWrite &&= (dw & 2) !== 0;
    cull = fs.regs.get(0x40) ?? 0;
    if (u16(r.b, p + 4) & 0x20) polygonOffset = r.f32(p + 0xc4) || 1;
  }
  const u0 = units[0]!;
  const blend = !!blendFunc?.blend && !(blendFunc.srcRgb === 1 && blendFunc.dstRgb === 0);
  return {
    name,
    textures,
    wrapS: u0.wrapS,
    wrapT: u0.wrapT,
    cull,
    layer: 0, // set from the meshes (H3D keeps the render layer on the mesh)
    blend,
    alphaTest: !blend,
    depthWrite,
    depthTest,
    uv: { scaleU: u0.scaleU, scaleV: u0.scaleV, rotate: u0.rotate, translateU: u0.translateU, translateV: u0.translateV },
    units,
    tev,
    tevBuffer,
    blendFunc,
    alphaFunc,
    polygonOffset,
  };
}

// ---- Skeleton

type Mat34 = number[];

function composeTRS(sc: [number, number, number], rot: [number, number, number], t: [number, number, number]): Mat34 {
  const [cx, cy, cz] = rot.map(Math.cos) as [number, number, number];
  const [sx, sy, sz] = rot.map(Math.sin) as [number, number, number];
  const m = [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
  return [
    m[0]! * sc[0], m[1]! * sc[1], m[2]! * sc[2], t[0],
    m[3]! * sc[0], m[4]! * sc[1], m[5]! * sc[2], t[1],
    m[6]! * sc[0], m[7]! * sc[1], m[8]! * sc[2], t[2],
  ];
}

function mul34(a: Mat34, b: Mat34): Mat34 {
  const o: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++)
      o.push(a[i * 4]! * b[j]! + a[i * 4 + 1]! * b[4 + j]! + a[i * 4 + 2]! * b[8 + j]! + (j === 3 ? a[i * 4 + 3]! : 0));
  return o;
}

const apply = (m: Mat34, x: number, y: number, z: number, w: number): [number, number, number] => [
  m[0]! * x + m[1]! * y + m[2]! * z + m[3]! * w,
  m[4]! * x + m[5]! * y + m[6]! * z + m[7]! * w,
  m[8]! * x + m[9]! * y + m[10]! * z + m[11]! * w,
];

/** H3DBone (0x64 bytes): flags, s16 parent, scale, rotation, translation, inverse bind matrix, name. */
function readBones(r: Reader, model: number): CgfxBone[] {
  return r.inlineList(model + 0x70, 0x64).map((o) => ({
    name: r.str(o + 0x5c),
    parent: s16(r.b, o + 4),
    scale: r.vec3(o + 8),
    rotation: r.vec3(o + 0x14),
    translation: r.vec3(o + 0x20),
  }));
}

function worldMatrices(bones: CgfxBone[]): Mat34[] {
  const world: Mat34[] = [];
  const get = (i: number, depth = 0): Mat34 => {
    if (world[i]) return world[i]!;
    const b = bones[i]!;
    const local = composeTRS(b.scale, b.rotation, b.translation);
    const m = b.parent >= 0 && b.parent < bones.length && b.parent !== i && depth < 64 ? mul34(get(b.parent, depth + 1), local) : local;
    world[i] = m;
    return m;
  };
  bones.forEach((_, i) => get(i));
  return world;
}

// ---- Meshes

// PICA attribute names (SPICA PICAAttributeName).
const ATTR = { position: 0, normal: 1, tangent: 2, color: 3, uv0: 4, uv1: 5, uv2: 6, boneIndex: 7, boneWeight: 8 };

interface Attr {
  name: number;
  /** 0 s8, 1 u8, 2 s16, 3 f32. */
  format: number;
  elements: number;
  scale: number;
  offset: number;
}

const FORMAT_SIZE = [1, 1, 2, 4];

/** Vertex layout of a mesh from its enable commands (SPICA H3DMesh.Deserialize). */
function vertexLayout(cmd: PicaState): { address: number; stride: number; attrs: Attr[]; fixed: Map<number, number[]>; posOffset: number[] } {
  const g = (r: number): number => cmd.regs.get(r) ?? 0;
  const formats = BigInt(g(0x201)) | (BigInt(g(0x202)) << 32n);
  const attributes = BigInt(g(0x204)) | (BigInt(g(0x205) & 0xffff) << 32n);
  const stride = (g(0x205) >>> 16) & 0xff;
  const permutation = BigInt(g(0x2bb)) | (BigInt(g(0x2bc)) << 32n);
  const total = (cmd.regs.get(0x242) ?? -1) + 1;
  const u7 = cmd.uniforms.get(7) ?? [1, 1, 1, 1];
  const u8v = cmd.uniforms.get(8) ?? [1, 1, 1, 1];
  const scaleOf = (n: number): number =>
    [u7[0], u7[1], u7[2], u7[3], u8v[0], u8v[1], u8v[2], 1, u8v[3]][n] ?? 1;
  const attrs: Attr[] = [];
  const fixed = new Map<number, number[]>();
  const nib = (v: bigint, i: number): number => Number((v >> BigInt(i * 4)) & 0xfn);
  let offset = 0;
  for (let i = 0; i < total; i++) {
    if ((formats >> BigInt(48 + i)) & 1n) {
      // A constant for every vertex (GPUREG_FIXEDATTRIB_*), by shader input index.
      fixed.set(nib(permutation, i), cmd.fixed.get(i) ?? [0, 0, 0, 1]);
      continue;
    }
    const perm = nib(attributes, i);
    const name = nib(permutation, perm);
    const fmt = nib(formats, perm);
    const format = fmt & 3, elements = (fmt >> 2) + 1;
    const size = FORMAT_SIZE[format]!;
    if (size > 1) offset = (offset + size - 1) & ~(size - 1);
    attrs.push({ name, format, elements, scale: scaleOf(name) || 1, offset });
    offset += size * elements;
  }
  const pos = cmd.uniforms.get(6) ?? [0, 0, 0, 0];
  return { address: g(0x203), stride, attrs, fixed, posOffset: pos };
}

function readValue(b: Uint8Array, o: number, a: Attr, out: number[]): void {
  for (let i = 0; i < 4; i++) out[i] = i === 3 ? 1 : 0;
  for (let i = 0; i < a.elements; i++) {
    switch (a.format) {
      case 0: out[i] = (b[o + i]! << 24) >> 24; break;
      case 1: out[i] = b[o + i]!; break;
      case 2: out[i] = (u16(b, o + i * 2) << 16) >> 16; break;
      case 3: out[i] = f32(b, o + i * 4); break;
    }
  }
}

interface SubMesh {
  skinning: number;
  bones: number[];
  indices: number[];
}

/** H3DSubMesh (0x34 bytes): u8 skinning, u16 bone count, 20 bone indices, commands (index buffer). */
function readSubMesh(r: Reader, o: number): SubMesh {
  const skinning = u8(r.b, o);
  const n = Math.min(u16(r.b, o + 2), 20);
  const bones: number[] = [];
  for (let i = 0; i < n; i++) bones.push(u16(r.b, o + 4 + i * 2));
  const cmd = r.pica(o + 0x2c);
  const buf = cmd.regs.get(0x227) ?? 0;
  const count = cmd.regs.get(0x228) ?? 0;
  const mode = ((cmd.regs.get(0x25e) ?? 0) >> 8) & 3;
  const wide = buf >>> 31 === 1;
  const at = buf & 0x7fffffff;
  const raw: number[] = [];
  for (let i = 0; i < count && at + (wide ? i * 2 + 2 : i + 1) <= r.b.length; i++) raw.push(wide ? u16(r.b, at + i * 2) : r.b[at + i]!);
  // Strips (1) and fans (2) become triangle lists.
  const indices: number[] = [];
  if (mode === 1) for (let i = 2; i < raw.length; i++) indices.push(...(i & 1 ? [raw[i - 1]!, raw[i - 2]!, raw[i]!] : [raw[i - 2]!, raw[i - 1]!, raw[i]!]));
  else if (mode === 2) for (let i = 2; i < raw.length; i++) indices.push(raw[0]!, raw[i - 1]!, raw[i]!);
  else indices.push(...raw);
  return { skinning, bones, indices };
}

/**
 * H3DMesh (0x38 bytes): u16 material, u8 flags, u16 node, u16 key (priority, layer << 8), enable commands, sub
 * meshes, disable commands, centre, parent, user data, metadata.
 */
function readMesh(r: Reader, o: number, boneWorld: Mat34[]): Omit<CgfxMesh, 'name' | 'visible'> & { node: number; layer: number } {
  const material = u16(r.b, o);
  const node = u16(r.b, o + 4);
  const key = u16(r.b, o + 6);
  const enable = r.pica(o + 8);
  const layout = vertexLayout(enable);
  const subs = r.inlineList(o + 0x10, 0x34).map((s) => readSubMesh(r, s));
  const { attrs, stride, address, posOffset, fixed: fixedByName } = layout;
  const has = (n: number): boolean => attrs.some((a) => a.name === n) || fixedByName.has(n);

  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], uv1: number[] = [], uv2: number[] = [], col: number[] = [], idx: number[] = [];
  const skinIdx: number[] = [], skinW: number[] = [];
  let skinned = false;
  const tmp = [0, 0, 0, 0];
  const vmap = new Map<number, number>();
  for (const sm of subs) {
    vmap.clear();
    for (const vi of sm.indices) {
      let out = vmap.get(vi);
      if (out === undefined) {
        out = pos.length / 3;
        vmap.set(vi, out);
        const base = address + vi * stride;
        let p = [0, 0, 0], n = [0, 0, 1];
        let c = [1, 1, 1, 1], t = [0, 0], t1 = [0, 0], t2 = [0, 0];
        const bi = [0, 0, 0, 0], bw = [0, 0, 0, 0];
        let biCount = 0, hasWeights = false;
        const take = (name: number, v: number[], elements: number): void => {
          switch (name) {
            case ATTR.position: p = [v[0]! + posOffset[0]!, v[1]! + posOffset[1]!, v[2]! + posOffset[2]!]; break;
            case ATTR.normal: n = [v[0]!, v[1]!, v[2]!]; break;
            case ATTR.color: c = [v[0]!, v[1]!, v[2]!, v[3]!]; break;
            case ATTR.uv0: t = [v[0]!, v[1]!]; break;
            case ATTR.uv1: t1 = [v[0]!, v[1]!]; break;
            case ATTR.uv2: t2 = [v[0]!, v[1]!]; break;
            case ATTR.boneIndex:
              for (let k = 0; k < elements; k++) bi[k] = Math.round(v[k]!);
              biCount = elements;
              break;
            case ATTR.boneWeight:
              hasWeights = true;
              for (let k = 0; k < elements; k++) bw[k] = v[k]!;
              break;
          }
        };
        for (const [name, v] of fixedByName) take(name, v, name === ATTR.boneIndex || name === ATTR.boneWeight ? 3 : 4);
        for (const a of attrs) {
          readValue(r.b, base + a.offset, a, tmp);
          if (a.name !== ATTR.boneIndex) for (let k = 0; k < 4; k++) tmp[k] = tmp[k]! * a.scale;
          take(a.name, tmp, a.elements);
        }
        // Bone indices pick from the sub mesh's bone list; smooth skinning uses the weights, the others follow one bone.
        const smooth = sm.skinning === 1 && hasWeights;
        const bones = [0, 1, 2, 3].map((k) => (k < Math.max(biCount, 1) ? sm.bones[bi[k]!] ?? -1 : -1));
        const weights = smooth ? bw : [bones[0]! >= 0 ? 1 : 0, 0, 0, 0];
        for (let k = 0; k < 4; k++) {
          const w = bones[k]! >= 0 ? weights[k]! : 0;
          skinIdx.push(Math.max(0, bones[k]!));
          skinW.push(w);
          if (w > 0) skinned = true;
        }
        if (!smooth && bones[0]! >= 0 && boneWorld[bones[0]!]) {
          const m = boneWorld[bones[0]!]!;
          p = apply(m, p[0]!, p[1]!, p[2]!, 1);
          n = apply(m, n[0]!, n[1]!, n[2]!, 0);
        }
        pos.push(p[0]!, p[1]!, p[2]!);
        nrm.push(n[0]!, n[1]!, n[2]!);
        uv.push(t[0]!, t[1]!);
        uv1.push(t1[0]!, t1[1]!);
        uv2.push(t2[0]!, t2[1]!);
        col.push(c[0]!, c[1]!, c[2]!, c[3]!);
      }
      idx.push(out);
    }
  }
  return {
    material,
    node,
    priority: key & 0xff,
    layer: (key >> 8) & 3,
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

/** Names of a patricia tree {i32 bit, u16 left, u16 right, name} (the root node first). */
function treeNames(r: Reader, tree: number, count: number): string[] {
  const out: string[] = [];
  if (!tree) return out;
  for (let i = 0; i < count; i++) out.push(r.str(tree + (i + 1) * 0x0c + 8));
  return out;
}

/**
 * H3DModel: flags, bone scaling, silhouette count, world matrix, materials (dict at +0x34), meshes (+0x40), 4 layer
 * ranges, sub mesh cullings, skeleton (dict at +0x70), mesh node visibility (+0x7C), name (+0x84), node count
 * (+0x88), node name tree (+0x8C).
 */
function readModel(r: Reader, o: number): CgfxModel {
  const name = r.str(o + 0x84);
  const materials = r.inlineList(o + 0x34, 0x58).map((m) => readMaterial(r, m));
  const bones = readBones(r, o);
  const world = worldMatrices(bones);
  const nodeCount = r.u32(o + 0x88);
  const nodeNames = treeNames(r, r.u32(o + 0x8c), nodeCount);
  const visPtr = r.u32(o + 0x7c), visCount = r.u32(o + 0x80);
  const visible = (node: number): boolean => !visPtr || node >= visCount || ((r.u32(visPtr + (node >> 5) * 4) >>> (node & 31)) & 1) === 1;
  const meshes: CgfxMesh[] = r.inlineList(o + 0x40, 0x38).map((m, i) => {
    const { node, layer, ...mesh } = readMesh(r, m, world);
    const mat = materials[mesh.material];
    if (mat && layer > mat.layer) mat.layer = layer;
    return { ...mesh, name: nodeNames[node] || `mesh${i}`, visible: visible(node) };
  });
  return { name, meshes, materials, bones, animations: [] };
}

/** H3D root: 15 dictionaries {pointer, count, name tree} — models, materials, shaders, textures, LUTs, … */
const DICT = { models: 0, textures: 3, skeletalAnimations: 8, materialAnimations: 9, visibilityAnimations: 10 } as const;

export interface BchSummary {
  header: BchHeader;
  models: string[];
  textures: string[];
  skeletalAnimations: string[];
  materialAnimations: string[];
}

export function bchSummary(src: Uint8Array): BchSummary {
  const { b, h } = relocateBch(src);
  const r = new Reader(b);
  const names = (d: number, nameAt: number): string[] => r.ptrList(h.contents + d * 12).map((p) => r.str(p + nameAt));
  return {
    header: h,
    models: names(DICT.models, 0x84),
    textures: names(DICT.textures, 0x1c),
    skeletalAnimations: names(DICT.skeletalAnimations, 0),
    materialAnimations: names(DICT.materialAnimations, 0),
  };
}

/** Parse a BCH (bytes start at 'BCH\0'). */
export function parseBch(src: Uint8Array): CgfxFile {
  const { b, h } = relocateBch(src);
  const r = new Reader(b);
  const models = r.ptrList(h.contents + DICT.models * 12).map((p) => readModel(r, p));
  const textures: CgfxTexture[] = [];
  for (const p of r.ptrList(h.contents + DICT.textures * 12)) {
    const t = readTexture(r, p);
    if (t) textures.push(t);
  }
  const animations = readBchAnimations(r.b, r.ptrList(h.contents + DICT.skeletalAnimations * 12), r.ptrList(h.contents + DICT.materialAnimations * 12));
  for (const m of models) m.animations = animations;
  return { models, textures };
}

/** Only the animations of a BCH (RPG3 keeps a monster's skill motions in a BCH of their own, without a model). */
export function bchAnimations(src: Uint8Array): CgfxFile['models'][number]['animations'] {
  const { b, h } = relocateBch(src);
  const r = new Reader(b);
  return readBchAnimations(r.b, r.ptrList(h.contents + DICT.skeletalAnimations * 12), r.ptrList(h.contents + DICT.materialAnimations * 12));
}

/** Type 8 entries: a 0x180-byte header, then the BCH. */
export function unwrapBch(b: Uint8Array): Uint8Array {
  const o = bchOffset(b);
  if (o < 0) throw new Error('BCH が見つかりません');
  return b.subarray(o);
}
