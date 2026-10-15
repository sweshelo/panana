// H3D (BCH) writer: the object model of types.ts -> bytes, for backward compatibility 8 (RPG3) or 0x21 (RPG FREE!).
//
// The writer turns the objects into blocks (a struct, a list, a string, a command list, a buffer), each with the
// pointers it holds (fixups), then lays the blocks out and writes the relocation table (SPICA H3DRelocator.ToRelative).
// Layout: when the H3D was read from a file of the same version and every block has its place in that file
// (H3DLayout), each block goes back where it was, so an unchanged file comes out byte-identical. Otherwise the
// blocks are placed in the order they are made (breadth first, like SPICA's serializer), the strings sorted
// (SPICA H3DComparers), raw data after the commands, aligned like RPG FREE!'s files.
import { fragmentShaderCommands, lutSamplerCommands, materialTextureCommands, meshCommands, subMeshCommands, textureCommands } from './commands';
import { buildPatriciaTree } from './patricia';
import { readCommands, Reg } from './pica';
import {
  animationFlagsSwapped, contentSize, headerLength, KEY_SIZE, keyBytes, legacyRelocDiff, lightContentSize, nullValues, paramsSize, Sec,
  TEXTURE_ADDRESS_REGS, TRANSFORM_ABSENT, TRANSFORM_CONST, treeless,
} from './read';
import type {
  H3D, H3DAnimation, H3DAnimContent, H3DAnimSlot, H3DBone, H3DCamera, H3DFloatKeyFrameGroup, H3DKeySegment, H3DLight, H3DLUT,
  H3DMaterial, H3DMaterialAnim, H3DMaterialParams, H3DMesh, H3DMetaData, H3DModel, H3DQuatTrack, H3DShader, H3DSubMesh, H3DTexture,
  H3DTextureMapper, KeyFrame, RGBA,
} from './types';
import { H3DPrimitiveType } from './types';

/** Sections of the file, in file order. */
const enum S { Contents, Strings, Commands, RawData, RawExt }
const SECTION_KIND = [Sec.Contents, Sec.Strings, Sec.Commands, Sec.RawData, Sec.RawExt];

interface Fixup {
  at: number;
  target: Block | null;
  addend: number;
  /** H3DSection of the target. */
  kind: number;
}

class Block {
  readonly bytes: Uint8Array;
  readonly dv: DataView;
  readonly fixups: Fixup[] = [];
  offset = -1;

  constructor(
    readonly sec: S,
    size: number,
    readonly align: number,
    readonly owner: object | string | null,
    readonly role: string,
  ) {
    this.bytes = new Uint8Array(size);
    this.dv = new DataView(this.bytes.buffer);
  }

  get size(): number {
    return this.bytes.length;
  }

  u8(o: number, v: number): void {
    this.bytes[o] = v & 0xff;
  }
  u16(o: number, v: number): void {
    this.dv.setUint16(o, v & 0xffff, true);
  }
  u32(o: number, v: number): void {
    this.dv.setUint32(o, v >>> 0, true);
  }
  f32(o: number, v: number): void {
    this.dv.setFloat32(o, v, true);
  }
  floats(o: number, v: readonly number[]): void {
    v.forEach((x, i) => this.f32(o + i * 4, x));
  }
  rgba(o: number, c: RGBA): void {
    this.bytes.set(c, o);
  }
}

export interface WriteOptions {
  /** Backward compatibility of the output (default: the version the H3D was read with). */
  backward?: number;
  /** Header forward compatibility and converter version (default: the H3D's). */
  forward?: number;
  converter?: number;
  /** Header flags (default: the H3D's; RPG3's files have 4, RPG FREE!'s 5). */
  flags?: number;
  /** Lay the file out anew even when the read layout could be kept. */
  freshLayout?: boolean;
}

class Writer {
  readonly blocks: Block[] = [];
  private readonly owned = new WeakMap<object, Map<string, Block>>();
  private readonly strings = new Map<string, Block>();
  private readonly queue: (() => void)[] = [];

  constructor(readonly v: number) {}

  /** The block `role` of `owner` (made once; `fill` runs later, breadth first). */
  block(sec: S, size: number, align: number, owner: object | null, role: string, fill?: (b: Block) => void): Block {
    if (owner) {
      const have = this.owned.get(owner)?.get(role);
      if (have) return have;
    }
    const b = new Block(sec, size, align, owner, role);
    this.blocks.push(b);
    if (owner) {
      let m = this.owned.get(owner);
      if (!m) this.owned.set(owner, (m = new Map()));
      m.set(role, b);
    }
    if (fill) this.queue.push(() => fill(b));
    return b;
  }

  run(): void {
    for (let i = 0; i < this.queue.length; i++) this.queue[i]!();
  }

  ptr(b: Block, at: number, target: Block | null, addend = 0, kind?: number): void {
    if (!target) {
      b.u32(at, 0);
      return;
    }
    b.fixups.push({ at, target, addend, kind: kind ?? SECTION_KIND[target.sec]! });
  }

  str(b: Block, at: number, s: string | null): void {
    if (s === null) return this.ptr(b, at, null);
    let t = this.strings.get(s);
    if (!t) {
      t = new Block(S.Strings, s.length + 1, 1, s, 'string');
      for (let i = 0; i < s.length; i++) t.bytes[i] = s.charCodeAt(i) & 0xff;
      this.strings.set(s, t);
      this.blocks.push(t);
    }
    this.ptr(b, at, t);
  }

