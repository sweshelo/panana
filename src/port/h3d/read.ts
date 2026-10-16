// H3D (BCH) reader: bytes -> the object model of types.ts. Layouts follow SPICA's serializer attributes per version
// (IfVersion 7 / 0x20 / 0x21) and the relocation table (H3DRelocator). The reader also records where each block was
// (H3DLayout) so that writeH3D can put it back at the same place.
import { commandState, readCommands, Reg, vectorFromWords } from './pica';
import type {
  H3D, H3DAnimation, H3DAnimContent, H3DAnimSlot, H3DBone, H3DBoundingBox, H3DCamera, H3DFloatKeyFrameGroup, H3DKeySegment, H3DLayout, H3DLight,
  H3DLUT, H3DMaterial, H3DMaterialAnim, H3DMaterialParams, H3DMesh, H3DMetaData, H3DMetaDataValue, H3DModel, H3DQuatTrack,
  H3DShader, H3DSubMesh, H3DTexture, H3DTextureCoord, H3DTextureMapper, H3DVertexData, KeyFrame, Matrix3x4, PICAAttribute,
  PICAFixedAttribute, PICATexEnvStage, RGBA, Vector3, Vector4,
} from './types';
import { H3DPrimitiveType, vectorSlots } from './types';

/** H3DSection: where a relocated pointer points. */
export const Sec = {
  Contents: 0, Strings: 1, Commands: 2, CommandsSrc: 3, RawData: 4, RawDataTexture: 5, RawDataVertex: 6, RawDataIndex16: 7, RawDataIndex8: 8,
  RawExt: 9, RawExtTexture: 10, RawExtVertex: 11, RawExtIndex16: 12, RawExtIndex8: 13, BaseAddress: 14,
} as const;

export interface H3DHeader {
  backwardCompatibility: number;
  forwardCompatibility: number;
  converterVersion: number;
  contentsAddress: number;
  stringsAddress: number;
  commandsAddress: number;
  rawDataAddress: number;
  rawExtAddress: number;
  relocationAddress: number;
  contentsLength: number;
  stringsLength: number;
  commandsLength: number;
  rawDataLength: number;
  rawExtLength: number;
  relocationLength: number;
  unInitDataLength: number;
  unInitCommandsLength: number;
  flags: number;
  addressCount: number;
}

/** Bytes of the header (the fields after the magic depend on the version). */
export const headerLength = (version: number): number => (version >= 0x21 ? 0x44 : version >= 8 ? 0x3c : 0x38);

export function readH3DHeader(b: Uint8Array): H3DHeader {
  if (b.length < 0x38 || b[0] !== 0x42 || b[1] !== 0x43 || b[2] !== 0x48 || b[3] !== 0) throw new Error('not a BCH (H3D) file');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const v = b[4]!;
  const ext = v >= 0x21;
  let o = 8;
  const next = (): number => {
    const x = dv.getUint32(o, true);
    o += 4;
    return x;
  };
  const contentsAddress = next(), stringsAddress = next(), commandsAddress = next(), rawDataAddress = next();
  const rawExtAddress = ext ? next() : 0;
  const relocationAddress = next();
  const contentsLength = next(), stringsLength = next(), commandsLength = next(), rawDataLength = next();
  const rawExtLength = ext ? next() : 0;
  const relocationLength = next();
  const unInitDataLength = next(), unInitCommandsLength = next();
  let flags = 0, addressCount = 0;
  if (v >= 8) {
    flags = b[o]!;
    addressCount = dv.getUint16(o + 2, true);
  }
  return {
    backwardCompatibility: v, forwardCompatibility: b[5]!, converterVersion: dv.getUint16(6, true),
    contentsAddress, stringsAddress, commandsAddress, rawDataAddress, rawExtAddress, relocationAddress,
    contentsLength, stringsLength, commandsLength, rawDataLength, rawExtLength, relocationLength,
    unInitDataLength, unInitCommandsLength, flags, addressCount,
  };
}

/**
 * The difference between H3DSection and the section numbers of older files (SPICA GetLegacyRelocDiff): added to the
 * file's number when reading, subtracted when writing.
 */
export function legacyRelocDiff(section: number, version: number): number {
  if (version > 7 && version < 0x21 && section >= Sec.RawDataVertex) return -1;
  if (version < 7 && section >= Sec.CommandsSrc) return 1;
  return 0;
}

export function sectionAddress(h: H3DHeader, s: number): number {
  switch (s) {
    case Sec.Contents: return h.contentsAddress;
    case Sec.Strings: return h.stringsAddress;
    case Sec.Commands: case Sec.CommandsSrc: return h.commandsAddress;
    case Sec.RawData: case Sec.RawDataTexture: case Sec.RawDataVertex: case Sec.RawDataIndex8: return h.rawDataAddress;
    case Sec.RawDataIndex16: return (h.rawDataAddress | 0x80000000) >>> 0;
    case Sec.RawExt: case Sec.RawExtTexture: case Sec.RawExtVertex: case Sec.RawExtIndex8: return h.rawExtAddress;
    case Sec.RawExtIndex16: return (h.rawExtAddress | 0x80000000) >>> 0;
  }
  return 0;
}

/** A relocation entry: the pointer's position (absolute), its section and the section it points to (H3DSection). */
export interface Relocation {
  position: number;
  source: number;
  target: number;
}

export function readRelocations(b: Uint8Array, h: H3DHeader): Relocation[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Relocation[] = [];
  for (let o = 0; o < h.relocationLength; o += 4) {
    const v = dv.getUint32(h.relocationAddress + o, true);
    let ptr = v & 0x1ffffff;
    let target = (v >>> 25) & 0xf;
    const source = v >>> 29;
    target += legacyRelocDiff(target, h.backwardCompatibility);
    if (target !== Sec.Strings) ptr <<= 2;
    out.push({ position: sectionAddress(h, source) + ptr, source, target });
  }
  return out;
}

/** Layout tracing (development): every block read, with its kind and range. */
export type H3DTrace = (kind: string, start: number, end: number) => void;

class Ctx {
  readonly dv: DataView;
  readonly version: number;
  readonly relocs = new Map<number, number>();
  /** Objects read by address (shared references: material params, meshes in the layer ranges, curves). */
  readonly cache = new Map<string, unknown>();
  readonly layout: H3DLayout;
  /** Every range read (to find the bytes between blocks). */
  readonly ranges: [number, number][] = [];
  /** Where each command list was. */
  readonly cmdAt = new WeakMap<Uint32Array, number>();

