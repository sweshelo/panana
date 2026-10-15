// CGFX writer: Gfx object model -> bytes. The placement reproduces the NW4C tools' order, so that a file read with
// readGfx and written again is byte-identical:
//   - an object is placed, then (A) the tables of its list / array fields, then (B) the DICTs of its dictionary
//     fields, then (C) the objects it points to, each with all of its own descendants, in field order;
//   - strings follow the content, in order of their first reference (equal strings share one copy);
//   - the IMAG section follows (vertex / index buffers and textures in order of reference; textures 128-aligned).
import { Block, GfxLayout, align } from './bin';
import { buildDictTree } from './dict';
import {
  PICACommandWriter, alphaTestTo, blendFunctionTo, colorOperationTo, depthColorMaskTo, rgbaToU32, stencilOperationTo,
  stencilTestTo, texEnvStageTo, TEXENV_SOURCE_REGS,
} from './pica';
import { GFX_TYPE, KEY_FORMATS } from './read';
import {
  GFX_DICTS, GfxPrimitiveType, type Gfx, type GfxAnimChannel, type GfxAnimGroup, type GfxAnimGroupElement,
  type GfxAnimation, type GfxAnimationElement, type GfxAttribute, type GfxBakedTrack, type GfxCamera, type GfxCurveSegment,
  type GfxFace, type GfxFaceDescriptor, type GfxFloatKeyFrameGroup, type GfxFragLightLUT, type GfxFragShader, type GfxLUT,
  type GfxMaterial, type GfxMesh, type GfxMetaData, type GfxModel, type GfxNodeTransform, type GfxObject, type GfxRawKey,
  type GfxShape, type GfxSkeleton, type GfxSubMesh, type GfxTexture, type GfxTextureImageData, type GfxTextureMapper,
  type GfxVertexBuffer, type RGBA, type GfxShaderReference, type GfxTextureReference,
} from './types';

/** Alignment of texture data in the IMAG section. */
const TEXTURE_ALIGN = 128;

/** A dictionary placed as a DICT block; values are pointed to with setValue once placed. */
interface DictOut {
  block: Block | null;
  count: number;
  setValue(i: number, target: Block): void;
}

class GfxWriter {
  readonly w = new GfxLayout();

  /** Places a DICT for these names (none when empty). */
  dict(names: readonly string[]): DictOut {
    if (!names.length) return { block: null, count: 0, setValue: () => {} };
    const tree = buildDictTree(names);
    const b = this.w.add(0x0c + tree.length * 16, 'DICT');
    b.set(0, new Uint8Array([0x44, 0x49, 0x43, 0x54])).u32(4, b.size).u32(8, names.length);
    tree.forEach((n, i) => {
      const o = 0x0c + i * 16;
      b.u32(o, n.referenceBit).u16(o + 4, n.leftNodeIndex).u16(o + 6, n.rightNodeIndex);
      if (i) b.str(o + 8, n.name);
    });
    return { block: b, count: names.length, setValue: (i, target) => b.ptr(0x0c + (i + 1) * 16 + 12, target) };
  }

  /** Writes a dictionary reference {count, pointer} into a block. */
  dictRef(b: Block, o: number, d: DictOut): void {
    b.u32(o, d.count).ptr(o + 4, d.block);
  }

  /** Places a table of pointers (none when empty) and writes {count, pointer}; returns the table. */
  table(b: Block, o: number, count: number, label: string, alignment = 4): Block | null {
    b.u32(o, count);
    if (!count) return null;
    const t = this.w.add(count * 4, label, alignment);
    b.ptr(o + 4, t);
    return t;
  }

  /** Places an array of u32 / f32 words and writes {count, pointer}. */
  words(b: Block, o: number, values: readonly number[], float = false, label = 'array'): void {
    b.u32(o, values.length);
    if (!values.length) return;
    const t = this.w.add(values.length * 4, label);
    values.forEach((v, i) => (float ? t.f32(i * 4, v) : t.u32(i * 4, v)));
    b.ptr(o + 4, t);
  }

  // --- common ---

  objectHeader(b: Block, typeId: number, magic: string, o: GfxObject): void {
    b.u32(0, typeId).set(4, magicBytes(magic)).u32(8, o.revision).str(12, o.name);
  }

