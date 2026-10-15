// CGFX reader: bytes -> Gfx object model (types.ts). Layouts follow SPICA's CtrGfx classes, corrected against the
// games' files (kahara monster and item models). Everything the writer needs for a byte-identical file is kept;
// unexpected data (unknown type ids, non-empty lists the model does not hold) throws.
import { GfxReader, hex } from './bin';
import { buildDictTree } from './dict';
import {
  alphaTestFrom, blendFunctionFrom, colorOperationFrom, depthColorMaskFrom, readCommands, rgbaFromU32, stencilOperationFrom,
  stencilTestFrom, texEnvStageFrom,
} from './pica';
import {
  GFX_DICTS, GfxPrimitiveType, emptyGfx, type Gfx, type GfxAnimChannel, type GfxAnimContent, type GfxAnimGroup,
  type GfxAnimGroupElement, type GfxAnimation, type GfxAnimationElement, type GfxAttribute, type GfxBakedTrack,
  type GfxBone, type GfxCamera, type GfxCameraProjection, type GfxCameraView, type GfxCurveSegment, type GfxFace,
  type GfxFaceDescriptor, type GfxFloatKeyFrameGroup, type GfxFragLightLUT, type GfxFragShader, type GfxLUT,
  type GfxLUTReference, type GfxMaterial, type GfxMaterialColor, type GfxMesh, type GfxMetaData, type GfxModel,
  type GfxNodeTransform, type GfxObject, type GfxRawKey, type GfxShape, type GfxSkeleton, type GfxSubMesh,
  type GfxTexEnv, type GfxTexture, type GfxTextureCoord, type GfxTextureReference, type GfxTextureImageData, type GfxTextureMapper,
  type GfxVertexBuffer, type RGBA, type Vec4,
} from './types';

/** Object type ids (GfxObject TypeChoice) and magics. */
export const GFX_TYPE = {
  mesh: 0x01000000,
  skeleton: 0x02000000,
  lut: 0x04000000,
  material: 0x08000000,
  shape: 0x10000001,
  textureReference: 0x20000004,
  textureCube: 0x20000009,
  textureImage: 0x20000011,
  camera: 0x4000000a,
  model: 0x40000012,
  modelSkeletal: 0x40000092,
  shaderReference: 0x80000001,
} as const;

export const GFX_MAGIC: Record<number, string> = {
  [GFX_TYPE.mesh]: 'SOBJ',
  [GFX_TYPE.skeleton]: 'SOBJ',
  [GFX_TYPE.shape]: 'SOBJ',
  [GFX_TYPE.lut]: 'LUTS',
  [GFX_TYPE.material]: 'MTOB',
  [GFX_TYPE.textureReference]: 'TXOB',
  [GFX_TYPE.textureCube]: 'TXOB',
  [GFX_TYPE.textureImage]: 'TXOB',
  [GFX_TYPE.camera]: 'CCAM',
  [GFX_TYPE.model]: 'CMDL',
  [GFX_TYPE.modelSkeletal]: 'CMDL',
  [GFX_TYPE.shaderReference]: 'SHDR',
};

/** Number of keys of a curve segment of this quantization: bytes per key and whether scale / offset are stored. */
export const KEY_FORMATS: { size: number; scaled: boolean }[] = [
  { size: 16, scaled: false }, // Hermite128
  { size: 8, scaled: true }, // Hermite64
  { size: 6, scaled: true }, // Hermite48
  { size: 12, scaled: false }, // UnifiedHermite96
  { size: 6, scaled: true }, // UnifiedHermite48
  { size: 4, scaled: true }, // UnifiedHermite32
  { size: 8, scaled: false }, // StepLinear64
  { size: 4, scaled: true }, // StepLinear32
];

class GfxParser {
  constructor(readonly r: GfxReader) {}

  fail(o: number, what: string): never {
    throw new Error(`CGFX: ${what} at ${hex(o)}`);
  }

  /** DICT reference {count, pointer} -> entries (the tree is checked against the one the writer builds). */
  dict(o: number): { name: string; data: number }[] {
    const { r } = this;
    const count = r.u32(o);
    const d = r.ptr(o + 4);
    if (!count) {
      if (d) this.fail(o, 'empty dictionary with a pointer');
      return [];
    }
    if (r.magic(d) !== 'DICT') this.fail(d, 'DICT expected');
    if (r.u32(d + 8) !== count) this.fail(d, 'dictionary count mismatch');
    if (r.u32(d + 4) !== (count + 1) * 16 + 12) this.fail(d, 'dictionary length');
    const out: { name: string; data: number }[] = [];
    for (let i = 0; i < count; i++) {
      const e = d + 0x1c + i * 16;
      const name = r.str(e + 8);
      if (name === null) this.fail(e, 'dictionary entry without a name');
      out.push({ name, data: r.ptr(e + 12) });
    }
    // The tree must be the one buildDictTree makes (the writer rebuilds it from the names).
    const tree = buildDictTree(out.map((e) => e.name));
    for (let i = 0; i <= count; i++) {
      const e = d + 0x0c + i * 16;
      const n = tree[i]!;
      if (r.u32(e) !== n.referenceBit >>> 0 || r.u16(e + 4) !== n.leftNodeIndex || r.u16(e + 6) !== n.rightNodeIndex)
        this.fail(e, 'dictionary tree differs from the patricia tree of its names');
      if (i === 0 && (r.u32(e + 8) || r.u32(e + 12))) this.fail(e, 'dictionary root with name / data');
    }
    return out;
  }