  constructor(
    readonly b: Uint8Array,
    readonly h: H3DHeader,
    relocs: Relocation[],
    readonly trace?: H3DTrace,
  ) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.version = h.backwardCompatibility;
    for (const r of relocs) this.relocs.set(r.position, r.target);
    this.layout = {
      version: h.backwardCompatibility,
      offsets: new WeakMap(),
      strings: new Map(),
      relocations: relocs.map((r) => r.position),
      fill: [],
      sections: [
        { address: h.contentsAddress, length: h.contentsLength },
        { address: h.stringsAddress, length: h.stringsLength },
        { address: h.commandsAddress, length: h.commandsLength },
        { address: h.rawDataAddress, length: h.rawDataLength },
        { address: h.rawExtAddress, length: h.rawExtLength },
      ],
      relocationAddress: h.relocationAddress,
      fileLength: b.length,
    };
  }

  u8 = (o: number): number => this.b[o]!;
  s8 = (o: number): number => (this.b[o]! << 24) >> 24;
  u16 = (o: number): number => this.dv.getUint16(o, true);
  s16 = (o: number): number => this.dv.getInt16(o, true);
  u32 = (o: number): number => this.dv.getUint32(o, true);
  s32 = (o: number): number => this.dv.getInt32(o, true);
  f32 = (o: number): number => this.dv.getFloat32(o, true);
  vec2 = (o: number): [number, number] => [this.f32(o), this.f32(o + 4)];
  vec3 = (o: number): Vector3 => [this.f32(o), this.f32(o + 4), this.f32(o + 8)];
  vec4 = (o: number): Vector4 => [this.f32(o), this.f32(o + 4), this.f32(o + 8), this.f32(o + 12)];
  rgba = (o: number): RGBA => [this.b[o]!, this.b[o + 1]!, this.b[o + 2]!, this.b[o + 3]!];
  mtx = (o: number, n: number): number[] => Array.from({ length: n }, (_, i) => this.f32(o + i * 4));

  /** Record where the block `role` of `owner` is (and trace it). */
  mark(owner: object, role: string, start: number, end: number): void {
    let m = this.layout.offsets.get(owner);
    if (!m) this.layout.offsets.set(owner, (m = new Map()));
    if (!m.has(role)) m.set(role, start);
    this.ranges.push([start, end]);
    this.trace?.(role, start, end);
  }

  /** A pointer field (0 when it is not relocated, i.e. null). */
  ptr = (o: number): number => (this.relocs.has(o) ? this.u32(o) : 0);

  /** The section a relocated pointer points to. */
  target = (o: number): number | undefined => this.relocs.get(o);

  str = (o: number): string | null => {
    const p = this.ptr(o);
    if (!p) return null;
    let e = p;
    while (e < this.b.length && this.b[e] !== 0) e++;
    const s = latin1(this.b, p, e);
    if (!this.layout.strings.has(s)) this.layout.strings.set(s, p);
    this.ranges.push([p, e + 1]);
    this.trace?.('string', p, e + 1);
    return s;
  };

  /** A name: never null (empty when missing). */
  name = (o: number): string => this.str(o) ?? '';

  /** A command list {pointer, word count}, or null. */
  words = (o: number): Uint32Array | null => {
    const p = this.ptr(o), n = this.u32(o + 4);
    if (!p) return null;
    return this.cached('cmd', p, () => {
      const out = new Uint32Array(n);
      for (let i = 0; i < n; i++) out[i] = this.u32(p + i * 4);
      this.mark(out, 'cmd', p, p + n * 4);
      this.cmdAt.set(out, p);
      return out;
    });
  };

  cached<T>(kind: string, at: number, read: () => T): T {
    const key = `${kind}@${at}`;
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const v = read();
    this.cache.set(key, v);
    return v;
  }
}

export function latin1(b: Uint8Array, s: number, e: number): string {
  let out = '';
  for (let i = s; i < e; i++) out += String.fromCharCode(b[i]!);
  return out;
}

/** Relocate a copy of the file (pointers become absolute offsets; SPICA H3DRelocator.ToAbsolute). */
export function relocate(src: Uint8Array, h: H3DHeader, relocs: Relocation[]): Uint8Array {
  const b = src.slice();
  const dv = new DataView(b.buffer);
  for (const r of relocs) {
    if (r.position + 4 > b.length) throw new Error(`relocation outside the file at ${r.position.toString(16)}`);
    dv.setUint32(r.position, (dv.getUint32(r.position, true) + sectionAddress(h, r.target)) >>> 0, true);
  }
  return b;
}

// ---- Dictionaries, metadata

/** Patricia tree names (the root node is skipped), or null. */
function readTree(c: Ctx, at: number, owner: object): string[] | null {
  const p = c.ptr(at);
  if (!p) return null;
  // SPICA reads nodes until it has seen every index the nodes refer to.
  let max = 0;
  const names: string[] = [];
  for (let i = 0; i <= max; i++) {
    const n = p + i * 12;
    max = Math.max(max, c.u16(n + 4), c.u16(n + 6));
    if (i > 0) names.push(c.name(n + 8));
  }
  c.mark(owner, 'tree', p, p + (max + 1) * 12);
  return names;
}

function readDict<T>(c: Ctx, at: number, item: (o: number) => T, inlineSize = 0): T[] {
  const p = c.ptr(at), n = c.u32(at + 4);
  const out: T[] = [];
  const names = readTree(c, at + 8, out);
  if (names && names.length !== n) throw new Error(`name tree of ${names.length} names for ${n} values`);
  if (!c.ptr(at + 8)) treeless.add(out);
  if (!p) {
    if (n) throw new Error('dictionary without values');
    nullValues.add(out);
    return out;
  }
  c.mark(out, 'values', p, p + n * (inlineSize || 4));
  for (let i = 0; i < n; i++) {
    if (inlineSize) out.push(item(p + i * inlineSize));
    else {
      const q = c.ptr(p + i * 4);
      if (!q) throw new Error(`null value in a dictionary at ${p.toString(16)}`);
      out.push(item(q));
    }
  }
  return out;
}

/** Lists that had a null pointer (the writer keeps them null), dictionaries without a name tree. */
export const nullValues = new WeakSet<object>();
export const treeless = new WeakSet<object>();

/** A list {pointer, count} of `size`-byte items, recording a null pointer on `out`. */
function list<T>(c: Ctx, at: number, out: T[], role: string, size: number, item: (p: number, i: number) => T): T[] {
  const p = c.ptr(at), n = c.u32(at + 4);
  if (!p) {
    nullValues.add(out);
    return out;
  }
  c.mark(out, role, p, p + n * size);
  for (let i = 0; i < n; i++) out.push(item(p, i));
  return out;
}

function readMetaData(c: Ctx, at: number): H3DMetaData {
  const p = c.ptr(at);
  if (!p) return null;
  return c.cached('meta', p, () => {
    const out = readDict(c, p, (o) => readMetaValue(c, o), 12);
    c.mark(out, 'meta', p, p + 12);
    return out;
  });
}

function readMetaValue(c: Ctx, o: number): H3DMetaDataValue {
  const name = c.name(o);
  const type = c.u16(o + 4);
  const n = c.u16(o + 6);
  const p = c.ptr(o + 8);
  const at = (i: number, size: number): number => p + i * size;
  const done = <V extends H3DMetaDataValue>(v: V): V => {
    if (p) c.mark(v.values, 'data', p, p + n * [4, 4, 4, 4, 0x3c, 0x0c][type]!);
    else nullValues.add(v.values);
    return v;
  };
  switch (type) {
    case 0: return done({ name, type, values: Array.from({ length: n }, (_, i) => c.s32(at(i, 4))) });
    case 1: return done({ name, type, values: Array.from({ length: n }, (_, i) => c.f32(at(i, 4))) });
    case 2: return done({ name, type, values: Array.from({ length: n }, (_, i) => c.name(at(i, 4))) });
    case 3: {
      const values: string[] = [];
      const v = done({ name, type, values });
      for (let i = 0; i < n; i++) values.push(utf16(c, c.ptr(at(i, 4)), values, i));
      return v;
    }
    case 4: return done({ name, type, values: Array.from({ length: n }, (_, i) => readBoundingBox(c, at(i, 0x3c))) });
    case 5: return done({ name, type, values: Array.from({ length: n }, (_, i) => readVertexData(c, at(i, 0x0c))) });
  }
  throw new Error(`unknown metadata type ${type}`);
}

function utf16(c: Ctx, p: number, owner: object, i: number): string {
  if (!p) return '';
  let s = '';
  let o = p;
  for (; o + 1 < c.b.length && c.u16(o); o += 2) s += String.fromCharCode(c.u16(o));
  c.mark(owner, `u16:${i}`, p, o + 2);
  return s;
}

function readBoundingBox(c: Ctx, o: number): H3DBoundingBox {
  return { center: c.vec3(o), orientation: c.mtx(o + 12, 9), size: c.vec3(o + 0x30) };
}