  metaDataValues(d: DictOut, md: GfxMetaData[]): void {
    md.forEach((m, i) => {
      let b: Block;
      switch (m.kind) {
        case 'single':
          b = this.w.add(16 + m.values.length * 4, 'metadata').u32(0, 0x80000000).u32(12, m.values.length).floats(16, m.values);
          break;
        case 'integer':
          b = this.w.add(16 + m.values.length * 4, 'metadata').u32(0, 0x20000000).u32(12, m.values.length);
          m.values.forEach((v, k) => b.s32(16 + k * 4, v));
          break;
        case 'color':
          b = this.w.add(16 + m.values.length * 16, 'metadata').u32(0, 0x40000000).u32(12, m.values.length);
          m.values.forEach((v, k) => b.floats(16 + k * 16, v));
          break;
        case 'string':
          b = this.w.add(20 + m.values.length * 4, 'metadata').u32(0, 0x10000000).u32(12, m.format).u32(16, m.values.length);
          m.values.forEach((v, k) => b.str(20 + k * 4, v));
          break;
      }
      b.str(4, m.name).u32(8, m.type);
      d.setValue(i, b);
    });
  }

  nodeTransformFields(b: Block, n: GfxNodeTransform): void {
    b.u32(0x18, n.branchVisible).bool(0x1c, n.isBranchVisible);
    b.floats(0x30, n.transformScale).floats(0x3c, n.transformRotation).floats(0x48, n.transformTranslation);
    b.floats(0x54, n.localTransform).floats(0x84, n.worldTransform);
  }

  animGroup(g: GfxAnimGroup): Block {
    const b = this.w.add(0x24, 'animGroup').u32(0, 0x80000000).u32(4, g.flags).str(8, g.name).u32(0x0c, g.memberType);
    b.u32(0x20, g.evaluationTiming);
    this.words(b, 0x18, g.blendOperationTypes, false, 'blendOps');
    const d = this.dict(g.elements.map((e) => e.name ?? ''));
    this.dictRef(b, 0x10, d);
    g.elements.forEach((e, i) => d.setValue(i, this.animGroupElement(e)));
    return b;
  }

  animGroupElement(e: GfxAnimGroupElement): Block {
    const sizes: Record<GfxAnimGroupElement['kind'], number> = {
      bone: 0x24, materialColor: 0x24, blendOp: 0x24, texSampler: 0x28, texMapper: 0x28, texCoord: 0x28, model: 0x20,
      mesh: 0x24, meshNodeVis: 0x24, camera: 0x20,
    };
    const b = this.w.add(sizes[e.kind], 'animGroupElement');
    b.u32(0, e.typeId).str(4, e.name).s32(8, e.memberOffset).s32(0x0c, e.blendOpIndex).u32(0x10, e.objType).u32(0x14, e.memberType).u32(0x18, e.materialPtr);
    switch (e.kind) {
      case 'bone':
        b.str(0x1c, e.boneName).u32(0x20, e.objType2);
        break;
      case 'materialColor':
      case 'blendOp':
        b.str(0x1c, e.materialName).u32(0x20, e.objType2);
        break;
      case 'texSampler':
      case 'texMapper':
      case 'texCoord':
        b.str(0x1c, e.materialName).s32(0x20, e.index).u32(0x24, e.objType2);
        break;
      case 'model':
      case 'camera':
        b.u32(0x1c, e.objType2);
        break;
      case 'mesh':
        b.s32(0x1c, e.meshIndex).u32(0x20, e.objType2);
        break;
      case 'meshNodeVis':
        b.str(0x1c, e.nodeName).u32(0x20, e.objType2);
        break;
    }
    return b;
  }

  // --- models ---

  model(m: GfxModel): Block {
    const skeletal = m.skeleton !== undefined;
    const b = this.w.add(skeletal ? 0xe4 : 0xe0, 'model');
    b.u32(0, skeletal ? GFX_TYPE.modelSkeletal : GFX_TYPE.model).set(4, magicBytes('CMDL')).u32(8, m.revision).str(12, m.name);
    this.nodeTransformFields(b, m);
    b.u32(0xd4, m.flags).u32(0xd8, m.faceCulling).s32(0xdc, m.layerId);
    // (A) tables
    const meshTable = this.table(b, 0xb4, m.meshes.length, 'meshTable', 8);
    const shapeTable = this.table(b, 0xc4, m.shapes.length, 'shapeTable');
    // (B) dictionaries
    const md = this.dict(m.metaData.map((x) => x.name));
    const ag = this.dict(m.animationsGroup.map((x) => x.name ?? ''));
    const mats = this.dict(m.materials.map((x) => x.name ?? ''));
    const vis = this.dict(m.meshNodeVisibilities.map((x) => x.name));
    this.dictRef(b, 0x10, md);
    this.dictRef(b, 0x28, ag);
    this.dictRef(b, 0xbc, mats);
    this.dictRef(b, 0xcc, vis);
    // (C) objects
    this.metaDataValues(md, m.metaData);
    m.animationsGroup.forEach((g, i) => ag.setValue(i, this.animGroup(g)));
    m.meshes.forEach((x, i) => meshTable!.ptr(i * 4, this.mesh(x, b)));
    m.materials.forEach((x, i) => mats.setValue(i, this.material(x)));
    m.shapes.forEach((x, i) => shapeTable!.ptr(i * 4, this.shape(x)));
    m.meshNodeVisibilities.forEach((x, i) => vis.setValue(i, this.w.add(8, 'meshNodeVis').str(0, x.name).bool(4, x.isVisible)));
    if (m.skeleton) b.ptr(0xe0, this.skeleton(m.skeleton));
    return b;
  }

