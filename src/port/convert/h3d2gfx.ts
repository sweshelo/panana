// H3D -> CGFX (RPG2): a model, its textures, LUTs and animations as RPG2's files have them (the reverse of
// gfx2h3d.ts). Values the NW4C tools write and nothing reads (matrices, flags, hashes, animation groups) are made as
// the games' own files have them; see the notes at each.
import {
  ANIM_GROUP_ELEMENT, GfxGLDataType, GfxPrimitiveType, PICACommandWriter, emptyGfx, encodeIndices, linkBones, texEnvStageFrom,
  type Gfx, type GfxAnimChannel, type GfxAnimContent, type GfxAnimGroup, type GfxAnimGroupElement, type GfxAnimation,
  type GfxAnimationElement, type GfxBakedTrack, type GfxBone, type GfxCurveSegment, type GfxFloatKeyFrameGroup,
  type GfxFragLightLUT, type GfxLUT, type GfxMaterial, type GfxMesh, type GfxModel, type GfxRawKey, type GfxShape,
  type GfxSubMesh, type GfxTexEnv, type GfxTexture, type GfxTextureMapper, type GfxVertexBuffer, type RGBA as GfxRGBA,
  type Vec4,
} from '../gfx';
import {
  H3DPrimitiveType, H3DTargetType, PICAAttributeName,
  type H3D, type H3DAnimation, type H3DAnimSlot, type H3DFloatKeyFrameGroup, type H3DKeySegment, type H3DLUT, type H3DMaterial,
  type H3DMesh, type H3DModel, type H3DQuatTrack, type H3DTexture, type RGBA,
} from '../h3d';
import { IDENTITY34, composeTRS, invert34, worldMatrices } from './common';
import { lutWords } from './gfx2h3d';
import { refFloat, setMaterialHashes } from './gfxhash';

const col = (c: RGBA): GfxRGBA => ({ r: c[0], g: c[1], b: c[2], a: c[3] });
/** A colour's floats: the shortest decimals that give its bytes (the NW4C tools keep 0.5, not 128 / 255). */
const f4 = (c: RGBA): Vec4 => [refFloat(c[0]), refFloat(c[1]), refFloat(c[2]), refFloat(c[3])];

/** PICAAttributeFormat -> GL data type. */
const GL_FORMAT = [GfxGLDataType.GL_BYTE, GfxGLDataType.GL_UNSIGNED_BYTE, GfxGLDataType.GL_SHORT, GfxGLDataType.GL_FLOAT];
const FORMAT_SIZE = [1, 1, 2, 4];

/** GL format / type of each PICA texture format (as the NW4C tools write them). */
const TEXTURE_GL: [number, number][] = [
  [0x1908, 0x1401], [0x1907, 0x1401], [0x1908, 0x8034], [0x1907, 0x8363], [0x1908, 0x8033], [0x190a, 0x1401], [0x6759, 0x1401],
  [0x1909, 0x1401], [0x1906, 0x1401], [0x190a, 0x6760], [0x1909, 0x6761], [0x1906, 0x6761], [0x675a, 0], [0x675b, 0],
];
const TEXTURE_BPP = [32, 24, 16, 16, 16, 16, 16, 8, 8, 8, 4, 4, 4, 8];

/** H3DTextureMinFilter -> GfxTextureMinFilter. */
const MIN_FILTER_TO_GFX = [0, 2, 3, 1, 4, 5];

// ---- Textures and LUTs

export function textureToGfx(t: H3DTexture): GfxTexture {
  if (t.rawBuffers.length !== 1) throw new Error(`texture ${t.name}: cube maps are not supported`);
  const [glFormat, glType] = TEXTURE_GL[t.format] ?? [0, 0];
  return {
    kind: 'image', name: t.name, revision: 0x05000000, metaData: [], height: t.height, width: t.width, glFormat, glType, mipmapSize: t.mipmapSize,
    textureObj: 0, locationFlag: 0, hwFormat: t.format,
    image: { height: t.height, width: t.width, rawBuffer: t.rawBuffers[0]!, dynamicAlloc: 0, bitsPerPixel: TEXTURE_BPP[t.format] ?? 4, locationPtr: 0, memoryArea: 0 },
  };
}

export function lutToGfx(l: H3DLUT): GfxLUT {
  return {
    name: l.name, revision: 0x04000100, metaData: [],
    samplers: l.samplers.map((s) => {
      const words = s.commands ? lutWords(Array.from(s.commands)) : s.table.map((v) => Math.round(v * 0xfff));
      return { typeId: 0x80000000, name: s.name, isAbsolute: (s.flags & 1) !== 0, commands: new PICACommandWriter().setMany(0x1c8, false, words).words };
    }),
  };
}

// ---- Materials

const FRAG_FLAGS: [number, number][] = [[2, 1], [4, 2], [8, 4], [32, 8], [64, 16], [16, 32]];

