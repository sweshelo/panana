// CGFX (RPG2) -> H3D: the model, its textures, LUTs and animations as an H3D object, game neutral (retarget.ts then
// sets what one game's files want: shader names, bool uniforms, skinning conventions). After SPICA's Gfx.ToH3D, with
// every field carried over (SPICA drops or guesses several).
import {
  GfxGLDataType, GfxPrimitiveType, decodeKeys, faceIndices, lutTable, readCommands,
  type Gfx, type GfxAnimChannel, type GfxAnimation, type GfxBakedTrack, type GfxFloatKeyFrameGroup, type GfxFragLightLUT,
  type GfxLUT, type GfxMaterial, type GfxModel, type GfxTexture, type RGBA as GfxRGBA,
} from '../gfx';
import {
  H3DAnimationType, H3DPrimitiveType, H3DTargetType, PICACommandWriter, Reg, lutConfigCommands,
  type H3D, type H3DAnimation, type H3DAnimationElement, type H3DAnimSlot, type H3DBone, type H3DFloatKeyFrameGroup, type H3DKeySegment,
  type H3DLUT, type H3DMaterial, type H3DMaterialAnim, type H3DMaterialParams, type H3DMesh, type H3DModel, type H3DQuatTrack,
  type H3DSubMesh, type H3DTexture, type H3DTextureMapper, type PICAAttribute, type PICAFixedAttribute, type PICALUTInputs, type RGBA,
  type Vector3, type Vector4,
} from '../h3d';
import { invert34, worldMatrices } from './common';
import { alphaOperands } from './gfxhash';
import { hashText } from './md5';

export function emptyH3D(): H3D {
  return {
    backwardCompatibility: 0x21, forwardCompatibility: 0x21, converterVersion: 42921, flags: 5,
    models: [], materials: [], shaders: [], textures: [], luts: [], lights: [], cameras: [], fogs: [],
    skeletalAnimations: [], materialAnimations: [], visibilityAnimations: [], lightAnimations: [], cameraAnimations: [],
    fogAnimations: [], scenes: [],
  };
}

const rgba = (c: GfxRGBA): RGBA => [c.r, c.g, c.b, c.a];

/** GL vertex data type -> PICAAttributeFormat. */
const PICA_FORMAT: Record<number, number> = {
  [GfxGLDataType.GL_BYTE]: 0, [GfxGLDataType.GL_UNSIGNED_BYTE]: 1, [GfxGLDataType.GL_SHORT]: 2, [GfxGLDataType.GL_FLOAT]: 3,
};
const FORMAT_SIZE = [1, 1, 2, 4];

/** GfxTextureMinFilter -> H3DTextureMinFilter. */
export const MIN_FILTER_TO_H3D = [0, 3, 1, 2, 4, 5];

// GfxFragmentFlags -> H3DFragmentFlags (clamp 1->2, dist0 2->4, dist1 4->8, geo0 8->32, geo1 16->64, reflection 32->16).
const FRAG_FLAGS: [number, number][] = [[1, 2], [2, 4], [4, 8], [8, 32], [16, 64], [32, 16]];
export const fragFlagsToH3D = (f: number, renormalize: boolean): number => FRAG_FLAGS.reduce((a, [g, h]) => (f & g ? a | h : a), renormalize ? 1 : 0);

// ---- Textures and LUTs

export function textureToH3D(t: GfxTexture): H3DTexture {
  if (t.kind !== 'image' || !t.image) throw new Error(`texture ${t.name}: cube maps are not supported`);
  return { name: t.name ?? '', format: t.hwFormat, mipmapSize: t.mipmapSize, width: t.width, height: t.height, rawBuffers: [t.image.rawBuffer] };
}

/** The 256 raw LUT words (value in bits 0-11, difference in 12-23) of a sampler's commands. */
export function lutWords(commands: readonly number[]): number[] {
  const out = new Array<number>(256).fill(0);
  let index = 0;
  for (const c of readCommands(commands)) {
    if (c.register === 0x1c5) index = c.parameters[0]! & 0xff;
    else if (c.register >= 0x1c8 && c.register <= 0x1cf) for (const p of c.parameters) if (index < 256) out[index++] = p;
  }
  return out;
}