  /** {pointer, word count} of a command list. */
  cmd(b: Block, at: number, words: Uint32Array | null | undefined, addresses?: (cb: Block) => void): Block | null {
    if (!words) {
      this.ptr(b, at, null);
      b.u32(at + 4, 0);
      return null;
    }
    const cb = this.block(S.Commands, words.length * 4, 4, words, 'cmd', (x) => {
      words.forEach((w, i) => x.u32(i * 4, w));
      addresses?.(x);
    });
    this.ptr(b, at, cb);
    b.u32(at + 4, words.length);
    return cb;
  }

  // ---- Dictionaries, lists, metadata

  tree(b: Block, at: number, owner: object, names: string[]): void {
    const nodes = buildPatriciaTree(names);
    const t = this.block(S.Contents, nodes.length * 12, 4, owner, 'tree', (x) => {
      nodes.forEach((n, i) => {
        x.u32(i * 12, n.referenceBit);
        x.u16(i * 12 + 4, n.left);
        x.u16(i * 12 + 6, n.right);
        this.str(x, i * 12 + 8, n.name);
      });
    });
    this.ptr(b, at, t);
  }

  /** H3DDict {values, count, tree}: values are pointers to `item` blocks, or inline structs of `inline` bytes. */
  dict<T>(b: Block, at: number, values: T[], name: (v: T) => string, item: { ptr: (v: T) => Block } | { inline: number; fill: (x: Block, o: number, v: T) => void }): void {
    if (!treeless.has(values)) this.tree(b, at + 8, values, values.map(name));
    if (nullValues.has(values) && !values.length) this.ptr(b, at, null);
    else {
      const size = 'inline' in item ? item.inline : 4;
      const vb = this.block(S.Contents, values.length * size, 4, values, 'values', (x) => {
        values.forEach((v, i) => ('inline' in item ? item.fill(x, i * size, v) : this.ptr(x, i * 4, item.ptr(v))));
      });
      this.ptr(b, at, vb);
    }
    b.u32(at + 4, values.length);
  }

  /** {pointer, count} of a list of `size`-byte items. */
  list<T>(b: Block, at: number, values: T[], role: string, size: number, fill: (x: Block, o: number, v: T, i: number) => void, align = 4): void {
    if (nullValues.has(values) && !values.length) this.ptr(b, at, null);
    else this.ptr(b, at, this.block(S.Contents, values.length * size, align, values, role, (x) => values.forEach((v, i) => fill(x, i * size, v, i))));
    b.u32(at + 4, values.length);
  }

  bools(b: Block, at: number, values: boolean[]): void {
    if (nullValues.has(values) && !values.length) this.ptr(b, at, null);
    else
      this.ptr(b, at, this.block(S.Contents, Math.ceil(values.length / 8), 4, values, 'bits', (x) => {
        values.forEach((v, i) => {
          if (v) x.u8(i >> 3, x.bytes[i >> 3]! | (1 << (i & 7)));
        });
      }));
    b.u32(at + 4, values.length);
  }

  metaData(b: Block, at: number, m: H3DMetaData): void {
    if (!m) return this.ptr(b, at, null);
    const mb = this.block(S.Contents, 12, 4, m, 'meta', (x) => {
      this.dict(x, 0, m, (v) => v.name, {
        inline: 12,
        fill: (y, o, v) => {
          this.str(y, o, v.name);
          y.u16(o + 4, v.type);
          y.u16(o + 6, v.values.length);
          const vals = v.values as unknown[];
          if (nullValues.has(vals) && !vals.length) return this.ptr(y, o + 8, null);
          const size = [4, 4, 4, 4, 0x3c, 0x0c][v.type]!;
          this.ptr(y, o + 8, this.block(S.Contents, vals.length * size, 4, vals, 'data', (z) => {
            vals.forEach((e, i) => {
              const p = i * size;
              switch (v.type) {
                case 0: z.u32(p, e as number); break;
                case 1: z.f32(p, e as number); break;
                case 2: this.str(z, p, e as string); break;
                case 3: {
                  const s = e as string;
                  const u = this.block(S.Strings, (s.length + 1) * 2, 2, vals, `u16:${i}`, (w) => {
                    for (let k = 0; k < s.length; k++) w.u16(k * 2, s.charCodeAt(k));
                  });
                  this.ptr(z, p, u);
                  break;
                }
                case 4: {
                  const bb = e as { center: number[]; orientation: number[]; size: number[] };
                  z.floats(p, [...bb.center, ...bb.orientation, ...bb.size]);
                  break;
                }
                default: throw new Error('vertex data metadata cannot be written');
              }
            });
          }));
        },
      });
    });
    this.ptr(b, at, mb);
  }

  // ---- Root

  root(h: H3D): void {
    const r = this.block(S.Contents, 15 * 12, 4, h, 'root');
    const named = <T extends { name: string }>(v: T): string => v.name;
    this.dict(r, 0, h.models, named, { ptr: (m) => this.model(m) });
    this.dict(r, 12, h.materials, (p) => p.modelReference, { ptr: (p) => this.params(p) });
    this.dict(r, 24, h.shaders, named, { ptr: (s) => this.shader(s) });
    this.dict(r, 36, h.textures, named, { ptr: (t) => this.texture(t) });
    this.dict(r, 48, h.luts, named, { ptr: (l) => this.lut(l) });
    this.dict(r, 60, h.lights, named, { ptr: (l) => this.light(l) });
    this.dict(r, 72, h.cameras, named, { ptr: (c) => this.camera(c) });
    if (h.fogs.length || h.scenes.length) throw new Error('fogs and scenes cannot be written');
    this.dict(r, 84, h.fogs, named, { ptr: () => r });
    this.dict(r, 96, h.skeletalAnimations, named, { ptr: (a) => this.animation(a, false) });
    this.dict(r, 108, h.materialAnimations, named, { ptr: (a) => this.animation(a, true) });
    this.dict(r, 120, h.visibilityAnimations, named, { ptr: (a) => this.animation(a, false) });
    this.dict(r, 132, h.lightAnimations, named, { ptr: (a) => this.animation(a, false) });
    this.dict(r, 144, h.cameraAnimations, named, { ptr: (a) => this.animation(a, false) });
    this.dict(r, 156, h.fogAnimations, named, { ptr: (a) => this.animation(a, false) });
    this.dict(r, 168, h.scenes, named, { ptr: () => r });
  }