  /** Dictionary whose entry names must equal the values' names. */
  named<T extends { name: string | null }>(o: number, read: (p: number) => T): T[] {
    return this.dict(o).map((e) => {
      const v = read(e.data);
      if (v.name !== e.name) this.fail(e.data, `dictionary key ${e.name} differs from the name ${v.name}`);
      return v;
    });
  }

  metaData(o: number): GfxMetaData[] {
    const { r } = this;
    return this.dict(o).map((e) => {
      const p = e.data;
      const type = r.u32(p);
      const name = r.str(p + 4)!;
      const t = r.u32(p + 8);
      if (name !== e.name) this.fail(p, 'metadata key');
      switch (type) {
        case 0x80000000: {
          const n = r.u32(p + 12);
          return { kind: 'single', name, type: t, values: r.floats(p + 16, n) };
        }
        case 0x20000000: {
          const n = r.u32(p + 12);
          return { kind: 'integer', name, type: t, values: Array.from({ length: n }, (_, i) => r.s32(p + 16 + i * 4)) };
        }
        case 0x40000000: {
          const n = r.u32(p + 12);
          return { kind: 'color', name, type: t, values: Array.from({ length: n }, (_, i) => r.vec4(p + 16 + i * 16)) };
        }
        case 0x10000000: {
          const format = r.u32(p + 12);
          if (format !== 0) this.fail(p, 'non-ASCII metadata strings are not supported');
          const n = r.u32(p + 16);
          return { kind: 'string', name, type: t, format, values: Array.from({ length: n }, (_, i) => r.str(p + 20 + i * 4) ?? '') };
        }
      }
      return this.fail(p, `metadata type ${hex(type)}`);
    });
  }

  /** GfxObject header: type id, magic, revision, name, user data. */
  object(o: number, types: readonly number[]): GfxObject & { typeId: number } {
    const { r } = this;
    const typeId = r.u32(o);
    if (!types.includes(typeId)) this.fail(o, `object type ${hex(typeId)} (expected ${types.map(hex).join('/')})`);
    if (r.magic(o + 4) !== GFX_MAGIC[typeId]) this.fail(o, `magic ${r.magic(o + 4)}`);
    return { typeId, revision: r.u32(o + 8), name: r.str(o + 12), metaData: this.metaData(o + 0x10) };
  }

  nodeTransform(o: number, types: readonly number[]): GfxNodeTransform & { typeId: number } {
    const { r } = this;
    const base = this.object(o, types);
    if (r.u32(o + 0x20) || r.u32(o + 0x24)) this.fail(o, 'node with children');
    return {
      ...base,
      branchVisible: r.u32(o + 0x18),
      isBranchVisible: r.bool(o + 0x1c),
      childs: [],
      animationsGroup: this.named(o + 0x28, (p) => this.animGroup(p)),
      transformScale: r.vec3(o + 0x30),
      transformRotation: r.vec3(o + 0x3c),
      transformTranslation: r.vec3(o + 0x48),
      localTransform: r.floats(o + 0x54, 12),
      worldTransform: r.floats(o + 0x84, 12),
    };
  }

  animGroup(o: number): GfxAnimGroup {
    const { r } = this;
    if (r.u32(o) !== 0x80000000) this.fail(o, 'anim group type');
    const nOps = r.u32(o + 0x18);
    const ops = r.ptr(o + 0x1c);
    return {
      flags: r.u32(o + 4),
      name: r.str(o + 8),
      memberType: r.u32(o + 0x0c),
      elements: this.named(o + 0x10, (p) => this.animGroupElement(p)),
      blendOperationTypes: Array.from({ length: nOps }, (_, i) => r.s32(ops + i * 4)),
      evaluationTiming: r.u32(o + 0x20),
    };
  }

  animGroupElement(o: number): GfxAnimGroupElement {
    const { r } = this;
    const typeId = r.u32(o);
    const base = {
      typeId,
      name: r.str(o + 4),
      memberOffset: r.s32(o + 8),
      blendOpIndex: r.s32(o + 0x0c),
      objType: r.u32(o + 0x10),
      memberType: r.u32(o + 0x14),
      materialPtr: r.u32(o + 0x18),
    };
    switch (typeId) {
      case 0x40000000:
        return { ...base, kind: 'bone', boneName: r.str(o + 0x1c), objType2: r.u32(o + 0x20) };
      case 0x08000000:
        return { ...base, kind: 'materialColor', materialName: r.str(o + 0x1c), objType2: r.u32(o + 0x20) };
      case 0x04000000:
        return { ...base, kind: 'blendOp', materialName: r.str(o + 0x1c), objType2: r.u32(o + 0x20) };
      case 0x02000000:
        return { ...base, kind: 'texSampler', materialName: r.str(o + 0x1c), index: r.s32(o + 0x20), objType2: r.u32(o + 0x24) };
      case 0x20000000:
        return { ...base, kind: 'texMapper', materialName: r.str(o + 0x1c), index: r.s32(o + 0x20), objType2: r.u32(o + 0x24) };
      case 0x80000000:
        return { ...base, kind: 'texCoord', materialName: r.str(o + 0x1c), index: r.s32(o + 0x20), objType2: r.u32(o + 0x24) };
      case 0x10000000:
        return { ...base, kind: 'model', objType2: r.u32(o + 0x1c) };
      case 0x01000000:
        return { ...base, kind: 'mesh', meshIndex: r.s32(o + 0x1c), objType2: r.u32(o + 0x20) };
      case 0x00080000:
        return { ...base, kind: 'meshNodeVis', nodeName: r.str(o + 0x1c), objType2: r.u32(o + 0x20) };
      case 0x00800000:
      case 0x00400000:
      case 0x00200000:
        return { ...base, kind: 'camera', objType2: r.u32(o + 0x1c) };
    }
    return this.fail(o, `anim group element type ${hex(typeId)}`);
  }

