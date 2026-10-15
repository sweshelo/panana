// The PICA command lists SPICA generates on save (H3DMesh / H3DSubMesh / H3DTexture / H3DMaterial /
// H3DMaterialParams / H3DLUTSampler .Serialize), for objects whose `…Commands` are undefined (a converter's output).
// Address words are left 0; the writer fills them in.
import { PICACommandWriter, Reg, toUInt32, wordsFromVector } from './pica';
import type { H3DLUTSampler, H3DMaterial, H3DMaterialParams, H3DMesh, H3DSubMesh, H3DTexture, PICATexEnvStage, RGBA } from './types';

const rgbaWord = (c: RGBA): number => (c[0] | (c[1] << 8) | (c[2] << 16) | (c[3] << 24)) >>> 0;

/** H3DMesh enable and disable commands (vertex format, fixed attributes, position offset, attribute scales). */
export function meshCommands(m: H3DMesh): { enable: Uint32Array; disable: Uint32Array } {
  let formats = 0n, attributes = 0n, permutation = 0n;
  let total = 0;
  const scales = [1, 0, 0, 0, 1, 0, 0, 0];
  m.attributes.forEach((a, i) => {
    const shift = BigInt(total++ * 4);
    const fmt = BigInt(a.format | (((a.elements - 1) & 3) << 2));
    formats |= fmt << shift;
    permutation |= BigInt(a.name) << shift;
    attributes |= BigInt(i) << shift;
    const at = [3, 2, 1, 0, 7, 6, 5, -1, 4][a.name];
    if (at !== undefined && at >= 0) scales[at] = a.scale;
  });
  attributes |= BigInt(m.vertexStride & 0xff) << 48n;
  attributes |= BigInt(m.attributes.length) << 60n;
  for (const f of m.fixedAttributes) {
    formats |= 1n << BigInt(48 + total);
    permutation |= BigInt(f.name) << BigInt(total++ * 4);
  }
  formats |= BigInt(total - 1) << 60n;
  const lo = (v: bigint): number => Number(v & 0xffffffffn);
  const hi = (v: bigint): number => Number((v >> 32n) & 0xffffffffn);
  const w = new PICACommandWriter();
  w.setCommand(Reg.GPUREG_VSH_INPUTBUFFER_CONFIG, (0xa0000000 | (total - 1)) >>> 0, 0xb);
  w.setCommand(Reg.GPUREG_VSH_NUM_ATTR, total - 1, 1);
  w.setCommand(Reg.GPUREG_VSH_ATTRIBUTES_PERMUTATION_LOW, lo(permutation));
  w.setCommand(Reg.GPUREG_VSH_ATTRIBUTES_PERMUTATION_HIGH, hi(permutation));
  w.setCommands(Reg.GPUREG_ATTRIBBUFFERS_LOC, true, 0xf, [0, lo(formats), hi(formats), 0, lo(attributes), hi(attributes)]);
  m.fixedAttributes.forEach((f, i) => {
    w.setCommands(Reg.GPUREG_FIXEDATTRIB_INDEX, true, 0xf, [m.attributes.length + i, ...wordsFromVector(f.value)]);
  });
  const p = m.positionOffset;
  w.setCommands(Reg.GPUREG_VSH_FLOATUNIFORM_INDEX, true, 0xf, [0x80000006, toUInt32(p[3]), toUInt32(p[2]), toUInt32(p[1]), toUInt32(p[0])]);
  w.setCommand(Reg.GPUREG_VSH_FLOATUNIFORM_INDEX, 0x80000007);
  w.setCommands(Reg.GPUREG_VSH_FLOATUNIFORM_DATA0, false, 0xf, scales.map(toUInt32));
  w.writeEnd();
  const d = new PICACommandWriter();
  d.setCommands(Reg.GPUREG_ATTRIBBUFFER0_OFFSET, true, 0xf, [0, 0, 0]);
  for (let i = 1; i < 12; i++) {
    d.setCommand(Reg.GPUREG_ATTRIBBUFFER0_CONFIG2 + i * 3, 0);
    if (m.fixedAttributes.some((f) => f.name === i)) d.setCommands(Reg.GPUREG_FIXEDATTRIB_INDEX, true, 0xf, [i, 0, 0, 0]);
  }
  d.writeEnd();
  return { enable: w.buffer(), disable: d.buffer() };
}