  // ---- Model

  model(m: H3DModel): Block {
    return this.block(S.Contents, 0x98, 4, m, 'model', (b) => {
      const v21 = this.v >= 0x21;
      b.u8(0, m.flags);
      b.u8(1, m.boneScaling);
      b.u16(2, m.silhouetteMaterialsCount);
      b.floats(4, m.worldTransform);
      this.dict(b, 0x34, m.materials, (x) => x.name, { inline: v21 ? 0x2c : 0x58, fill: (x, o, mat) => this.material(x, o, mat) });
      this.list(b, 0x40, m.meshes, 'meshes', 0x38, (x, o, mesh) => this.mesh(x, o, mesh, b));
      const meshes = this.owned.get(m.meshes)?.get('meshes') ?? null;
      let pos = 0;
      [m.meshesLayer0, m.meshesLayer1, m.meshesLayer2, m.meshesLayer3].forEach((layer, i) => {
        if (layer.length) {
          pos = m.meshes.indexOf(layer[0]!);
          if (pos < 0 || layer.some((x, k) => m.meshes[pos + k] !== x)) throw new Error(`model ${m.name}: the meshes of layer ${i} are not a run of the mesh list`);
        }
        this.ptr(b, 0x48 + i * 8, meshes, pos * 0x38);
        pos += layer.length;
        this.ptr(b, 0x4c + i * 8, meshes, pos * 0x38);
      });
      if (this.v >= 7) this.list(b, 0x68, m.subMeshCullings, 'cullings', 0, () => {});
      this.dict(b, 0x70, m.skeleton, (x) => x.name, { inline: 0x64, fill: (x, o, bone) => this.bone(x, o, bone) });
      this.bools(b, 0x7c, m.meshNodesVisibility);
      this.str(b, 0x84, m.name);
      b.u32(0x88, m.meshNodesCount);
      if (m.meshNodesTree) this.tree(b, 0x8c, m.meshNodesTree, m.meshNodesTree);
      b.u32(0x90, m.userDefinedAddress);
      this.metaData(b, 0x94, m.metaData);
    });
  }

  bone(b: Block, o: number, x: H3DBone): void {
    b.u32(o, x.flags);
    b.u16(o + 4, x.parentIndex);
    b.floats(o + 8, [...x.scale, ...x.rotation, ...x.translation, ...x.inverseTransform]);
    this.str(b, o + 0x5c, x.name);
    this.metaData(b, o + 0x60, x.metaData);
  }

  mesh(b: Block, o: number, m: H3DMesh, model: Block): void {
    b.u16(o, m.materialIndex);
    b.u8(o + 2, (m.type & 3) | ((m.skinning & 3) << 2) | m.flagsRest);
    b.u16(o + 4, m.nodeIndex);
    b.u16(o + 6, (m.priority & 0xff) | ((m.layer & 3) << 8) | m.keyRest);
    let enable = m.enableCommands, disable = m.disableCommands;
    if (!enable) {
      const g = meshCommands(m);
      enable = g.enable;
      disable ??= g.disable;
    }
    const raw = m.rawBuffer.length ? this.block(S.RawData, m.rawBuffer.length, 4, m.rawBuffer, 'raw', (x) => x.bytes.set(m.rawBuffer)) : null;
    this.cmd(b, o + 8, enable, (x) => {
      for (const c of readCommands(enable!)) {
        // The base address: a BaseAddress relocation from version 0x21, before it the value RPG3's converter wrote.
        if (c.register === Reg.GPUREG_ATTRIBBUFFERS_LOC) {
          if (this.v >= 0x21) this.ptr(x, c.word * 4, x, 0, Sec.BaseAddress);
          else x.u32(c.word * 4, 0x03000000);
        }
        if (c.register === Reg.GPUREG_ATTRIBBUFFER0_OFFSET && raw) this.ptr(x, c.word * 4, raw, 0, Sec.RawDataVertex);
      }
    });
    this.list(b, o + 0x10, m.subMeshes, 'subMeshes', 0x34, (x, so, s) => this.subMesh(x, so, s));
    this.cmd(b, o + 0x18, disable);
    b.floats(o + 0x20, m.meshCenter);
    this.ptr(b, o + 0x2c, model);
    b.u32(o + 0x30, m.userDefinedAddress);
    this.metaData(b, o + 0x34, m.metaData);
  }