  // --- models ---

  model(o: number): GfxModel {
    const { r } = this;
    const node = this.nodeTransform(o, [GFX_TYPE.model, GFX_TYPE.modelSkeletal]);
    const { typeId, ...rest } = node;
    const model: GfxModel = {
      ...rest,
      meshes: [],
      materials: this.named(o + 0xbc, (p) => this.material(p)),
      shapes: r.ptrList(o + 0xc4).map((p) => this.shape(p)),
      meshNodeVisibilities: this.dict(o + 0xcc).map((e) => {
        const name = r.str(e.data);
        if (name !== e.name) this.fail(e.data, 'mesh node key');
        return { name, isVisible: r.bool(e.data + 4) };
      }),
      flags: r.u32(o + 0xd4),
      faceCulling: r.u32(o + 0xd8),
      layerId: r.s32(o + 0xdc),
    };
    model.meshes = r.ptrList(o + 0xb4).map((p) => this.mesh(p, o));
    if (typeId === GFX_TYPE.modelSkeletal) {
      const sk = r.ptr(o + 0xe0);
      model.skeleton = sk ? this.skeleton(sk) : null;
    }
    return model;
  }

  mesh(o: number, model: number): GfxMesh {
    const { r } = this;
    const { typeId, ...base } = this.object(o, [GFX_TYPE.mesh]);
    if (r.ptr(o + 0x20) !== model) this.fail(o, 'mesh parent is not its model');
    return {
      ...base,
      shapeIndex: r.s32(o + 0x18),
      materialIndex: r.s32(o + 0x1c),
      isVisible: r.u8(o + 0x24),
      renderPriority: r.u8(o + 0x25),
      meshNodeIndex: r.s16(o + 0x26),
      primitiveIndex: r.s32(o + 0x28),
      flags: r.u32(o + 0x2c),
      attrScaleCommands: r.words(o + 0x30, 12),
      enableCommandsPtr: r.u32(o + 0x60),
      enableCommandsLength: r.u32(o + 0x64),
      disableCommandsPtr: r.u32(o + 0x68),
      disableCommandsLength: r.u32(o + 0x6c),
      meshNodeName: r.str(o + 0x70),
      renderKeyCache: [r.u32(o + 0x74), r.u32(o + 0x78)],
      commandAlloc: r.u32(o + 0x7c),
      reserved: r.u32(o + 0x80),
    };
  }

  skeleton(o: number): GfxSkeleton {
    const { r } = this;
    const { typeId, ...base } = this.object(o, [GFX_TYPE.skeleton]);
    const entries = this.dict(o + 0x18);
    const addr = entries.map((e) => e.data);
    const index = (p: number, at: number): number => {
      if (!p) return -1;
      const i = addr.indexOf(p);
      if (i < 0) this.fail(at, 'bone pointer outside the skeleton');
      return i;
    };
    const bones = entries.map((e, i): GfxBone => {
      const p = e.data;
      const name = r.str(p)!;
      if (name !== e.name) this.fail(p, 'bone key');
      return {
        name,
        flags: r.u32(p + 4),
        index: r.s32(p + 8),
        parentIndex: r.s32(p + 0x0c),
        parent: index(r.ptr(p + 0x10), p + 0x10),
        child: index(r.ptr(p + 0x14), p + 0x14),
        prevSibling: index(r.ptr(p + 0x18), p + 0x18),
        nextSibling: index(r.ptr(p + 0x1c), p + 0x1c),
        scale: r.vec3(p + 0x20),
        rotation: r.vec3(p + 0x2c),
        translation: r.vec3(p + 0x38),
        localTransform: r.floats(p + 0x44, 12),
        worldTransform: r.floats(p + 0x74, 12),
        invWorldTransform: r.floats(p + 0xa4, 12),
        billboardMode: r.u32(p + 0xd4),
        metaData: this.metaData(p + 0xd8),
      };
    });
    return { ...base, bones, rootBone: index(r.ptr(o + 0x20), o + 0x20), scalingRule: r.u32(o + 0x24), flags: r.u32(o + 0x28) };
  }

  shape(o: number): GfxShape {
    const { r } = this;
    const { typeId, ...base } = this.object(o, [GFX_TYPE.shape]);
    const bb = r.ptr(o + 0x1c);
    const bs = r.ptr(o + 0x40);
    let blendShape: GfxShape['blendShape'] = null;
    if (bs) {
      if (r.u32(bs + 4)) this.fail(bs, 'blend shape targets');
      const n = r.u32(bs + 0x0c);
      const t = r.ptr(bs + 0x10);
      blendShape = { typeId: r.u32(bs), targets: [], types: r.words(t, n) };
    }
    return {
      ...base,
      flags: r.u32(o + 0x18),
      boundingBox: bb ? { typeId: r.u32(bb), center: r.vec3(bb + 4), orientation: r.floats(bb + 0x10, 9), size: r.vec3(bb + 0x34) } : null,
      positionOffset: r.vec3(o + 0x20),
      subMeshes: r.ptrList(o + 0x2c).map((p) => this.subMesh(p)),
      baseAddress: r.u32(o + 0x34),
      vertexBuffers: r.ptrList(o + 0x38).map((p) => this.vertexBuffer(p)),
      blendShape,
    };
  }