  mesh(m: GfxMesh, model: Block): Block {
    const b = this.w.add(0x84, 'mesh', 8);
    this.objectHeader(b, GFX_TYPE.mesh, 'SOBJ', m);
    b.s32(0x18, m.shapeIndex).s32(0x1c, m.materialIndex).ptr(0x20, model).u8(0x24, m.isVisible).u8(0x25, m.renderPriority);
    b.dv.setInt16(0x26, m.meshNodeIndex, true);
    b.s32(0x28, m.primitiveIndex).u32(0x2c, m.flags).words(0x30, m.attrScaleCommands);
    b.u32(0x60, m.enableCommandsPtr).u32(0x64, m.enableCommandsLength).u32(0x68, m.disableCommandsPtr).u32(0x6c, m.disableCommandsLength);
    b.str(0x70, m.meshNodeName).words(0x74, m.renderKeyCache).u32(0x7c, m.commandAlloc).u32(0x80, m.reserved);
    this.objectMetaData(b, m);
    return b;
  }

  /** (B) + (C) of an object whose only dictionary is its user data. */
  objectMetaData(b: Block, o: GfxObject): void {
    const md = this.dict(o.metaData.map((x) => x.name));
    this.dictRef(b, 0x10, md);
    this.metaDataValues(md, o.metaData);
  }

  skeleton(s: GfxSkeleton): Block {
    const b = this.w.add(0x2c, 'skeleton');
    this.objectHeader(b, GFX_TYPE.skeleton, 'SOBJ', s);
    b.u32(0x24, s.scalingRule).u32(0x28, s.flags);
    const md = this.dict(s.metaData.map((x) => x.name));
    const bones = this.dict(s.bones.map((x) => x.name));
    this.dictRef(b, 0x10, md);
    this.dictRef(b, 0x18, bones);
    this.metaDataValues(md, s.metaData);
    const blocks = s.bones.map(() => new Block(0xe0, 'bone'));
    const at = (i: number): Block | null => (i < 0 ? null : (blocks[i] ?? fail(`bone pointer ${i}`)));
    s.bones.forEach((x, i) => {
      const p = this.w.place(blocks[i]!);
      p.str(0, x.name).u32(4, x.flags).s32(8, x.index).s32(0x0c, x.parentIndex);
      p.ptr(0x10, at(x.parent)).ptr(0x14, at(x.child)).ptr(0x18, at(x.prevSibling)).ptr(0x1c, at(x.nextSibling));
      p.floats(0x20, x.scale).floats(0x2c, x.rotation).floats(0x38, x.translation);
      p.floats(0x44, x.localTransform).floats(0x74, x.worldTransform).floats(0xa4, x.invWorldTransform).u32(0xd4, x.billboardMode);
      const bmd = this.dict(x.metaData.map((y) => y.name));
      this.dictRef(p, 0xd8, bmd);
      this.metaDataValues(bmd, x.metaData);
      bones.setValue(i, p);
    });
    b.ptr(0x20, at(s.rootBone));
    return b;
  }

  shape(s: GfxShape): Block {
    const b = this.w.add(0x44, 'shape');
    this.objectHeader(b, GFX_TYPE.shape, 'SOBJ', s);
    b.u32(0x18, s.flags).floats(0x20, s.positionOffset).u32(0x34, s.baseAddress);
    const sm = this.table(b, 0x2c, s.subMeshes.length, 'subMeshTable');
    const vb = this.table(b, 0x38, s.vertexBuffers.length, 'vertexBufferTable');
    this.objectMetaData(b, s);
    if (s.boundingBox) {
      const x = s.boundingBox;
      b.ptr(0x1c, this.w.add(0x40, 'obb').u32(0, x.typeId).floats(4, x.center).floats(0x10, x.orientation).floats(0x34, x.size));
    }
    s.subMeshes.forEach((x, i) => sm!.ptr(i * 4, this.subMesh(x)));
    s.vertexBuffers.forEach((x, i) => vb!.ptr(i * 4, this.vertexBuffer(x)));
    if (s.blendShape) {
      const x = s.blendShape;
      const p = this.w.add(0x14, 'blendShape').u32(0, x.typeId);
      this.table(p, 4, 0, 'blendShapeTargets');
      this.words(p, 0x0c, x.types, false, 'blendShapeTypes');
      b.ptr(0x40, p);
    }
    return b;
  }