  subMesh(b: Block, o: number, s: H3DSubMesh): void {
    b.u8(o, s.skinning);
    b.u16(o + 2, s.boneIndices.length);
    const slots = s.boneIndicesRaw ?? s.boneIndices;
    for (let i = 0; i < 20; i++) b.u16(o + 4 + i * 2, slots[i] ?? 0);
    const wide = s.is16Bit || s.indices.some((i) => i > 0xff);
    const idx = s.indices.length
      ? this.block(S.RawData, s.indices.length * (wide ? 2 : 1), wide ? 2 : 1, s.indices, 'raw', (x) => {
          s.indices.forEach((v, i) => (wide ? x.u16(i * 2, v) : x.u8(i, v)));
        })
      : null;
    const words = s.commands ?? subMeshCommands(s);
    this.cmd(b, o + 0x2c, words, (x) => {
      for (const c of readCommands(words)) if (c.register === Reg.GPUREG_INDEXBUFFER_CONFIG && idx) this.ptr(x, c.word * 4, idx, 0, wide ? Sec.RawDataIndex16 : Sec.RawDataIndex8);
    });
  }

  // ---- Materials

  mapper(b: Block, o: number, m: H3DTextureMapper): void {
    b.u8(o, m.samplerType);
    b.u8(o + 1, m.wrapU);
    b.u8(o + 2, m.wrapV);
    b.u8(o + 3, m.magFilter);
    b.u8(o + 4, m.minFilter);
    b.u8(o + 5, m.minLOD);
    b.f32(o + 8, m.lodBias);
    b.rgba(o + 0x0c, m.borderColor);
  }

  material(b: Block, o: number, m: H3DMaterial): void {
    const v21 = this.v >= 0x21;
    this.ptr(b, o, this.params(m.materialParams));
    this.ptr(b, o + 4, m.texture0 && this.texture(m.texture0));
    this.ptr(b, o + 8, m.texture1 && this.texture(m.texture1));
    this.ptr(b, o + 0x0c, m.texture2 && this.texture(m.texture2));
    this.cmd(b, o + 0x10, m.textureCommands ?? materialTextureCommands(m));
    if (v21) {
      if (nullValues.has(m.textureMappers)) this.ptr(b, o + 0x18, null);
      else this.ptr(b, o + 0x18, this.block(S.Contents, 0x30, 4, m.textureMappers, 'mappers', (x) => m.textureMappers.forEach((t, i) => this.mapper(x, i * 0x10, t))));
    } else m.textureMappers.forEach((t, i) => this.mapper(b, o + 0x18 + i * 0x10, t));
    const n = o + (v21 ? 0x1c : 0x48);
    this.str(b, n, m.texture0Name);
    this.str(b, n + 4, m.texture1Name);
    this.str(b, n + 8, m.texture2Name);
    this.str(b, n + 12, m.name);
  }

  params(p: H3DMaterialParams): Block {
    return this.block(S.Contents, paramsSize(this.v), 4, p, 'params', (b) => {
      let fs = p.fragmentShaderCommands;
      let frameAccess = p.frameAccessOffset;
      if (!fs) ({ words: fs, frameAccessOffset: frameAccess } = fragmentShaderCommands(p));
      b.u32(0, p.uniqueId);
      b.u16(4, p.flags);
      b.u8(6, p.fragmentFlags);
      b.u8(7, frameAccess);
      b.u32(8, p.materialShader);
      p.textureCoords.forEach((t, i) => {
        const o = 0x0c + i * 0x18;
        b.u8(o, t.flags);
        b.u8(o + 1, t.transformType);
        b.u8(o + 2, t.mappingType);
        b.u8(o + 3, t.referenceCameraIndex);
        b.floats(o + 4, [...t.scale, t.rotation, ...t.translation]);
      });
      b.u16(0x54, p.lightSetIndex);
      b.u16(0x56, p.fogIndex);
      [p.emissionColor, p.ambientColor, p.diffuseColor, p.specular0Color, p.specular1Color, p.constant0Color, p.constant1Color,
        p.constant2Color, p.constant3Color, p.constant4Color, p.constant5Color, p.blendColor].forEach((c, i) => b.rgba(0x58 + i * 4, c));
      b.f32(0x88, p.colorScale);
      p.samplerPtrs.forEach((v, i) => b.u32(0x8c + i * 4, v));
      b.u8(0xa4, p.layerConfig);
      b.u8(0xa5, p.fresnelSelector);
      b.u8(0xa6, p.bumpMode);
      b.u8(0xa7, p.bumpTexture);
      p.lutConfigCommands.forEach((v, i) => b.u32(0xa8 + i * 4, v));
      b.u32(0xc0, p.constantColors);
      b.f32(0xc4, p.polygonOffsetUnit);
      const cb = this.cmd(b, 0xc8, fs);
      this.ptr(b, 0xd0, cb, 0, Sec.CommandsSrc);
      [p.lutDist0TableName, p.lutDist1TableName, p.lutFresnelTableName, p.lutReflecRTableName, p.lutReflecGTableName, p.lutReflecBTableName,
        p.lutDist0SamplerName, p.lutDist1SamplerName, p.lutFresnelSamplerName, p.lutReflecRSamplerName, p.lutReflecGSamplerName,
        p.lutReflecBSamplerName, p.shaderReference, p.modelReference].forEach((s, i) => this.str(b, 0xd4 + i * 4, s));
      if (this.v >= 7) this.metaData(b, 0x10c, p.metaData);
    });
  }

  // ---- Textures, LUTs, shaders, lights, cameras