/** H3DSubMesh commands (bool uniforms, index buffer, draw). */
export function subMeshCommands(s: H3DSubMesh): Uint32Array {
  const w = new PICACommandWriter();
  w.setCommand(Reg.GPUREG_VSH_BOOLUNIFORM, (s.boolUniforms | 0x7fff0000) >>> 0);
  w.setCommand(Reg.GPUREG_RESTART_PRIMITIVE, 1);
  w.setCommand(Reg.GPUREG_INDEXBUFFER_CONFIG, 0);
  w.setCommand(Reg.GPUREG_NUMVERTICES, s.indices.length);
  w.setCommand(Reg.GPUREG_START_DRAW_FUNC0, 0, 1);
  w.setCommand(Reg.GPUREG_DRAWELEMENTS, 1);
  w.setCommand(Reg.GPUREG_START_DRAW_FUNC0, 1, 1);
  w.setCommand(Reg.GPUREG_VTX_FUNC, 1);
  w.setCommand(Reg.GPUREG_PRIMITIVE_CONFIG, s.primitiveMode << 8, 8);
  w.setCommand(Reg.GPUREG_PRIMITIVE_CONFIG, s.primitiveMode << 8, 8);
  w.writeEnd();
  return w.buffer();
}

/** H3DTexture commands of units 0-2 (size, mipmaps, address, format). */
export function textureCommands(t: H3DTexture): [Uint32Array, Uint32Array, Uint32Array] {
  const res = (t.height | (t.width << 16)) >>> 0;
  const unit = (dim: number, lod: number, addr: number, type: number): Uint32Array => {
    const w = new PICACommandWriter();
    w.setCommand(dim, res);
    w.setCommand(lod, t.mipmapSize);
    w.setCommand(addr, 0);
    w.setCommand(type, t.format);
    w.writeEnd();
    return w.buffer();
  };
  return [
    unit(Reg.GPUREG_TEXUNIT0_DIM, Reg.GPUREG_TEXUNIT0_LOD, Reg.GPUREG_TEXUNIT0_ADDR1, Reg.GPUREG_TEXUNIT0_TYPE),
    unit(Reg.GPUREG_TEXUNIT1_DIM, Reg.GPUREG_TEXUNIT1_LOD, Reg.GPUREG_TEXUNIT1_ADDR, Reg.GPUREG_TEXUNIT1_TYPE),
    unit(Reg.GPUREG_TEXUNIT2_DIM, Reg.GPUREG_TEXUNIT2_LOD, Reg.GPUREG_TEXUNIT2_ADDR, Reg.GPUREG_TEXUNIT2_TYPE),
  ];
}

/** H3DMaterial texture commands (the enabled texture units; the game fills in the rest). */
export function materialTextureCommands(m: H3DMaterial): Uint32Array {
  const e = m.enabledTextures;
  const config = (0x00011000 | (e[0] ? 1 : 0) | (e[1] ? 2 : 0) | (e[2] ? 4 : 0) | (e[3] ? 0x400 : 0)) >>> 0;
  const w = new PICACommandWriter();
  w.setCommands(Reg.GPUREG_TEXUNIT_CONFIG, false, 0, [0, 0, 0]);
  w.setCommand(Reg.GPUREG_TEXUNIT_CONFIG, config);
  for (const [border, dim, param, lod, addr, type] of [
    [0x81, 0x82, 0x83, 0x84, 0x85, 0x8e], [0x91, 0x92, 0x93, 0x94, 0x95, 0x96], [0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e],
  ] as const) {
    w.setCommand(border, 0);
    w.setCommand(dim, 0);
    w.setCommand(param, 0x2220);
    w.setCommand(lod, 0);
    w.setCommand(addr, 0);
    w.setCommand(type, 0xc);
  }
  w.writeEnd();
  return w.buffer();
}

/** The 6 words of the LUT input commands (abs / select / scale) from the decoded fields. */
export function lutConfigCommands(p: H3DMaterialParams): number[] {
  const shifts = { dist0: 0, dist1: 4, specular: 8, fresnel: 12, reflecR: 16, reflecG: 20, reflecB: 24 } as const;
  let abs = 0, sel = 0, scale = 0;
  for (const [k, s] of Object.entries(shifts) as [keyof typeof shifts, number][]) {
    if (!p.lutInputAbsolute[k]) abs |= 1 << (s + 1);
    sel |= (p.lutInputSelection[k] & 7) << s;
    scale |= (p.lutInputScale[k] & 7) << s;
  }
  return [abs >>> 0, Reg.GPUREG_LIGHTING_LUTINPUT_ABS | 0xf0000, sel >>> 0, Reg.GPUREG_LIGHTING_LUTINPUT_SELECT | 0xf0000, scale >>> 0, Reg.GPUREG_LIGHTING_LUTINPUT_SCALE | 0xf0000];
}