/** PICAFaceCulling -> GfxFaceCulling (never 0 -> Never 3, front 1 -> FrontFace 0, back 2 -> BackFace 1). */
const CULL_TO_GFX = [3, 0, 1, 3];

/** A texture coordinate's 3×4 matrix (CGFX keeps it next to scale / rotation / translation). */
function coordMatrix(scale: number[], rotation: number, translation: number[], type: number): number[] {
  if (scale[0] === 1 && scale[1] === 1 && !rotation && !translation[0] && !translation[1]) return [...IDENTITY34];
  const [sx, sy] = scale as [number, number];
  const [tx, ty] = translation as [number, number];
  const c = Math.cos(rotation), s = Math.sin(rotation);
  let x = 0, y = 0;
  if (type === 0) { x = sx * (0.5 * s - 0.5 * c + 0.5 - tx); y = sy * (0.5 * -s - 0.5 * c + 0.5 - ty); }
  else if (type === 1) { x = sx * (-c * tx - s * ty); y = sy * (s * tx - c * ty); }
  else { x = sx * c * (-tx - 0.5) - sx * s * (ty - 0.5) + 0.5; y = sy * s * (-tx - 0.5) + sy * c * (ty - 0.5) + 0.5; }
  return [sx * c, sx * -s, 0, x, sy * s, sy * c, 0, y, 0, 0, 1, 0];
}