/** H3D LUT sampler commands from the 256 raw words (the layout of the games' files). */
export function h3dLutCommands(words: number[]): Uint32Array {
  const w = new PICACommandWriter();
  w.setCommands(Reg.GPUREG_LIGHTING_LUT_DATA0, false, 0xf, words);
  w.writeEnd();
  return w.buffer();
}

export function lutToH3D(l: GfxLUT): H3DLUT {
  return {
    name: l.name ?? '',
    samplers: l.samplers.map((s) => ({ name: s.name, flags: s.isAbsolute ? 1 : 0, table: lutTable(s.commands), commands: h3dLutCommands(lutWords(s.commands)) })),
  };
}

// ---- Materials

function materialToH3D(m: GfxMaterial, model: string): H3DMaterial {
  const fs = m.fragmentShader;
  const L = fs?.luts ?? null;
  const fo = m.fragmentOperation;
  const ra = m.rasterization;
  const c = m.colors;
  // CGFX LUT references name the dictionary entry "samplerName" and the sampler "tableName" (the other way round).
  const table = (x: GfxFragLightLUT | null | undefined): string | null => x?.sampler?.samplerName ?? null;
  const sampler = (x: GfxFragLightLUT | null | undefined): string | null => x?.sampler?.tableName ?? null;
  const inputs = <T>(f: (x: GfxFragLightLUT | null | undefined) => T, specular: T): PICALUTInputs<T> => ({
    dist0: f(L?.dist0), dist1: f(L?.dist1), specular, fresnel: f(L?.fresnel), reflecR: f(L?.reflecR), reflecG: f(L?.reflecG), reflecB: f(L?.reflecB),
  });
  const texEnv = fs?.textureEnvironments ?? [];
  const p: H3DMaterialParams = {
    uniqueId: hashText(`${m.name}@${model}`),
    flags: (m.flags | (ra.isPolygonOffsetEnabled ? 0x20 : 0)) & 0xffff,
    fragmentFlags: fs ? fragFlagsToH3D(fs.lighting.flags, fs.lighting.isBumpRenormalize) : 0,
    frameAccessOffset: 0,
    materialShader: 0,
    textureCoords: [0, 1, 2].map((i) => {
      const t = m.textureCoords[i]!;
      return {
        flags: i < m.usedTextureCoordsCount ? 1 : 0, transformType: t.transformType, mappingType: t.mappingType,
        referenceCameraIndex: t.referenceCameraIndex, scale: [...t.scale], rotation: t.rotation, translation: [...t.translation],
      };
    }) as H3DMaterialParams['textureCoords'],
    lightSetIndex: m.lightSetIndex,
    fogIndex: m.fogIndex,
    emissionColor: rgba(c.emission), ambientColor: rgba(c.ambient), diffuseColor: rgba(c.diffuse), specular0Color: rgba(c.specular0),
    specular1Color: rgba(c.specular1), constant0Color: rgba(c.constant0), constant1Color: rgba(c.constant1), constant2Color: rgba(c.constant2),
    constant3Color: rgba(c.constant3), constant4Color: rgba(c.constant4), constant5Color: rgba(c.constant5),
    blendColor: rgba(fo.blend.color),
    colorScale: c.ambientF[3],
    samplerPtrs: [0, 0, 0, 0, 0, 0],
    layerConfig: ((fs?.lighting.translucencyKind ?? 0) & 15) | ((m.texCoordConfig & 15) << 4),
    fresnelSelector: fs?.lighting.fresnelSelector ?? 0,
    bumpMode: fs?.lighting.bumpMode ?? 0,
    bumpTexture: fs?.lighting.bumpTexture ?? 0,
    lutConfigCommands: [],
    constantColors: texEnv.reduce((a, t, i) => a | ((t.constant & 15) << (i * 4)), 0) >>> 0,
    polygonOffsetUnit: ra.polygonOffsetUnit,
    lutDist0TableName: table(L?.dist0), lutDist1TableName: table(L?.dist1), lutFresnelTableName: table(L?.fresnel),
    lutReflecRTableName: table(L?.reflecR), lutReflecGTableName: table(L?.reflecG), lutReflecBTableName: table(L?.reflecB),
    lutDist0SamplerName: sampler(L?.dist0), lutDist1SamplerName: sampler(L?.dist1), lutFresnelSamplerName: sampler(L?.fresnel),
    lutReflecRSamplerName: sampler(L?.reflecR), lutReflecGSamplerName: sampler(L?.reflecG), lutReflecBSamplerName: sampler(L?.reflecB),
    shaderReference: '2@DefaultShader-nl',
    modelReference: `${m.name}@${model}`,
    metaData: null,
    // The games' H3D files have every LUT input signed (the register's abs bits all set) whatever the samplers say.
    lutInputAbsolute: inputs(() => false, false),
    lutInputSelection: inputs((x) => x?.input ?? 0, 0),
    lutInputScale: inputs((x) => x?.scale ?? 0, 0),
    texEnvStages: [0, 1, 2, 3, 4, 5].map((i) => {
      const s = texEnv[i]?.stage;
      if (!s) return { source: { color: [15, 0, 0], alpha: [15, 0, 0] }, operand: { color: [0, 0, 0], alpha: [0, 0, 0] }, combiner: { color: 0, alpha: 0 }, color: [0, 0, 0, 0], scale: { color: 0, alpha: 0 }, updateColorBuffer: false, updateAlphaBuffer: false };
      return {
        source: { color: [...s.source.color], alpha: [...s.source.alpha] }, operand: { color: [...s.operand.color], alpha: alphaOperands(s) },
        combiner: { ...s.combiner }, color: rgba(s.color), scale: { ...s.scale }, updateColorBuffer: s.updateColorBuffer, updateAlphaBuffer: s.updateAlphaBuffer,
      };
    }) as H3DMaterialParams['texEnvStages'],
    texEnvBufferColor: fs ? rgba(fs.texEnvBufferColor) : [0, 0, 0, 0],
    colorOperation: { ...fo.blend.colorOperation },
    blendFunction: { ...fo.blend.function },
    // The H3D converters write logic op 6 (no-op) when blending and the stencil buffer mask 255 when unused.
    logicalOperation: fo.blend.mode === 3 ? fo.blend.logicalOperation : 6,
    alphaTest: fs ? { ...fs.alphaTest } : { enabled: false, function: 1, reference: 0 },
    stencilTest: { ...fo.stencil.test, bufferMask: fo.stencil.test.enabled ? fo.stencil.test.bufferMask : 255 },
    stencilOperation: { ...fo.stencil.operation },
    // The H3D converters write the colour and depth masks open (the CGFX files keep them closed and the runtime opens them).
    depthColorMask: { ...fo.depth.colorMask, redWrite: true, greenWrite: true, blueWrite: true, alphaWrite: true, depthWrite: (fo.depth.flags & 2) !== 0 },
    faceCulling: ra.faceCullingCommand & 3,
    colorBufferRead: true,
    colorBufferWrite: true,
    stencilBufferRead: false,
    depthBufferRead: true,
    stencilBufferWrite: false,
    depthBufferWrite: (fo.depth.flags & 2) !== 0,
    textureSources: [0, 1, 2, 3].map((i) => {
      const t = m.textureCoords[i];
      if (!t || i >= m.usedTextureCoordsCount) return 0;
      return t.mappingType === 1 ? 3 : t.mappingType === 2 ? 4 : t.sourceCoordIndex;
    }) as Vector4,
    vtxShaderUniforms: new Map(),
    geoShaderUniforms: new Map(),
  };
  p.lutConfigCommands = lutConfigCommands(p);
  const mappers = [0, 1, 2].map((i): H3DTextureMapper => {
    const t = m.textureMappers[i];
    if (!t) return { samplerType: 0, wrapU: 0, wrapV: 0, magFilter: 0, minFilter: 0, minLOD: 0, lodBias: 0, borderColor: [255, 255, 255, 255] };
    return {
      samplerType: i > 0 ? 1 : 0, wrapU: t.wrapU, wrapV: t.wrapV, magFilter: t.magFilter,
      minFilter: MIN_FILTER_TO_H3D[t.sampler?.minFilter ?? 1] ?? 3, minLOD: t.minLOD, lodBias: t.lodBias, borderColor: rgba(t.borderColor),
    };
  }) as H3DMaterial['textureMappers'];
  const name = (i: number): string | null => m.textureMappers[i]?.texture?.path ?? null;
  return {
    name: m.name ?? '', materialParams: p, texture0: null, texture1: null, texture2: null, textureMappers: mappers,
    texture0Name: name(0), texture1Name: name(1), texture2Name: name(2),
    enabledTextures: [!!m.textureMappers[0], !!m.textureMappers[1], !!m.textureMappers[2], false],
  };
}

