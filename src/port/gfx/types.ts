// CGFX (NW4C .bcres / .bcmdl, revision 5) object model, after SPICA's CtrGfx classes (SPICA/Formats/CtrGfx),
// with camelCase fields. Private fields of SPICA that are stored in the file are public here so that a file read
// and written again is byte-identical. Dictionaries (GfxDict<T>) are arrays in entry order; the key of an entry is
// its `name`. Pointers between objects of the same file (mesh -> model, sampler -> mapper, bone -> bone) are kept
// as indices or implied by nesting and rebuilt by the writer.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
/** Row-major 3x4 matrix (12 floats, as stored). */
export type Mat3x4 = number[];
/** Row-major 3x3 matrix (9 floats). */
export type Mat3x3 = number[];

/** RGBA colour, 8 bits per channel (SPICA Math3D/RGBA). */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ---------------------------------------------------------------------------------------------------------------
// File

export interface Gfx {
  /** Header revision (0x05000000 in the games). */
  revision: number;
  models: GfxModel[];
  textures: GfxTexture[];
  luts: GfxLUT[];
  materials: GfxMaterial[];
  shaders: GfxShader[];
  cameras: GfxCamera[];
  lights: GfxLight[];
  fogs: GfxFog[];
  scenes: GfxScene[];
  skeletalAnimations: GfxAnimation[];
  materialAnimations: GfxAnimation[];
  visibilityAnimations: GfxAnimation[];
  cameraAnimations: GfxAnimation[];
  lightAnimations: GfxAnimation[];
  fogAnimations: GfxAnimation[];
  emitters: GfxEmitter[];
}

/** Dictionaries of the DATA section, in file order. */
export const GFX_DICTS = [
  'models', 'textures', 'luts', 'materials', 'shaders', 'cameras', 'lights', 'fogs', 'scenes',
  'skeletalAnimations', 'materialAnimations', 'visibilityAnimations', 'cameraAnimations', 'lightAnimations',
  'fogAnimations', 'emitters',
] as const satisfies readonly (keyof Gfx)[];