  subMesh(s: GfxSubMesh): Block {
    const b = this.w.add(0x14, 'subMesh').u32(8, s.skinning);
    this.words(b, 0, s.boneIndices, false, 'boneIndices');
    const ft = this.table(b, 0x0c, s.faces.length, 'faceTable');
    s.faces.forEach((x, i) => ft!.ptr(i * 4, this.face(x)));
    return b;
  }

  face(f: GfxFace): Block {
    const b = this.w.add(0x18, 'face').u32(0x10, f.flags).u32(0x14, f.commandAlloc);
    const t = this.table(b, 0, f.faceDescriptors.length, 'faceDescriptorTable');
    this.words(b, 8, f.bufferObjs, false, 'bufferObjs');
    f.faceDescriptors.forEach((x, i) => t!.ptr(i * 4, this.faceDescriptor(x)));
    return b;
  }

  faceDescriptor(f: GfxFaceDescriptor): Block {
    const b = this.w.add(0x2c, 'faceDescriptor').u32(0, f.format).u8(4, f.primitiveMode).u8(5, f.visible);
    b.image(8, f.rawBuffer).u32(0x10, f.bufferObj).u32(0x14, f.locationFlag).u32(0x18, f.commandCachePtr).u32(0x1c, f.commandCacheLength);
    b.u32(0x20, f.locationPtr).u32(0x24, f.memoryArea).u32(0x28, f.boundingVolume);
    return b;
  }

  attribute(a: GfxAttribute): Block {
    const b = this.w.add(0x34, 'attribute').u32(0, 0x40000001).u32(4, a.attrName).u32(8, a.type).u32(0x0c, a.bufferObj).u32(0x10, a.locationFlag);
    b.image(0x14, a.rawBuffer).u32(0x1c, a.locationPtr).u32(0x20, a.memoryArea).u32(0x24, a.format).s32(0x28, a.elements);
    b.f32(0x2c, a.scale).s32(0x30, a.offset);
    return b;
  }

  vertexBuffer(v: GfxVertexBuffer): Block {
    switch (v.kind) {
      case 'attribute':
        return this.attribute(v);
      case 'interleaved': {
        const b = this.w.add(0x30, 'interleaved').u32(0, 0x40000002).u32(4, v.attrName).u32(8, v.type).u32(0x0c, v.bufferObj).u32(0x10, v.locationFlag);
        b.image(0x14, v.rawBuffer).u32(0x1c, v.locationPtr).u32(0x20, v.memoryArea).s32(0x24, v.vertexStride);
        const t = this.table(b, 0x28, v.attributes.length, 'attributeTable');
        v.attributes.forEach((x, i) => t!.ptr(i * 4, this.attribute(x)));
        return b;
      }
      case 'fixed': {
        const b = this.w.add(0x20, 'fixed').u32(0, 0x80000000).u32(4, v.attrName).u32(8, v.type).u32(0x0c, v.format).s32(0x10, v.elements).f32(0x14, v.scale);
        this.words(b, 0x18, v.vector, true, 'fixedVector');
        return b;
      }
    }
  }

  // --- materials ---