  subMesh(o: number): GfxSubMesh {
    const { r } = this;
    const n = r.u32(o);
    const t = r.ptr(o + 4);
    return {
      boneIndices: Array.from({ length: n }, (_, i) => r.s32(t + i * 4)),
      skinning: r.u32(o + 8),
      faces: r.ptrList(o + 0x0c).map((p) => this.face(p)),
    };
  }

  face(o: number): GfxFace {
    const { r } = this;
    const n = r.u32(o + 8);
    return {
      faceDescriptors: r.ptrList(o).map((p) => this.faceDescriptor(p)),
      bufferObjs: r.words(r.ptr(o + 12), n),
      flags: r.u32(o + 0x10),
      commandAlloc: r.u32(o + 0x14),
    };
  }

  faceDescriptor(o: number): GfxFaceDescriptor {
    const { r } = this;
    if (r.u16(o + 6)) this.fail(o, 'face descriptor padding');
    return {
      format: r.u32(o),
      primitiveMode: r.u8(o + 4),
      visible: r.u8(o + 5),
      rawBuffer: r.bytes(r.ptr(o + 0x0c), r.u32(o + 8)),
      bufferObj: r.u32(o + 0x10),
      locationFlag: r.u32(o + 0x14),
      commandCachePtr: r.u32(o + 0x18),
      commandCacheLength: r.u32(o + 0x1c),
      locationPtr: r.u32(o + 0x20),
      memoryArea: r.u32(o + 0x24),
      boundingVolume: r.u32(o + 0x28),
    };
  }

  attribute(o: number): GfxAttribute {
    const { r } = this;
    const n = r.u32(o + 0x14);
    const p = r.ptr(o + 0x18);
    return {
      kind: 'attribute',
      attrName: r.u32(o + 4),
      type: r.u32(o + 8),
      bufferObj: r.u32(o + 0x0c),
      locationFlag: r.u32(o + 0x10),
      rawBuffer: p ? r.bytes(p, n) : n ? this.fail(o, 'attribute data without pointer') : null,
      locationPtr: r.u32(o + 0x1c),
      memoryArea: r.u32(o + 0x20),
      format: r.u32(o + 0x24),
      elements: r.s32(o + 0x28),
      scale: r.f32(o + 0x2c),
      offset: r.s32(o + 0x30),
    };
  }

  vertexBuffer(o: number): GfxVertexBuffer {
    const { r } = this;
    const typeId = r.u32(o);
    switch (typeId) {
      case 0x40000001:
        return this.attribute(o);
      case 0x40000002:
        return {
          kind: 'interleaved',
          attrName: r.u32(o + 4),
          type: r.u32(o + 8),
          bufferObj: r.u32(o + 0x0c),
          locationFlag: r.u32(o + 0x10),
          rawBuffer: r.bytes(r.ptr(o + 0x18), r.u32(o + 0x14)),
          locationPtr: r.u32(o + 0x1c),
          memoryArea: r.u32(o + 0x20),
          vertexStride: r.s32(o + 0x24),
          attributes: r.ptrList(o + 0x28).map((p) => {
            if (r.u32(p) !== 0x40000001) this.fail(p, 'interleaved attribute type');
            return this.attribute(p);
          }),
        };
      case 0x80000000: {
        const n = r.u32(o + 0x18);
        return {
          kind: 'fixed',
          attrName: r.u32(o + 4),
          type: r.u32(o + 8),
          format: r.u32(o + 0x0c),
          elements: r.s32(o + 0x10),
          scale: r.f32(o + 0x14),
          vector: r.floats(r.ptr(o + 0x1c), n),
        };
      }
    }
    return this.fail(o, `vertex buffer type ${hex(typeId)}`);
  }

  // --- materials ---

  rgba = (o: number): RGBA => rgbaFromU32(this.r.u32(o));

  /** Expects a command list of known registers; returns the parameters by register. */
  commands(o: number, words: number): Map<number, number> {
    const list = this.r.words(o, words);
    const out = new Map<number, number>();
    for (const c of readCommands(list)) out.set(c.register, c.parameters[0]!);
    return out;
  }