/** H3DVertexData (metadata of type 5). Never seen in the games' files; read for completeness, not written. */
function readVertexData(c: Ctx, o: number): H3DVertexData {
  const na = c.u16(o) & 0xff, ni = c.u16(o + 2);
  const pa = c.ptr(o + 4), pi = c.ptr(o + 8);
  const attributes = Array.from({ length: na }, (_, i) => {
    const a = pa + i * 12;
    const type = c.u8(a + 1);
    const stride = c.u8(a + 2);
    const offset = c.ptr(a + 4) || c.u32(a + 4);
    const format = type & 3, elements = ((type >> 2) & 3) + 1;
    const fixedValue: Vector4 = [0, 0, 0, 0];
    if (!stride) for (let k = 0; k < elements; k++) fixedValue[k] = [c.s8, c.u8, c.s16, c.f32][format]!(offset + k * [1, 1, 2, 4][format]!);
    return { name: c.u8(a), format, elements, stride, offset, fixedValue };
  });
  const indices = Array.from({ length: ni }, (_, i) => {
    const x = pi + i * 8;
    const type = c.u8(x), count = c.u16(x + 2), p = c.ptr(x + 4);
    return { type, drawMode: c.u8(x + 1), indices: Array.from({ length: count }, (_, k) => (type === 1 ? c.u16(p + k * 2) : c.u8(p + k))) };
  });
  const base = Math.min(...attributes.filter((a) => a.stride).map((a) => a.offset), Infinity);
  const stride = attributes.filter((a) => a.stride).reduce((s, a) => s + a.elements * [1, 1, 2, 4][a.format]!, 0);
  const max = Math.max(0, ...indices.flatMap((x) => x.indices));
  for (const a of attributes) if (a.stride) a.offset -= base;
  return { attributes, indices, rawBuffer: Number.isFinite(base) ? c.b.slice(base, base + (max + 1) * stride) : new Uint8Array(0) };
}

// ---- Model

function readModel(c: Ctx, o: number): H3DModel {
  return c.cached('model', o, () => {
    const v21 = c.version >= 0x21;
    const meshes: H3DMesh[] = [];
    const mp = c.ptr(o + 0x40), mn = c.u32(o + 0x44);
    if (mp) {
      c.mark(meshes, 'meshes', mp, mp + mn * 0x38);
      for (let i = 0; i < mn; i++) meshes.push(readMesh(c, mp + i * 0x38));
    } else nullValues.add(meshes);
    // Layer lists are ranges {start, end} of the mesh list.
    const range = (at: number): H3DMesh[] => {
      const s = c.ptr(at), e = c.ptr(at + 4);
      const out: H3DMesh[] = [];
      if (s) for (let p = s; p < e; p += 0x38) out.push(readMesh(c, p));
      return out;
    };
    const cullings: unknown[] = [];
    if (c.version >= 7) {
      const cp = c.ptr(o + 0x68);
      cullings.length = c.u32(o + 0x6c);
      cullings.fill(null);
      if (cp) c.mark(cullings, 'cullings', cp, cp);
      else nullValues.add(cullings);
    }
    const model: H3DModel = {
      name: c.name(o + 0x84),
      flags: c.u8(o),
      boneScaling: c.u8(o + 1),
      silhouetteMaterialsCount: c.u16(o + 2),
      worldTransform: c.mtx(o + 4, 12),
      materials: readDict(c, o + 0x34, (m) => readMaterial(c, m), v21 ? 0x2c : 0x58),
      meshes,
      meshesLayer0: range(o + 0x48),
      meshesLayer1: range(o + 0x50),
      meshesLayer2: range(o + 0x58),
      meshesLayer3: range(o + 0x60),
      subMeshCullings: cullings,
      skeleton: readDict(c, o + 0x70, (b) => readBone(c, b), 0x64),
      meshNodesVisibility: readBools(c, o + 0x7c),
      meshNodesCount: c.s32(o + 0x88),
      meshNodesTree: null,
      userDefinedAddress: c.u32(o + 0x90),
      metaData: readMetaData(c, o + 0x94),
    };
    c.mark(model, 'model', o, o + 0x98);
    const tree: string[] = [];
    const names = readTree(c, o + 0x8c, tree);
    if (names) {
      tree.push(...names);
      model.meshNodesTree = tree;
    }
    for (const m of meshes) if (c.ptr(meshAt.get(m)! + 0x2c) !== o) throw new Error('a mesh whose parent is another model');
    return model;
  });
}

const meshAt = new WeakMap<H3DMesh, number>();

function readBools(c: Ctx, at: number): boolean[] {
  const p = c.ptr(at), n = c.u32(at + 4);
  const out: boolean[] = [];
  if (!p) {
    nullValues.add(out);
    return out;
  }
  c.mark(out, 'bits', p, p + Math.ceil(n / 8));
  for (let i = 0; i < n; i++) out.push(((c.u32(p + (i >> 5) * 4) >>> (i & 31)) & 1) === 1);
  return out;
}

function readBone(c: Ctx, o: number): H3DBone {
  return {
    flags: c.u32(o),
    parentIndex: c.s16(o + 4),
    scale: c.vec3(o + 8),
    rotation: c.vec3(o + 0x14),
    translation: c.vec3(o + 0x20),
    inverseTransform: c.mtx(o + 0x2c, 12),
    name: c.name(o + 0x5c),
    metaData: readMetaData(c, o + 0x60),
  };
}

function readMesh(c: Ctx, o: number): H3DMesh {
  return c.cached('mesh', o, () => {
    const flags = c.u8(o + 2), key = c.u16(o + 6);
    const subMeshes: H3DSubMesh[] = [];
    const sp = c.ptr(o + 0x10), sn = c.u32(o + 0x14);
    if (sp) {
      c.mark(subMeshes, 'subMeshes', sp, sp + sn * 0x34);
      for (let i = 0; i < sn; i++) subMeshes.push(readSubMesh(c, sp + i * 0x34));
    } else nullValues.add(subMeshes);
    const enable = c.words(o + 8) ?? new Uint32Array(0);
    const disable = c.words(o + 0x18) ?? undefined;
    const layout = vertexLayout(enable);
    clearAddresses(c, enable, [Reg.GPUREG_ATTRIBBUFFER0_OFFSET]);
    // The attribute buffers' base address: relocated (BaseAddress) from version 0x21, 0x03000000 in RPG3's files.
    for (const cmd of readCommands(enable)) if (cmd.register === Reg.GPUREG_ATTRIBBUFFERS_LOC) enable[cmd.word] = 0;
    const vertices = subMeshes.reduce((m, s) => Math.max(m, ...s.indices), 0) + 1;
    const address = layout.address;
    const size = vertices * layout.vertexStride;
    const rawBuffer = c.cached('raw', address, () => {
      const r = address ? c.b.slice(address, address + size) : new Uint8Array(0);
      if (address) c.mark(r, 'raw', address, address + size);
      return r;
    });
    const mesh: H3DMesh = {
      materialIndex: c.u16(o),
      type: flags & 3,
      skinning: (flags >> 2) & 3,
      flagsRest: flags & ~15,
      nodeIndex: c.u16(o + 4),
      priority: key & 0xff,
      layer: (key >> 8) & 3,
      keyRest: key & ~0x3ff,
      subMeshes,
      meshCenter: c.vec3(o + 0x20),
      userDefinedAddress: c.u32(o + 0x30),
      metaData: readMetaData(c, o + 0x34),
      rawBuffer,
      vertexStride: layout.vertexStride,
      attributes: layout.attributes,
      fixedAttributes: layout.fixedAttributes,
      positionOffset: layout.positionOffset,
      enableCommands: enable,
      disableCommands: disable,
    };
    meshAt.set(mesh, o);
    return mesh;
  });
}

/** Set the relocated values of `registers` to 0 (the addresses the writer fills in). */
function clearAddresses(c: Ctx, words: Uint32Array, registers: number[]): void {
  const at = c.cmdAt.get(words);
  for (const cmd of readCommands(words)) if (registers.includes(cmd.register) && at !== undefined && c.relocs.has(at + cmd.word * 4)) words[cmd.word] = 0;
}