function materialToGfx(m: H3DMaterial, layer: number): GfxMaterial {
  const p = m.materialParams;
  const lut = (table: string | null, sampler: string | null, input: number, scale: number): GfxFragLightLUT | null =>
    sampler && table ? { input, scale, sampler: { typeId: 0x40000000, samplerName: table, tableName: sampler, targetLUT: 0 } } : null;
  const sel = p.lutInputSelection, sc = p.lutInputScale;
  const used = [0, 1, 2].filter((i) => m.enabledTextures[i]).length;
  const mappers = [0, 1, 2].map((i): GfxTextureMapper | null => {
    if (!m.enabledTextures[i]) return null;
    const t = m.textureMappers[i]!;
    const name = [m.texture0Name, m.texture1Name, m.texture2Name][i] ?? '';
    const mf = MIN_FILTER_TO_GFX[t.minFilter] ?? 1;
    return {
      dynamicAlloc: 0, texture: { name: '', revision: 0x05000000, metaData: [], path: name, texturePtr: 0 },
      sampler: { typeId: 0x80000000, minFilter: mf, borderColor: f4(t.borderColor), lodBias: t.lodBias },
      unitType: 0, borderColor: col(t.borderColor), dimension: 0, magFilter: t.magFilter & 1, minFilter: mf === 0 || mf === 2 || mf === 3 ? 0 : 1,
      mipFilter: mf === 3 || mf === 5 ? 1 : 0, wrapU: t.wrapU, wrapV: t.wrapV, paramOtherBits: 0, lodBias: t.lodBias, minLOD: t.minLOD, maxLOD: 0,
      tail: [0, 0, 0, 0, 0, 0],
    };
  });
  const lighting = p.fragmentFlags;
  const textureEnvironments: GfxTexEnv[] = p.texEnvStages.map((s, i) => ({
    constant: (p.constantColors >>> (i * 4)) & 15,
    stage: {
      // through the PICA words, as the file stores them
      ...texEnvStageFrom(
        (s.source.color[0] | (s.source.color[1] << 4) | (s.source.color[2] << 8) | (s.source.alpha[0] << 16) | (s.source.alpha[1] << 20) | (s.source.alpha[2] << 24)) >>> 0,
        (s.operand.color[0] | (s.operand.color[1] << 4) | (s.operand.color[2] << 8) | (s.operand.alpha[0] << 12) | (s.operand.alpha[1] << 16) | (s.operand.alpha[2] << 20)) >>> 0,
        (s.combiner.color | (s.combiner.alpha << 16)) >>> 0, 0, (s.scale.color | (s.scale.alpha << 16)) >>> 0,
      ),
      color: col(s.color),
      updateColorBuffer: i >= 1 && i <= 4 && s.updateColorBuffer, updateAlphaBuffer: i >= 1 && i <= 4 && s.updateAlphaBuffer,
    },
  }));
  const bf = p.blendFunction;
  const separate = bf.colorSrcFunc !== bf.alphaSrcFunc || bf.colorDstFunc !== bf.alphaDstFunc || bf.colorEquation !== bf.alphaEquation;
  const gm: GfxMaterial = {
    name: m.name, revision: 0x06000003, metaData: [],
    flags: p.flags & 0x1f, texCoordConfig: p.layerConfig >> 4, translucencyKind: layer,
    colors: {
      emissionF: f4(p.emissionColor), ambientF: [...f4(p.ambientColor).slice(0, 3), p.colorScale] as Vec4, diffuseF: f4(p.diffuseColor),
      specular0F: f4(p.specular0Color), specular1F: f4(p.specular1Color), constant0F: f4(p.constant0Color), constant1F: f4(p.constant1Color),
      constant2F: f4(p.constant2Color), constant3F: f4(p.constant3Color), constant4F: f4(p.constant4Color), constant5F: f4(p.constant5Color),
      emission: col(p.emissionColor), ambient: col(p.ambientColor), diffuse: col(p.diffuseColor), specular0: col(p.specular0Color),
      specular1: col(p.specular1Color), constant0: col(p.constant0Color), constant1: col(p.constant1Color), constant2: col(p.constant2Color),
      constant3: col(p.constant3Color), constant4: col(p.constant4Color), constant5: col(p.constant5Color), commandCache: 0,
    },
    rasterization: { isPolygonOffsetEnabled: (p.flags & 0x20) !== 0, faceCulling: CULL_TO_GFX[p.faceCulling & 3]!, polygonOffsetUnit: p.polygonOffsetUnit, faceCullingCommand: p.faceCulling & 3 },
    fragmentOperation: {
      // RPG2's files keep the colour / depth writes closed in the mask (the flags say what is written).
      depth: { flags: (p.depthColorMask.enabled ? 1 : 0) | (p.depthColorMask.depthWrite ? 2 : 0), colorMask: { ...p.depthColorMask, redWrite: false, greenWrite: false, blueWrite: false, alphaWrite: false, depthWrite: false }, deltaZDepth: 0x03000000 },
      blend: {
        mode: p.colorOperation.blendMode === 0 ? 3 : separate ? 2 : 1, colorF: f4(p.blendColor), colorOperation: { ...p.colorOperation },
        // RPG2's files: logic op 0 and stencil buffer mask 0 when not used.
        function: { ...bf }, logicalOperation: p.colorOperation.blendMode === 0 ? p.logicalOperation : 0, color: col(p.blendColor),
      },
      stencil: { test: { ...p.stencilTest, bufferMask: p.stencilTest.enabled ? p.stencilTest.bufferMask : 0 }, operation: { ...p.stencilOperation } },
    },
    usedTextureCoordsCount: used,
    textureCoords: [0, 1, 2].map((i) => {
      const t = p.textureCoords[i]!;
      const src = p.textureSources[i] ?? 0;
      return {
        sourceCoordIndex: src <= 2 ? Math.round(src) : 0, mappingType: t.mappingType, referenceCameraIndex: t.referenceCameraIndex,
        transformType: t.transformType, scale: [...t.scale], rotation: t.rotation, translation: [...t.translation], flags: 0,
        transform: i < used ? coordMatrix(t.scale, t.rotation, t.translation, t.transformType) : [...IDENTITY34],
      };
    }) as GfxMaterial['textureCoords'],
    textureMappers: mappers,
    proceduralTextureMapper: null,
    shader: { name: '', revision: 0x06000000, metaData: [], path: 'DefaultShader', shaderPtr: 0 },
    fragmentShader: {
      texEnvBufferColorF: f4(p.texEnvBufferColor),
      lighting: {
        flags: FRAG_FLAGS.reduce((a, [h, g]) => (lighting & h ? a | g : a), 0), translucencyKind: p.layerConfig & 15,
        fresnelSelector: p.fresnelSelector, bumpTexture: p.bumpTexture, bumpMode: p.bumpMode, isBumpRenormalize: (lighting & 1) !== 0,
      },
      luts: {
        reflecR: lut(p.lutReflecRTableName, p.lutReflecRSamplerName, sel.reflecR, sc.reflecR),
        reflecG: lut(p.lutReflecGTableName, p.lutReflecGSamplerName, sel.reflecG, sc.reflecG),
        reflecB: lut(p.lutReflecBTableName, p.lutReflecBSamplerName, sel.reflecB, sc.reflecB),
        dist0: lut(p.lutDist0TableName, p.lutDist0SamplerName, sel.dist0, sc.dist0),
        dist1: lut(p.lutDist1TableName, p.lutDist1SamplerName, sel.dist1, sc.dist1),
        fresnel: lut(p.lutFresnelTableName, p.lutFresnelSamplerName, sel.fresnel, sc.fresnel),
      },
      textureEnvironments,
      alphaTest: { ...p.alphaTest },
      texEnvBufferColor: col(p.texEnvBufferColor),
      texEnvUpdateBuffer: 0,
      lightingConfig0: 0x400,
    },
    shaderProgramDescIndex: 0, shaderParameters: [], lightSetIndex: p.lightSetIndex, fogIndex: p.fogIndex,
    materialFlagsHash: 0, shaderParamsHash: 0, textureCoordsHash: 0, textureSamplersHash: 0, textureMappersHash: 0, materialColorsHash: 0,
    rasterizationHash: 0, fragLightHash: 0, fragLightLUTHash: 0, fragLightLUTSampHash: 0, textureEnvironmentHash: 0, alphaTestHash: 0,
    fragOpHash: 0, uniqueId: 0,
  };
  setMaterialHashes(gm);
  return gm;
}

