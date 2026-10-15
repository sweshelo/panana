// The H3D (BCH) object model, mirroring SPICA's CtrH3D classes (gdkchan, public domain) with camelCase fields, for
// RPG3 (backward compatibility 8) and RPG FREE! (0x21). readH3D (read.ts) fills it and writeH3D (write.ts) writes it
// back; a native file read and written again is byte-identical.
//
// PICA command lists: the objects that SPICA rebuilds from decoded fields on save (mesh, sub mesh, texture, material,
// LUT sampler) keep the commands as read (`…Commands`, with the words that hold an address set to 0) next to the
// decoded fields. The writer writes the stored commands when present and fills in the addresses; when a command list
// is undefined (an object made by a converter) it generates the list from the decoded fields like SPICA does. So a
// change of a decoded field only takes effect after the matching command list is set to undefined.

/** A dictionary: values in order; the name tree (patricia tree) is built from the names on write. */
export type H3DDict<T> = T[];

export type Vector2 = [number, number];
export type Vector3 = [number, number, number];
export type Vector4 = [number, number, number, number];
/** Row-major 3×4 matrix (M11 M12 M13 M14 M21 … M34), as stored. */
export type Matrix3x4 = number[];
/** RGBA bytes. */
export type RGBA = [number, number, number, number];

export interface H3D {
  backwardCompatibility: number;
  forwardCompatibility: number;
  converterVersion: number;
  /** H3DFlags (IsFromNewConverter 1, IsInitialized 2, IsUnInitDisabled 4). */
  flags: number;
  models: H3DDict<H3DModel>;
  /** The material params of every model's materials (the same objects as `H3DMaterial.materialParams`). */
  materials: H3DDict<H3DMaterialParams>;
  shaders: H3DDict<H3DShader>;
  textures: H3DDict<H3DTexture>;
  luts: H3DDict<H3DLUT>;
  lights: H3DDict<H3DLight>;
  cameras: H3DDict<H3DCamera>;
  fogs: H3DDict<H3DFog>;
  skeletalAnimations: H3DDict<H3DAnimation>;
  materialAnimations: H3DDict<H3DMaterialAnim>;
  visibilityAnimations: H3DDict<H3DAnimation>;
  lightAnimations: H3DDict<H3DAnimation>;
  cameraAnimations: H3DDict<H3DAnimation>;
  fogAnimations: H3DDict<H3DAnimation>;
  scenes: H3DDict<H3DScene>;
  /** Header fields kept as read (the uninitialised data / command lengths some converters fill in). */
  unInitDataLength?: number;
  unInitCommandsLength?: number;
  /**
   * Where everything was in the file this was read from (see H3DLayout). writeH3D reuses it when writing the same
   * version and every block still fits where it was; otherwise it lays the file out itself.
   */
  layout?: H3DLayout;
}

/**
 * The placement of a read file: the offset of every block (by the object that owns it and a role name), of every
 * string, the order of the relocation table and the section addresses. Nothing in it changes what the file means:
 * the converters that made the games' files placed blocks and ordered the relocation table in ways that are not
 * derived from the content (RPG3's converter 39824 orders by an internal traversal of its own), so a byte-identical
 * rewrite needs it.
 */
export interface H3DLayout {
  version: number;
  offsets: WeakMap<object, Map<string, number>>;
  strings: Map<string, number>;
  relocations: number[];
  sections: { address: number; length: number }[];
  relocationAddress: number;
  fileLength: number;
  /** Bytes between the blocks that are not 0. */
  fill: [number, Uint8Array][];
}

// ---- Metadata

export const H3DMetaDataType = { Integer: 0, Single: 1, ASCIIString: 2, UnicodeString: 3, BoundingBox: 4, VertexData: 5 } as const;

export interface H3DBoundingBox {
  center: Vector3;
  /** 3×3 rotation, row major. */
  orientation: number[];
  size: Vector3;
}