  texture(t: H3DTexture): Block {
    return this.block(S.Contents, 0x20, 4, t, 'texture', (b) => {
      const gen = !t.texture0Commands ? textureCommands(t) : null;
      const raws = t.rawBuffers.map((r) => this.block(S.RawData, r.length, 0x80, r, 'raw', (x) => x.bytes.set(r)));
      const units = [t.texture0Commands ?? gen![0], t.texture1Commands ?? gen?.[1], t.texture2Commands ?? gen?.[2]];
      units.forEach((words, u) => {
        this.cmd(b, u * 8, words, (x) => {
          const regs = TEXTURE_ADDRESS_REGS[u]!;
          for (const c of readCommands(words!)) {
            const face = regs.indexOf(c.register);
            const raw = face >= 0 ? raws[u === 0 ? face : 0] : undefined;
            if (raw) this.ptr(x, c.word * 4, raw, 0, Sec.RawDataTexture);
          }
        });
      });
      b.u8(0x18, t.format);
      b.u8(0x19, t.mipmapSize);
      this.str(b, 0x1c, t.name);
    });
  }

  lut(l: H3DLUT): Block {
    return this.block(S.Contents, 0x0c, 4, l, 'lut', (b) => {
      this.list(b, 0, l.samplers, 'samplers', 0x10, (x, o, s) => {
        x.u8(o, s.flags);
        this.cmd(x, o + 4, s.commands ?? lutSamplerCommands(s));
        this.str(x, o + 0x0c, s.name);
      });
      this.str(b, 8, l.name);
    });
  }

  shader(s: H3DShader): Block {
    return this.block(S.Contents, 0x30, 4, s, 'shader', (b) => {
      const prog = s.program;
      this.ptr(b, 0, prog && this.block(S.Contents, prog.length, 4, prog, 'raw', (x) => x.bytes.set(prog)));
      b.u32(4, prog?.length ?? 0);
      this.cmd(b, 8, s.shaderAllCommands);
      this.cmd(b, 0x10, s.shaderProgramCommands);
      this.cmd(b, 0x18, s.shaderSetupCommands);
      b.u16(0x20, s.vtxShaderIndex);
      b.u16(0x22, s.geoShaderIndex);
      b.u32(0x24, s.bindingAddress);
      this.str(b, 0x28, s.name);
      b.u32(0x2c, s.userDefinedAddress);
    });
  }

  light(l: H3DLight): Block {
    const size = lightContentSize(l.type);
    return this.block(S.Contents, 0x30 + size, 4, l, 'light', (b) => {
      this.str(b, 0, l.name);
      b.floats(4, [...l.transformScale, ...l.transformRotation, ...l.transformTranslation]);
      b.u8(0x28, l.type);
      b.u8(0x29, l.enabled);
      b.u8(0x2a, l.flags);
      b.u8(0x2b, l.lutConfig);
      this.metaData(b, 0x2c, l.metaData);
      b.bytes.set(l.content.subarray(0, size), 0x30);
      l.lutNames.forEach((n, i) => this.str(b, 0x5c + i * 4, n));
    });
  }

  camera(c: H3DCamera): Block {
    return this.block(S.Contents, 0x3c, 4, c, 'camera', (b) => {
      this.str(b, 0, c.name);
      b.floats(4, [...c.transformScale, ...c.transformRotation, ...c.transformTranslation]);
      b.u8(0x28, c.viewType);
      b.u8(0x29, c.projectionType);
      b.u8(0x2a, c.flags);
      b.f32(0x2c, c.wScale);
      const view = c.view, proj = c.projection;
      this.ptr(b, 0x30, view && this.block(S.Contents, view.length * 4, 4, view, 'view', (x) => x.floats(0, view)));
      this.ptr(b, 0x34, proj && this.block(S.Contents, proj.length * 4, 4, proj, 'projection', (x) => x.floats(0, proj)));
      this.metaData(b, 0x38, c.metaData);
    });
  }

  // ---- Animations

  animation(a: H3DAnimation | H3DMaterialAnim, material: boolean): Block {
    return this.block(S.Contents, material ? 0x20 : 0x18, 4, a, 'animation', (b) => {
      const swapped = animationFlagsSwapped(this.v);
      this.str(b, 0, a.name);
      b.u8(swapped ? 5 : 4, a.animationFlags);
      b.u8(swapped ? 4 : 5, a.animationType);
      b.u16(6, a.curvesCount);
      b.f32(8, a.framesCount);
      this.list(b, 0x0c, a.elements, 'elements', 4, (x, o, e) => {
        this.ptr(x, o, this.block(S.Contents, 8 + contentSize(e.primitiveType), 4, e, 'element', (y) => {
          this.str(y, 0, e.name);
          y.u16(4, e.targetType);
          y.u16(6, e.primitiveType);
          this.content(y, 8, e.content);
        }));
      });
      this.metaData(b, 0x14, a.metaData);
      if (material) this.list(b, 0x18, (a as H3DMaterialAnim).textureNames, 'names', 4, (x, o, n) => this.str(x, o, n));
    });
  }

  slots(b: Block, o: number, slots: H3DAnimSlot[], constBit: (i: number) => number, absentBit: (i: number) => number, rest: number): void {
    let flags = rest;
    slots.forEach((s, i) => {
      const at = o + 4 + i * 4;
      if (s === null) flags |= 1 << absentBit(i);
      else if (typeof s === 'number') {
        flags |= 1 << constBit(i);
        b.f32(at, s);
      } else this.ptr(b, at, this.curve(s));
    });
    b.u32(o, flags);
  }