/** The vertex layout of a mesh's enable commands (SPICA H3DMesh.Deserialize). */
export function vertexLayout(words: Uint32Array): {
  address: number;
  vertexStride: number;
  attributes: PICAAttribute[];
  fixedAttributes: PICAFixedAttribute[];
  positionOffset: Vector4;
} {
  const st = commandState(words);
  const g = (r: number): number => st.regs.get(r) ?? 0;
  const formats = BigInt(g(Reg.GPUREG_ATTRIBBUFFERS_FORMAT_LOW)) | (BigInt(g(Reg.GPUREG_ATTRIBBUFFERS_FORMAT_HIGH)) << 32n);
  const config2 = g(Reg.GPUREG_ATTRIBBUFFER0_CONFIG2);
  const bufferAttributes = BigInt(g(Reg.GPUREG_ATTRIBBUFFER0_CONFIG1)) | (BigInt(config2 & 0xffff) << 32n);
  const permutation = BigInt(g(Reg.GPUREG_VSH_ATTRIBUTES_PERMUTATION_LOW)) | (BigInt(g(Reg.GPUREG_VSH_ATTRIBUTES_PERMUTATION_HIGH)) << 32n);
  const total = st.regs.has(Reg.GPUREG_VSH_NUM_ATTR) ? g(Reg.GPUREG_VSH_NUM_ATTR) + 1 : 0;
  const nib = (v: bigint, i: number): number => Number((v >> BigInt(i * 4)) & 0xfn);
  const u7 = st.vtxUniforms.get(7) ?? [0, 0, 0, 0];
  const u8v = st.vtxUniforms.get(8) ?? [0, 0, 0, 0];
  const attributes: PICAAttribute[] = [];
  const fixedAttributes: PICAFixedAttribute[] = [];
  for (let i = 0; i < total; i++) {
    if ((formats >> BigInt(48 + i)) & 1n) {
      const w = st.fixed.get(i) ?? [0, 0, 0];
      fixedAttributes.push({ name: nib(permutation, i), value: vectorFromWords(w[0], w[1], w[2]) });
    } else {
      const perm = nib(bufferAttributes, i);
      const name = nib(permutation, perm);
      const fmt = nib(formats, perm);
      const scale = [u7[0], u7[1], u7[2], u7[3], u8v[0], u8v[1], u8v[2], 1, u8v[3]][name] ?? 1;
      attributes.push({ name, format: fmt & 3, elements: (fmt >> 2) + 1, scale: scale! });
    }
  }
  return { address: g(Reg.GPUREG_ATTRIBBUFFER0_OFFSET), vertexStride: (config2 >>> 16) & 0xff, attributes, fixedAttributes, positionOffset: st.vtxUniforms.get(6) ?? [0, 0, 0, 0] };
}

function readSubMesh(c: Ctx, o: number): H3DSubMesh {
  const count = c.u16(o + 2);
  const raw = Array.from({ length: 20 }, (_, i) => c.u16(o + 4 + i * 2));
  const commands = c.words(o + 0x2c) ?? new Uint32Array(0);
  const st = commandState(commands);
  const address = st.regs.get(Reg.GPUREG_INDEXBUFFER_CONFIG) ?? 0;
  const n = st.regs.get(Reg.GPUREG_NUMVERTICES) ?? 0;
  clearAddresses(c, commands, [Reg.GPUREG_INDEXBUFFER_CONFIG]);
  const is16Bit = address >>> 31 === 1;
  const at = address & 0x7fffffff;
  const indices = c.cached(`idx${is16Bit ? 16 : 8}:${n}`, at, () => {
    const out = new Uint16Array(n);
    for (let i = 0; i < n; i++) out[i] = is16Bit ? c.u16(at + i * 2) : c.u8(at + i);
    if (at) c.mark(out, 'raw', at, at + n * (is16Bit ? 2 : 1));
    return out;
  });
  const boneIndices = raw.slice(0, Math.min(count, 20));
  const rest = raw.slice(boneIndices.length);
  return {
    skinning: c.u8(o),
    boneIndices,
    boneIndicesRaw: rest.some((x) => x !== 0) ? raw : null,
    boolUniforms: (st.regs.get(Reg.GPUREG_VSH_BOOLUNIFORM) ?? 0) & 0xffff,
    indices,
    is16Bit,
    primitiveMode: ((st.regs.get(Reg.GPUREG_PRIMITIVE_CONFIG) ?? 0) >>> 8) & 3,
    commands,
  };
}

// ---- Materials

function readTextureCoord(c: Ctx, o: number): H3DTextureCoord {
  return {
    flags: c.u8(o), transformType: c.u8(o + 1), mappingType: c.u8(o + 2), referenceCameraIndex: c.s8(o + 3),
    scale: c.vec2(o + 4), rotation: c.f32(o + 0x0c), translation: c.vec2(o + 0x10),
  };
}

function readMapper(c: Ctx, o: number): H3DTextureMapper {
  return {
    samplerType: c.u8(o), wrapU: c.u8(o + 1), wrapV: c.u8(o + 2), magFilter: c.u8(o + 3), minFilter: c.u8(o + 4), minLOD: c.u8(o + 5),
    lodBias: c.f32(o + 8), borderColor: c.rgba(o + 0x0c),
  };
}

const emptyMapper = (): H3DTextureMapper => ({ samplerType: 0, wrapU: 0, wrapV: 0, magFilter: 0, minFilter: 0, minLOD: 0, lodBias: 0, borderColor: [0, 0, 0, 0] });

function readMaterial(c: Ctx, o: number): H3DMaterial {
  const v21 = c.version >= 0x21;
  const textureCommands = c.words(o + 0x10) ?? undefined;
  const mp = v21 ? c.ptr(o + 0x18) : o + 0x18;
  const mappers = [0, 1, 2].map((i) => (mp ? readMapper(c, mp + i * 0x10) : emptyMapper())) as H3DMaterial['textureMappers'];
  if (v21 && mp) c.mark(mappers, 'mappers', mp, mp + 0x30);
  else if (v21) nullValues.add(mappers);
  const n = v21 ? 0x1c : 0x48;
  const unit = textureCommands ? commandState(textureCommands).regs.get(Reg.GPUREG_TEXUNIT_CONFIG) ?? 0 : 0;
  const tex = (at: number): H3DTexture | null => (c.ptr(at) ? readTexture(c, c.ptr(at)) : null);
  return {
    materialParams: readMaterialParams(c, c.ptr(o)),
    texture0: tex(o + 4),
    texture1: tex(o + 8),
    texture2: tex(o + 0x0c),
    textureMappers: mappers,
    texture0Name: c.str(o + n),
    texture1Name: c.str(o + n + 4),
    texture2Name: c.str(o + n + 8),
    name: c.name(o + n + 12),
    enabledTextures: [(unit & 1) !== 0, (unit & 2) !== 0, (unit & 4) !== 0, (unit & 0x400) !== 0],
    textureCommands,
  };
}

/** Bytes of H3DMaterialParams (the metadata pointer is there from version 7). */
export const paramsSize = (version: number): number => (version >= 7 ? 0x110 : 0x10c);