  material(m: GfxMaterial): Block {
    const b = this.w.add(0x2d8, 'material');
    this.objectHeader(b, GFX_TYPE.material, 'MTOB', m);
    b.u32(0x18, m.flags).u32(0x1c, m.texCoordConfig).u32(0x20, m.translucencyKind);
    const c = m.colors;
    [c.emissionF, c.ambientF, c.diffuseF, c.specular0F, c.specular1F, c.constant0F, c.constant1F, c.constant2F, c.constant3F, c.constant4F, c.constant5F]
      .forEach((v, i) => b.floats(0x24 + i * 16, v));
    [c.emission, c.ambient, c.diffuse, c.specular0, c.specular1, c.constant0, c.constant1, c.constant2, c.constant3, c.constant4, c.constant5]
      .forEach((v, i) => b.u32(0xd4 + i * 4, rgbaToU32(v)));
    b.u32(0x100, c.commandCache);
    const ra = m.rasterization;
    b.bool(0x104, ra.isPolygonOffsetEnabled).u32(0x108, ra.faceCulling).f32(0x10c, ra.polygonOffsetUnit);
    b.words(0x110, new PICACommandWriter().set(0x040, ra.faceCullingCommand, 1).words);
    const fo = m.fragmentOperation;
    b.u32(0x118, fo.depth.flags);
    b.words(0x11c, new PICACommandWriter().set(0x107, depthColorMaskTo(fo.depth.colorMask), 1).set(0x126, fo.depth.deltaZDepth, 8).words);
    b.u32(0x12c, fo.blend.mode).floats(0x130, fo.blend.colorF);
    const bl = fo.blend;
    b.words(0x140, new PICACommandWriter().setMany(0x100, true, [colorOperationTo(bl.colorOperation), blendFunctionTo(bl.function), bl.logicalOperation, rgbaToU32(bl.color)]).words);
    b.words(0x158, new PICACommandWriter().set(0x105, stencilTestTo(fo.stencil.test), 13).set(0x106, stencilOperationTo(fo.stencil.operation)).words);
    b.s32(0x168, m.usedTextureCoordsCount);
    m.textureCoords.forEach((t, i) => {
      const o = 0x16c + i * 0x58;
      b.s32(o, t.sourceCoordIndex).u32(o + 4, t.mappingType).s32(o + 8, t.referenceCameraIndex).u32(o + 0x0c, t.transformType);
      b.floats(o + 0x10, t.scale).f32(o + 0x18, t.rotation).floats(o + 0x1c, t.translation).u32(o + 0x24, t.flags).floats(o + 0x28, t.transform);
    });
    b.s32(0x28c, m.shaderProgramDescIndex).s32(0x298, m.lightSetIndex).s32(0x29c, m.fogIndex);
    b.words(0x2a0, [
      m.materialFlagsHash, m.shaderParamsHash, m.textureCoordsHash, m.textureSamplersHash, m.textureMappersHash, m.materialColorsHash,
      m.rasterizationHash, m.fragLightHash, m.fragLightLUTHash, m.fragLightLUTSampHash, m.textureEnvironmentHash, m.alphaTestHash,
      m.fragOpHash, m.uniqueId,
    ]);
    this.table(b, 0x290, 0, 'shaderParameters');
    this.objectMetaData(b, m);
    m.textureMappers.forEach((t, i) => t && b.ptr(0x274 + i * 4, this.textureMapper(t, i)));
    if (m.shader) b.ptr(0x284, this.shaderReference(m.shader));
    if (m.fragmentShader) b.ptr(0x288, this.fragShader(m.fragmentShader));
    return b;
  }

  textureMapper(t: GfxTextureMapper, unit: number): Block {
    const b = this.w.add(0x4c, 'textureMapper').u32(0, 0x80000000).u32(4, t.dynamicAlloc);
    const param =
      ((t.magFilter & 1) << 1) | ((t.minFilter & 1) << 2) | ((t.mipFilter & 1) << 24) | ((t.wrapV & 7) << 8) | ((t.wrapU & 7) << 12) | t.paramOtherBits;
    const lod = (Math.round(t.lodBias * 256) & 0x1fff) | ((t.maxLOD & 0xf) << 16) | ((t.minLOD & 0xf) << 24);
    const cmd = new PICACommandWriter()
      .set([0x8e, 0x96, 0x9e][unit]!, t.unitType, 1)
      .setMany([0x81, 0x91, 0x99][unit]!, true, [rgbaToU32(t.borderColor), t.dimension, param >>> 0, lod >>> 0, ...t.tail]);
    b.words(0x10, cmd.words).u32(0x48, cmd.words.length * 4);
    if (t.texture) b.ptr(8, this.textureReference(t.texture));
    if (t.sampler) {
      const s = t.sampler;
      b.ptr(0x0c, this.w.add(0x20, 'sampler').u32(0, s.typeId).ptr(4, b).u32(8, s.minFilter).floats(0x0c, s.borderColor).f32(0x1c, s.lodBias));
    }
    return b;
  }

  textureReference(t: GfxTextureReference): Block {
    const b = this.w.add(0x20, 'textureReference');
    this.objectHeader(b, GFX_TYPE.textureReference, 'TXOB', t);
    b.str(0x18, t.path).u32(0x1c, t.texturePtr);
    this.objectMetaData(b, t);
    return b;
  }

  shaderReference(t: GfxShaderReference): Block {
    const b = this.w.add(0x20, 'shaderReference');
    this.objectHeader(b, GFX_TYPE.shaderReference, 'SHDR', t);
    b.str(0x18, t.path).u32(0x1c, t.shaderPtr);
    this.objectMetaData(b, t);
    return b;
  }