// ---- Meshes

/** CGFX sub mesh skinning (0 none, 1 rigid, 2 smooth) -> H3D (0 none, 1 smooth, 2 rigid). */
const SKINNING_TO_H3D = [0, 2, 1];

function meshesToH3D(m: GfxModel, nodes: boolean): H3DMesh[] {
  return m.meshes.map((mesh, mi) => {
    const shape = m.shapes[mesh.shapeIndex];
    if (!shape) throw new Error(`mesh ${mi}: no shape ${mesh.shapeIndex}`);
    let rawBuffer: Uint8Array = new Uint8Array(0);
    let vertexStride = 0;
    const attributes: PICAAttribute[] = [];
    const fixedAttributes: PICAFixedAttribute[] = [];
    for (const v of shape.vertexBuffers) {
      if (v.kind === 'fixed') {
        const k = v.scale || 1;
        const x = (i: number, d: number): number => (v.vector[i] !== undefined ? v.vector[i]! * k : d);
        fixedAttributes.push({ name: v.attrName, value: [x(0, 0), x(1, 0), x(2, 0), x(3, 1)] });
      } else if (v.kind === 'interleaved') {
        // The PICA packs attributes in order, each aligned to its element size; the NW4C buffers are laid out the same.
        let offset = 0;
        for (const a of v.attributes) {
          const format = PICA_FORMAT[a.format];
          if (format === undefined) throw new Error(`mesh ${mi}: attribute format ${a.format}`);
          const size = FORMAT_SIZE[format]!;
          offset = Math.ceil(offset / size) * size;
          if (a.offset !== offset) throw new Error(`mesh ${mi}: attribute ${a.attrName} at ${a.offset}, the PICA needs ${offset}`);
          offset += size * a.elements;
          attributes.push({ name: a.attrName, format, elements: a.elements, scale: a.scale });
        }
        rawBuffer = v.rawBuffer;
        vertexStride = v.vertexStride;
      } else throw new Error(`mesh ${mi}: vertex streams of their own are not supported`);
    }
    const subMeshes: H3DSubMesh[] = [];
    for (const sm of shape.subMeshes) {
      if (sm.boneIndices.length > 20) throw new Error(`mesh ${mi}: a bone palette of ${sm.boneIndices.length} bones (the H3D limit is 20)`);
      for (const f of sm.faces)
        for (const fd of f.faceDescriptors)
          subMeshes.push({
            skinning: SKINNING_TO_H3D[sm.skinning] ?? 0, boneIndices: [...sm.boneIndices], boneIndicesRaw: null, boolUniforms: 0,
            indices: faceIndices(fd), is16Bit: fd.format === GfxGLDataType.GL_UNSIGNED_SHORT, primitiveMode: fd.primitiveMode,
          });
    }
    const bb = shape.boundingBox;
    const center: Vector3 = bb ? [...bb.center] : [0, 0, 0];
    return {
      materialIndex: mesh.materialIndex, type: 0, skinning: 0, flagsRest: 0, nodeIndex: nodes ? mi : 0,
      priority: mesh.renderPriority, layer: (m.materials[mesh.materialIndex]?.translucencyKind ?? 0) & 3, keyRest: 0,
      subMeshes, meshCenter: center, userDefinedAddress: 0,
      metaData: bb ? [{ name: 'OBBox', type: 4, values: [{ center: [...bb.center], orientation: [...bb.orientation], size: [...bb.size] }] }] : null,
      rawBuffer, vertexStride, attributes, fixedAttributes, positionOffset: [...shape.positionOffset, 0] as Vector4,
    };
  });
}