function readMaterialParams(c: Ctx, o: number): H3DMaterialParams {
  return c.cached('params', o, () => {
    const lut = Array.from({ length: 6 }, (_, i) => c.u32(o + 0xa8 + i * 4));
    const fs = c.words(o + 0xc8) ?? new Uint32Array(0);
    if (c.ptr(o + 0xd0) !== c.ptr(o + 0xc8)) throw new Error('fragment shader commands with two different pointers');
    const p: H3DMaterialParams = {
      uniqueId: c.u32(o),
      flags: c.u16(o + 4),
      fragmentFlags: c.u8(o + 6),
      frameAccessOffset: c.u8(o + 7),
      materialShader: c.u32(o + 8),
      textureCoords: [0, 1, 2].map((i) => readTextureCoord(c, o + 0x0c + i * 0x18)) as H3DMaterialParams['textureCoords'],
      lightSetIndex: c.u16(o + 0x54),
      fogIndex: c.u16(o + 0x56),
      emissionColor: c.rgba(o + 0x58),
      ambientColor: c.rgba(o + 0x5c),
      diffuseColor: c.rgba(o + 0x60),
      specular0Color: c.rgba(o + 0x64),
      specular1Color: c.rgba(o + 0x68),
      constant0Color: c.rgba(o + 0x6c),
      constant1Color: c.rgba(o + 0x70),
      constant2Color: c.rgba(o + 0x74),
      constant3Color: c.rgba(o + 0x78),
      constant4Color: c.rgba(o + 0x7c),
      constant5Color: c.rgba(o + 0x80),
      blendColor: c.rgba(o + 0x84),
      colorScale: c.f32(o + 0x88),
      samplerPtrs: Array.from({ length: 6 }, (_, i) => c.u32(o + 0x8c + i * 4)),
      layerConfig: c.u8(o + 0xa4),
      fresnelSelector: c.u8(o + 0xa5),
      bumpMode: c.u8(o + 0xa6),
      bumpTexture: c.u8(o + 0xa7),
      lutConfigCommands: lut,
      constantColors: c.u32(o + 0xc0),
      polygonOffsetUnit: c.f32(o + 0xc4),
      lutDist0TableName: c.str(o + 0xd4),
      lutDist1TableName: c.str(o + 0xd8),
      lutFresnelTableName: c.str(o + 0xdc),
      lutReflecRTableName: c.str(o + 0xe0),
      lutReflecGTableName: c.str(o + 0xe4),
      lutReflecBTableName: c.str(o + 0xe8),
      lutDist0SamplerName: c.str(o + 0xec),
      lutDist1SamplerName: c.str(o + 0xf0),
      lutFresnelSamplerName: c.str(o + 0xf4),
      lutReflecRSamplerName: c.str(o + 0xf8),
      lutReflecGSamplerName: c.str(o + 0xfc),
      lutReflecBSamplerName: c.str(o + 0x100),
      shaderReference: c.str(o + 0x104),
      modelReference: c.name(o + 0x108),
      metaData: c.version >= 7 ? readMetaData(c, o + 0x10c) : null,
      fragmentShaderCommands: fs,
      ...decodeFragment(lut, fs),
    };
    c.mark(p, 'params', o, o + paramsSize(c.version));
    return p;
  });
}

const lutInputs = <T>(f: (shift: number) => T): { dist0: T; dist1: T; specular: T; fresnel: T; reflecR: T; reflecG: T; reflecB: T } => ({
  dist0: f(0), dist1: f(4), specular: f(8), fresnel: f(12), reflecR: f(16), reflecG: f(20), reflecB: f(24),
});

const rgbaOf = (v: number): RGBA => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];

export function emptyTexEnvStage(): PICATexEnvStage {
  return {
    source: { color: [0, 0, 0], alpha: [0, 0, 0] }, operand: { color: [0, 0, 0], alpha: [0, 0, 0] }, combiner: { color: 0, alpha: 0 },
    color: [0, 0, 0, 0], scale: { color: 0, alpha: 0 }, updateColorBuffer: false, updateAlphaBuffer: false,
  };
}

/** The decoded fields of H3DMaterialParams (SPICA H3DMaterialParams.Deserialize). */
export function decodeFragment(lutConfig: ArrayLike<number>, fragment: ArrayLike<number>): Pick<
  H3DMaterialParams,
  | 'lutInputAbsolute' | 'lutInputSelection' | 'lutInputScale' | 'texEnvStages' | 'texEnvBufferColor' | 'colorOperation' | 'blendFunction'
  | 'logicalOperation' | 'alphaTest' | 'stencilTest' | 'stencilOperation' | 'depthColorMask' | 'faceCulling' | 'colorBufferRead'
  | 'colorBufferWrite' | 'stencilBufferRead' | 'depthBufferRead' | 'stencilBufferWrite' | 'depthBufferWrite' | 'textureSources'
  | 'vtxShaderUniforms' | 'geoShaderUniforms'
> {
  const lut = commandState(lutConfig).regs;
  const abs = lut.get(Reg.GPUREG_LIGHTING_LUTINPUT_ABS) ?? 0;
  const sel = lut.get(Reg.GPUREG_LIGHTING_LUTINPUT_SELECT) ?? 0;
  const scl = lut.get(Reg.GPUREG_LIGHTING_LUTINPUT_SCALE) ?? 0;
  const st = commandState(fragment);
  const stages = Array.from({ length: 6 }, emptyTexEnvStage);
  const r = (reg: number): number | undefined => st.regs.get(reg);
  [Reg.GPUREG_TEXENV0_SOURCE, Reg.GPUREG_TEXENV1_SOURCE, Reg.GPUREG_TEXENV2_SOURCE, Reg.GPUREG_TEXENV3_SOURCE, Reg.GPUREG_TEXENV4_SOURCE, Reg.GPUREG_TEXENV5_SOURCE].forEach((base, i) => {
    const s = stages[i]!;
    const src = r(base), opr = r(base + 1), comb = r(base + 2), col = r(base + 3), sc = r(base + 4);
    if (src !== undefined) s.source = { color: [src & 15, (src >> 4) & 15, (src >> 8) & 15], alpha: [(src >> 16) & 15, (src >> 20) & 15, (src >> 24) & 15] };
    if (opr !== undefined) s.operand = { color: [opr & 15, (opr >> 4) & 15, (opr >> 8) & 15], alpha: [(opr >> 12) & 7, (opr >> 16) & 7, (opr >> 20) & 7] };
    if (comb !== undefined) s.combiner = { color: comb & 15, alpha: (comb >> 16) & 15 };
    if (col !== undefined) s.color = rgbaOf(col);
    if (sc !== undefined) s.scale = { color: sc & 3, alpha: (sc >> 16) & 3 };
  });
  const up = r(Reg.GPUREG_TEXENV_UPDATE_BUFFER);
  if (up !== undefined)
    for (let i = 1; i <= 4; i++) {
      stages[i]!.updateColorBuffer = (up & (0x80 << i)) !== 0;
      stages[i]!.updateAlphaBuffer = (up & (0x800 << i)) !== 0;
    }
  const op = r(Reg.GPUREG_COLOR_OPERATION) ?? 0;
  const bf = r(Reg.GPUREG_BLEND_FUNC) ?? 0;
  const at = r(Reg.GPUREG_FRAGOP_ALPHA_TEST) ?? 0;
  const stt = r(Reg.GPUREG_STENCIL_TEST) ?? 0;
  const sop = r(Reg.GPUREG_STENCIL_OP) ?? 0;
  const dcm = r(Reg.GPUREG_DEPTH_COLOR_MASK) ?? 0;
  const dbr = r(Reg.GPUREG_DEPTHBUFFER_READ) ?? 0;
  const dbw = r(Reg.GPUREG_DEPTHBUFFER_WRITE) ?? 0;
  const u10 = st.vtxUniforms.get(10) ?? [0, 0, 0, 0];
  return {
    lutInputAbsolute: lutInputs((s) => ((abs >>> (s + 1)) & 1) === 0),
    lutInputSelection: lutInputs((s) => (sel >>> s) & 7),
    lutInputScale: lutInputs((s) => (scl >>> s) & 7),
    texEnvStages: stages,
    texEnvBufferColor: rgbaOf(r(Reg.GPUREG_TEXENV_BUFFER_COLOR) ?? 0),
    colorOperation: { fragOpMode: op & 3, blendMode: (op >> 8) & 1 },
    blendFunction: {
      colorEquation: bf & 7, alphaEquation: (bf >> 8) & 7, colorSrcFunc: (bf >> 16) & 15, colorDstFunc: (bf >> 20) & 15,
      alphaSrcFunc: (bf >> 24) & 15, alphaDstFunc: (bf >>> 28) & 15,
    },
    logicalOperation: (r(Reg.GPUREG_LOGIC_OP) ?? 0) & 15,
    alphaTest: { enabled: (at & 1) !== 0, function: (at >> 4) & 7, reference: (at >> 8) & 255 },
    stencilTest: { enabled: (stt & 1) !== 0, function: (stt >> 4) & 7, bufferMask: (stt >> 8) & 255, reference: (stt >> 16) & 255, mask: stt >>> 24 },
    stencilOperation: { failOp: sop & 7, zFailOp: (sop >> 4) & 7, zPassOp: (sop >> 8) & 7 },
    depthColorMask: {
      enabled: (dcm & 1) !== 0, depthFunc: (dcm >> 4) & 7, redWrite: (dcm & 0x100) !== 0, greenWrite: (dcm & 0x200) !== 0,
      blueWrite: (dcm & 0x400) !== 0, alphaWrite: (dcm & 0x800) !== 0, depthWrite: (dcm & 0x1000) !== 0,
    },
    faceCulling: (r(Reg.GPUREG_FACECULLING_CONFIG) ?? 0) & 3,
    colorBufferRead: ((r(Reg.GPUREG_COLORBUFFER_READ) ?? 0) & 15) === 15,
    colorBufferWrite: ((r(Reg.GPUREG_COLORBUFFER_WRITE) ?? 0) & 15) === 15,
    stencilBufferRead: (dbr & 1) !== 0,
    depthBufferRead: (dbr & 2) !== 0,
    stencilBufferWrite: (dbw & 1) !== 0,
    depthBufferWrite: (dbw & 2) !== 0,
    textureSources: [u10[0], u10[1], u10[2], u10[3]],
    vtxShaderUniforms: st.vtxUniforms,
    geoShaderUniforms: st.geoUniforms,
  };
}