export interface H3DVertexDataAttribute {
  name: number;
  format: number;
  elements: number;
  /** 0 = a fixed attribute (`fixedValue`). */
  stride: number;
  offset: number;
  fixedValue: Vector4;
}

export interface H3DVertexDataIndices {
  type: number;
  drawMode: number;
  indices: number[];
}

export interface H3DVertexData {
  attributes: H3DVertexDataAttribute[];
  indices: H3DVertexDataIndices[];
  rawBuffer: Uint8Array;
}

export type H3DMetaDataValue =
  | { name: string; type: 0; values: number[] }
  | { name: string; type: 1; values: number[] }
  | { name: string; type: 2; values: string[] }
  | { name: string; type: 3; values: string[] }
  | { name: string; type: 4; values: H3DBoundingBox[] }
  | { name: string; type: 5; values: H3DVertexData[] };

/** H3DMetaData (null when the object has none). */
export type H3DMetaData = H3DMetaDataValue[] | null;

// ---- Model

export const H3DModelFlags = { IsDrawingEnabled: 1, HasSkeleton: 2, HasSubMeshCulling: 4, HasSilhouette: 8 } as const;
export const H3DBoneScaling = { Standard: 0, Maya: 1, SoftImage: 2 } as const;

export interface H3DModel {
  name: string;
  flags: number;
  boneScaling: number;
  silhouetteMaterialsCount: number;
  worldTransform: Matrix3x4;
  materials: H3DDict<H3DMaterial>;
  meshes: H3DMesh[];
  /** The meshes of each layer: the same objects as in `meshes` (written as ranges of that list). */
  meshesLayer0: H3DMesh[];
  meshesLayer1: H3DMesh[];
  meshesLayer2: H3DMesh[];
  meshesLayer3: H3DMesh[];
  /** H3DSubMeshCulling (version 7 and up); kept as raw 0-byte structs, so only the count matters. */
  subMeshCullings: unknown[];
  skeleton: H3DDict<H3DBone>;
  meshNodesVisibility: boolean[];
  meshNodesCount: number;
  /** Names of the mesh nodes (H3DPatriciaTree), or null. */
  meshNodesTree: string[] | null;
  userDefinedAddress: number;
  metaData: H3DMetaData;
}

/** H3DBoneFlags. */
export const H3DBoneFlags = {
  IsMatrixDirty: 1 << 1,
  IsWorldMatrixUpdated: 1 << 2,
  IsCallBackEnabled: 1 << 4,
  IsSegmentScaleCompensate: 1 << 22,
  IsScaleUniform: 1 << 23,
  IsScaleVolumeOne: 1 << 25,
  IsRotationZero: 1 << 26,
  IsTranslationZero: 1 << 27,
  IsHiScaleUniform: 1 << 28,
  IsHiScaleVolumeOne: 1 << 29,
  IsHiRotationZero: 1 << 30,
  IsHiTranslationZero: 2 ** 31,
} as const;

export interface H3DBone {
  name: string;
  /** All 32 bits, billboard mode included (bits 16-18, `billboardMode`). */
  flags: number;
  parentIndex: number;
  scale: Vector3;
  rotation: Vector3;
  translation: Vector3;
  inverseTransform: Matrix3x4;
  metaData: H3DMetaData;
}

export const billboardMode = (b: H3DBone): number => (b.flags >>> 16) & 7;

export const H3DMeshSkinning = { Mixed: 0, Rigid: 1, Smooth: 2 } as const;
export const H3DSubMeshSkinning = { None: 0, Smooth: 1, Rigid: 2 } as const;

/** PICAAttributeName. */
export const PICAAttributeName = {
  Position: 0, Normal: 1, Tangent: 2, Color: 3, TexCoord0: 4, TexCoord1: 5, TexCoord2: 6, BoneIndex: 7, BoneWeight: 8,
  UserAttribute0: 9, UserAttribute1: 10, UserAttribute2: 11,
} as const;
/** PICAAttributeFormat. */
export const PICAAttributeFormat = { Byte: 0, Ubyte: 1, Short: 2, Float: 3 } as const;

