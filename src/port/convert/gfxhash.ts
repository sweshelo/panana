// The settings hashes of a CGFX material (SPICA GfxMaterial.Calc*Hash): MD5 folds of the settings serialized as
// SPICA (and, as the games' files show, the NW4C tools) does. Equal settings give equal hashes, which the runtime
// uses to skip state changes, so a converted material must carry the hashes of its own settings.
import { PICACommandWriter, stencilOperationTo, stencilTestTo, texEnvStageTo, TEXENV_SOURCE_REGS } from '../gfx/pica';
import type { GfxFragLightLUT, GfxMaterial, GfxTexEnv, PICABlendFunction, RGBA } from '../gfx/types';
import { foldHash } from './md5';

class Bytes {
  private b: number[] = [];
  private dv = new DataView(new ArrayBuffer(4));
  u8(v: number): this {
    this.b.push(v & 0xff);
    return this;
  }
  u32(v: number): this {
    this.dv.setUint32(0, v >>> 0, true);
    for (let i = 0; i < 4; i++) this.b.push(this.dv.getUint8(i));
    return this;
  }
  s32(v: number): this {
    return this.u32(v | 0);
  }
  f32(v: number): this {
    this.dv.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) this.b.push(this.dv.getUint8(i));
    return this;
  }
  floats(v: readonly number[]): this {
    v.forEach((x) => this.f32(x));
    return this;
  }
  rgba(c: RGBA): this {
    return this.floats([c.r / 255, c.g / 255, c.b / 255, c.a / 255]);
  }
  rgb(c: RGBA): this {
    return this.floats([c.r / 255, c.g / 255, c.b / 255]);
  }
  hash(): number {
    return foldHash(Uint8Array.from(this.b));
  }
}

/** PICATestFunc -> GfxTestFunc. */
const TEST_FUNC = [0, 1, 4, 7, 2, 3, 6, 5];
/** PICALogicalOp -> GfxLogicalOp. */
const LOGIC_OP = [0, 8, 6, 1, 3, 4, 2, 5, 10, 9, 11, 12, 13, 14, 7, 15];
const GL_BLEND = [0x0000, 0x0001, 0x0300, 0x0301, 0x0306, 0x0307, 0x0302, 0x0303, 0x0304, 0x0305, 0x8001, 0x8002, 0x8003, 0x8004, 0x0308];
const GL_EQUATION = [0x8006, 0x800a, 0x800b, 0x8007, 0x8008];
const GL_SRC: Record<number, number> = { 3: 0x84c0, 4: 0x84c1, 5: 0x84c2, 6: 0x84c3, 14: 0x8576, 0: 0x8577, 15: 0x8578, 13: 0x8579, 1: 0x6210, 2: 0x6211 };
const GL_COLOR_OP: Record<number, number> = { 0: 0x300, 1: 0x301, 2: 0x302, 3: 0x303, 4: 0x8580, 8: 0x8581, 12: 0x8582, 5: 0x8583, 9: 0x8584, 13: 0x8585 };
const GL_ALPHA_OP: Record<number, number> = { 0: 0x302, 1: 0x303, 2: 0x8580, 3: 0x8583, 4: 0x8581, 5: 0x8584, 6: 0x8582, 7: 0x8585 };

/** The alpha operands of a stage (bits 12, 16, 20 of the PICA operand word). */
export function alphaOperands(s: GfxTexEnv['stage']): [number, number, number] {
  return [...s.operand.alpha];
}

function blendWords(b: Bytes, mode: number, f: PICABlendFunction): void {
  const w = (x: number[]): void => void x.forEach((v) => b.u32(v));
  if (mode === 1) w([GL_BLEND[f.colorSrcFunc]!, GL_BLEND[f.colorDstFunc]!, GL_EQUATION[f.colorEquation]!, GL_BLEND[1]!, GL_BLEND[0]!, GL_EQUATION[0]!]);
  else if (mode === 2) w([GL_BLEND[f.colorSrcFunc]!, GL_BLEND[f.colorDstFunc]!, GL_EQUATION[f.colorEquation]!, GL_BLEND[f.alphaSrcFunc]!, GL_BLEND[f.alphaDstFunc]!, GL_EQUATION[f.alphaEquation]!]);
  else w([GL_BLEND[6]!, GL_BLEND[7]!, GL_EQUATION[0]!, GL_BLEND[1]!, GL_BLEND[0]!, GL_EQUATION[0]!]);
}

/** The float a reference byte was made from: the shortest decimal that rounds to it (the tools keep 0.5, not 128 / 255). */
export function refFloat(ref: number): number {
  for (let d = 1; d <= 3; d++) {
    const x = Math.round((ref / 255) * 10 ** d) / 10 ** d;
    if (Math.round(x * 255) === ref) return x;
  }
  return ref / 255;
}