// ---- Model

/**
 * H3D bone flags as RPG3's and RPG FREE!'s converters set them: segment scale compensate (22), scale uniform (23),
 * scale one (25), and rotation + translation zero (26 + 27, only together); billboard mode in bits 16-18.
 */
export function h3dBoneFlags(scale: readonly number[], rotation: readonly number[], translation: readonly number[], ssc: boolean, billboard = 0): number {
  let f = ssc ? 1 << 22 : 0;
  if (scale[0] === scale[1] && scale[1] === scale[2]) f |= 1 << 23;
  if (scale.every((x) => x === 1)) f |= 1 << 25;
  if (rotation.every((x) => x === 0) && translation.every((x) => x === 0)) f |= 3 << 26;
  // H3D billboard modes have no gap after off: World is 1 (CGFX 2) …
  if (billboard >= 2) f |= ((billboard - 1) & 7) << 16;
  return f >>> 0;
}

export function modelToH3D(m: GfxModel, visibility: boolean): H3DModel {
  const name = m.name ?? '';
  const sk = m.skeleton ?? null;
  const maya = sk?.scalingRule === 1;
  const poses = (sk?.bones ?? []).map((b) => ({ parent: b.parentIndex, scale: b.scale, rotation: b.rotation, translation: b.translation, ssc: maya && (b.flags & 0x20) !== 0 }));
  const world = worldMatrices(poses);
  const skeleton: H3DBone[] = (sk?.bones ?? []).map((b, i) => ({
    name: b.name, flags: h3dBoneFlags(b.scale, b.rotation, b.translation, (b.flags & 0x20) !== 0, b.billboardMode), parentIndex: b.parentIndex, scale: [...b.scale], rotation: [...b.rotation],
    translation: [...b.translation], inverseTransform: invert34(world[i]!), metaData: null,
  }));
  // Meshes hidden by default or animated by a visibility animation need mesh nodes (as RPG FREE!'s enemy_45 has).
  const nodes = visibility || m.meshes.some((x) => !x.isVisible);
  const meshes = meshesToH3D(m, nodes);
  const layers: H3DMesh[][] = [[], [], [], []];
  for (const x of meshes) layers[x.layer]!.push(x);
  return {
    name, flags: skeleton.length ? 2 : 0, boneScaling: sk?.scalingRule ?? 0, silhouetteMaterialsCount: 0, worldTransform: [...m.worldTransform],
    materials: m.materials.map((x) => materialToH3D(x, name)),
    meshes: layers.flat(), meshesLayer0: layers[0]!, meshesLayer1: layers[1]!, meshesLayer2: layers[2]!, meshesLayer3: layers[3]!,
    subMeshCullings: [], skeleton,
    meshNodesVisibility: nodes ? m.meshes.map((x) => x.isVisible !== 0) : [true],
    meshNodesCount: nodes ? m.meshes.length : 0,
    meshNodesTree: nodes ? m.meshes.map((_, i) => `_meshIndex${i}`) : null,
    userDefinedAddress: 0, metaData: null,
  };
}