const stageWords = (s: PICATexEnvStage): number[] => [
  (s.source.color[0] | (s.source.color[1] << 4) | (s.source.color[2] << 8) | (s.source.alpha[0] << 16) | (s.source.alpha[1] << 20) | (s.source.alpha[2] << 24)) >>> 0,
  (s.operand.color[0] | (s.operand.color[1] << 4) | (s.operand.color[2] << 8) | (s.operand.alpha[0] << 12) | (s.operand.alpha[1] << 16) | (s.operand.alpha[2] << 20)) >>> 0,
  (s.combiner.color | (s.combiner.alpha << 16)) >>> 0,
  rgbaWord(s.color),
  (s.scale.color | (s.scale.alpha << 16)) >>> 0,
];

/**
 * A texture coordinate's transform (SPICA TextureTransform.GetTransform) as SPICA's Matrix3x4 fields: m[c][r] is
 * M(r+1)(c+1) for rows 1-4 (row 4 = translation) and columns 1-3.
 */
export function textureTransform(scale: [number, number], rotation: number, translation: [number, number], type: number): number[][] {
  const [sx, sy] = scale;
  const [tx, ty] = translation;
  const ca = Math.fround(Math.cos(rotation)), sa = Math.fround(Math.sin(rotation));
  // m[row][col], rows 0-3, cols 0-2; identity
  const m = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]];
  m[0]![0] = sx * ca;
  m[0]![1] = sy * sa;
  m[1]![0] = sx * -sa;
  m[1]![1] = sy * ca;
  if (type === 0) {
    m[3]![0] = sx * (0.5 * sa - 0.5 * ca + 0.5 - tx);
    m[3]![1] = sy * (0.5 * -sa - 0.5 * ca + 0.5 - ty);
  } else if (type === 1) {
    m[3]![0] = sx * (-ca * tx - sa * ty);
    m[3]![1] = sy * (sa * tx - ca * ty);
  } else if (type === 2) {
    m[3]![0] = sx * ca * (-tx - 0.5) - sx * sa * (ty - 0.5) + 0.5;
    m[3]![1] = sy * sa * (-tx - 0.5) + sy * ca * (ty - 0.5) + 0.5;
  }
  return m;
}