// ---- Textures, LUTs, shaders, lights, cameras

/** Bytes of a PICA texture of `w` × `h` (one level). */
export function textureLength(format: number, w: number, h: number): number {
  const bpp = [32, 24, 16, 16, 16, 16, 16, 8, 8, 8, 4, 4, 4, 8][format] ?? 0;
  return (w * h * bpp) >> 3;
}

/** Bytes of all `levels` mip levels. */
export function mipmapLength(format: number, w: number, h: number, levels: number): number {
  let n = 0;
  for (let i = 0; i < Math.max(levels, 1); i++) n += textureLength(format, Math.max(w >> i, 8), Math.max(h >> i, 8));
  return n;
}

/** The address registers of texture units 0 (6 cube faces), 1 and 2. */
export const TEXTURE_ADDRESS_REGS = [[Reg.GPUREG_TEXUNIT0_ADDR1, 0x86, 0x87, 0x88, 0x89, 0x8a], [Reg.GPUREG_TEXUNIT1_ADDR], [Reg.GPUREG_TEXUNIT2_ADDR]];

function readTexture(c: Ctx, o: number): H3DTexture {
  return c.cached('texture', o, () => {
    const t0 = c.words(o) ?? new Uint32Array(0);
    const t1 = c.words(o + 8) ?? undefined;
    const t2 = c.words(o + 0x10) ?? undefined;
    const format = c.u8(o + 0x18), mipmapSize = c.u8(o + 0x19);
    const st = commandState(t0);
    const dim = st.regs.get(Reg.GPUREG_TEXUNIT0_DIM) ?? 0;
    const width = (dim >>> 16) & 0x7ff, height = dim & 0x7ff;
    const len = mipmapLength(format, width, height, mipmapSize);
    const rawBuffers: Uint8Array[] = [];
    for (const reg of TEXTURE_ADDRESS_REGS[0]!) {
      const a = st.regs.get(reg);
      if (!a) break;
      rawBuffers.push(c.cached('raw', a, () => {
        const r = c.b.slice(a, a + len);
        c.mark(r, 'raw', a, a + len);
        return r;
      }));
    }
    clearAddresses(c, t0, TEXTURE_ADDRESS_REGS[0]!);
    if (t1) clearAddresses(c, t1, TEXTURE_ADDRESS_REGS[1]!);
    if (t2) clearAddresses(c, t2, TEXTURE_ADDRESS_REGS[2]!);
    const t: H3DTexture = { name: c.name(o + 0x1c), format, mipmapSize, width, height, rawBuffers, texture0Commands: t0, texture1Commands: t1, texture2Commands: t2 };
    c.mark(t, 'texture', o, o + 0x20);
    return t;
  });
}

function readLUT(c: Ctx, o: number): H3DLUT {
  const samplers = list(c, o, [] as H3DLUT['samplers'], 'samplers', 0x10, (p, i) => {
    const s = p + i * 0x10;
    const commands = c.words(s + 4) ?? new Uint32Array(0);
    const table = new Array<number>(256).fill(0);
    let index = 0;
    for (const cmd of readCommands(commands)) {
      if (cmd.register === Reg.GPUREG_LIGHTING_LUT_INDEX) index = cmd.value & 0xff;
      else if (cmd.register >= Reg.GPUREG_LIGHTING_LUT_DATA0 && cmd.register <= Reg.GPUREG_LIGHTING_LUT_DATA7 && index < 256) table[index++] = (cmd.value & 0xfff) / 0xfff;
    }
    return { flags: c.u8(s), commands, name: c.name(s + 0x0c), table };
  });
  const lut: H3DLUT = { name: c.name(o + 8), samplers };
  c.mark(lut, 'lut', o, o + 0x0c);
  return lut;
}

function readShader(c: Ctx, o: number): H3DShader {
  const pp = c.ptr(o), pn = c.u32(o + 4);
  // The 4 shaders of a program share it.
  const program = pp
    ? c.cached('program', pp, () => {
        const r = c.b.slice(pp, pp + pn);
        c.mark(r, 'raw', pp, pp + pn);
        return r;
      })
    : null;
  const s: H3DShader = {
    program,
    shaderAllCommands: c.words(o + 8),
    shaderProgramCommands: c.words(o + 0x10),
    shaderSetupCommands: c.words(o + 0x18),
    vtxShaderIndex: c.s16(o + 0x20),
    geoShaderIndex: c.s16(o + 0x22),
    bindingAddress: c.u32(o + 0x24),
    name: c.name(o + 0x28),
    userDefinedAddress: c.u32(o + 0x2c),
  };
  c.mark(s, 'shader', o, o + 0x30);
  return s;
}

/** Bytes of a light's content by type (SPICA H3DHemisphereLight 0x30, Ambient 4, Vertex 0x40, Fragment 0x3C). */
export const lightContentSize = (type: number): number => (type === 1 ? 0x30 : type === 2 ? 4 : (type & 4) !== 0 ? 0x40 : (type & 8) !== 0 ? 0x3c : 0);

function readLight(c: Ctx, o: number): H3DLight {
  const type = c.u8(o + 0x28);
  const size = lightContentSize(type);
  const fragment = (type & 8) !== 0;
  const l: H3DLight = {
    name: c.name(o),
    transformScale: c.vec3(o + 4),
    transformRotation: c.vec3(o + 0x10),
    transformTranslation: c.vec3(o + 0x1c),
    type,
    enabled: c.u8(o + 0x29),
    flags: c.u8(o + 0x2a),
    lutConfig: c.u8(o + 0x2b),
    metaData: readMetaData(c, o + 0x2c),
    content: c.b.slice(o + 0x30, o + 0x30 + size),
    lutNames: fragment ? [0, 1, 2, 3].map((i) => c.str(o + 0x30 + 0x2c + i * 4)) : [],
  };
  c.mark(l, 'light', o, o + 0x30 + size);
  return l;
}

/** Floats of each camera view type (Aim, LookAt, Rotate). */
export const CAMERA_VIEW_SIZE = [4, 6, 3];