// ---- Animations

function segmentToH3D(s: GfxFloatKeyFrameGroup['segments'][number]): H3DKeySegment {
  const quantization = s.formatFlags >>> 5;
  return {
    startFrame: s.startFrame, endFrame: s.endFrame, interpolationType: (s.formatFlags >>> 2) & 7, quantization,
    valueScale: s.valueScale, valueOffset: s.valueOffset, frameScale: s.frameScale, invDuration: s.invDuration, keyFrames: decodeKeys(s),
  };
}

function curveToH3D(g: GfxFloatKeyFrameGroup): H3DAnimSlot {
  if (g.curveFlags & 2) return g.value;
  const [first, ...more] = g.segments.map(segmentToH3D);
  if (!first) return null;
  const { startFrame, endFrame, ...seg } = first;
  const c: H3DFloatKeyFrameGroup = { startFrame: g.startFrame, endFrame: g.endFrame, preRepeat: g.preRepeat, postRepeat: g.postRepeat, curveIndex: 0, ...seg };
  if (startFrame !== g.startFrame) c.segmentStart = startFrame;
  if (endFrame !== g.endFrame) c.segmentEnd = endFrame;
  if (more.length) c.moreSegments = more;
  return c;
}

const slot = (ch: GfxAnimChannel | undefined): H3DAnimSlot => (ch === null || ch === undefined ? null : typeof ch === 'number' ? ch : curveToH3D(ch));