export interface PICAAttribute {
  name: number;
  format: number;
  elements: number;
  scale: number;
}

export interface PICAFixedAttribute {
  name: number;
  value: Vector4;
}

export interface H3DMesh {
  materialIndex: number;
  /** H3DMeshType (bits 0-1 of the flags byte). */
  type: number;
  /** H3DMeshSkinning (bits 2-3 of the flags byte). */
  skinning: number;
  /** The other bits of the flags byte. */
  flagsRest: number;
  nodeIndex: number;
  /** Render priority (key bits 0-7). */
  priority: number;
  /** Render layer 0-3 (key bits 8-9). */
  layer: number;
  /** The other bits of the key. */
  keyRest: number;
  subMeshes: H3DSubMesh[];
  meshCenter: Vector3;
  userDefinedAddress: number;
  metaData: H3DMetaData;
  /** The interleaved vertex buffer (`vertexStride` bytes per vertex). */
  rawBuffer: Uint8Array;
  vertexStride: number;
  attributes: PICAAttribute[];
  fixedAttributes: PICAFixedAttribute[];
  /** Vertex shader uniform 6 (added to the positions). */
  positionOffset: Vector4;
  /** Raw PICA commands (see the note at the top); the two address words are 0. */
  enableCommands?: Uint32Array;
  disableCommands?: Uint32Array;
}

export const PICAPrimitiveMode = { Triangles: 0, TriangleStrip: 1, TriangleFan: 2, GeometryPrimitive: 3 } as const;

export interface H3DSubMesh {
  skinning: number;
  /** Bone palette: indices into the skeleton (up to 20; the u16 count is `boneIndices.length`). */
  boneIndices: number[];
  /** The 20 slots as stored (unused ones may hold leftovers); null = zeros after `boneIndices`. */
  boneIndicesRaw: number[] | null;
  boolUniforms: number;
  indices: Uint16Array;
  /** Whether the index buffer is 16-bit (else 8-bit). */
  is16Bit: boolean;
  primitiveMode: number;
  /** Raw PICA commands; the index buffer address word is 0. */
  commands?: Uint32Array;
}

// ---- Materials

export const H3DMaterialFlags = {
  IsFragmentLightingEnabled: 1 << 0,
  IsVertexLightingEnabled: 1 << 1,
  IsHemiSphereLightingEnabled: 1 << 2,
  IsHemiSphereOcclusionEnabled: 1 << 3,
  IsFogEnabled: 1 << 4,
  IsPolygonOffsetEnabled: 1 << 5,
} as const;

export interface H3DTextureCoord {
  flags: number;
  transformType: number;
  mappingType: number;
  referenceCameraIndex: number;
  scale: Vector2;
  rotation: number;
  translation: Vector2;
}

export interface H3DTextureMapper {
  samplerType: number;
  wrapU: number;
  wrapV: number;
  magFilter: number;
  minFilter: number;
  minLOD: number;
  lodBias: number;
  borderColor: RGBA;
}

export interface H3DMaterial {
  name: string;
  materialParams: H3DMaterialParams;
  /** Texture pointers (null in every file seen; kept for completeness). */
  texture0: H3DTexture | null;
  texture1: H3DTexture | null;
  texture2: H3DTexture | null;
  textureMappers: [H3DTextureMapper, H3DTextureMapper, H3DTextureMapper];
  texture0Name: string | null;
  texture1Name: string | null;
  texture2Name: string | null;
  /** Texture units 0-3 enabled (GPUREG_TEXUNIT_CONFIG). */
  enabledTextures: [boolean, boolean, boolean, boolean];
  /** Raw PICA commands (texture unit setup). */
  textureCommands?: Uint32Array;
}