  material(o: number): GfxMaterial {
    const { r } = this;
    const { typeId, ...base } = this.object(o, [GFX_TYPE.material]);
    const v4 = (i: number): Vec4 => r.vec4(o + 0x24 + i * 16);
    const c = (i: number): RGBA => this.rgba(o + 0xd4 + i * 4);
    const colors: GfxMaterialColor = {
      emissionF: v4(0), ambientF: v4(1), diffuseF: v4(2), specular0F: v4(3), specular1F: v4(4),
      constant0F: v4(5), constant1F: v4(6), constant2F: v4(7), constant3F: v4(8), constant4F: v4(9), constant5F: v4(10),
      emission: c(0), ambient: c(1), diffuse: c(2), specular0: c(3), specular1: c(4),
      constant0: c(5), constant1: c(6), constant2: c(7), constant3: c(8), constant4: c(9), constant5: c(10),
      commandCache: r.u32(o + 0x100),
    };
    const depth = this.commands(o + 0x11c, 4);
    const blend = this.commands(o + 0x140, 6);
    const stencil = this.commands(o + 0x158, 4);
    const textureCoords: GfxTextureCoord[] = [0, 1, 2].map((i) => {
      const p = o + 0x16c + i * 0x58;
      return {
        sourceCoordIndex: r.s32(p),
        mappingType: r.u32(p + 4),
        referenceCameraIndex: r.s32(p + 8),
        transformType: r.u32(p + 0x0c),
        scale: r.vec2(p + 0x10),
        rotation: r.f32(p + 0x18),
        translation: r.vec2(p + 0x1c),
        flags: r.u32(p + 0x24),
        transform: r.floats(p + 0x28, 12),
      };
    });
    if (r.u32(o + 0x280)) this.fail(o, 'procedural texture mapper');
    if (r.u32(o + 0x290)) this.fail(o, 'shader parameters');
    const shader = r.ptr(o + 0x284);
    const fs = r.ptr(o + 0x288);
    const h = (i: number): number => r.u32(o + 0x2a0 + i * 4);
    return {
      ...base,
      flags: r.u32(o + 0x18),
      texCoordConfig: r.u32(o + 0x1c),
      translucencyKind: r.u32(o + 0x20),
      colors,
      rasterization: {
        isPolygonOffsetEnabled: r.bool(o + 0x104),
        faceCulling: r.u32(o + 0x108),
        polygonOffsetUnit: r.f32(o + 0x10c),
        faceCullingCommand: this.commands(o + 0x110, 2).get(0x40) ?? 0,
      },
      fragmentOperation: {
        depth: {
          flags: r.u32(o + 0x118),
          colorMask: depthColorMaskFrom(depth.get(0x107) ?? 0),
          deltaZDepth: depth.get(0x126) ?? 0,
        },
        blend: {
          mode: r.u32(o + 0x12c),
          colorF: r.vec4(o + 0x130),
          colorOperation: colorOperationFrom(blend.get(0x100) ?? 0),
          function: blendFunctionFrom(blend.get(0x101) ?? 0),
          logicalOperation: blend.get(0x102) ?? 0,
          color: rgbaFromU32(blend.get(0x103) ?? 0),
        },
        stencil: {
          test: stencilTestFrom(stencil.get(0x105) ?? 0),
          operation: stencilOperationFrom(stencil.get(0x106) ?? 0),
        },
      },
      usedTextureCoordsCount: r.s32(o + 0x168),
      textureCoords,
      textureMappers: [0, 1, 2].map((i) => {
        const p = r.ptr(o + 0x274 + i * 4);
        return p ? this.textureMapper(p) : null;
      }),
      proceduralTextureMapper: null,
      shader: shader ? this.shaderReference(shader) : null,
      fragmentShader: fs ? this.fragShader(fs) : null,
      shaderProgramDescIndex: r.s32(o + 0x28c),
      shaderParameters: [],
      lightSetIndex: r.s32(o + 0x298),
      fogIndex: r.s32(o + 0x29c),
      materialFlagsHash: h(0),
      shaderParamsHash: h(1),
      textureCoordsHash: h(2),
      textureSamplersHash: h(3),
      textureMappersHash: h(4),
      materialColorsHash: h(5),
      rasterizationHash: h(6),
      fragLightHash: h(7),
      fragLightLUTHash: h(8),
      fragLightLUTSampHash: h(9),
      textureEnvironmentHash: h(10),
      alphaTestHash: h(11),
      fragOpHash: h(12),
      uniqueId: h(13),
    };
  }

  textureMapper(o: number): GfxTextureMapper {
    const { r } = this;
    if (r.u32(o) !== 0x80000000) this.fail(o, 'texture mapper type');
    if (r.u32(o + 0x48) !== 0x38) this.fail(o, 'texture mapper command length');
    const words = r.words(o + 0x10, 14);
    // TYPE (mask 1), then BORDER_COLOR.. as 10 consecutive parameters.
    const typeReg = words[1]! & 0xffff;
    const unit = [0x8e, 0x96, 0x9e].indexOf(typeReg);
    if (unit < 0 || words[1] !== (0x00010000 | typeReg) || words[3] !== ((0x809f0000 | [0x81, 0x91, 0x99][unit]!) >>> 0) || words[13] !== 0)
      this.fail(o, 'texture mapper commands');
    const param = words[4 + 1]!;
    const lod = words[4 + 2]!;
    const tex = r.ptr(o + 8);
    const samp = r.ptr(o + 0x0c);
    let sampler: GfxTextureMapper['sampler'] = null;
    if (samp) {
      if (r.ptr(samp + 4) !== o) this.fail(samp, 'sampler parent is not its mapper');
      sampler = { typeId: r.u32(samp), minFilter: r.u32(samp + 8), borderColor: r.vec4(samp + 0x0c), lodBias: r.f32(samp + 0x1c) };
    }
    return {
      dynamicAlloc: r.u32(o + 4),
      texture: tex ? this.textureReference(tex) : null,
      sampler,
      unitType: words[0]!,
      borderColor: rgbaFromU32(words[2]!),
      dimension: words[4]!,
      magFilter: (param >>> 1) & 1,
      minFilter: (param >>> 2) & 1,
      mipFilter: (param >>> 24) & 1,
      wrapV: (param >>> 8) & 7,
      wrapU: (param >>> 12) & 7,
      paramOtherBits: (param & ~(0x01007706)) >>> 0,
      lodBias: ((lod << 19) >> 19) / 256,
      minLOD: (lod >>> 24) & 0xf,
      maxLOD: (lod >>> 16) & 0xf,
      tail: words.slice(7, 13),
    };
  }

  textureReference(o: number): GfxTextureReference {
    const { typeId, ...base } = this.object(o, [GFX_TYPE.textureReference]);
    return { ...base, path: this.r.str(o + 0x18), texturePtr: this.r.u32(o + 0x1c) };
  }

  shaderReference(o: number): NonNullable<GfxMaterial['shader']> {
    const { typeId, ...base } = this.object(o, [GFX_TYPE.shaderReference]);
    return { ...base, path: this.r.str(o + 0x18), shaderPtr: this.r.u32(o + 0x1c) };
  }