function bakedToH3D<T extends number[]>(t: GfxBakedTrack | null): H3DQuatTrack<T> | null {
  if (!t) return null;
  if (t.flags & 1) return { constant: true, startFrame: 0, endFrame: 0, flags: 0, frames: [t.values[0]!.slice() as T] };
  // CGFX bakes one value past the end; H3D keeps start..end.
  const n = Math.max(1, Math.floor(t.endFrame - t.startFrame) + 1);
  return { constant: false, startFrame: t.startFrame, endFrame: t.endFrame, flags: 0, frames: t.values.slice(0, n).map((v) => v.slice() as T) };
}

const MATERIAL_PATH = /^Materials\["(.+)"\]\.(.+)$/;
const COLOR_TARGET: Record<string, number> = {
  'MaterialColor.Emission': H3DTargetType.MaterialEmission, 'MaterialColor.Ambient': H3DTargetType.MaterialAmbient,
  'MaterialColor.Diffuse': H3DTargetType.MaterialDiffuse, 'MaterialColor.Specular0': H3DTargetType.MaterialSpecular0,
  'MaterialColor.Specular1': H3DTargetType.MaterialSpecular1, 'MaterialColor.Constant0': H3DTargetType.MaterialConstant0,
  'MaterialColor.Constant1': H3DTargetType.MaterialConstant1, 'MaterialColor.Constant2': H3DTargetType.MaterialConstant2,
  'MaterialColor.Constant3': H3DTargetType.MaterialConstant3, 'MaterialColor.Constant4': H3DTargetType.MaterialConstant4,
  'MaterialColor.Constant5': H3DTargetType.MaterialConstant5, 'FragmentOperation.BlendOperation.BlendColor': H3DTargetType.MaterialBlendColor,
  'TextureMappers[0].Sampler.BorderColor': H3DTargetType.MaterialMapper0BorderCol, 'TextureMappers[1].Sampler.BorderColor': H3DTargetType.MaterialMapper1BorderCol,
  'TextureMappers[2].Sampler.BorderColor': H3DTargetType.MaterialMapper2BorderCol,
};
const COORD_PATH = /^TextureCoordinators\[(\d)\]\.(Scale|Rotate|Translate)$/;