  content(b: Block, o: number, c: H3DAnimContent): void {
    switch (c.kind) {
      case 'vector':
        return this.slots(b, o, c.slots, (i) => i, (i) => 8 + i, c.flagsRest);
      case 'transform': {
        const s = [c.scaleX, c.scaleY, c.scaleZ, c.rotationX, c.rotationY, c.rotationZ, c.translationX, c.translationY, c.translationZ];
        return this.slots(b, o, s, (i) => TRANSFORM_CONST[i]!, (i) => TRANSFORM_ABSENT[i]!, c.flagsRest);
      }
      case 'quatTransform': {
        let flags = 0;
        const parts: [H3DQuatTrack<number[]> | null, number][] = [[c.scales, 3], [c.rotations, 4], [c.translations, 3]];
        parts.forEach(([t, size], i) => {
          if (!t) {
            flags |= 1 << (5 - i);
            return;
          }
          if (t.constant) flags |= 1 << (2 - i);
          this.ptr(b, o + 4 + i * 4, this.block(S.Contents, t.constant ? size * 4 : 0x14, 4, t, 'track', (x) => {
            if (t.constant) return x.floats(0, t.frames[0]!);
            x.f32(0, t.startFrame);
            x.f32(4, t.endFrame);
            x.u32(8, t.flags);
            this.list(x, 0x0c, t.frames, 'frames', size * 4, (y, fo, f) => y.floats(fo, f));
          }));
        });
        b.u32(o, flags);
        return;
      }
      case 'boolean':
      case 'mtxTransform':
        b.f32(o, c.startFrame);
        b.f32(o + 4, c.endFrame);
        b.u8(o + 8, c.preRepeat);
        b.u8(o + 9, c.postRepeat);
        b.u16(o + 0x0a, c.curveIndex);
        if (c.kind === 'boolean') this.bools(b, o + 0x0c, c.values);
        else this.list(b, o + 0x0c, c.frames, 'frames', 48, (x, fo, f) => x.floats(fo, f));
        return;
    }
  }

  curve(c: H3DFloatKeyFrameGroup): Block {
    const inline = this.v >= 0x20;
    return this.block(S.Contents, inline ? 0x24 : 0x14, 4, c, 'curve', (b) => {
      b.f32(0, c.startFrame);
      b.f32(4, c.endFrame);
      b.u8(8, c.preRepeat);
      b.u8(9, c.postRepeat);
      b.u16(0x0a, c.curveIndex);
      if (inline) {
        const seg = c.moreSegments?.length ? mergeSegments(c) : c;
        const q = quantParams(seg, c.endFrame);
        b.u8(0x0c, seg.interpolationType);
        b.u8(0x0d, seg.quantization);
        b.u16(0x0e, seg.keyFrames.length);
        b.floats(0x10, [q.valueScale, q.valueOffset, q.frameScale, q.invDuration]);
        this.keys(b, 0x20, seg.keyFrames, seg.quantization, q);
        return;
      }
      const segs: H3DKeySegment[] = [
        { ...c, startFrame: c.segmentStart ?? c.startFrame, endFrame: c.segmentEnd ?? c.endFrame },
        ...(c.moreSegments ?? []),
      ];
      this.ptr(b, 0x0c, this.block(S.Contents, segs.length * 0x20, 4, c, 'segment', (x) => {
        segs.forEach((s, i) => {
          const o = i * 0x20;
          const q = quantParams(s, s.endFrame - s.startFrame);
          x.f32(o, s.startFrame);
          x.f32(o + 4, s.endFrame);
          x.u8(o + 8, s.interpolationType);
          x.u8(o + 9, s.quantization);
          x.u16(o + 0x0a, s.keyFrames.length);
          x.floats(o + 0x0c, [q.invDuration, q.valueScale, q.valueOffset, q.frameScale]);
          this.keys(x, o + 0x1c, s.keyFrames, s.quantization, q);
        });
      }));
      b.u32(0x10, segs.length);
    });
  }

  keys(b: Block, at: number, keys: KeyFrame[], quant: number, q: QuantParams): void {
    if (nullValues.has(keys) && !keys.length) return this.ptr(b, at, null);
    this.ptr(b, at, this.block(S.Contents, keys.length * KEY_SIZE[quant]!, 4, keys, 'keys', (x) => encodeKeys(x, keys, quant, q)));
  }
}

// ---- Key frames

interface QuantParams {
  valueScale: number;
  valueOffset: number;
  frameScale: number;
  invDuration: number;
}

const FLOAT_QUANT = new Set([0, 3, 6]);

/** The stored quantization parameters, or SPICA's (KeyFrameQuantizationHelper) for a new curve. */
function quantParams(s: Omit<H3DKeySegment, 'startFrame' | 'endFrame'>, duration: number): QuantParams {
  if (s.valueScale !== undefined && s.valueOffset !== undefined && s.frameScale !== undefined && s.invDuration !== undefined)
    return { valueScale: s.valueScale, valueOffset: s.valueOffset, frameScale: s.frameScale, invDuration: s.invDuration };
  const k = s.keyFrames;
  let minF = k[0]?.frame ?? 0, maxF = minF, minV = k[0]?.value ?? 0, maxV = minV;
  for (const x of k) {
    minF = Math.min(minF, x.frame); maxF = Math.max(maxF, x.frame);
    minV = Math.min(minV, x.value); maxV = Math.max(maxV, x.value);
  }
  const q = s.quantization;
  const vbits = [0, 20, 16, 0, 16, 12, 0, 20][q]!, fbits = [0, 12, 8, 0, 0, 8, 0, 12][q]!;
  let valueScale = vbits ? (maxV - minV) / (2 ** vbits - 1) : 1;
  let frameScale = fbits ? (maxF - minF) / (2 ** fbits - 1) : 1;
  if (!valueScale) valueScale = 1;
  if (!frameScale) frameScale = 1;
  return { valueScale, valueOffset: valueScale === 1 && FLOAT_QUANT.has(q) ? 0 : minV, frameScale, invDuration: duration ? 1 / duration : 0 };
}