  fragShader(o: number): GfxFragShader {
    const { r } = this;
    const lutsP = r.ptr(o + 0x28);
    let luts: GfxFragShader['luts'] = null;
    if (lutsP) {
      const lut = (i: number): GfxFragLightLUT | null => {
        const p = r.ptr(lutsP + i * 4);
        if (!p) return null;
        const s = r.ptr(p + 8);
        let sampler: GfxLUTReference | null = null;
        if (s) sampler = { typeId: r.u32(s), samplerName: r.str(s + 4), tableName: r.str(s + 8), targetLUT: r.u32(s + 12) };
        return { input: r.u32(p), scale: r.u32(p + 4), sampler };
      };
      luts = { reflecR: lut(0), reflecG: lut(1), reflecB: lut(2), dist0: lut(3), dist1: lut(4), fresnel: lut(5) };
    }
    const textureEnvironments: GfxTexEnv[] = [0, 1, 2, 3, 4, 5].map((i) => {
      const p = o + 0x2c + i * 0x1c;
      const w = r.words(p + 4, 6);
      const hdr = (0x804f0000 | [0xc0, 0xc8, 0xd0, 0xd8, 0xf0, 0xf8][i]!) >>> 0;
      if (w[1] !== hdr) this.fail(p, 'texture combiner commands');
      return { constant: r.u32(p), stage: texEnvStageFrom(w[0]!, w[2]!, w[3]!, w[4]!, w[5]!) };
    });
    const at = r.words(o + 0xd4, 2);
    if (at[1] !== 0x000f0104) this.fail(o + 0xd4, 'alpha test command');
    const cmd = r.words(o + 0xdc, 6);
    if (cmd[1] !== 0x000f00fd || cmd[3] !== 0x000200e0 || cmd[5] !== 0x000201c3) this.fail(o + 0xdc, 'fragment shader commands');
    const update = cmd[2]!;
    for (let i = 1; i <= 4; i++) {
      textureEnvironments[i]!.stage.updateColorBuffer = ((update >>> (7 + i)) & 1) !== 0;
      textureEnvironments[i]!.stage.updateAlphaBuffer = ((update >>> (11 + i)) & 1) !== 0;
    }
    return {
      texEnvBufferColorF: r.vec4(o),
      lighting: {
        flags: r.u32(o + 0x10),
        translucencyKind: r.u32(o + 0x14),
        fresnelSelector: r.u32(o + 0x18),
        bumpTexture: r.s32(o + 0x1c),
        bumpMode: r.u32(o + 0x20),
        isBumpRenormalize: r.bool(o + 0x24),
      },
      luts,
      textureEnvironments,
      alphaTest: alphaTestFrom(at[0]!),
      texEnvBufferColor: rgbaFromU32(cmd[0]!),
      texEnvUpdateBuffer: (update & ~0xff00) >>> 0,
      lightingConfig0: cmd[4]!,
    };
  }

  // --- textures and LUTs ---

  imageData(o: number): GfxTextureImageData {
    const { r } = this;
    return {
      height: r.s32(o),
      width: r.s32(o + 4),
      rawBuffer: r.bytes(r.ptr(o + 0x0c), r.u32(o + 8)),
      dynamicAlloc: r.u32(o + 0x10),
      bitsPerPixel: r.s32(o + 0x14),
      locationPtr: r.u32(o + 0x18),
      memoryArea: r.u32(o + 0x1c),
    };
  }

  texture(o: number): GfxTexture {
    const { r } = this;
    const { typeId, ...base } = this.object(o, [GFX_TYPE.textureImage, GFX_TYPE.textureCube]);
    const t = {
      ...base,
      height: r.s32(o + 0x18),
      width: r.s32(o + 0x1c),
      glFormat: r.u32(o + 0x20),
      glType: r.u32(o + 0x24),
      mipmapSize: r.s32(o + 0x28),
      textureObj: r.u32(o + 0x2c),
      locationFlag: r.u32(o + 0x30),
      hwFormat: r.u32(o + 0x34),
    };
    const img = (p: number): GfxTextureImageData | null => (p ? this.imageData(p) : null);
    if (typeId === GFX_TYPE.textureImage) return { ...t, kind: 'image', image: img(r.ptr(o + 0x38)) };
    return { ...t, kind: 'cube', images: [0, 1, 2, 3, 4, 5].map((i) => img(r.ptr(o + 0x38 + i * 4))) };
  }

  lut(o: number): GfxLUT {
    const { r } = this;
    const { typeId, ...base } = this.object(o, [GFX_TYPE.lut]);
    return {
      ...base,
      samplers: this.named(o + 0x18, (p) => {
        if (r.u32(p) !== 0x80000000) this.fail(p, 'LUT sampler type');
        const n = r.u32(p + 0x0c);
        if (n & 3) this.fail(p, 'LUT command length');
        return { typeId: r.u32(p), name: r.str(p + 4)!, isAbsolute: r.bool(p + 8), commands: r.words(r.ptr(p + 0x10), n >> 2) };
      }),
    };
  }

  // --- animations ---

  segment(o: number): GfxCurveSegment {
    const { r } = this;
    const formatFlags = r.u32(o + 8);
    const quant = formatFlags >>> 5;
    const fmt = KEY_FORMATS[quant];
    if (!fmt) this.fail(o, `key quantization ${quant}`);
    const n = r.u32(o + 0x0c);
    let p = o + 0x14;
    let valueScale = 1, valueOffset = 0, frameScale = 1;
    if (fmt.scaled) {
      valueScale = r.f32(p);
      valueOffset = r.f32(p + 4);
      frameScale = r.f32(p + 8);
      p += 12;
    }
    const keys: GfxRawKey[] = [];
    for (let i = 0; i < n; i++, p += fmt.size) keys.push(readKey(r, p, quant));
    return { startFrame: r.f32(o), endFrame: r.f32(o + 4), formatFlags, invDuration: r.f32(o + 0x10), valueScale, valueOffset, frameScale, keys };
  }