function readCamera(c: Ctx, o: number): H3DCamera {
  const viewType = c.u8(o + 0x28), projectionType = c.u8(o + 0x29);
  const vp = c.ptr(o + 0x30), pp = c.ptr(o + 0x34);
  const viewSize = CAMERA_VIEW_SIZE[viewType] ?? 0;
  const view = vp ? c.mtx(vp, viewSize) : null;
  const projection = pp ? c.mtx(pp, 4) : null;
  if (view) c.mark(view, 'view', vp, vp + viewSize * 4);
  if (projection) c.mark(projection, 'projection', pp, pp + 16);
  const cam: H3DCamera = {
    name: c.name(o),
    transformScale: c.vec3(o + 4),
    transformRotation: c.vec3(o + 0x10),
    transformTranslation: c.vec3(o + 0x1c),
    viewType,
    projectionType,
    flags: c.u8(o + 0x2a),
    wScale: c.f32(o + 0x2c),
    view,
    projection,
    metaData: readMetaData(c, o + 0x38),
  };
  c.mark(cam, 'camera', o, o + 0x3c);
  return cam;
}

// ---- Animations

/** Key frame size of each quantization. */
export const KEY_SIZE = [16, 8, 6, 12, 6, 4, 8, 4];

/** The bytes of the keys as read and the keys they decoded to (the writer reuses the bytes while nothing changed). */
export const keyBytes = new WeakMap<KeyFrame[], { bytes: Uint8Array; decoded: KeyFrame[]; params: number[] }>();

function readKeys(c: Ctx, o: number, quant: number, n: number, frameScale: number, valueScale: number, valueOffset: number): KeyFrame[] {
  const out: KeyFrame[] = [];
  const start = o;
  for (let i = 0; i < n; i++) {
    let frame = 0, value = 0, inSlope = 0, outSlope = 0;
    switch (quant) {
      case 0: frame = c.f32(o); value = c.f32(o + 4); inSlope = c.f32(o + 8); outSlope = c.f32(o + 12); break;
      case 1: {
        const w = c.u32(o);
        frame = w & 0xfff; value = w >>> 12; inSlope = c.s16(o + 4) / 256; outSlope = c.s16(o + 6) / 256; break;
      }
      case 2: {
        frame = c.u8(o); value = c.u16(o + 1);
        const sl = c.u8(o + 3) | (c.u8(o + 4) << 8) | (c.u8(o + 5) << 16);
        inSlope = ((sl << 20) >> 20) / 32; outSlope = ((sl << 8) >> 20) / 32; break;
      }
      case 3: frame = c.f32(o); value = c.f32(o + 4); inSlope = outSlope = c.f32(o + 8); break;
      case 4: frame = c.u16(o) / 32; value = c.u16(o + 2); inSlope = outSlope = c.s16(o + 4) / 256; break;
      case 5: {
        const w = c.u8(o + 1) | (c.u8(o + 2) << 8) | (c.u8(o + 3) << 16);
        frame = c.u8(o); value = w & 0xfff; inSlope = outSlope = ((w << 8) >> 20) / 32; break;
      }
      case 6: frame = c.f32(o); value = c.f32(o + 4); break;
      case 7: {
        const w = c.u32(o);
        frame = w & 0xfff; value = w >>> 12; break;
      }
      default: throw new Error(`unknown key frame quantization ${quant}`);
    }
    out.push({ frame: frame * frameScale, value: value * valueScale + valueOffset, inSlope, outSlope });
    o += KEY_SIZE[quant]!;
  }
  keyBytes.set(out, { bytes: c.b.slice(start, o), decoded: out.map((k) => ({ ...k })), params: [quant, frameScale, valueScale, valueOffset] });
  return out;
}

/** A segment before version 0x20 (0x20 bytes). */
function readSegment(c: Ctx, s: number): H3DKeySegment {
  const quantization = c.u8(s + 9), count = c.u16(s + 0x0a);
  const invDuration = c.f32(s + 0x0c), valueScale = c.f32(s + 0x10), valueOffset = c.f32(s + 0x14), frameScale = c.f32(s + 0x18), keys = c.ptr(s + 0x1c);
  const keyFrames = keys ? readKeys(c, keys, quantization, count, frameScale, valueScale, valueOffset) : [];
  if (keys) c.mark(keyFrames, 'keys', keys, keys + count * KEY_SIZE[quantization]!);
  else nullValues.add(keyFrames);
  return { startFrame: c.f32(s), endFrame: c.f32(s + 4), interpolationType: c.u8(s + 8), quantization, valueScale, valueOffset, frameScale, invDuration, keyFrames };
}

/**
 * H3DFloatKeyFrameGroup. From version 0x20 (0x24 bytes) the segment is in the curve; before (0x14 bytes) the curve
 * has a list {pointer, count} of segments (0x20 bytes each; RPG3 has curves of several segments, e.g. hermite and
 * step parts of a material animation).
 */
function readCurve(c: Ctx, o: number): H3DFloatKeyFrameGroup {
  return c.cached('curve', o, () => {
    const head = { startFrame: c.f32(o), endFrame: c.f32(o + 4), preRepeat: c.u8(o + 8), postRepeat: c.u8(o + 9), curveIndex: c.u16(o + 0x0a) };
    let curve: H3DFloatKeyFrameGroup;
    if (c.version >= 0x20) {
      const s = o + 0x0c;
      const quantization = c.u8(s + 1), count = c.u16(s + 2);
      const valueScale = c.f32(s + 4), valueOffset = c.f32(s + 8), frameScale = c.f32(s + 0x0c), invDuration = c.f32(s + 0x10), keys = c.ptr(s + 0x14);
      const keyFrames = keys ? readKeys(c, keys, quantization, count, frameScale, valueScale, valueOffset) : [];
      if (keys) c.mark(keyFrames, 'keys', keys, keys + count * KEY_SIZE[quantization]!);
      else nullValues.add(keyFrames);
      curve = { ...head, interpolationType: c.u8(s), quantization, valueScale, valueOffset, frameScale, invDuration, keyFrames };
      c.mark(curve, 'curve', o, o + 0x24);
    } else {
      const sp = c.ptr(o + 0x0c), n = c.u32(o + 0x10);
      if (!sp || n < 1) throw new Error('a curve without segments');
      const [first, ...more] = Array.from({ length: n }, (_, i) => readSegment(c, sp + i * 0x20));
      const { startFrame, endFrame, ...seg } = first!;
      curve = { ...head, ...seg };
      if (startFrame !== head.startFrame) curve.segmentStart = startFrame;
      if (endFrame !== head.endFrame) curve.segmentEnd = endFrame;
      if (more.length) curve.moreSegments = more;
      c.mark(curve, 'segment', sp, sp + n * 0x20);
      c.mark(curve, 'curve', o, o + 0x14);
    }
    return curve;
  });
}

function readSlot(c: Ctx, at: number, constant: boolean, absent: boolean): H3DAnimSlot {
  if (absent) return null;
  if (constant) return c.f32(at);
  const p = c.ptr(at);
  return p ? readCurve(c, p) : null;
}

export const TRANSFORM_CONST = [6, 7, 8, 9, 10, 11, 13, 14, 15];
export const TRANSFORM_ABSENT = [16, 17, 18, 19, 20, 21, 22, 23, 24];
export const TRANSFORM_KNOWN = [...TRANSFORM_CONST, ...TRANSFORM_ABSENT].reduce((m, b) => m | (1 << b), 0);

function readQuatTrack<T>(c: Ctx, p: number, constant: boolean, size: number): H3DQuatTrack<T> {
  const read = (o: number): T => (size === 3 ? c.vec3(o) : c.vec4(o)) as T;
  if (constant) {
    const t: H3DQuatTrack<T> = { constant: true, startFrame: 0, endFrame: 0, flags: 0, frames: [read(p)] };
    c.mark(t, 'track', p, p + size * 4);
    return t;
  }
  const fp = c.ptr(p + 0x0c), n = c.u32(p + 0x10);
  const frames = Array.from({ length: fp ? n : 0 }, (_, i) => read(fp + i * size * 4));
  if (fp) c.mark(frames, 'frames', fp, fp + n * size * 4);
  else nullValues.add(frames);
  const t: H3DQuatTrack<T> = { constant: false, startFrame: c.f32(p), endFrame: c.f32(p + 4), flags: c.u32(p + 8), frames };
  c.mark(t, 'track', p, p + 0x14);
  return t;
}