function encodeKeys(b: Block, keys: KeyFrame[], quant: number, q: QuantParams): void {
  const kept = keyBytes.get(keys);
  if (kept && kept.params[0] === quant && kept.params[1] === q.frameScale && kept.params[2] === q.valueScale && kept.params[3] === q.valueOffset &&
    kept.decoded.length === keys.length && kept.decoded.every((d, i) => d.frame === keys[i]!.frame && d.value === keys[i]!.value && d.inSlope === keys[i]!.inSlope && d.outSlope === keys[i]!.outSlope)) {
    b.bytes.set(kept.bytes);
    return;
  }
  let o = 0;
  const int = (x: number): number => Math.round(x);
  for (const k of keys) {
    const f = k.frame / q.frameScale;
    const v = q.valueScale ? (k.value - q.valueOffset) / q.valueScale : 0;
    switch (quant) {
      case 0: b.floats(o, [f, v, k.inSlope, k.outSlope]); break;
      case 1:
        b.u32(o, (int(f) & 0xfff) | ((int(v) & 0xfffff) << 12));
        b.u16(o + 4, int(k.inSlope * 256));
        b.u16(o + 6, int(k.outSlope * 256));
        break;
      case 2: {
        b.u8(o, int(f));
        b.u16(o + 1, int(v));
        const sl = (int(k.inSlope * 32) & 0xfff) | ((int(k.outSlope * 32) & 0xfff) << 12);
        b.u8(o + 3, sl);
        b.u8(o + 4, sl >> 8);
        b.u8(o + 5, sl >> 16);
        break;
      }
      case 3: b.floats(o, [f, v, k.inSlope]); break;
      case 4:
        b.u16(o, int(f * 32));
        b.u16(o + 2, int(v));
        b.u16(o + 4, int(k.inSlope * 256));
        break;
      case 5: {
        b.u8(o, int(f));
        const w = (int(v) & 0xfff) | ((int(k.inSlope * 32) & 0xfff) << 12);
        b.u8(o + 1, w);
        b.u8(o + 2, w >> 8);
        b.u8(o + 3, w >> 16);
        break;
      }
      case 6: b.floats(o, [f, v]); break;
      case 7: b.u32(o, (int(f) & 0xfff) | ((int(v) & 0xfffff) << 12)); break;
    }
    o += KEY_SIZE[quant]!;
  }
}

/**
 * One segment from the segments of a version 8 curve (version 0x20 and later have one per curve): the keys of all
 * segments as Hermite128 (floats). A step segment's keys get a second key holding the value up to the next key, so
 * steps stay steps; a linear segment's slopes become the line's.
 */
export function mergeSegments(c: H3DFloatKeyFrameGroup): H3DKeySegment {
  const segs: H3DKeySegment[] = [{ ...c, startFrame: c.segmentStart ?? c.startFrame, endFrame: c.segmentEnd ?? c.endFrame }, ...(c.moreSegments ?? [])];
  const keys: KeyFrame[] = [];
  for (const s of segs) {
    const k = s.keyFrames;
    k.forEach((x, i) => {
      const next = k[i + 1];
      if (s.interpolationType === 0) {
        keys.push({ frame: x.frame, value: x.value, inSlope: 0, outSlope: 0 });
        if (next) keys.push({ frame: next.frame, value: x.value, inSlope: 0, outSlope: 0 });
      } else if (s.interpolationType === 1) {
        const slope = next ? (next.value - x.value) / (next.frame - x.frame || 1) : 0;
        const prev = k[i - 1];
        const inSlope = prev ? (x.value - prev.value) / (x.frame - prev.frame || 1) : slope;
        keys.push({ frame: x.frame, value: x.value, inSlope, outSlope: next ? slope : inSlope });
      } else keys.push({ ...x });
    });
  }
  return { startFrame: c.startFrame, endFrame: c.endFrame, interpolationType: 2, quantization: 0, keyFrames: keys };
}

// ---- Layout

const align = (v: number, a: number): number => Math.ceil(v / a) * a;

interface Placed {
  sections: { address: number; length: number }[];
  relocationAddress: number;
  fileLength?: number;
}

/** Every block at the place the read layout gives it, or null when that does not work out. */
function hintedLayout(h: H3D, blocks: Block[], v: number): Placed | null {
  const l = h.layout;
  if (!l || l.version !== v) return null;
  for (const b of blocks) {
    const at = b.sec === S.Strings && b.role === 'string' ? l.strings.get(b.owner as string) : typeof b.owner === 'object' && b.owner ? l.offsets.get(b.owner)?.get(b.role) : undefined;
    if (at === undefined) return null;
    const s = l.sections[b.sec]!;
    if (at < s.address || at + b.size > s.address + s.length || at % b.align) return null;
    b.offset = at;
  }
  const sorted = blocks.filter((b) => b.size).sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.offset < sorted[i - 1]!.offset + sorted[i - 1]!.size) return null;
  return { sections: l.sections, relocationAddress: l.relocationAddress, fileLength: l.fileLength };
}