  curve(o: number): GfxFloatKeyFrameGroup {
    const { r } = this;
    const curveFlags = r.u32(o + 0x0c);
    const g: GfxFloatKeyFrameGroup = {
      startFrame: r.f32(o),
      endFrame: r.f32(o + 4),
      preRepeat: r.u8(o + 8),
      postRepeat: r.u8(o + 9),
      padding: r.u16(o + 10),
      curveFlags,
      value: 0,
      segments: [],
    };
    if (curveFlags & 2) {
      g.value = r.f32(o + 0x10);
      return g;
    }
    // Segment count, then one pointer per segment (inline).
    const n = r.u32(o + 0x10);
    for (let i = 0; i < n; i++) g.segments.push(this.segment(r.ptr(o + 0x14 + i * 4)));
    return g;
  }

  channels(e: number, n: number, constBase: number, absentBase: number): GfxAnimChannel[] {
    const { r } = this;
    const flags = r.u32(e);
    const out: GfxAnimChannel[] = [];
    for (let i = 0; i < n; i++) {
      const slot = e + 0x0c + i * 4;
      if (flags & (1 << (absentBase + i))) {
        if (r.u32(slot)) this.fail(slot, 'absent channel with data');
        out.push(null);
      } else if (flags & (1 << (constBase + i))) out.push(r.f32(slot));
      else {
        const p = r.ptr(slot);
        if (!p) this.fail(slot, 'curve channel without curve');
        out.push(this.curve(p));
      }
    }
    return out;
  }

  baked(o: number, size: number): GfxBakedTrack | null {
    if (!o) return null;
    const { r } = this;
    const startFrame = r.f32(o);
    const endFrame = r.f32(o + 4);
    const flags = r.u32(o + 0x0c);
    const n = flags & 1 ? 1 : bakedCount(startFrame, endFrame);
    const values: number[][] = [];
    const segmentFlags: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = o + 0x10 + i * (size + 1) * 4;
      values.push(r.floats(p, size));
      segmentFlags.push(r.u32(p + size * 4));
    }
    return { startFrame, endFrame, curveRelPtr: r.u32(o + 8), flags, values, segmentFlags };
  }

  animationElement(o: number): GfxAnimationElement {
    const { r } = this;
    const flags = r.u32(o);
    const name = r.str(o + 4)!;
    const type = r.u32(o + 8) as GfxPrimitiveType;
    let content: GfxAnimContent;
    switch (type) {
      case GfxPrimitiveType.Float:
        content = { type, channels: this.channels(o, 1, 0, 1) as [GfxAnimChannel] };
        break;
      case GfxPrimitiveType.Vector2D:
        content = { type, channels: this.channels(o, 2, 0, 2) as [GfxAnimChannel, GfxAnimChannel] };
        break;
      case GfxPrimitiveType.Vector3D:
        content = { type, channels: this.channels(o, 3, 0, 3) as [GfxAnimChannel, GfxAnimChannel, GfxAnimChannel] };
        break;
      case GfxPrimitiveType.RGBA:
        content = { type, channels: this.channels(o, 4, 0, 4) as [GfxAnimChannel, GfxAnimChannel, GfxAnimChannel, GfxAnimChannel] };
        break;
      case GfxPrimitiveType.Transform:
        content = { type, channels: this.channels(o, 10, 6, 16) };
        break;
      case GfxPrimitiveType.QuatTransform:
        content = {
          type,
          rotations: this.baked(r.ptr(o + 0x0c), 4),
          translations: this.baked(r.ptr(o + 0x10), 3),
          scales: this.baked(r.ptr(o + 0x14), 3),
        };
        break;
      case GfxPrimitiveType.Boolean: {
        // Curve {start, end, pre / post repeat, pointer to the bits}, one bit per frame (start..end).
        const p = r.ptr(o + 0x0c);
        if (!p) this.fail(o, 'boolean element without curve');
        const startFrame = r.f32(p);
        const endFrame = r.f32(p + 4);
        const bits = r.ptr(p + 0x0c);
        const values: boolean[] = [];
        const n = boolCount(startFrame, endFrame);
        for (let i = 0; i < n; i++) values.push(((r.u8(bits + (i >> 3)) >> (i & 7)) & 1) !== 0);
        content = { type, value: { startFrame, endFrame, preRepeat: r.u8(p + 8), postRepeat: r.u8(p + 9), padding: r.u16(p + 10), values } };
        break;
      }
      default:
        this.fail(o, `animation element type ${type}`);
    }
    return { flags, name, content };
  }

  animation(o: number, extra = 0): GfxAnimation {
    const { r } = this;
    if (r.magic(o) !== 'CANM') this.fail(o, 'CANM expected');
    return {
      revision: r.u32(o + 4),
      name: r.str(o + 8)!,
      targetAnimGroupName: r.str(o + 0x0c),
      loopMode: r.u32(o + 0x10),
      framesCount: r.f32(o + 0x14),
      elements: this.dict(o + 0x18).map((e) => {
        const el = this.animationElement(e.data);
        if (el.name !== e.name) this.fail(e.data, 'animation element key');
        return el;
      }),
      metaData: this.metaData(o + 0x20),
      extraFields: r.words(o + 0x28, extra),
    };
  }

  // --- cameras ---

  camera(o: number): GfxCamera {
    const { r } = this;
    const { typeId, ...node } = this.nodeTransform(o, [GFX_TYPE.camera]);
    const v = r.ptr(o + 0xbc);
    const p = r.ptr(o + 0xc0);
    let view: GfxCameraView | null = null;
    if (v) {
      const t = r.u32(v);
      if (t === 0x80000000) view = { kind: 'aim', typeId: t, flags: r.u32(v + 4), target: r.vec3(v + 8), twist: r.f32(v + 0x14) };
      else if (t === 0x40000000) view = { kind: 'lookAt', typeId: t, flags: r.u32(v + 4), target: r.vec3(v + 8), upVector: r.vec3(v + 0x14) };
      else if (t === 0x20000000) view = { kind: 'rotation', typeId: t, isInheritingRotation: r.bool(v + 4), rotation: r.vec3(v + 8) };
      else this.fail(v, `camera view type ${hex(t)}`);
    }
    let projection: GfxCameraProjection | null = null;
    if (p) {
      const t = r.u32(p);
      if (t === 0x20000000)
        projection = { kind: 'perspective', typeId: t, zNear: r.f32(p + 4), zFar: r.f32(p + 8), aspectRatio: r.f32(p + 12), fovy: r.f32(p + 16) };
      else if (t === 0x40000000 || t === 0x80000000)
        projection = {
          kind: t === 0x40000000 ? 'orthogonal' : 'frustum', typeId: t, zNear: r.f32(p + 4), zFar: r.f32(p + 8),
          aspectRatio: r.f32(p + 12), height: r.f32(p + 16), center: r.vec2(p + 20),
        };
      else this.fail(p, `camera projection type ${hex(t)}`);
    }
    return { ...node, viewType: r.u32(o + 0xb4), projectionType: r.u32(o + 0xb8), view, projection, wScale: r.f32(o + 0xc4) };
  }
}