// ---- Meshes

/** H3D sub mesh skinning (0 none, 1 smooth, 2 rigid) -> CGFX (0 none, 1 rigid, 2 smooth). */
const SKINNING_TO_GFX = [0, 2, 1];

/** The fixed value of a mesh's bone index attribute, or null when it is per vertex / missing. */
function fixedBoneIndex(m: H3DMesh): number[] | null {
  return m.fixedAttributes.find((a) => a.name === PICAAttributeName.BoneIndex)?.value ?? null;
}

function shapeOf(m: H3DMesh, positions: (m: H3DMesh) => number[]): { shape: GfxShape; single: boolean } {
  // A mesh drawn with a single bone (rigid with a fixed index 0, or none) is an unskinned shape bound to that bone in
  // RPG2's files: skinning none, a one bone palette and no bone index attribute.
  const fixed = fixedBoneIndex(m);
  const single = m.subMeshes.every((s) => s.boneIndices.length === 1 && (s.skinning === 0 || (s.skinning === 2 && fixed !== null && fixed[0] === 0)))
    && !m.attributes.some((a) => a.name === PICAAttributeName.BoneIndex || a.name === PICAAttributeName.BoneWeight);
  const elements = (n: number): number => m.attributes.find((a) => a.name === n)?.elements ?? 0;
  // Both bone indices and weights fixed: as many as the weights that are not 0.
  const fixedWeights = m.fixedAttributes.find((a) => a.name === PICAAttributeName.BoneWeight)?.value;
  const fixedCount = fixedWeights ? Math.max(1, fixedWeights.slice(0, 3).filter((x) => x).length) : 1;
  const buffers: GfxVertexBuffer[] = [];
  let offset = 0;
  buffers.push({
    kind: 'interleaved', attrName: 21, type: 2, bufferObj: 0, locationFlag: 0, rawBuffer: m.rawBuffer, locationPtr: 0, memoryArea: 0, vertexStride: m.vertexStride,
    attributes: m.attributes.map((a) => {
      const size = FORMAT_SIZE[a.format]!;
      offset = Math.ceil(offset / size) * size;
      const at = offset;
      offset += size * a.elements;
      return {
        kind: 'attribute' as const, attrName: a.name, type: 0, bufferObj: 0, locationFlag: 0, rawBuffer: null, locationPtr: 0, memoryArea: 0,
        format: GL_FORMAT[a.format]!, elements: a.elements, scale: a.scale, offset: at,
      };
    }),
  });
  for (const f of m.fixedAttributes) {
    if (single && f.name === PICAAttributeName.BoneIndex) continue;
    const n =
      f.name === PICAAttributeName.BoneIndex ? elements(PICAAttributeName.BoneWeight) || fixedCount
      : f.name === PICAAttributeName.BoneWeight ? elements(PICAAttributeName.BoneIndex) || fixedCount
      : f.name === PICAAttributeName.Color ? 4
      : f.name >= PICAAttributeName.TexCoord0 && f.name <= PICAAttributeName.TexCoord2 ? 2 : 3;
    buffers.push({ kind: 'fixed', attrName: f.name, type: 1, format: GfxGLDataType.GL_FLOAT, elements: n, scale: 0, vector: f.value.slice(0, n) });
  }
  const subMeshes: GfxSubMesh[] = m.subMeshes.map((s) => {
    const enc = encodeIndices(s.indices);
    const format = s.is16Bit ? GfxGLDataType.GL_UNSIGNED_SHORT : enc.format;
    const rawBuffer = format === enc.format ? enc.rawBuffer : new Uint8Array(new Uint16Array(s.indices).buffer.slice(0));
    return {
      boneIndices: [...s.boneIndices], skinning: single ? 0 : SKINNING_TO_GFX[s.skinning] ?? 0,
      faces: [{
        faceDescriptors: [{ format, primitiveMode: s.primitiveMode, visible: 1, rawBuffer, bufferObj: 0, locationFlag: 0, commandCachePtr: 0, commandCacheLength: 0, locationPtr: 0, memoryArea: 0, boundingVolume: 0 }],
        bufferObjs: [0], flags: 0, commandAlloc: 0,
      }],
    };
  });
  const obb = m.metaData?.find((x) => x.name === 'OBBox' && x.type === 4);
  let box = obb && obb.type === 4 ? obb.values[0] : undefined;
  if (!box) {
    // No OBBox: the axis aligned box of the rest pose positions.
    const p = positions(m);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[i + k]!); hi[k] = Math.max(hi[k]!, p[i + k]!); }
    if (!p.length) lo.fill(0), hi.fill(0);
    box = { center: [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2) as [number, number, number], orientation: [1, 0, 0, 0, 1, 0, 0, 0, 1], size: [0, 1, 2].map((k) => hi[k]! - lo[k]!) as [number, number, number] };
  }
  return {
    single,
    shape: {
      name: '', revision: 0, metaData: [], flags: 0,
      boundingBox: { typeId: 0x80000000, center: [...box.center], orientation: [...box.orientation], size: [...box.size] },
      positionOffset: [m.positionOffset[0], m.positionOffset[1], m.positionOffset[2]], subMeshes, baseAddress: 0, vertexBuffers: buffers,
      blendShape: { typeId: 0, targets: [], types: [] },
    },
  };
}