export interface PICATexEnvStage {
  source: { color: [number, number, number]; alpha: [number, number, number] };
  operand: { color: [number, number, number]; alpha: [number, number, number] };
  combiner: { color: number; alpha: number };
  color: RGBA;
  scale: { color: number; alpha: number };
  updateColorBuffer: boolean;
  updateAlphaBuffer: boolean;
}

export interface PICABlendFunction {
  colorEquation: number;
  alphaEquation: number;
  colorSrcFunc: number;
  colorDstFunc: number;
  alphaSrcFunc: number;
  alphaDstFunc: number;
}

export interface PICAColorOperation {
  fragOpMode: number;
  blendMode: number;
}

export interface PICAAlphaTest {
  enabled: boolean;
  function: number;
  reference: number;
}

export interface PICAStencilTest {
  enabled: boolean;
  function: number;
  bufferMask: number;
  reference: number;
  mask: number;
}

export interface PICAStencilOperation {
  failOp: number;
  zFailOp: number;
  zPassOp: number;
}

export interface PICADepthColorMask {
  enabled: boolean;
  depthFunc: number;
  redWrite: boolean;
  greenWrite: boolean;
  blueWrite: boolean;
  alphaWrite: boolean;
  depthWrite: boolean;
}

/** PICALUTInAbs / PICALUTInSel / PICALUTInScale: one value per LUT input. */
export interface PICALUTInputs<T> {
  dist0: T;
  dist1: T;
  specular: T;
  fresnel: T;
  reflecR: T;
  reflecG: T;
  reflecB: T;
}

export interface H3DMaterialParams {
  uniqueId: number;
  flags: number;
  fragmentFlags: number;
  frameAccessOffset: number;
  /** H3DMaterialShader pointer (0 in every file seen). */
  materialShader: number;
  textureCoords: [H3DTextureCoord, H3DTextureCoord, H3DTextureCoord];
  lightSetIndex: number;
  fogIndex: number;
  emissionColor: RGBA;
  ambientColor: RGBA;
  diffuseColor: RGBA;
  specular0Color: RGBA;
  specular1Color: RGBA;
  constant0Color: RGBA;
  constant1Color: RGBA;
  constant2Color: RGBA;
  constant3Color: RGBA;
  constant4Color: RGBA;
  constant5Color: RGBA;
  blendColor: RGBA;
  colorScale: number;
  /** Dist0, Dist1, Fresnel, ReflecR, ReflecG, ReflecB sampler pointers (runtime; 0 in files). */
  samplerPtrs: number[];
  /** TranslucencyKind (bits 0-3) and TexCoordConfig (bits 4-7). */
  layerConfig: number;
  fresnelSelector: number;
  bumpMode: number;
  bumpTexture: number;
  /** 6 words: the LUT input abs / select / scale commands. */
  lutConfigCommands: number[];
  /** Constant colour of each TEV stage (4 bits per stage). */
  constantColors: number;
  polygonOffsetUnit: number;
  lutDist0TableName: string | null;
  lutDist1TableName: string | null;
  lutFresnelTableName: string | null;
  lutReflecRTableName: string | null;
  lutReflecGTableName: string | null;
  lutReflecBTableName: string | null;
  lutDist0SamplerName: string | null;
  lutDist1SamplerName: string | null;
  lutFresnelSamplerName: string | null;
  lutReflecRSamplerName: string | null;
  lutReflecGSamplerName: string | null;
  lutReflecBSamplerName: string | null;
  /** "index@shader name" (e.g. "0@DefaultShader"). */
  shaderReference: string | null;
  /** "material@model" (the H3D.Materials dictionary name). */
  modelReference: string;
  metaData: H3DMetaData;
  // Decoded from the commands (informational while `fragmentShaderCommands` is set).
  lutInputAbsolute: PICALUTInputs<boolean>;
  lutInputSelection: PICALUTInputs<number>;
  lutInputScale: PICALUTInputs<number>;
  texEnvStages: PICATexEnvStage[];
  texEnvBufferColor: RGBA;
  colorOperation: PICAColorOperation;
  blendFunction: PICABlendFunction;
  logicalOperation: number;
  alphaTest: PICAAlphaTest;
  stencilTest: PICAStencilTest;
  stencilOperation: PICAStencilOperation;
  depthColorMask: PICADepthColorMask;
  faceCulling: number;
  colorBufferRead: boolean;
  colorBufferWrite: boolean;
  stencilBufferRead: boolean;
  depthBufferRead: boolean;
  stencilBufferWrite: boolean;
  depthBufferWrite: boolean;
  /** UV set (0-2) or environment map (3-5) of each texture unit (vertex uniform 10). */
  textureSources: Vector4;
  /** Every vertex / geometry shader float uniform the commands set. */
  vtxShaderUniforms: Map<number, Vector4>;
  geoShaderUniforms: Map<number, Vector4>;
  /** Raw PICA commands of the fragment pipeline (TEV, blending, depth, texture matrices …). */
  fragmentShaderCommands?: Uint32Array;
}