function readContent(c: Ctx, o: number, prim: number): H3DAnimContent {
  const flags = c.u32(o);
  switch (prim) {
    case H3DPrimitiveType.Transform: {
      const s = TRANSFORM_CONST.map((cb, i) => readSlot(c, o + 4 + i * 4, (flags & (1 << cb)) !== 0, (flags & (1 << TRANSFORM_ABSENT[i]!)) !== 0));
      return {
        kind: 'transform', scaleX: s[0]!, scaleY: s[1]!, scaleZ: s[2]!, rotationX: s[3]!, rotationY: s[4]!, rotationZ: s[5]!,
        translationX: s[6]!, translationY: s[7]!, translationZ: s[8]!, flagsRest: flags & ~TRANSFORM_KNOWN,
      };
    }
    case H3DPrimitiveType.QuatTransform: {
      const part = <T>(i: number, size: number): H3DQuatTrack<T> | null => {
        if (flags & (1 << (5 - i))) return null;
        const p = c.ptr(o + 4 + i * 4);
        return p ? readQuatTrack<T>(c, p, (flags & (1 << (2 - i))) !== 0, size) : null;
      };
      if (flags & ~0x3f) throw new Error(`quaternion transform flags ${flags.toString(16)}`);
      return { kind: 'quatTransform', scales: part<Vector3>(0, 3), rotations: part<Vector4>(1, 4), translations: part<Vector3>(2, 3) };
    }
    case H3DPrimitiveType.Boolean: {
      const values = readBools(c, o + 0x0c);
      return { kind: 'boolean', startFrame: c.f32(o), endFrame: c.f32(o + 4), preRepeat: c.u8(o + 8), postRepeat: c.u8(o + 9), curveIndex: c.u16(o + 0x0a), values };
    }
    case H3DPrimitiveType.MtxTransform: {
      const p = c.ptr(o + 0x0c), n = c.u32(o + 0x10);
      const frames = Array.from({ length: p ? n : 0 }, (_, i): Matrix3x4 => c.mtx(p + i * 48, 12));
      if (p) c.mark(frames, 'frames', p, p + n * 48);
      else nullValues.add(frames);
      return { kind: 'mtxTransform', startFrame: c.f32(o), endFrame: c.f32(o + 4), preRepeat: c.u8(o + 8), postRepeat: c.u8(o + 9), curveIndex: c.u16(o + 0x0a), frames };
    }
  }
  const n = vectorSlots(prim);
  if (!n) throw new Error(`unknown animation primitive type ${prim}`);
  const slots = Array.from({ length: n }, (_, i) => readSlot(c, o + 4 + i * 4, (flags & (1 << i)) !== 0, (flags & (1 << (8 + i))) !== 0));
  const known = Array.from({ length: n }, (_, i) => (1 << i) | (1 << (8 + i))).reduce((a, b) => a | b, 0);
  return { kind: 'vector', slots, flagsRest: flags & ~known };
}

/** Bytes of an element's content. */
export function contentSize(prim: number): number {
  switch (prim) {
    case H3DPrimitiveType.Transform: return 40;
    case H3DPrimitiveType.QuatTransform: return 16;
    case H3DPrimitiveType.Boolean:
    case H3DPrimitiveType.MtxTransform:
      return 0x14;
  }
  return 4 + vectorSlots(prim) * 4;
}

/** Version 8 has the type at +0x04 and the flags at +0x05; from 0x20 they swap. */
export const animationFlagsSwapped = (version: number): boolean => version < 0x20;

function readAnimation(c: Ctx, o: number, material: boolean): H3DAnimation | H3DMaterialAnim {
  const swapped = animationFlagsSwapped(c.version);
  const elements = list(c, o + 0x0c, [] as H3DAnimation['elements'], 'elements', 4, (p, i) => {
    const e = c.ptr(p + i * 4);
    const prim = c.u16(e + 6);
    const el = { name: c.name(e), targetType: c.u16(e + 4), primitiveType: prim, content: readContent(c, e + 8, prim) };
    c.mark(el, 'element', e, e + 8 + contentSize(prim));
    return el;
  });
  const anim: H3DAnimation = {
    name: c.name(o),
    animationFlags: c.u8(o + (swapped ? 5 : 4)),
    animationType: c.u8(o + (swapped ? 4 : 5)),
    curvesCount: c.u16(o + 6),
    framesCount: c.f32(o + 8),
    elements,
    metaData: readMetaData(c, o + 0x14),
  };
  if (!material) {
    c.mark(anim, 'animation', o, o + 0x18);
    return anim;
  }
  const textureNames = list(c, o + 0x18, [] as string[], 'names', 4, (p, i) => c.name(p + i * 4));
  const m: H3DMaterialAnim = { ...anim, textureNames };
  c.mark(m, 'animation', o, o + 0x20);
  return m;
}

// ---- Root

export interface ReadOptions {
  trace?: H3DTrace;
}

/** Read a BCH (bytes start at "BCH\0"). */
export function readH3D(bch: Uint8Array, opts: ReadOptions = {}): H3D {
  const h = readH3DHeader(bch);
  const relocs = readRelocations(bch, h);
  const c = new Ctx(relocate(bch, h, relocs), h, relocs, opts.trace);
  const root = h.contentsAddress;
  const d = (i: number): number => root + i * 12;
  const unsupported = (what: string) => (): never => {
    throw new Error(`${what} are not supported`);
  };
  const out: H3D = {
    backwardCompatibility: h.backwardCompatibility,
    forwardCompatibility: h.forwardCompatibility,
    converterVersion: h.converterVersion,
    flags: h.flags,
    models: readDict(c, d(0), (o) => readModel(c, o)),
    materials: readDict(c, d(1), (o) => readMaterialParams(c, o)),
    shaders: readDict(c, d(2), (o) => readShader(c, o)),
    textures: readDict(c, d(3), (o) => readTexture(c, o)),
    luts: readDict(c, d(4), (o) => readLUT(c, o)),
    lights: readDict(c, d(5), (o) => readLight(c, o)),
    cameras: readDict(c, d(6), (o) => readCamera(c, o)),
    fogs: readDict(c, d(7), unsupported('fogs')),
    skeletalAnimations: readDict(c, d(8), (o) => readAnimation(c, o, false)),
    materialAnimations: readDict(c, d(9), (o) => readAnimation(c, o, true) as H3DMaterialAnim),
    visibilityAnimations: readDict(c, d(10), (o) => readAnimation(c, o, false)),
    lightAnimations: readDict(c, d(11), (o) => readAnimation(c, o, false)),
    cameraAnimations: readDict(c, d(12), (o) => readAnimation(c, o, false)),
    fogAnimations: readDict(c, d(13), (o) => readAnimation(c, o, false)),
    scenes: readDict(c, d(14), unsupported('scenes')),
  };
  c.mark(out, 'root', root, root + 15 * 12);
  if (h.unInitDataLength) out.unInitDataLength = h.unInitDataLength;
  if (h.unInitCommandsLength) out.unInitCommandsLength = h.unInitCommandsLength;
  // Bytes outside every block that are not 0 (padding some converters fill with 0xFF).
  c.ranges.push([0, headerLength(h.backwardCompatibility)], [h.relocationAddress, h.relocationAddress + h.relocationLength]);
  c.ranges.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  const fill: [number, Uint8Array][] = [];
  const gap = (from: number, to: number): void => {
    let i = from;
    while (i < to) {
      while (i < to && bch[i] === 0) i++;
      let e = i;
      while (e < to && bch[e] !== 0) e++;
      if (e > i) fill.push([i, bch.slice(i, e)]);
      i = e;
    }
  };
  for (const [s, e] of c.ranges) {
    if (s > covered) gap(covered, s);
    covered = Math.max(covered, e);
  }
  gap(covered, bch.length);
  c.layout.fill = fill;
  Object.defineProperty(out, 'layout', { value: c.layout, enumerable: false, writable: true, configurable: true });
  return out;
}