/** Position values of a mesh (scale applied, before the position offset), for bounding boxes. */
function meshPositions(m: H3DMesh): number[] {
  const a = m.attributes;
  let off = 0;
  let at = -1, fmt = 3, sc = 1;
  for (const x of a) {
    const size = FORMAT_SIZE[x.format]!;
    off = Math.ceil(off / size) * size;
    if (x.name === PICAAttributeName.Position) { at = off; fmt = x.format; sc = x.scale; }
    off += size * x.elements;
  }
  if (at < 0 || !m.vertexStride) return [];
  const dv = new DataView(m.rawBuffer.buffer, m.rawBuffer.byteOffset, m.rawBuffer.byteLength);
  const out: number[] = [];
  for (let v = 0; v + m.vertexStride <= m.rawBuffer.length; v += m.vertexStride)
    for (let k = 0; k < 3; k++) {
      const o = v + at + k * FORMAT_SIZE[fmt]!;
      out.push((fmt === 3 ? dv.getFloat32(o, true) : fmt === 2 ? dv.getInt16(o, true) : fmt === 1 ? dv.getUint8(o) : dv.getInt8(o)) * sc);
    }
  return out;
}

// ---- Model

const COLOR_MEMBERS = ['Emission', 'Ambient', 'Diffuse', 'Specular0', 'Specular1', 'Constant0', 'Constant1', 'Constant2', 'Constant3', 'Constant4', 'Constant5'];

function element(kind: GfxAnimGroupElement['kind'], typeId: number, name: string, memberOffset: number, blendOpIndex: number, objType: number, memberType: number, extra: object): GfxAnimGroupElement {
  return { kind, typeId, name, memberOffset, blendOpIndex, objType, memberType, materialPtr: 0, objType2: objType, ...extra } as GfxAnimGroupElement;
}

/** The animation groups RPG2's models carry (every bone, every mesh, every material member an animation can bind). */
function animationGroups(bones: string[], meshes: number, materials: GfxMaterial[]): GfxAnimGroup[] {
  const mat = (m: GfxMaterial): string => `Materials["${m.name}"]`;
  const material: GfxAnimGroupElement[] = [];
  COLOR_MEMBERS.forEach((c, k) => {
    for (const m of materials) material.push(element('materialColor', ANIM_GROUP_ELEMENT.materialColor, `${mat(m)}.MaterialColor.${c}`, k * 16, 0, 1, k, { materialName: m.name }));
  });
  const units = (m: GfxMaterial): number[] => [0, 1, 2].filter((i) => m.textureMappers[i]);
  for (const m of materials) for (const i of units(m)) material.push(element('texSampler', ANIM_GROUP_ELEMENT.texSampler, `${mat(m)}.TextureMappers[${i}].Sampler.BorderColor`, 12, 0, 2, 0, { materialName: m.name, index: i }));
  for (const m of materials) for (const i of units(m)) material.push(element('texMapper', ANIM_GROUP_ELEMENT.texMapper, `${mat(m)}.TextureMappers[${i}].Texture`, 8, 1, 3, 0, { materialName: m.name, index: i }));
  for (const m of materials) material.push(element('blendOp', ANIM_GROUP_ELEMENT.blendOp, `${mat(m)}.FragmentOperation.BlendOperation.BlendColor`, 4, 0, 4, 0, { materialName: m.name }));
  ([['Scale', 16, 2, 0], ['Rotate', 24, 3, 1], ['Translate', 28, 2, 2]] as const).forEach(([what, mo, bo, mt]) => {
    for (const m of materials) for (const i of units(m)) material.push(element('texCoord', ANIM_GROUP_ELEMENT.texCoord, `${mat(m)}.TextureCoordinators[${i}].${what}`, mo, bo, 5, mt, { materialName: m.name, index: i }));
  });
  return [
    { flags: 1, name: 'SkeletalAnimation', memberType: 1, evaluationTiming: 1, blendOperationTypes: [8], elements: bones.map((b) => element('bone', ANIM_GROUP_ELEMENT.bone, b, 0, 0, 0, 0, { boneName: b })) },
    {
      flags: 0, name: 'VisibilityAnimation', memberType: 3, evaluationTiming: 0, blendOperationTypes: [0],
      elements: [
        element('model', ANIM_GROUP_ELEMENT.model, 'IsVisible', 212, 0, 6, 1, {}),
        ...Array.from({ length: meshes }, (_, i) => element('mesh', ANIM_GROUP_ELEMENT.mesh, `Meshes[${i}].IsVisible`, 36, 0, 7, 0, { meshIndex: i })),
        element('model', ANIM_GROUP_ELEMENT.model, 'IsBranchVisible', 28, 0, 6, 0, {}),
      ],
    },
    { flags: 0, name: 'MaterialAnimation', memberType: 2, evaluationTiming: 1, blendOperationTypes: [3, 7, 5, 2], elements: material },
  ];
}