export const translucencyKind = (p: H3DMaterialParams): number => p.layerConfig & 15;
export const texCoordConfig = (p: H3DMaterialParams): number => p.layerConfig >> 4;

// ---- Textures, LUTs, shaders

/** PICATextureFormat. */
export const PICATextureFormat = {
  RGBA8: 0, RGB8: 1, RGBA5551: 2, RGB565: 3, RGBA4: 4, LA8: 5, HiLo8: 6, L8: 7, A8: 8, LA4: 9, L4: 10, A4: 11, ETC1: 12, ETC1A4: 13,
} as const;

export interface H3DTexture {
  name: string;
  format: number;
  mipmapSize: number;
  width: number;
  height: number;
  /** Faces: [0] is the 2D image (all mip levels), cube maps have 6. */
  rawBuffers: Uint8Array[];
  /** Raw PICA commands of units 0-2; the address words are 0. */
  texture0Commands?: Uint32Array;
  texture1Commands?: Uint32Array;
  texture2Commands?: Uint32Array;
}

export interface H3DLUTSampler {
  name: string;
  flags: number;
  /** 256 values in 0..1. */
  table: number[];
  /** Raw PICA commands (the quantized table). */
  commands?: Uint32Array;
}

export interface H3DLUT {
  name: string;
  samplers: H3DLUTSampler[];
}

export interface H3DShader {
  name: string;
  /** The SHBIN program, opaque. */
  program: Uint8Array | null;
  shaderAllCommands: Uint32Array | null;
  shaderProgramCommands: Uint32Array | null;
  shaderSetupCommands: Uint32Array | null;
  vtxShaderIndex: number;
  geoShaderIndex: number;
  bindingAddress: number;
  userDefinedAddress: number;
}

// ---- Lights, cameras, fogs, scenes (none in the monster / item files; layouts follow SPICA)

export interface H3DLight {
  name: string;
  transformScale: Vector3;
  transformRotation: Vector3;
  transformTranslation: Vector3;
  type: number;
  enabled: number;
  flags: number;
  lutConfig: number;
  metaData: H3DMetaData;
  /** The type's content as stored (hemisphere 0x30, ambient 4, vertex 0x40, fragment 0x3C bytes; see SPICA). */
  content: Uint8Array;
  /** Fragment lights: the 4 LUT names (distance table / sampler, angle table / sampler). */
  lutNames: (string | null)[];
}

export interface H3DCamera {
  name: string;
  transformScale: Vector3;
  transformRotation: Vector3;
  transformTranslation: Vector3;
  /** H3DCameraViewType: Aim 0 (target xyz, twist), LookAt 1 (target xyz, up xyz), Rotate 2 (rotation xyz). */
  viewType: number;
  /** H3DCameraProjectionType: Perspective 0 (near, far, aspect, fovy), Orthogonal 1 (near, far, aspect, height). */
  projectionType: number;
  flags: number;
  wScale: number;
  view: number[] | null;
  projection: number[] | null;
  metaData: H3DMetaData;
}