export function emptyGfx(): Gfx {
  return {
    revision: 0x05000000,
    models: [], textures: [], luts: [], materials: [], shaders: [], cameras: [], lights: [], fogs: [], scenes: [],
    skeletalAnimations: [], materialAnimations: [], visibilityAnimations: [], cameraAnimations: [],
    lightAnimations: [], fogAnimations: [], emitters: [],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Common objects

/** User data (GfxMetaData*): type id 0x80000000 single, 0x40000000 colour, 0x20000000 integer, 0x10000000 string. */
export type GfxMetaData =
  | { kind: 'single'; name: string; type: number; values: number[] }
  | { kind: 'color'; name: string; type: number; values: Vec4[] }
  | { kind: 'integer'; name: string; type: number; values: number[] }
  | { kind: 'string'; name: string; type: number; format: GfxStringFormat; values: string[] };

export enum GfxStringFormat {
  Ascii = 0,
  Utf8 = 1,
  Utf16LE = 2,
  Utf16BE = 3,
}

/**
 * GfxObject: type id, magic, revision, name and user data. The magic follows from the type; the revision is kept
 * (it differs per kind: CMDL 0x09000000, MTOB 0x06000003, TXOB 0x05000000 …).
 */
export interface GfxObject {
  name: string | null;
  revision: number;
  metaData: GfxMetaData[];
}

/** GfxNode (scene graph node): visibility and animation groups. */
export interface GfxNode extends GfxObject {
  branchVisible: number;
  isBranchVisible: boolean;
  /** Child objects (always empty in the games; kept as a count check). */
  childs: never[];
  animationsGroup: GfxAnimGroup[];
}

export interface GfxNodeTransform extends GfxNode {
  transformScale: Vec3;
  transformRotation: Vec3;
  transformTranslation: Vec3;
  localTransform: Mat3x4;
  worldTransform: Mat3x4;
}

// ---------------------------------------------------------------------------------------------------------------
// Animation groups (members of a node an animation can bind to)

export interface GfxAnimGroup {
  /** Type id 0x80000000. */
  flags: number;
  name: string | null;
  memberType: number;
  elements: GfxAnimGroupElement[];
  blendOperationTypes: number[];
  evaluationTiming: GfxAnimEvaluationTiming;
}

export enum GfxAnimEvaluationTiming {
  BeforeWorldUpdate = 0,
  AfterSceneCull = 1,
}

export enum GfxAnimGroupObjType {
  Bone = 0,
  MaterialColor = 1,
  TexSampler = 2,
  TexMapper = 3,
  BlendOperation = 4,
  TexCoord = 5,
  Model = 6,
  Mesh = 7,
  MeshNodeVisibility = 8,
  // Camera members (not in SPICA): transform, view updater, projection updater.
  CameraTransform = 9,
  CameraView = 10,
  CameraProjection = 11,
}

/** Element type ids (GfxAnimGroupElement TypeChoice) and the extra fields each one has. */
export const ANIM_GROUP_ELEMENT = {
  meshNodeVis: 0x00080000,
  mesh: 0x01000000,
  texSampler: 0x02000000,
  blendOp: 0x04000000,
  materialColor: 0x08000000,
  model: 0x10000000,
  texMapper: 0x20000000,
  bone: 0x40000000,
  texCoord: 0x80000000,
  // Camera members (not in SPICA).
  cameraTransform: 0x00800000,
  cameraView: 0x00400000,
  cameraProjection: 0x00200000,
} as const;

export interface GfxAnimGroupElementBase {
  /** TypeChoice id (ANIM_GROUP_ELEMENT). */
  typeId: number;
  name: string | null;
  memberOffset: number;
  blendOpIndex: number;
  objType: number;
  memberType: number;
  materialPtr: number;
}

export type GfxAnimGroupElement =
  | (GfxAnimGroupElementBase & { kind: 'bone'; boneName: string | null; objType2: number })
  | (GfxAnimGroupElementBase & { kind: 'materialColor' | 'blendOp'; materialName: string | null; objType2: number })
  | (GfxAnimGroupElementBase & { kind: 'texSampler' | 'texMapper' | 'texCoord'; materialName: string | null; index: number; objType2: number })
  | (GfxAnimGroupElementBase & { kind: 'model'; objType2: number })
  | (GfxAnimGroupElementBase & { kind: 'mesh'; meshIndex: number; objType2: number })
  | (GfxAnimGroupElementBase & { kind: 'meshNodeVis'; nodeName: string | null; objType2: number })
  | (GfxAnimGroupElementBase & { kind: 'camera'; objType2: number });

// ---------------------------------------------------------------------------------------------------------------
// Models

export enum GfxModelFlags {
  IsVisible = 1 << 0,
  IsNonUniformScalable = 1 << 1,
}

export interface GfxModel extends GfxNodeTransform {
  /** GfxModel (type 0x40000012) or GfxModelSkeletal (0x40000092, with a skeleton). */
  meshes: GfxMesh[];
  materials: GfxMaterial[];
  shapes: GfxShape[];
  meshNodeVisibilities: GfxMeshNodeVisibility[];
  flags: number;
  /** PICAFaceCulling. */
  faceCulling: number;
  layerId: number;
  /** GfxModelSkeletal only (undefined = plain GfxModel; null = skeletal model with a null skeleton pointer). */
  skeleton?: GfxSkeleton | null;
}

export interface GfxMeshNodeVisibility {
  name: string;
  isVisible: boolean;
}

/** GfxMesh: one draw of a shape with a material. Its Parent pointer is the model holding it. */
export interface GfxMesh extends GfxObject {
  shapeIndex: number;
  materialIndex: number;
  /** Visible (u8). */
  isVisible: number;
  renderPriority: number;
  meshNodeIndex: number;
  primitiveIndex: number;
  // Runtime data (zero in files).
  flags: number;
  attrScaleCommands: number[];
  enableCommandsPtr: number;
  enableCommandsLength: number;
  disableCommandsPtr: number;
  disableCommandsLength: number;
  meshNodeName: string | null;
  /** RenderKeyCache (u64) as two words, CommandAlloc and one more runtime word (the mesh is 8-aligned). */
  renderKeyCache: [number, number];
  commandAlloc: number;
  reserved: number;
}

export interface GfxSkeleton extends GfxObject {
  bones: GfxBone[];
  /** Index (in `bones`) of the RootBone pointer, -1 = null. */
  rootBone: number;
  scalingRule: GfxSkeletonScalingRule;
  /** Bit 1 = IsTranslationAnimEnabled. */
  flags: number;
}

export enum GfxSkeletonScalingRule {
  Standard = 0,
  Maya = 1,
  SoftImage = 2,
}

export enum GfxBoneFlags {
  IsIdentity = 1 << 0,
  IsTranslationZero = 1 << 1,
  IsRotationZero = 1 << 2,
  IsScaleVolumeOne = 1 << 3,
  IsScaleUniform = 1 << 4,
  IsSegmentScaleCompensate = 1 << 5,
  IsNeededRendering = 1 << 6,
  IsLocalMtxCalculate = 1 << 7,
  IsWorldMtxCalculate = 1 << 8,
  HasSkinningMtx = 1 << 9,
}

export enum GfxBillboardMode {
  Off = 0,
  World = 2,
  WorldViewpoint = 3,
  Screen = 4,
  ScreenViewpoint = 5,
  YAxial = 6,
  YAxialViewpoint = 7,
}

export interface GfxBone {
  name: string;
  flags: number;
  index: number;
  parentIndex: number;
  /** Bone pointers as indices into the skeleton's bones (-1 = null). */
  parent: number;
  child: number;
  prevSibling: number;
  nextSibling: number;
  scale: Vec3;
  /** Euler angles (radians), R = Rz·Ry·Rx. */
  rotation: Vec3;
  translation: Vec3;
  localTransform: Mat3x4;
  worldTransform: Mat3x4;
  invWorldTransform: Mat3x4;
  billboardMode: GfxBillboardMode;
  metaData: GfxMetaData[];
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes (geometry)

export interface GfxShape extends GfxObject {
  flags: number;
  boundingBox: GfxBoundingBox | null;
  positionOffset: Vec3;
  subMeshes: GfxSubMesh[];
  baseAddress: number;
  vertexBuffers: GfxVertexBuffer[];
  blendShape: GfxBlendShape | null;
}

/** Oriented bounding box (type 0x80000000). */
export interface GfxBoundingBox {
  typeId: number;
  center: Vec3;
  orientation: Mat3x3;
  size: Vec3;
}

export enum GfxSubMeshSkinning {
  None = 0,
  Rigid = 1,
  Smooth = 2,
}

/** A group of faces drawn with one bone palette (boneIndices = skeleton bone indices). */
export interface GfxSubMesh {
  boneIndices: number[];
  skinning: GfxSubMeshSkinning;
  faces: GfxFace[];
}

export interface GfxFace {
  faceDescriptors: GfxFaceDescriptor[];
  /** One buffer object per descriptor (runtime, 0 in files). */
  bufferObjs: number[];
  flags: number;
  commandAlloc: number;
}

export enum GfxGLDataType {
  GL_BYTE = 0x1400,
  GL_UNSIGNED_BYTE = 0x1401,
  GL_SHORT = 0x1402,
  GL_UNSIGNED_SHORT = 0x1403,
  GL_FLOAT = 0x1406,
  GL_FIXED = 0x140c,
}

/** PICAPrimitiveMode. */
export enum PICAPrimitiveMode {
  Triangles = 0,
  TriangleStrip = 1,
  TriangleFan = 2,
  GeometryPrimitive = 3,
}

export interface GfxFaceDescriptor {
  /** Index format: GL_UNSIGNED_BYTE or GL_UNSIGNED_SHORT. */
  format: GfxGLDataType;
  primitiveMode: PICAPrimitiveMode;
  visible: number;
  /** Index buffer (in the IMAG section). */
  rawBuffer: Uint8Array;
  bufferObj: number;
  locationFlag: number;
  commandCachePtr: number;
  commandCacheLength: number;
  locationPtr: number;
  memoryArea: number;
  boundingVolume: number;
}

/** PICAAttributeName (vertex attribute usage). */
export enum PICAAttributeName {
  Position = 0,
  Normal = 1,
  Tangent = 2,
  Color = 3,
  TexCoord0 = 4,
  TexCoord1 = 5,
  TexCoord2 = 6,
  BoneIndex = 7,
  BoneWeight = 8,
  UserAttribute0 = 9,
  UserAttribute1 = 10,
  UserAttribute2 = 11,
  UserAttribute3 = 12,
  UserAttribute4 = 13,
  UserAttribute5 = 14,
  UserAttribute6 = 15,
  UserAttribute7 = 16,
  UserAttribute8 = 17,
  UserAttribute9 = 18,
  UserAttribute10 = 19,
  UserAttribute11 = 20,
  Interleave = 21,
}

export enum GfxVertexBufferType {
  None = 0,
  Fixed = 1,
  Interleaved = 2,
}

/** GfxAttribute (type 0x40000001): one attribute of an interleaved buffer, or a stream of its own. */
export interface GfxAttribute {
  kind: 'attribute';
  attrName: PICAAttributeName;
  type: GfxVertexBufferType;
  bufferObj: number;
  locationFlag: number;
  /** Own stream (null inside an interleaved buffer). */
  rawBuffer: Uint8Array | null;
  locationPtr: number;
  memoryArea: number;
  format: GfxGLDataType;
  elements: number;
  scale: number;
  /** Byte offset in the interleaved vertex. */
  offset: number;
}

/** GfxVertexBufferInterleaved (type 0x40000002). */
export interface GfxVertexBufferInterleaved {
  kind: 'interleaved';
  attrName: PICAAttributeName;
  type: GfxVertexBufferType;
  bufferObj: number;
  locationFlag: number;
  rawBuffer: Uint8Array;
  locationPtr: number;
  memoryArea: number;
  vertexStride: number;
  attributes: GfxAttribute[];
}

/** GfxVertexBufferFixed (type 0x80000000): one constant value for every vertex. */
export interface GfxVertexBufferFixed {
  kind: 'fixed';
  attrName: PICAAttributeName;
  type: GfxVertexBufferType;
  format: GfxGLDataType;
  elements: number;
  scale: number;
  vector: number[];
}

export type GfxVertexBuffer = GfxAttribute | GfxVertexBufferInterleaved | GfxVertexBufferFixed;

export interface GfxBlendShape {
  typeId: number;
  /** Targets (never used by the games; kept as a count check). */
  targets: never[];
  types: number[];
}

// ---------------------------------------------------------------------------------------------------------------
// Materials

export enum GfxMaterialFlags {
  IsFragmentLightingEnabled = 1 << 0,
  IsVertexLightingEnabled = 1 << 1,
  IsHemiSphereLightingEnabled = 1 << 2,
  IsHemiSphereOcclusionEnabled = 1 << 3,
  IsFogEnabled = 1 << 4,
  IsPolygonOffsetEnabled = 1 << 5,
}

export enum GfxTranslucencyKind {
  Layer0 = 0,
  Layer1 = 1,
  Layer2 = 2,
  Layer3 = 3,
}

export enum GfxTexCoordConfig {
  Config0120 = 0,
  Config0110 = 1,
  Config0111 = 2,
  Config0112 = 3,
  Config0121 = 4,
  Config0122 = 5,
}

/** Material colours: floats (canonical for the NW4C tools) and the 8-bit copies the GPU uses. */
export interface GfxMaterialColor {
  emissionF: Vec4;
  /** W = colour scale. */
  ambientF: Vec4;
  diffuseF: Vec4;
  specular0F: Vec4;
  specular1F: Vec4;
  constant0F: Vec4;
  constant1F: Vec4;
  constant2F: Vec4;
  constant3F: Vec4;
  constant4F: Vec4;
  constant5F: Vec4;
  emission: RGBA;
  ambient: RGBA;
  diffuse: RGBA;
  specular0: RGBA;
  specular1: RGBA;
  constant0: RGBA;
  constant1: RGBA;
  constant2: RGBA;
  constant3: RGBA;
  constant4: RGBA;
  constant5: RGBA;
  commandCache: number;
}

export enum GfxFaceCulling {
  FrontFace = 0,
  BackFace = 1,
  Always = 2,
  Never = 3,
}

export interface GfxRasterization {
  isPolygonOffsetEnabled: boolean;
  faceCulling: GfxFaceCulling;
  polygonOffsetUnit: number;
  /** GPUREG_FACECULLING_CONFIG parameter (PICAFaceCulling: 0 never, 1 front, 2 back). */
  faceCullingCommand: number;
}

export enum GfxFragOpBlendMode {
  None = 0,
  Blend = 1,
  BlendSeparate = 2,
  LogicalOp = 3,
}

export interface GfxFragOp {
  depth: {
    /** Bit 0 test enabled, bit 1 mask (write) enabled. */
    flags: number;
    colorMask: PICADepthColorMask;
    /** GPUREG_GAS_DELTAZ_DEPTH parameter (depth format bits 24-25). */
    deltaZDepth: number;
  };
  blend: {
    mode: GfxFragOpBlendMode;
    colorF: Vec4;
    colorOperation: PICAColorOperation;
    function: PICABlendFunction;
    /** PICALogicalOp (GPUREG_LOGIC_OP). */
    logicalOperation: number;
    color: RGBA;
  };
  stencil: {
    test: PICAStencilTest;
    operation: PICAStencilOperation;
  };
}

export enum GfxTextureMappingType {
  UvCoordinateMap = 0,
  CameraCubeEnvMap = 1,
  CameraSphereEnvMap = 2,
  ProjectionMap = 3,
  Shadow = 4,
  ShadowBox = 5,
}

export enum GfxTextureTransformType {
  DccMaya = 0,
  DccSoftImage = 1,
  Dcc3dsMax = 2,
}

export interface GfxTextureCoord {
  sourceCoordIndex: number;
  mappingType: GfxTextureMappingType;
  referenceCameraIndex: number;
  transformType: GfxTextureTransformType;
  scale: Vec2;
  rotation: number;
  translation: Vec2;
  /** Enabled / dirty flags (runtime). */
  flags: number;
  transform: Mat3x4;
}

/** GfxTextureReference (type 0x20000004, TXOB): a texture by path (name), resolved at runtime. */
export interface GfxTextureReference extends GfxObject {
  path: string | null;
  texturePtr: number;
}

export enum GfxTextureMinFilter {
  Nearest = 0,
  Linear = 1,
  NearestMipmapNearest = 2,
  NearestMipmapLinear = 3,
  LinearMipmapNearest = 4,
  LinearMipmapLinear = 5,
}

/** GfxTextureSamplerStd (type 0x80000000). Its Parent pointer is the mapper holding it. */
export interface GfxTextureSampler {
  typeId: number;
  minFilter: GfxTextureMinFilter;
  borderColor: Vec4;
  lodBias: number;
}

export enum PICATextureFilter {
  Nearest = 0,
  Linear = 1,
}

export enum PICATextureWrap {
  ClampToEdge = 0,
  ClampToBorder = 1,
  Repeat = 2,
  Mirror = 3,
}

/** GfxTextureMapper (type 0x80000000): texture unit settings (the PICA commands are rebuilt from the fields). */
export interface GfxTextureMapper {
  dynamicAlloc: number;
  texture: GfxTextureReference | null;
  sampler: GfxTextureSampler | null;
  /** GPUREG_TEXUNITi_TYPE parameter (0). */
  unitType: number;
  borderColor: RGBA;
  /** GPUREG_TEXUNITi_DIM (0 in files; set at runtime). */
  dimension: number;
  magFilter: PICATextureFilter;
  minFilter: PICATextureFilter;
  mipFilter: PICATextureFilter;
  wrapU: PICATextureWrap;
  wrapV: PICATextureWrap;
  /** Bits of GPUREG_TEXUNITi_PARAM other than filters and wraps (ETC1, shadow, …). */
  paramOtherBits: number;
  /** GPUREG_TEXUNITi_LOD: bias (s4.8, 13 bits), min / max LOD. */
  lodBias: number;
  minLOD: number;
  maxLOD: number;
  /** Parameters after LOD (addresses, shadow, type), 0 in files. */
  tail: number[];
}

export interface GfxShaderReference extends GfxObject {
  /** "DefaultShader" for the games' materials. */
  path: string | null;
  shaderPtr: number;
}

export enum GfxFresnelSelector {
  No = 0,
  Pri = 1,
  Sec = 2,
  PriSec = 3,
}

export enum GfxBumpMode {
  NotUsed = 0,
  AsBump = 1,
  AsTangent = 2,
}

export enum GfxFragmentFlags {
  IsClampHighLightEnabled = 1 << 0,
  IsLUTDist0Enabled = 1 << 1,
  IsLUTDist1Enabled = 1 << 2,
  IsLUTGeoFactor0Enabled = 1 << 3,
  IsLUTGeoFactor1Enabled = 1 << 4,
  IsLUTReflectionEnabled = 1 << 5,
}

export interface GfxFragLight {
  flags: number;
  translucencyKind: GfxTranslucencyKind;
  fresnelSelector: GfxFresnelSelector;
  bumpTexture: number;
  bumpMode: GfxBumpMode;
  isBumpRenormalize: boolean;
}

/** GfxLUTReference (type 0x40000000): a LUT sampler by table (LUT dictionary entry) and sampler name. */
export interface GfxLUTReference {
  typeId: number;
  samplerName: string | null;
  tableName: string | null;
  targetLUT: number;
}

export interface GfxFragLightLUT {
  /** PICALUTInput. */
  input: number;
  /** PICALUTScale. */
  scale: number;
  sampler: GfxLUTReference | null;
}

export interface GfxFragLightLUTs {
  reflecR: GfxFragLightLUT | null;
  reflecG: GfxFragLightLUT | null;
  reflecB: GfxFragLightLUT | null;
  dist0: GfxFragLightLUT | null;
  dist1: GfxFragLightLUT | null;
  fresnel: GfxFragLightLUT | null;
}

export enum GfxTexEnvConstant {
  Constant0 = 0,
  Constant1 = 1,
  Constant2 = 2,
  Constant3 = 3,
  Constant4 = 4,
  Constant5 = 5,
  Emission = 6,
  Ambient = 7,
  Diffuse = 8,
  Specular0 = 9,
  Specular1 = 10,
}

export interface GfxTexEnv {
  constant: GfxTexEnvConstant;
  stage: PICATexEnvStage;
}

export interface GfxFragShader {
  texEnvBufferColorF: Vec4;
  lighting: GfxFragLight;
  luts: GfxFragLightLUTs | null;
  textureEnvironments: GfxTexEnv[];
  alphaTest: PICAAlphaTest;
  texEnvBufferColor: RGBA;
  /** GPUREG_TEXENV_UPDATE_BUFFER parameter (fog mode, buffer update bits of stages 1-4, …). */
  texEnvUpdateBuffer: number;
  /** GPUREG_LIGHTING_CONFIG0 parameter written with mask 2 (0x400). */
  lightingConfig0: number;
}

export interface GfxMaterial extends GfxObject {
  flags: number;
  texCoordConfig: GfxTexCoordConfig;
  translucencyKind: GfxTranslucencyKind;
  colors: GfxMaterialColor;
  rasterization: GfxRasterization;
  fragmentOperation: GfxFragOp;
  usedTextureCoordsCount: number;
  textureCoords: GfxTextureCoord[];
  /** Three slots (null = unused unit). */
  textureMappers: (GfxTextureMapper | null)[];
  /** Procedural texture mapper pointer (never used; must be null). */
  proceduralTextureMapper: null;
  shader: GfxShaderReference | null;
  fragmentShader: GfxFragShader | null;
  shaderProgramDescIndex: number;
  /** Shader parameters (never used by the games; kept as a count check). */
  shaderParameters: never[];
  lightSetIndex: number;
  fogIndex: number;
  // Hashes of the settings (SPICA GfxMaterial.Calc*Hash) and the unique id.
  materialFlagsHash: number;
  shaderParamsHash: number;
  textureCoordsHash: number;
  textureSamplersHash: number;
  textureMappersHash: number;
  materialColorsHash: number;
  rasterizationHash: number;
  fragLightHash: number;
  fragLightLUTHash: number;
  fragLightLUTSampHash: number;
  textureEnvironmentHash: number;
  alphaTestHash: number;
  fragOpHash: number;
  uniqueId: number;
}

// ---------------------------------------------------------------------------------------------------------------
// PICA register values used by materials (SPICA/PICA/Commands)

export enum PICATestFunc {
  Never = 0,
  Always = 1,
  Equal = 2,
  Notequal = 3,
  Less = 4,
  Lequal = 5,
  Greater = 6,
  Gequal = 7,
}

export interface PICADepthColorMask {
  enabled: boolean;
  depthFunc: PICATestFunc;
  redWrite: boolean;
  greenWrite: boolean;
  blueWrite: boolean;
  alphaWrite: boolean;
  depthWrite: boolean;
}

export interface PICAColorOperation {
  /** PICAFragOpMode (0 default, 1 gas, 3 shadow). */
  fragOpMode: number;
  /** PICABlendMode (0 logical op, 1 blend). */
  blendMode: number;
}

export interface PICABlendFunction {
  colorEquation: number;
  alphaEquation: number;
  colorSrcFunc: number;
  colorDstFunc: number;
  alphaSrcFunc: number;
  alphaDstFunc: number;
}

export interface PICAStencilTest {
  enabled: boolean;
  function: PICATestFunc;
  bufferMask: number;
  reference: number;
  mask: number;
}

export interface PICAStencilOperation {
  failOp: number;
  zFailOp: number;
  zPassOp: number;
}

export interface PICAAlphaTest {
  enabled: boolean;
  function: PICATestFunc;
  reference: number;
}

/** One texture combiner stage (GPUREG_TEXENVi_*), the parameters as PICA stores them. */
export interface PICATexEnvStage {
  /** PICATextureCombinerSource ×3 for colour and alpha. */
  source: { color: [number, number, number]; alpha: [number, number, number] };
  /** PICATextureCombinerColorOp ×3, PICATextureCombinerAlphaOp ×3. */
  operand: { color: [number, number, number]; alpha: [number, number, number] };
  /** PICATextureCombinerMode for colour and alpha. */
  combiner: { color: number; alpha: number };
  color: RGBA;
  /** PICATextureCombinerScale (0 = ×1, 1 = ×2, 2 = ×4). */
  scale: { color: number; alpha: number };
  /** Bits of the source / operand / combiner / scale parameters outside the fields (kept for byte identity). */
  otherBits: [number, number, number, number];
  /** Update the combiner buffer with this stage's output (GPUREG_TEXENV_UPDATE_BUFFER; stages 1-4). */
  updateColorBuffer: boolean;
  updateAlphaBuffer: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Textures

export enum PICATextureFormat {
  RGBA8 = 0,
  RGB8 = 1,
  RGBA5551 = 2,
  RGB565 = 3,
  RGBA4 = 4,
  LA8 = 5,
  HiLo8 = 6,
  L8 = 7,
  A8 = 8,
  LA4 = 9,
  L4 = 10,
  A4 = 11,
  ETC1 = 12,
  ETC1A4 = 13,
}

export interface GfxTextureImageData {
  height: number;
  width: number;
  /** Pixel data (in the IMAG section; PICA tiled layout, all mipmap levels). */
  rawBuffer: Uint8Array;
  dynamicAlloc: number;
  bitsPerPixel: number;
  locationPtr: number;
  memoryArea: number;
}

interface GfxTextureBase extends GfxObject {
  height: number;
  width: number;
  glFormat: number;
  glType: number;
  mipmapSize: number;
  textureObj: number;
  locationFlag: number;
  hwFormat: PICATextureFormat;
}

/** GfxTextureImage (type 0x20000011). */
export interface GfxTextureImage extends GfxTextureBase {
  kind: 'image';
  image: GfxTextureImageData | null;
}

/** GfxTextureCube (type 0x20000009): six faces, X+ X- Y+ Y- Z+ Z-. */
export interface GfxTextureCube extends GfxTextureBase {
  kind: 'cube';
  images: (GfxTextureImageData | null)[];
}

export type GfxTexture = GfxTextureImage | GfxTextureCube;

// ---------------------------------------------------------------------------------------------------------------
// LUTs (fragment lighting tables)

export interface GfxLUT extends GfxObject {
  samplers: GfxLUTSampler[];
}

/** GfxLUTSampler (type 0x80000000): a 256-entry table as the PICA commands that upload it (pica.ts lutTable). */
export interface GfxLUTSampler {
  typeId: number;
  name: string;
  isAbsolute: boolean;
  /** PICA command words (GPUREG_LIGHTING_LUT_INDEX + LUT_DATA). */
  commands: number[];
}

// ---------------------------------------------------------------------------------------------------------------
// Animations

export enum GfxLoopMode {
  OneTime = 0,
  Loop = 1,
}

export enum GfxLoopType {
  None = 0,
  Repeat = 1,
  MirroredRepeat = 2,
  RelativeRepeat = 3,
}

export enum GfxPrimitiveType {
  Float = 0,
  Integer = 1,
  Boolean = 2,
  Vector2D = 3,
  Vector3D = 4,
  Transform = 5,
  RGBA = 6,
  Texture = 7,
  QuatTransform = 8,
  MtxTransform = 9,
}

export interface GfxAnimation {
  /** Magic CANM. */
  revision: number;
  name: string;
  /** "SkeletalAnimation", "MaterialAnimation", "VisibilityAnimation", "CameraAnimation" … */
  targetAnimGroupName: string | null;
  loopMode: GfxLoopMode;
  framesCount: number;
  elements: GfxAnimationElement[];
  metaData: GfxMetaData[];
  /**
   * Words after the common part: camera animations have two (0 in the games; in NW4C the kinds of the view and
   * projection updaters), skeletal / material / visibility animations none.
   */
  extraFields: number[];
}

/** KeyFrameQuantization (SPICA Formats/Common). */
export enum KeyFrameQuantization {
  Hermite128 = 0,
  Hermite64 = 1,
  Hermite48 = 2,
  UnifiedHermite96 = 3,
  UnifiedHermite48 = 4,
  UnifiedHermite32 = 5,
  StepLinear64 = 6,
  StepLinear32 = 7,
}

/**
 * A key as stored: frame, value and slopes before scaling (integers for the quantized formats). Decoded:
 * frame × frameScale, value × valueScale + valueOffset; slopes as they are (anim.ts decodeKeys).
 */
export interface GfxRawKey {
  frame: number;
  value: number;
  inSlope: number;
  outSlope: number;
}

export interface GfxCurveSegment {
  startFrame: number;
  endFrame: number;
  /** Bit 0 = constant, bits 2-4 interpolation (0 step, 1 linear, 2 hermite), bits 5-7 quantization. */
  formatFlags: number;
  invDuration: number;
  /** Present for quantized formats (not Hermite128 / UnifiedHermite96 / StepLinear64). */
  valueScale: number;
  valueOffset: number;
  frameScale: number;
  keys: GfxRawKey[];
}

/** GfxFloatKeyFrameGroup: an animation curve. */
export interface GfxFloatKeyFrameGroup {
  startFrame: number;
  endFrame: number;
  preRepeat: GfxLoopType;
  postRepeat: GfxLoopType;
  padding: number;
  /** Bit 1 = constant value, bit 2 = quantized curve. */
  curveFlags: number;
  /** Constant curves only. */
  value: number;
  segments: GfxCurveSegment[];
}

/** One channel of an element: absent (rest value), a constant, or a curve. */
export type GfxAnimChannel = null | number | GfxFloatKeyFrameGroup;

/** Baked values of a QuatTransform element: one value per frame (or one when constant). */
export interface GfxBakedTrack {
  startFrame: number;
  endFrame: number;
  /** Word at +8 (curve pointer slot, 4 in the games). */
  curveRelPtr: number;
  /** Bit 0 = constant. */
  flags: number;
  /** Values (xyz or quaternion xyzw) and the flags word after each. */
  values: number[][];
  segmentFlags: number[];
}

export type GfxAnimContent =
  | { type: GfxPrimitiveType.Float; channels: [GfxAnimChannel] }
  | { type: GfxPrimitiveType.Vector2D; channels: [GfxAnimChannel, GfxAnimChannel] }
  | { type: GfxPrimitiveType.Vector3D; channels: [GfxAnimChannel, GfxAnimChannel, GfxAnimChannel] }
  | { type: GfxPrimitiveType.RGBA; channels: [GfxAnimChannel, GfxAnimChannel, GfxAnimChannel, GfxAnimChannel] }
  /** Scale xyz, rotation xyz (radians), (unused w), translation xyz. */
  | { type: GfxPrimitiveType.Transform; channels: GfxAnimChannel[] }
  | {
      type: GfxPrimitiveType.QuatTransform;
      rotations: GfxBakedTrack | null;
      translations: GfxBakedTrack | null;
      scales: GfxBakedTrack | null;
    }
  | { type: GfxPrimitiveType.Boolean; value: GfxAnimBoolean };

/** Boolean curve: one bit per frame. */
export interface GfxAnimBoolean {
  startFrame: number;
  endFrame: number;
  preRepeat: GfxLoopType;
  postRepeat: GfxLoopType;
  padding: number;
  /** One value per frame from startFrame to endFrame (both included). */
  values: boolean[];
}

export interface GfxAnimationElement {
  /**
   * Element flags: for curve contents bit (constBase + i) = channel i constant, bit (absentBase + i) = absent
   * (Transform: 6 + i / 16 + i; others: i / channels + i). The writer derives these bits from the channels and
   * keeps the others.
   */
  flags: number;
  /** Bone name, or the member path (`Materials["…"].TextureCoordinators[0].Translate`, `Meshes[0].IsVisible`). */
  name: string;
  content: GfxAnimContent;
}

// ---------------------------------------------------------------------------------------------------------------
// Cameras, lights and the rest

export type GfxCameraView =
  | { kind: 'aim'; typeId: number; flags: number; target: Vec3; twist: number }
  | { kind: 'lookAt'; typeId: number; flags: number; target: Vec3; upVector: Vec3 }
  | { kind: 'rotation'; typeId: number; isInheritingRotation: boolean; rotation: Vec3 };

export type GfxCameraProjection =
  | { kind: 'perspective'; typeId: number; zNear: number; zFar: number; aspectRatio: number; fovy: number }
  | { kind: 'orthogonal' | 'frustum'; typeId: number; zNear: number; zFar: number; aspectRatio: number; height: number; center: Vec2 };

export interface GfxCamera extends GfxNodeTransform {
  viewType: number;
  projectionType: number;
  view: GfxCameraView | null;
  projection: GfxCameraProjection | null;
  wScale: number;
}

/** Lights, fogs, scenes, shaders and emitters do not occur in the games' files (the reader rejects them). */
export type GfxLight = never;
export type GfxFog = never;
export type GfxScene = never;
export type GfxShader = never;
export type GfxEmitter = never;