/** `monster`: RPG2's monsters all have the Maya scaling rule (its items mostly the standard one). */
export function modelToGfx(h: H3DModel, monster = true): GfxModel {
  if (!h.skeleton.length) {
    // RPG2's models always have a skeleton: one root bone, which unskinned meshes are bound to.
    h = {
      ...h,
      skeleton: [{ name: h.name, flags: 0x0ec00000, parentIndex: -1, scale: [1, 1, 1], rotation: [0, 0, 0], translation: [0, 0, 0], inverseTransform: [...IDENTITY34], metaData: null }],
      meshes: h.meshes.map((m) => ({ ...m, subMeshes: m.subMeshes.map((x) => (x.boneIndices.length ? x : { ...x, boneIndices: [0], skinning: 0 })) })),
    };
  }
  const maya = h.boneScaling === 1;
  const poses = h.skeleton.map((b) => ({ parent: b.parentIndex, scale: b.scale, rotation: b.rotation, translation: b.translation, ssc: maya && (b.flags & (1 << 22)) !== 0 }));
  const world = worldMatrices(poses);
  const shapes = h.meshes.map((m) => shapeOf(m, meshPositions));
  // Bone flags as RPG2's files have them: 0x180 always, value flags, segment scale compensate, 0x40 for bones in a
  // palette and 0x200 for bones in a smooth palette.
  const inPalette = new Set<number>(), inSmooth = new Set<number>();
  for (const { shape } of shapes) for (const s of shape.subMeshes) for (const b of s.boneIndices) { inPalette.add(b); if (s.skinning === 2) inSmooth.add(b); }
  const bones: GfxBone[] = h.skeleton.map((b, i) => {
    const one = b.scale.every((x) => x === 1), zr = b.rotation.every((x) => x === 0), zt = b.translation.every((x) => x === 0);
    let flags = 0x180 | (zt ? 2 : 0) | (zr ? 4 : 0) | (one ? 8 : 0) | (b.scale[0] === b.scale[1] && b.scale[1] === b.scale[2] ? 16 : 0) | (one && zr && zt ? 1 : 0);
    if (b.flags & (1 << 22)) flags |= 0x20;
    if (inPalette.has(i)) flags |= 0x40;
    if (inSmooth.has(i)) flags |= 0x200;
    const bb = (b.flags >>> 16) & 7;
    return {
      name: b.name, flags, index: i, parentIndex: b.parentIndex, parent: -1, child: -1, prevSibling: -1, nextSibling: -1,
      scale: [...b.scale], rotation: [...b.rotation], translation: [...b.translation],
      localTransform: composeTRS(b.scale, b.rotation, b.translation), worldTransform: [...IDENTITY34], invWorldTransform: invert34(world[i]!),
      billboardMode: bb ? bb + 1 : 0, metaData: [],
    };
  });
  const layerOf = (i: number): number => h.meshes.find((m) => m.materialIndex === i)?.layer ?? 1;
  const materials = h.materials.map((m, i) => materialToGfx(m, layerOf(i)));
  const visible = (m: H3DMesh): number => (h.meshNodesCount && h.meshNodesVisibility[m.nodeIndex] === false ? 0 : 1);
  // Render priority inverted to keep the draw order (gfx2h3d.ts).
  const meshes: GfxMesh[] = h.meshes.map((m, i) => ({
    name: '', revision: 0, metaData: [], shapeIndex: i, materialIndex: m.materialIndex, isVisible: visible(m), renderPriority: 255 - m.priority,
    meshNodeIndex: -1, primitiveIndex: 0, flags: 0, attrScaleCommands: new Array<number>(12).fill(0), enableCommandsPtr: 0, enableCommandsLength: 0,
    disableCommandsPtr: 0, disableCommandsLength: 0, meshNodeName: h.skeleton[m.subMeshes[0]?.boneIndices[0] ?? 0]?.name ?? null,
    renderKeyCache: [0, 0], commandAlloc: 0, reserved: 0,
  }));
  // RPG2's skeletons all have the Maya rule; a standard one (no compensated bone then) draws the same with it.
  if (!maya) for (const b of bones) b.flags &= ~0x20;
  const skeleton = { name: null, revision: 0, metaData: [], bones, rootBone: -1, scalingRule: monster || maya ? 1 : h.boneScaling, flags: 2 };
  linkBones(skeleton);
  return {
    name: h.name, revision: 0x09000000, metaData: [], branchVisible: 1, isBranchVisible: true, childs: [],
    animationsGroup: animationGroups(bones.map((b) => b.name), meshes.length, materials),
    transformScale: [1, 1, 1], transformRotation: [0, 0, 0], transformTranslation: [0, 0, 0], localTransform: [...IDENTITY34], worldTransform: [...h.worldTransform],
    meshes, materials, shapes: shapes.map((s) => s.shape), meshNodeVisibilities: [], flags: 1, faceCulling: 0, layerId: 0, skeleton,
  };
}