/** Values of a baked track (not constant): one per frame from start to end, both included, plus one. */
export const bakedCount = (start: number, end: number): number => Math.max(0, Math.floor(end - start)) + 2;
/** Frames of a boolean curve. */
export const boolCount = (start: number, end: number): number => Math.max(0, Math.ceil(end - start)) + 1;

function readKey(r: GfxReader, p: number, quant: number): GfxRawKey {
  switch (quant) {
    case 0:
      return { frame: r.f32(p), value: r.f32(p + 4), inSlope: r.f32(p + 8), outSlope: r.f32(p + 12) };
    case 1: {
      const w = r.u32(p);
      return { frame: w & 0xfff, value: w >>> 12, inSlope: r.s16(p + 4), outSlope: r.s16(p + 6) };
    }
    case 2: {
      // u8 frame, u16 value, 24 bits of slopes (in = bits 0-11, out = bits 12-23), as SPICA reads it.
      const s = r.u8(p + 3) | (r.u16(p + 4) << 8);
      return { frame: r.u8(p), value: r.u16(p + 1), inSlope: (s << 20) >> 20, outSlope: (s << 8) >> 20 };
    }
    case 3: {
      const s = r.f32(p + 8);
      return { frame: r.f32(p), value: r.f32(p + 4), inSlope: s, outSlope: s };
    }
    case 4: {
      const s = r.s16(p + 4);
      return { frame: r.u16(p), value: r.u16(p + 2), inSlope: s, outSlope: s };
    }
    case 5: {
      const w = r.u32(p);
      const s = (w | 0) >> 20;
      return { frame: w & 0xff, value: (w >>> 8) & 0xfff, inSlope: s, outSlope: s };
    }
    case 6:
      return { frame: r.f32(p), value: r.f32(p + 4), inSlope: 0, outSlope: 0 };
    default: {
      const w = r.u32(p);
      return { frame: w & 0xfff, value: w >>> 12, inSlope: 0, outSlope: 0 };
    }
  }
}

/** Parses a CGFX file (bytes starting at the 'CGFX' magic). */
export function readGfx(b: Uint8Array): Gfx {
  const r = new GfxReader(b);
  if (r.magic(0) !== 'CGFX') throw new Error('CGFX: not a CGFX file');
  if (r.u16(4) !== 0xfeff) throw new Error('CGFX: big-endian files are not supported');
  const headerLength = r.u16(6);
  if (headerLength !== 0x14) throw new Error(`CGFX: header length ${hex(headerLength)}`);
  const g = emptyGfx();
  g.revision = r.u32(8);
  const data = headerLength;
  if (r.magic(data) !== 'DATA') throw new Error('CGFX: DATA section expected');
  const p = new GfxParser(r);
  GFX_DICTS.forEach((key, i) => {
    const at = data + 8 + i * 8;
    switch (key) {
      case 'models':
        g.models = p.named(at, (o) => p.model(o));
        break;
      case 'textures':
        g.textures = p.named(at, (o) => p.texture(o));
        break;
      case 'luts':
        g.luts = p.named(at, (o) => p.lut(o));
        break;
      case 'materials':
        g.materials = p.named(at, (o) => p.material(o));
        break;
      case 'cameras':
        g.cameras = p.named(at, (o) => p.camera(o));
        break;
      case 'skeletalAnimations':
      case 'materialAnimations':
      case 'visibilityAnimations':
      case 'cameraAnimations':
      case 'lightAnimations':
      case 'fogAnimations':
        g[key] = p.named(at, (o) => p.animation(o, key === 'cameraAnimations' ? 2 : 0));
        break;
      default:
        if (r.u32(at)) throw new Error(`CGFX: ${key} are not supported (none occur in the games)`);
    }
  });
  return g;
}