/** Not found in any file of the games; reading a file with fogs or scenes throws. */
export interface H3DFog {
  name: string;
}

export interface H3DScene {
  name: string;
}

// ---- Animations

export const H3DAnimationType = { Skeletal: 0, Material: 1, Visibility: 2, Light: 3, Camera: 4, Fog: 5 } as const;
export const H3DAnimationFlags = { IsLooping: 1, IsConstant: 2 } as const;
export const H3DPrimitiveType = {
  Float: 0, Integer: 1, Vector2D: 2, Vector3D: 3, Transform: 4, RGBA: 5, Texture: 6, QuatTransform: 7, Boolean: 8, MtxTransform: 9,
} as const;
export const H3DTargetType = {
  Bone: 0, MaterialConstant0: 1, MaterialConstant1: 2, MaterialConstant2: 3, MaterialConstant3: 4, MaterialConstant4: 5,
  MaterialConstant5: 6, MaterialEmission: 7, MaterialAmbient: 8, MaterialDiffuse: 9, MaterialSpecular0: 10,
  MaterialSpecular1: 11, MaterialMapper0BorderCol: 12, MaterialMapper0Texture: 13, MaterialMapper1BorderCol: 14,
  MaterialMapper1Texture: 15, MaterialMapper2BorderCol: 16, MaterialMapper2Texture: 17, MaterialBlendColor: 18,
  MaterialTexCoord0Scale: 19, MaterialTexCoord0Rot: 20, MaterialTexCoord0Trans: 21, MaterialTexCoord1Scale: 22,
  MaterialTexCoord1Rot: 23, MaterialTexCoord1Trans: 24, MaterialTexCoord2Scale: 25, MaterialTexCoord2Rot: 26,
  MaterialTexCoord2Trans: 27, LightTransform: 28, LightAmbient: 29, LightDiffuse: 30, LightSpecular0: 31,
  LightSpecular1: 32, LightGround: 33, LightSky: 34, LightDirection: 35, LightAttenuationStart: 36,
  LightAttenuationEnd: 37, LightInterpolationFactor: 38, LightEnabled: 39, CameraTransform: 40, CameraTargetPos: 41,
  CameraTwist: 42, CameraUpVector: 43, CameraViewRotation: 44, CameraZNear: 45, CameraZFar: 46, CameraAspectRatio: 47,
  CameraHeight: 48, MeshNodeVisibility: 49, ModelVisibility: 50, FogColor: 51,
} as const;
export const H3DInterpolationType = { Step: 0, Linear: 1, Hermite: 2 } as const;
export const H3DLoopType = { None: 0, Repeat: 1, MirroredRepeat: 2, RelativeRepeat: 3 } as const;
/** KeyFrameQuantization. */
export const KeyFrameQuantization = {
  Hermite128: 0, Hermite64: 1, Hermite48: 2, UnifiedHermite96: 3, UnifiedHermite48: 4, UnifiedHermite32: 5, StepLinear64: 6, StepLinear32: 7,
} as const;

export interface KeyFrame {
  frame: number;
  value: number;
  inSlope: number;
  outSlope: number;
}

/** H3DAnimationCurve fields. */
export interface H3DAnimationCurve {
  startFrame: number;
  endFrame: number;
  preRepeat: number;
  postRepeat: number;
  curveIndex: number;
}