export function animationToH3D(a: GfxAnimation, kind: 'skeletal' | 'material' | 'visibility', meshNode: (i: number) => string): H3DAnimation | H3DMaterialAnim {
  const elements: H3DAnimationElement[] = [];
  for (const e of a.elements) {
    const c = e.content;
    if (c.type === GfxPrimitiveType.Transform) {
      const s = c.channels.map(slot);
      elements.push({
        name: e.name, targetType: H3DTargetType.Bone, primitiveType: H3DPrimitiveType.Transform,
        content: {
          kind: 'transform', scaleX: s[0]!, scaleY: s[1]!, scaleZ: s[2]!, rotationX: s[3]!, rotationY: s[4]!, rotationZ: s[5]!,
          translationX: s[7] ?? null, translationY: s[8] ?? null, translationZ: s[9] ?? null, flagsRest: e.flags & 0x3f,
        },
      });
    } else if (c.type === GfxPrimitiveType.QuatTransform) {
      elements.push({
        name: e.name, targetType: H3DTargetType.Bone, primitiveType: H3DPrimitiveType.QuatTransform,
        content: { kind: 'quatTransform', scales: bakedToH3D(c.scales), rotations: bakedToH3D(c.rotations), translations: bakedToH3D(c.translations) },
      });
    } else if (c.type === GfxPrimitiveType.Boolean) {
      const mesh = /^Meshes\[(\d+)\]\.IsVisible$/.exec(e.name);
      const v = c.value;
      const content = { kind: 'boolean' as const, startFrame: v.startFrame, endFrame: v.endFrame, preRepeat: v.preRepeat, postRepeat: v.postRepeat, curveIndex: 0, values: [...v.values] };
      if (mesh) elements.push({ name: meshNode(Number(mesh[1])), targetType: H3DTargetType.MeshNodeVisibility, primitiveType: H3DPrimitiveType.Boolean, content });
      else if (e.name === 'IsVisible') elements.push({ name: '', targetType: H3DTargetType.ModelVisibility, primitiveType: H3DPrimitiveType.Boolean, content });
    } else {
      const path = MATERIAL_PATH.exec(e.name);
      if (!path) continue;
      const [, material, member] = path as unknown as [string, string, string];
      const coord = COORD_PATH.exec(member);
      let target: number | undefined;
      if (coord) target = [H3DTargetType.MaterialTexCoord0Scale, H3DTargetType.MaterialTexCoord1Scale, H3DTargetType.MaterialTexCoord2Scale][Number(coord[1])]! + ['Scale', 'Rotate', 'Translate'].indexOf(coord[2]!);
      else target = COLOR_TARGET[member];
      if (target === undefined) continue;
      const prim = c.type === GfxPrimitiveType.RGBA ? H3DPrimitiveType.RGBA : c.type === GfxPrimitiveType.Vector2D ? H3DPrimitiveType.Vector2D : c.type === GfxPrimitiveType.Float ? H3DPrimitiveType.Float : -1;
      if (prim < 0 || !('channels' in c)) continue;
      elements.push({ name: material, targetType: target, primitiveType: prim, content: { kind: 'vector', slots: c.channels.map(slot), flagsRest: 0 } });
    }
  }
  const anim: H3DAnimation = {
    name: a.name, animationFlags: a.loopMode & 1, animationType: kind === 'skeletal' ? H3DAnimationType.Skeletal : kind === 'material' ? H3DAnimationType.Material : H3DAnimationType.Visibility,
    curvesCount: 0, framesCount: a.framesCount, elements, metaData: null,
  };
  numberCurves(anim);
  return kind === 'material' ? { ...anim, textureNames: [] } : anim;
}

/** curveIndex of each curve and the animation's curve count, in element order (as the converters number them). */
export function numberCurves(a: H3DAnimation): void {
  let n = 0;
  for (const e of a.elements) {
    const c = e.content;
    const slots = c.kind === 'transform' ? [c.scaleX, c.scaleY, c.scaleZ, c.rotationX, c.rotationY, c.rotationZ, c.translationX, c.translationY, c.translationZ] : c.kind === 'vector' ? c.slots : [];
    for (const s of slots) if (s !== null && typeof s === 'object') s.curveIndex = n++;
    if (c.kind === 'boolean') c.curveIndex = n++;
  }
  a.curvesCount = n;
}

/** A whole CGFX file as an H3D (the model, if any, with its textures, LUTs and animations). */
export function gfxToH3D(g: Gfx): H3D {
  const h = emptyH3D();
  const visibility = g.visibilityAnimations.length > 0;
  h.models = g.models.map((m) => modelToH3D(m, visibility));
  h.materials = h.models.flatMap((m) => m.materials.map((x) => x.materialParams));
  h.textures = g.textures.map(textureToH3D);
  h.luts = g.luts.map(lutToH3D);
  const node = (i: number): string => `_meshIndex${i}`;
  h.skeletalAnimations = g.skeletalAnimations.map((a) => animationToH3D(a, 'skeletal', node));
  h.materialAnimations = g.materialAnimations.map((a) => animationToH3D(a, 'material', node) as H3DMaterialAnim);
  h.visibilityAnimations = g.visibilityAnimations.map((a) => animationToH3D(a, 'visibility', node));
  return h;
}