// ---- Animations

const SLOPE_DIV = [1, 256, 32, 1, 256, 32, 1, 1];
const FRAME_DIV = [1, 1, 1, 1, 32, 1, 1, 1];
const FLOAT_QUANT = new Set([0, 3, 6]);

function segmentToGfx(s: H3DKeySegment, start: number, end: number): GfxCurveSegment {
  // RPG2's files have no Hermite48 (2) or StepLinear32 (7) keys: they become Hermite64 (the same values, finer slopes)
  // and StepLinear64.
  const q = s.quantization === 2 ? 1 : s.quantization === 7 ? 6 : s.quantization;
  if (q === 6 && s.quantization === 7) s = { ...s, valueScale: 1, valueOffset: 0, frameScale: 1 };
  if (s.valueScale === undefined || s.valueOffset === undefined || s.frameScale === undefined) {
    // No quantization parameters (a merged curve): store the keys as floats.
    const hermite = s.interpolationType === 2;
    return {
      startFrame: start, endFrame: end, formatFlags: ((hermite ? 0 : 6) << 5) | (s.interpolationType << 2), invDuration: end > start ? 1 / (end - start) : 1,
      valueScale: 1, valueOffset: 0, frameScale: 1, keys: s.keyFrames.map((k) => ({ frame: k.frame, value: k.value, inSlope: hermite ? k.inSlope : 0, outSlope: hermite ? k.outSlope : 0 })),
    };
  }
  const float = FLOAT_QUANT.has(q);
  const vs = s.valueScale, vo = s.valueOffset, fs = s.frameScale;
  const keys: GfxRawKey[] = s.keyFrames.map((k) => {
    const frame = (k.frame / fs) * FRAME_DIV[q]!;
    const value = vs ? (k.value - vo) / vs : 0;
    return {
      frame: float ? frame : Math.round(frame), value: float ? value : Math.round(value),
      inSlope: float ? k.inSlope : Math.round(k.inSlope * SLOPE_DIV[q]!), outSlope: float ? k.outSlope : Math.round(k.outSlope * SLOPE_DIV[q]!),
    };
  });
  return {
    startFrame: start, endFrame: end, formatFlags: (q << 5) | (s.interpolationType << 2), invDuration: s.invDuration ?? (end > start ? 1 / (end - start) : 1),
    valueScale: float ? 1 : vs, valueOffset: float ? 0 : vo, frameScale: float ? 1 : fs, keys,
  };
}

function curveToGfx(c: H3DFloatKeyFrameGroup): GfxFloatKeyFrameGroup {
  const segments = [segmentToGfx(c, c.segmentStart ?? c.startFrame, c.segmentEnd ?? c.endFrame), ...(c.moreSegments ?? []).map((s) => segmentToGfx(s, s.startFrame, s.endFrame))];
  return { startFrame: c.startFrame, endFrame: c.endFrame, preRepeat: c.preRepeat, postRepeat: c.postRepeat, padding: 0, curveFlags: 4, value: 0, segments };
}

const channel = (s: H3DAnimSlot | undefined): GfxAnimChannel => (s === null || s === undefined ? null : typeof s === 'number' ? s : curveToGfx(s));

function bakedToGfx(t: H3DQuatTrack<number[]> | null): GfxBakedTrack | null {
  if (!t) return null;
  if (t.constant) return { startFrame: 0, endFrame: 0, curveRelPtr: 0, flags: 1, values: [t.frames[0]!.slice()], segmentFlags: [0] };
  // RPG2 bakes one value past the end frame (the last one again).
  const values = t.frames.map((f) => f.slice());
  if (values.length) values.push(values[values.length - 1]!.slice());
  return { startFrame: t.startFrame, endFrame: t.endFrame, curveRelPtr: 0, flags: 0, values, segmentFlags: values.map(() => 0) };
}