  fragShader(f: GfxFragShader): Block {
    const b = this.w.add(0xf4, 'fragShader').floats(0, f.texEnvBufferColorF);
    const l = f.lighting;
    b.u32(0x10, l.flags).u32(0x14, l.translucencyKind).u32(0x18, l.fresnelSelector).s32(0x1c, l.bumpTexture).u32(0x20, l.bumpMode).bool(0x24, l.isBumpRenormalize);
    let update = f.texEnvUpdateBuffer;
    f.textureEnvironments.forEach((t, i) => {
      const o = 0x2c + i * 0x1c;
      b.u32(o, t.constant).words(o + 4, new PICACommandWriter().setMany(TEXENV_SOURCE_REGS[i]!, true, texEnvStageTo(t.stage)).words);
      if (i >= 1 && i <= 4) update |= (t.stage.updateColorBuffer ? 1 << (7 + i) : 0) | (t.stage.updateAlphaBuffer ? 1 << (11 + i) : 0);
    });
    b.words(0xd4, new PICACommandWriter().set(0x104, alphaTestTo(f.alphaTest)).words);
    b.words(0xdc, new PICACommandWriter().set(0xfd, rgbaToU32(f.texEnvBufferColor)).set(0xe0, update >>> 0, 2).set(0x1c3, f.lightingConfig0, 2).words);
    if (f.luts) {
      const p = this.w.add(0x18, 'fragLightLUTs');
      const u = f.luts;
      [u.reflecR, u.reflecG, u.reflecB, u.dist0, u.dist1, u.fresnel].forEach((x, i) => x && p.ptr(i * 4, this.fragLightLUT(x)));
      b.ptr(0x28, p);
    }
    return b;
  }

  fragLightLUT(l: GfxFragLightLUT): Block {
    const b = this.w.add(0x0c, 'fragLightLUT').u32(0, l.input).u32(4, l.scale);
    if (l.sampler) {
      const s = l.sampler;
      b.ptr(8, this.w.add(0x10, 'lutReference').u32(0, s.typeId).str(4, s.samplerName).str(8, s.tableName).u32(12, s.targetLUT));
    }
    return b;
  }

  // --- textures and LUTs ---

  texture(t: GfxTexture): Block {
    const b = this.w.add(t.kind === 'image' ? 0x3c : 0x50, 'texture');
    this.objectHeader(b, t.kind === 'image' ? GFX_TYPE.textureImage : GFX_TYPE.textureCube, 'TXOB', t);
    b.s32(0x18, t.height).s32(0x1c, t.width).u32(0x20, t.glFormat).u32(0x24, t.glType).s32(0x28, t.mipmapSize);
    b.u32(0x2c, t.textureObj).u32(0x30, t.locationFlag).u32(0x34, t.hwFormat);
    this.objectMetaData(b, t);
    const images = t.kind === 'image' ? [t.image] : t.images;
    images.forEach((x, i) => x && b.ptr(0x38 + i * 4, this.imageData(x)));
    return b;
  }

  imageData(d: GfxTextureImageData): Block {
    const b = this.w.add(0x20, 'imageData').s32(0, d.height).s32(4, d.width).image(8, d.rawBuffer, TEXTURE_ALIGN);
    return b.u32(0x10, d.dynamicAlloc).s32(0x14, d.bitsPerPixel).u32(0x18, d.locationPtr).u32(0x1c, d.memoryArea);
  }

  lut(l: GfxLUT): Block {
    const b = this.w.add(0x20, 'lut');
    this.objectHeader(b, GFX_TYPE.lut, 'LUTS', l);
    const md = this.dict(l.metaData.map((x) => x.name));
    const ss = this.dict(l.samplers.map((x) => x.name));
    this.dictRef(b, 0x10, md);
    this.dictRef(b, 0x18, ss);
    this.metaDataValues(md, l.metaData);
    l.samplers.forEach((s, i) => {
      const p = this.w.add(0x14, 'lutSampler').u32(0, s.typeId).str(4, s.name).bool(8, s.isAbsolute);
      p.u32(0x0c, s.commands.length * 4);
      if (s.commands.length) p.ptr(0x10, this.w.add(s.commands.length * 4, 'lutCommands').words(0, s.commands));
      ss.setValue(i, p);
    });
    return b;
  }

  // --- animations ---

  animation(a: GfxAnimation): Block {
    const b = this.w.add(0x28 + a.extraFields.length * 4, 'animation').set(0, magicBytes('CANM')).u32(4, a.revision).str(8, a.name).str(0x0c, a.targetAnimGroupName);
    b.words(0x28, a.extraFields);
    b.u32(0x10, a.loopMode).f32(0x14, a.framesCount);
    const el = this.dict(a.elements.map((x) => x.name));
    const md = this.dict(a.metaData.map((x) => x.name));
    this.dictRef(b, 0x18, el);
    this.dictRef(b, 0x20, md);
    a.elements.forEach((e, i) => el.setValue(i, this.animationElement(e)));
    this.metaDataValues(md, a.metaData);
    return b;
  }