/** H3DMaterialParams fragment commands (TEV stages, blending, tests, buffers, texture matrices, colours). */
export function fragmentShaderCommands(p: H3DMaterialParams): { words: Uint32Array; frameAccessOffset: number } {
  const w = new PICACommandWriter();
  const bases = [Reg.GPUREG_TEXENV0_SOURCE, Reg.GPUREG_TEXENV1_SOURCE, Reg.GPUREG_TEXENV2_SOURCE, Reg.GPUREG_TEXENV3_SOURCE, Reg.GPUREG_TEXENV4_SOURCE, Reg.GPUREG_TEXENV5_SOURCE];
  bases.forEach((reg, i) => w.setCommands(reg, true, 0xf, stageWords(p.texEnvStages[i]!)));
  let update = 0;
  for (let i = 1; i <= 4; i++) {
    if (p.texEnvStages[i]!.updateColorBuffer) update |= 0x80 << i;
    if (p.texEnvStages[i]!.updateAlphaBuffer) update |= 0x800 << i;
  }
  w.setCommand(Reg.GPUREG_TEXENV_UPDATE_BUFFER, update, 2);
  w.setCommand(Reg.GPUREG_TEXENV_BUFFER_COLOR, rgbaWord(p.texEnvBufferColor));
  w.setCommand(Reg.GPUREG_COLOR_OPERATION, ((0xe4 << 16) | (p.colorOperation.fragOpMode & 3) | ((p.colorOperation.blendMode & 1) << 8)) >>> 0, 3);
  const bf = p.blendFunction;
  w.setCommand(Reg.GPUREG_BLEND_FUNC, ((bf.colorEquation & 7) | ((bf.alphaEquation & 7) << 8) | ((bf.colorSrcFunc & 15) << 16) | ((bf.colorDstFunc & 15) << 20) | ((bf.alphaSrcFunc & 15) << 24) | ((bf.alphaDstFunc & 15) << 28)) >>> 0);
  const at = p.alphaTest;
  w.setCommand(Reg.GPUREG_FRAGOP_ALPHA_TEST, ((at.enabled ? 1 : 0) | ((at.function & 7) << 4) | ((at.reference & 255) << 8)) >>> 0, 3);
  const st = p.stencilTest;
  w.setCommand(Reg.GPUREG_STENCIL_TEST, ((st.enabled ? 1 : 0) | ((st.function & 7) << 4) | (st.bufferMask << 8) | (st.reference << 16) | (st.mask << 24)) >>> 0);
  const so = p.stencilOperation;
  w.setCommand(Reg.GPUREG_STENCIL_OP, (so.failOp & 7) | ((so.zFailOp & 7) << 4) | ((so.zPassOp & 7) << 8));
  const d = p.depthColorMask;
  w.setCommand(Reg.GPUREG_DEPTH_COLOR_MASK, (d.enabled ? 1 : 0) | ((d.depthFunc & 7) << 4) | (d.redWrite ? 0x100 : 0) | (d.greenWrite ? 0x200 : 0) | (d.blueWrite ? 0x400 : 0) | (d.alphaWrite ? 0x800 : 0) | (d.depthWrite ? 0x1000 : 0));
  w.setCommand(Reg.GPUREG_FACECULLING_CONFIG, p.faceCulling);
  w.setCommand(Reg.GPUREG_FRAMEBUFFER_FLUSH, 1);
  w.setCommand(Reg.GPUREG_FRAMEBUFFER_INVALIDATE, 1);
  const frameAccessOffset = w.index;
  w.setCommand(Reg.GPUREG_COLORBUFFER_READ, p.colorBufferRead ? 0xf : 0, 1);
  w.setCommand(Reg.GPUREG_COLORBUFFER_WRITE, p.colorBufferWrite ? 0xf : 0, 1);
  w.setBits(Reg.GPUREG_DEPTHBUFFER_READ, p.stencilBufferRead, p.depthBufferRead);
  w.setBits(Reg.GPUREG_DEPTHBUFFER_WRITE, p.stencilBufferWrite, p.depthBufferWrite);
  const zero = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const mtx = p.textureCoords.map((t) => (t.scale[0] !== 0 || t.scale[1] !== 0 ? textureTransform(t.scale, t.rotation, t.translation, t.transformType) : zero));
  // Uniforms 11-13 (matrix 0), 14-16 (matrix 1), 17-18 (matrix 2): column c is the vector (M1c, M2c, M3c, M4c), words w z y x.
  const rows: number[] = [];
  for (let m = 0; m < 3; m++) for (let col = 0; col < (m < 2 ? 3 : 2); col++) rows.push(mtx[m]![3]![col]!, mtx[m]![2]![col]!, mtx[m]![1]![col]!, mtx[m]![0]![col]!);
  w.setCommand(Reg.GPUREG_VSH_FLOATUNIFORM_INDEX, 0x8000000b);
  w.setCommands(Reg.GPUREG_VSH_FLOATUNIFORM_DATA0, false, 0xf, rows.map(toUInt32));
  const tc = p.textureCoords;
  w.setCommands(Reg.GPUREG_VSH_FLOATUNIFORM_INDEX, true, 0xf, [0x80000013, toUInt32(tc[1].translation[1]), toUInt32(tc[1].translation[0]), toUInt32(tc[0].translation[1]), toUInt32(tc[0].translation[0])]);
  const ts = p.textureSources;
  w.setCommands(Reg.GPUREG_VSH_FLOATUNIFORM_INDEX, true, 0xf, [0x8000000a, toUInt32(ts[3]), toUInt32(ts[2]), toUInt32(ts[1]), toUInt32(ts[0])]);
  const a = p.ambientColor, df = p.diffuseColor;
  w.setCommands(Reg.GPUREG_VSH_FLOATUNIFORM_INDEX, true, 0xf, [0x80000014, toUInt32(p.colorScale), toUInt32(a[2] / 255), toUInt32(a[1] / 255), toUInt32(a[0] / 255)]);
  w.setCommands(Reg.GPUREG_VSH_FLOATUNIFORM_INDEX, true, 0xf, [0x80000015, toUInt32(df[3] / 255), toUInt32(df[2] / 255), toUInt32(df[1] / 255), toUInt32(df[0] / 255)]);
  w.setCommands(Reg.GPUREG_VSH_FLOATUNIFORM_INDEX, true, 0xf, [0x80000055, toUInt32(1), toUInt32(8), toUInt32(1), toUInt32(8)]);
  w.writeEnd();
  return { words: w.buffer(), frameAccessOffset };
}

/**
 * H3DLUTSampler commands: each entry is a 12-bit value and the difference to the next entry as sign + 11-bit
 * magnitude (the games' files; SPICA writes the difference in two's complement, which the files do not use). The
 * files' converter sometimes sets the sign of a zero difference, which is not reproduced.
 */
export function lutSamplerCommands(s: H3DLUTSampler): Uint32Array {
  const v = s.table.map((x) => Math.min(0xfff, Math.max(0, Math.round(x * 0xfff))));
  const q: number[] = [];
  for (let i = 0; i < 256; i++) {
    const d = i < 255 ? v[i + 1]! - v[i]! : 0;
    const mag = Math.min(0x7ff, Math.round((Math.abs(d) * 0x7ff) / 0xfff));
    q.push((v[i]! | (((d < 0 ? 0x800 : 0) | mag) << 12)) >>> 0);
  }
  const w = new PICACommandWriter();
  w.setCommands(Reg.GPUREG_LIGHTING_LUT_DATA0, false, 0xf, q);
  w.writeEnd();
  return w.buffer();
}