/** Blocks in the order they were made, strings sorted, raw data textures first (SPICA H3DComparers). */
function freshLayout(blocks: Block[], v: number): Placed {
  let pos = headerLength(v);
  const sections: Placed['sections'] = [];
  const bySec = (s: S): Block[] => blocks.filter((b) => b.sec === s);
  const strings = bySec(S.Strings).sort((a, b) => compareStrings(String(a.owner), String(b.owner)));
  const raw = bySec(S.RawData);
  const order: Block[][] = [bySec(S.Contents), strings, bySec(S.Commands), [...raw.filter((b) => b.align === 0x80), ...raw.filter((b) => b.align !== 0x80)], bySec(S.RawExt)];
  const sectionAlign = [4, 4, 0x10, 0x80, 0x80];
  order.forEach((list, s) => {
    pos = align(pos, sectionAlign[s]!);
    const start = pos;
    for (const b of list) {
      pos = align(pos, b.align);
      b.offset = pos;
      pos += b.size;
    }
    if (s === S.Strings) pos = align(pos, 0x10);
    sections.push({ address: start, length: pos - start });
  });
  // An empty RawExt section sits at the relocation table (as in RPG FREE!'s files).
  const relocationAddress = align(pos, 0x80);
  if (!sections[S.RawExt]!.length) sections[S.RawExt] = { address: relocationAddress, length: 0 };
  return { sections, relocationAddress };
}

/** SPICA H3DComparers.CompareString: byte order, shorter first. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Write an H3D as a BCH. */
export function writeH3D(h: H3D, opts: WriteOptions = {}): Uint8Array {
  const v = opts.backward ?? h.backwardCompatibility;
  if (v !== 8 && v !== 0x21 && (v < 7 || v > 0x21)) throw new Error(`unsupported backward compatibility ${v}`);
  const w = new Writer(v);
  w.root(h);
  w.run();
  const blocks = w.blocks;
  const placed = (!opts.freshLayout && hintedLayout(h, blocks, v)) || freshLayout(blocks, v);
  const sec = placed.sections;
  const secStart = (s: S): number => sec[s]!.address;
  // Relocations
  const relocs: { position: number; word: number; raw: boolean }[] = [];
  const kindSection = (kind: number): S =>
    kind === Sec.Contents ? S.Contents : kind === Sec.Strings ? S.Strings : kind <= Sec.CommandsSrc ? S.Commands : kind <= Sec.RawDataIndex8 ? S.RawData : S.RawExt;
  const relocLength = blocks.reduce((n, b) => n + b.fixups.length, 0) * 4;
  const end = placed.relocationAddress + relocLength;
  const fileLength = Math.max(placed.fileLength ?? 0, end);
  if (placed.fileLength !== undefined && end > placed.fileLength) throw new Error('relocation table outside the file');
  const out = new Uint8Array(fileLength);
  const dv = new DataView(out.buffer);
  if (placed.fileLength !== undefined) for (const [o, bytes] of h.layout!.fill) out.set(bytes, o);
  for (const b of blocks) out.set(b.bytes, b.offset);
  for (const b of blocks)
    for (const f of b.fixups) {
      const position = b.offset + f.at;
      let value = f.addend;
      if (f.target && f.kind !== Sec.BaseAddress) value += f.target.offset - secStart(kindSection(f.kind));
      dv.setUint32(position, value >>> 0, true);
      const source = SECTION_KIND[b.sec]!;
      let rel = position - secStart(b.sec);
      if (f.kind !== Sec.Strings) {
        if (rel & 3) throw new Error('unaligned pointer');
        rel >>>= 2;
      }
      if (rel > 0x1ffffff) throw new Error('pointer out of the 25-bit range');
      const fileKind = f.kind - legacyRelocDiff(f.kind, v);
      relocs.push({ position, word: (rel | (fileKind << 25) | (source << 29)) >>> 0, raw: f.kind >= Sec.RawData && f.kind <= Sec.RawExtIndex8 });
    }
  // The read order when it is the same set of pointers, else commands first (as RPG FREE!'s converter does).
  const hint = placed.fileLength !== undefined ? h.layout?.relocations : undefined;
  let ordered = relocs;
  if (hint && hint.length === relocs.length) {
    const byPos = new Map(relocs.map((r) => [r.position, r]));
    const list = hint.map((p) => byPos.get(p));
    if (byPos.size === relocs.length && list.every((r) => r)) ordered = list as typeof relocs;
  }
  if (ordered === relocs) ordered = [...relocs.filter((r) => r.word >>> 29 === Sec.Commands), ...relocs.filter((r) => r.word >>> 29 !== Sec.Commands)];
  ordered.forEach((r, i) => dv.setUint32(placed.relocationAddress + i * 4, r.word, true));
  // Header
  out.set([0x42, 0x43, 0x48, 0, v, (opts.forward ?? h.forwardCompatibility) & 0xff], 0);
  dv.setUint16(6, opts.converter ?? h.converterVersion, true);
  const ext = v >= 0x21;
  const fields = [
    sec[S.Contents]!.address, sec[S.Strings]!.address, sec[S.Commands]!.address, sec[S.RawData]!.address, ...(ext ? [sec[S.RawExt]!.address] : []), placed.relocationAddress,
    sec[S.Contents]!.length, sec[S.Strings]!.length, sec[S.Commands]!.length, sec[S.RawData]!.length, ...(ext ? [sec[S.RawExt]!.length] : []), relocLength,
    h.unInitDataLength ?? 0, h.unInitCommandsLength ?? 0,
  ];
  if (!ext && blocks.some((b) => b.sec === S.RawExt)) throw new Error('RawExt data needs version 0x21');
  fields.forEach((x, i) => dv.setUint32(8 + i * 4, x, true));
  if (v >= 8) {
    const o = 8 + fields.length * 4;
    out[o] = opts.flags ?? h.flags;
    dv.setUint16(o + 2, relocs.filter((r) => r.raw).length, true);
  }
  return out;
}