  animationElement(e: GfxAnimationElement): Block {
    const c = e.content;
    const slots =
      c.type === GfxPrimitiveType.QuatTransform ? 3 : c.type === GfxPrimitiveType.Boolean ? 1 : c.channels.length;
    const b = this.w.add(0x0c + slots * 4, 'animElement').str(4, e.name).u32(8, c.type);
    let flags = e.flags;
    switch (c.type) {
      case GfxPrimitiveType.QuatTransform:
        if (c.rotations) b.ptr(0x0c, this.baked(c.rotations));
        if (c.translations) b.ptr(0x10, this.baked(c.translations));
        if (c.scales) b.ptr(0x14, this.baked(c.scales));
        break;
      case GfxPrimitiveType.Boolean: {
        const v = c.value;
        const p = this.w.add(0x10, 'boolCurve').f32(0, v.startFrame).f32(4, v.endFrame).u8(8, v.preRepeat).u8(9, v.postRepeat).u16(10, v.padding);
        const bits = this.w.add(Math.ceil(v.values.length / 8), 'boolBits');
        v.values.forEach((x, i) => x && (bits.bytes[i >> 3]! |= 1 << (i & 7)));
        b.ptr(0x0c, p.ptr(0x0c, bits));
        break;
      }
      default: {
        const n = c.channels.length;
        const [constBase, absentBase] = c.type === GfxPrimitiveType.Transform ? [6, 16] : [0, n];
        c.channels.forEach((ch, i) => {
          flags &= ~((1 << (constBase + i)) | (1 << (absentBase + i)));
          if (ch === null) flags |= 1 << (absentBase + i);
          else if (typeof ch === 'number') {
            flags |= 1 << (constBase + i);
            b.f32(0x0c + i * 4, ch);
          }
        });
        c.channels.forEach((ch, i) => ch !== null && typeof ch === 'object' && b.ptr(0x0c + i * 4, this.curve(ch)));
      }
    }
    b.u32(0, flags >>> 0);
    return b;
  }

  curve(g: GfxFloatKeyFrameGroup): Block {
    const constant = (g.curveFlags & 2) !== 0;
    const b = this.w.add(constant ? 0x14 : 0x14 + g.segments.length * 4, 'curve');
    b.f32(0, g.startFrame).f32(4, g.endFrame).u8(8, g.preRepeat).u8(9, g.postRepeat).u16(10, g.padding).u32(0x0c, g.curveFlags);
    if (constant) b.f32(0x10, g.value);
    else {
      b.u32(0x10, g.segments.length);
      g.segments.forEach((s, i) => b.ptr(0x14 + i * 4, this.segment(s)));
    }
    return b;
  }

  segment(s: GfxCurveSegment): Block {
    const quant = s.formatFlags >>> 5;
    const fmt = KEY_FORMATS[quant] ?? fail(`key quantization ${quant}`);
    const head = 0x14 + (fmt.scaled ? 12 : 0);
    const b = this.w.add(align(head + s.keys.length * fmt.size, 4), 'segment');
    b.f32(0, s.startFrame).f32(4, s.endFrame).u32(8, s.formatFlags).u32(0x0c, s.keys.length).f32(0x10, s.invDuration);
    if (fmt.scaled) b.f32(0x14, s.valueScale).f32(0x18, s.valueOffset).f32(0x1c, s.frameScale);
    s.keys.forEach((k, i) => writeKey(b, head + i * fmt.size, quant, k));
    return b;
  }

  baked(t: GfxBakedTrack): Block {
    const size = t.values[0]?.length ?? 0;
    const b = this.w.add(0x10 + t.values.length * (size + 1) * 4, 'baked');
    b.f32(0, t.startFrame).f32(4, t.endFrame).u32(8, t.curveRelPtr).u32(0x0c, t.flags);
    t.values.forEach((v, i) => b.floats(0x10 + i * (size + 1) * 4, v).u32(0x10 + i * (size + 1) * 4 + size * 4, t.segmentFlags[i] ?? 0));
    return b;
  }

  // --- cameras ---

  camera(c: GfxCamera): Block {
    const b = this.w.add(0xc8, 'camera');
    this.objectHeader(b, GFX_TYPE.camera, 'CCAM', c);
    this.nodeTransformFields(b, c);
    b.u32(0xb4, c.viewType).u32(0xb8, c.projectionType).f32(0xc4, c.wScale);
    const md = this.dict(c.metaData.map((x) => x.name));
    const ag = this.dict(c.animationsGroup.map((x) => x.name ?? ''));
    this.dictRef(b, 0x10, md);
    this.dictRef(b, 0x28, ag);
    this.metaDataValues(md, c.metaData);
    c.animationsGroup.forEach((g, i) => ag.setValue(i, this.animGroup(g)));
    if (c.view) {
      const v = c.view;
      let p: Block;
      if (v.kind === 'aim') p = this.w.add(0x18, 'view').u32(4, v.flags).floats(8, v.target).f32(0x14, v.twist);
      else if (v.kind === 'lookAt') p = this.w.add(0x20, 'view').u32(4, v.flags).floats(8, v.target).floats(0x14, v.upVector);
      else p = this.w.add(0x14, 'view').bool(4, v.isInheritingRotation).floats(8, v.rotation);
      b.ptr(0xbc, p.u32(0, v.typeId));
    }
    if (c.projection) {
      const v = c.projection;
      const p =
        v.kind === 'perspective'
          ? this.w.add(0x14, 'projection').f32(0x0c, v.aspectRatio).f32(0x10, v.fovy)
          : this.w.add(0x1c, 'projection').f32(0x0c, v.aspectRatio).f32(0x10, v.height).floats(0x14, v.center);
      b.ptr(0xc0, p.u32(0, v.typeId).f32(4, v.zNear).f32(8, v.zFar));
    }
    return b;
  }
}