/** Sets the hash fields of a material from its settings (the two SPICA leaves at 0 stay 0, as in the games). */
export function setMaterialHashes(m: GfxMaterial): void {
  m.materialFlagsHash = new Bytes().u32(m.flags | 0x20).hash();
  m.shaderParamsHash = new Bytes().hash();
  const tc = new Bytes().u32(m.texCoordConfig);
  m.textureCoords.forEach((t, i) => {
    const used = i < m.usedTextureCoordsCount;
    tc.s32(t.sourceCoordIndex).u32(t.mappingType).s32(t.referenceCameraIndex).u32(t.transformType);
    if (used) tc.floats(t.scale);
    tc.f32(t.rotation);
    if (used) tc.floats(t.translation);
    tc.u8(0).floats(t.transform).u32(m.texCoordConfig);
  });
  m.textureCoordsHash = tc.hash();
  const ts = new Bytes().u32(m.texCoordConfig);
  const wraps = [2, 3, 0, 1];
  for (const t of m.textureMappers) {
    if (!t || !t.sampler) continue;
    ts.rgba(t.borderColor).u32(wraps[t.wrapU]!).u32(wraps[t.wrapV]!).f32(t.minLOD).f32(t.lodBias).u32(t.sampler.minFilter).u32(t.magFilter);
  }
  m.textureSamplersHash = ts.hash();
  m.textureMappersHash = 0;
  const c = m.colors;
  const rgb = (v: readonly number[]): number[] => v.slice(0, 3);
  m.materialColorsHash = new Bytes().floats(rgb(c.emissionF)).floats(rgb(c.ambientF)).f32(c.ambientF[3]).floats(c.diffuseF).floats(rgb(c.specular0F))
    .floats(rgb(c.specular1F)).floats(c.constant0F).floats(c.constant1F).floats(c.constant2F).floats(c.constant3F).floats(c.constant4F).floats(c.constant5F).hash();
  const r = m.rasterization;
  m.rasterizationHash = new Bytes().u32(r.isPolygonOffsetEnabled ? 1 : 0).u32(r.faceCullingCommand).u32(0x00010040).f32(r.polygonOffsetUnit).hash();
  const fs = m.fragmentShader;
  if (fs) {
    const l = fs.lighting;
    m.fragLightHash = new Bytes().u32(l.flags).u32(l.translucencyKind).u32(l.fresnelSelector).s32(l.bumpTexture).u32(l.bumpMode).u8(l.isBumpRenormalize ? 1 : 0)
      .u8(m.flags & 1).hash();
    const lb = new Bytes();
    const u = fs.luts;
    if (u) for (const x of [u.reflecR, u.reflecG, u.reflecB, u.dist0, u.dist1, u.fresnel] as (GfxFragLightLUT | null)[]) if (x) lb.u32(x.input).u32(x.scale);
    m.fragLightLUTSampHash = lb.hash();
    const te = new Bytes().floats(fs.texEnvBufferColorF);
    fs.textureEnvironments.forEach((t, i) => {
      const s = t.stage;
      te.u32(t.constant);
      for (const k of [0, 1, 2]) te.u32(GL_SRC[s.source.color[k]!] ?? 0);
      for (const k of [0, 1, 2]) te.u32(GL_COLOR_OP[s.operand.color[k]!] ?? 0);
      for (const k of [0, 1, 2]) te.u32(GL_SRC[s.source.alpha[k]!] ?? 0);
      for (const a of alphaOperands(s)) te.u32(GL_ALPHA_OP[a] ?? 0);
      for (const w of new PICACommandWriter().setMany(TEXENV_SOURCE_REGS[i]!, true, texEnvStageTo(s)).words) te.u32(w);
    });
    m.textureEnvironmentHash = te.hash();
    const at = fs.alphaTest;
    m.alphaTestHash = new Bytes().u8(at.enabled ? 1 : 0).u32(TEST_FUNC[at.function]!).f32(refFloat(at.reference)).hash();
  }
  m.fragLightLUTHash = 0;
  const fo = m.fragmentOperation;
  const op = new Bytes().u32(fo.depth.flags).u32(TEST_FUNC[fo.depth.colorMask.depthFunc]!).u32(0).u32(fo.blend.mode).rgba(fo.blend.color);
  op.u32(fo.blend.mode === 3 ? LOGIC_OP[fo.blend.logicalOperation]! : 1);
  blendWords(op, fo.blend.mode, fo.blend.function);
  for (const w of new PICACommandWriter().set(0x105, stencilTestTo(fo.stencil.test), 13).set(0x106, stencilOperationTo(fo.stencil.operation)).words) op.u32(w);
  m.fragOpHash = op.hash();
}