const COLOR_PATH: Record<number, string> = {
  [H3DTargetType.MaterialEmission]: 'MaterialColor.Emission', [H3DTargetType.MaterialAmbient]: 'MaterialColor.Ambient',
  [H3DTargetType.MaterialDiffuse]: 'MaterialColor.Diffuse', [H3DTargetType.MaterialSpecular0]: 'MaterialColor.Specular0',
  [H3DTargetType.MaterialSpecular1]: 'MaterialColor.Specular1', [H3DTargetType.MaterialConstant0]: 'MaterialColor.Constant0',
  [H3DTargetType.MaterialConstant1]: 'MaterialColor.Constant1', [H3DTargetType.MaterialConstant2]: 'MaterialColor.Constant2',
  [H3DTargetType.MaterialConstant3]: 'MaterialColor.Constant3', [H3DTargetType.MaterialConstant4]: 'MaterialColor.Constant4',
  [H3DTargetType.MaterialConstant5]: 'MaterialColor.Constant5', [H3DTargetType.MaterialBlendColor]: 'FragmentOperation.BlendOperation.BlendColor',
  [H3DTargetType.MaterialMapper0BorderCol]: 'TextureMappers[0].Sampler.BorderColor', [H3DTargetType.MaterialMapper1BorderCol]: 'TextureMappers[1].Sampler.BorderColor',
  [H3DTargetType.MaterialMapper2BorderCol]: 'TextureMappers[2].Sampler.BorderColor',
};

export function animationToGfx(a: H3DAnimation, kind: 'skeletal' | 'material' | 'visibility', meshOfNode: (name: string) => number): GfxAnimation {
  const elements: GfxAnimationElement[] = [];
  for (const e of a.elements) {
    const c = e.content;
    let name = e.name;
    let content: GfxAnimContent | null = null;
    let flags = 0;
    if (c.kind === 'transform') {
      content = { type: GfxPrimitiveType.Transform, channels: [c.scaleX, c.scaleY, c.scaleZ, c.rotationX, c.rotationY, c.rotationZ, null, c.translationX, c.translationY, c.translationZ].map(channel) };
      flags = c.flagsRest & 0x3f;
    } else if (c.kind === 'quatTransform') {
      content = { type: GfxPrimitiveType.QuatTransform, rotations: bakedToGfx(c.rotations), translations: bakedToGfx(c.translations), scales: bakedToGfx(c.scales) };
    } else if (c.kind === 'boolean') {
      const value = { startFrame: c.startFrame, endFrame: c.endFrame, preRepeat: c.preRepeat, postRepeat: c.postRepeat, padding: 0, values: [...c.values] };
      if (e.targetType === H3DTargetType.MeshNodeVisibility) {
        const i = meshOfNode(e.name);
        if (i < 0) continue;
        name = `Meshes[${i}].IsVisible`;
      } else if (e.targetType === H3DTargetType.ModelVisibility) name = 'IsVisible';
      else continue;
      content = { type: GfxPrimitiveType.Boolean, value };
    } else if (c.kind === 'vector') {
      const t = e.targetType;
      const coord = t >= H3DTargetType.MaterialTexCoord0Scale && t <= H3DTargetType.MaterialTexCoord2Trans ? t - H3DTargetType.MaterialTexCoord0Scale : -1;
      const member = coord >= 0 ? `TextureCoordinators[${Math.floor(coord / 3)}].${['Scale', 'Rotate', 'Translate'][coord % 3]}` : COLOR_PATH[t];
      if (!member) continue;
      name = `Materials["${e.name}"].${member}`;
      const ch = c.slots.map(channel);
      if (e.primitiveType === H3DPrimitiveType.RGBA) content = { type: GfxPrimitiveType.RGBA, channels: ch as [GfxAnimChannel, GfxAnimChannel, GfxAnimChannel, GfxAnimChannel] };
      else if (e.primitiveType === H3DPrimitiveType.Vector2D) content = { type: GfxPrimitiveType.Vector2D, channels: ch as [GfxAnimChannel, GfxAnimChannel] };
      else if (e.primitiveType === H3DPrimitiveType.Float) content = { type: GfxPrimitiveType.Float, channels: ch as [GfxAnimChannel] };
    }
    if (content) elements.push({ flags, name, content });
  }
  return {
    revision: 0x07000001, name: a.name,
    targetAnimGroupName: kind === 'skeletal' ? 'SkeletalAnimation' : kind === 'material' ? 'MaterialAnimation' : 'VisibilityAnimation',
    loopMode: a.animationFlags & 1, framesCount: a.framesCount, elements, metaData: [], extraFields: [],
  };
}

/** An H3D (model, textures, LUTs, animations) as one CGFX file. */
export function h3dToGfx(h: H3D, monster = true): Gfx {
  const g = emptyGfx();
  g.models = h.models.map((m) => modelToGfx(m, monster));
  g.textures = h.textures.map(textureToGfx);
  g.luts = h.luts.map(lutToGfx);
  const model = h.models[0];
  const meshOfNode = (node: string): number => {
    const n = model?.meshNodesTree?.indexOf(node) ?? -1;
    return n < 0 ? -1 : model!.meshes.findIndex((m) => m.nodeIndex === n);
  };
  g.skeletalAnimations = h.skeletalAnimations.map((a) => animationToGfx(a, 'skeletal', meshOfNode));
  g.materialAnimations = h.materialAnimations.map((a) => animationToGfx(a, 'material', meshOfNode));
  g.visibilityAnimations = h.visibilityAnimations.map((a) => animationToGfx(a, 'visibility', meshOfNode));
  return g;
}