function writeKey(b: Block, p: number, quant: number, k: GfxRawKey): void {
  switch (quant) {
    case 0:
      b.f32(p, k.frame).f32(p + 4, k.value).f32(p + 8, k.inSlope).f32(p + 12, k.outSlope);
      break;
    case 1:
      b.u32(p, (k.frame & 0xfff) | (k.value << 12)).u16(p + 4, k.inSlope).u16(p + 6, k.outSlope);
      break;
    case 2: {
      const s = (k.inSlope & 0xfff) | ((k.outSlope & 0xfff) << 12);
      b.u8(p, k.frame).u8(p + 1, k.value).u8(p + 2, k.value >> 8).u8(p + 3, s).u16(p + 4, s >> 8);
      break;
    }
    case 3:
      b.f32(p, k.frame).f32(p + 4, k.value).f32(p + 8, k.inSlope);
      break;
    case 4:
      b.u16(p, k.frame).u16(p + 2, k.value).u16(p + 4, k.inSlope);
      break;
    case 5:
      b.u32(p, (k.frame & 0xff) | ((k.value & 0xfff) << 8) | (k.inSlope << 20));
      break;
    case 6:
      b.f32(p, k.frame).f32(p + 4, k.value);
      break;
    default:
      b.u32(p, (k.frame & 0xfff) | (k.value << 12));
  }
}

const magicBytes = (m: string): Uint8Array => new Uint8Array([...m].map((c) => c.charCodeAt(0)));

function fail(what: string): never {
  throw new Error(`CGFX writer: ${what}`);
}

/** Builds a CGFX file. */
export function writeGfx(g: Gfx, debug?: { blocks?: Block[] }): Uint8Array {
  const wr = new GfxWriter();
  const data = wr.w.add(8 + GFX_DICTS.length * 8, 'DATA');
  data.set(0, magicBytes('DATA'));
  const lists = GFX_DICTS.map((k) => g[k] as { name: string | null }[]);
  lists.forEach((l, i) => {
    if (l.length && !['models', 'textures', 'luts', 'materials', 'cameras'].includes(GFX_DICTS[i]!) && !GFX_DICTS[i]!.endsWith('Animations'))
      fail(`${GFX_DICTS[i]} are not supported`);
  });
  const dicts = lists.map((l, i) => {
    const d = wr.dict(l.map((x) => x.name ?? ''));
    wr.dictRef(data, 8 + i * 8, d);
    return d;
  });
  GFX_DICTS.forEach((k, i) => {
    const d = dicts[i]!;
    switch (k) {
      case 'models':
        g.models.forEach((x, j) => d.setValue(j, wr.model(x)));
        break;
      case 'textures':
        g.textures.forEach((x, j) => d.setValue(j, wr.texture(x)));
        break;
      case 'luts':
        g.luts.forEach((x, j) => d.setValue(j, wr.lut(x)));
        break;
      case 'materials':
        g.materials.forEach((x, j) => d.setValue(j, wr.material(x)));
        break;
      case 'cameras':
        g.cameras.forEach((x, j) => d.setValue(j, wr.camera(x)));
        break;
      default:
        if (k.endsWith('Animations')) (g[k] as GfxAnimation[]).forEach((x, j) => d.setValue(j, wr.animation(x)));
    }
  });
  if (debug) debug.blocks = wr.w.blocks;
  return wr.w.build(0x14, (out, contentEnd, imageStart, imageEnd) => {
    const dv = new DataView(out.buffer);
    out.set(magicBytes('CGFX'), 0);
    dv.setUint16(4, 0xfeff, true);
    dv.setUint16(6, 0x14, true);
    dv.setUint32(8, g.revision, true);
    dv.setUint32(0x0c, out.length, true);
    dv.setUint32(0x10, imageEnd > imageStart ? 2 : 1, true);
    dv.setUint32(0x18, imageStart - 0x14, true);
    void contentEnd;
    if (imageEnd > imageStart) {
      out.set(magicBytes('IMAG'), imageStart);
      dv.setUint32(imageStart + 4, imageEnd - imageStart, true);
    }
  });
}