export interface H3DFloatKeyFrameGroup extends H3DAnimationCurve {
  interpolationType: number;
  quantization: number;
  /**
   * Quantization parameters as read. The writer encodes the keys with them when set; when undefined (a new curve)
   * it computes them as SPICA's KeyFrameQuantizationHelper does.
   */
  valueScale?: number;
  valueOffset?: number;
  frameScale?: number;
  invDuration?: number;
  /** Before version 0x20: the segment's own start / end frame when it differs from the curve's. */
  segmentStart?: number;
  segmentEnd?: number;
  keyFrames: KeyFrame[];
  /**
   * Before version 0x20 a curve is a list of segments; the fields above are the first one, these the others. Writing
   * version 0x20 or later merges them into one segment (see write.ts mergeSegments).
   */
  moreSegments?: H3DKeySegment[];
}

/** A segment of a curve before version 0x20. */
export interface H3DKeySegment {
  startFrame: number;
  endFrame: number;
  interpolationType: number;
  quantization: number;
  valueScale?: number;
  valueOffset?: number;
  frameScale?: number;
  invDuration?: number;
  keyFrames: KeyFrame[];
}

/** A slot of a vector / transform: absent, a constant, or a curve. */
export type H3DAnimSlot = null | number | H3DFloatKeyFrameGroup;

/** Float, Texture (1 slot), Vector2D (2), Vector3D (3), RGBA (4): flags + slots. */
export interface H3DAnimVector {
  kind: 'vector';
  slots: H3DAnimSlot[];
  /** The flag bits other than constant / absent (e.g. IsXActive). */
  flagsRest: number;
}

/** H3DAnimTransform: scale xyz, rotation xyz, translation xyz. */
export interface H3DAnimTransform {
  kind: 'transform';
  scaleX: H3DAnimSlot;
  scaleY: H3DAnimSlot;
  scaleZ: H3DAnimSlot;
  rotationX: H3DAnimSlot;
  rotationY: H3DAnimSlot;
  rotationZ: H3DAnimSlot;
  translationX: H3DAnimSlot;
  translationY: H3DAnimSlot;
  translationZ: H3DAnimSlot;
  /** The flag bits other than constant / absent (IsIdentity, IsScaleOne …). */
  flagsRest: number;
}

/** The frames of one part of a quaternion transform; a constant has one frame and no header. */
export interface H3DQuatTrack<T> {
  constant: boolean;
  /** Header of a non-constant track: start frame, end frame, flags. */
  startFrame: number;
  endFrame: number;
  flags: number;
  frames: T[];
}

/** H3DAnimQuatTransform (baked): null = the part does not exist. */
export interface H3DAnimQuatTransform {
  kind: 'quatTransform';
  scales: H3DQuatTrack<Vector3> | null;
  rotations: H3DQuatTrack<Vector4> | null;
  translations: H3DQuatTrack<Vector3> | null;
}

export interface H3DAnimBoolean extends H3DAnimationCurve {
  kind: 'boolean';
  values: boolean[];
}

export interface H3DAnimMtxTransform extends H3DAnimationCurve {
  kind: 'mtxTransform';
  frames: Matrix3x4[];
}

export type H3DAnimContent = H3DAnimVector | H3DAnimTransform | H3DAnimQuatTransform | H3DAnimBoolean | H3DAnimMtxTransform;

export interface H3DAnimationElement {
  name: string;
  targetType: number;
  primitiveType: number;
  content: H3DAnimContent;
}

export interface H3DAnimation {
  name: string;
  animationFlags: number;
  animationType: number;
  curvesCount: number;
  framesCount: number;
  elements: H3DAnimationElement[];
  metaData: H3DMetaData;
}

export interface H3DMaterialAnim extends H3DAnimation {
  textureNames: string[];
}

/** The slots of each primitive type that is a vector (flags + n words). */
export const vectorSlots = (primitiveType: number): number => {
  switch (primitiveType) {
    case H3DPrimitiveType.Float:
    case H3DPrimitiveType.Integer:
    case H3DPrimitiveType.Texture:
      return 1;
    case H3DPrimitiveType.Vector2D: return 2;
    case H3DPrimitiveType.Vector3D: return 3;
    case H3DPrimitiveType.RGBA: return 4;
  }
  return 0;
};
