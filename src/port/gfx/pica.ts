// PICA200 register values used by CGFX materials (SPICA/PICA/Commands), the command list reader / writer
// (SPICA/PICA/PICACommandReader.cs, PICACommandWriter.cs) and the fragment lighting LUT encoding.
import type {
  PICAAlphaTest, PICABlendFunction, PICAColorOperation, PICADepthColorMask, PICAStencilOperation, PICAStencilTest,
  PICATexEnvStage, RGBA,
} from './types';

/** Registers used here (SPICA PICARegister). */
export const PICAReg = {
  GPUREG_FACECULLING_CONFIG: 0x040,
  GPUREG_TEXUNIT0_BORDER_COLOR: 0x081,
  GPUREG_TEXUNIT0_TYPE: 0x08e,
  GPUREG_TEXUNIT1_BORDER_COLOR: 0x091,
  GPUREG_TEXUNIT1_TYPE: 0x096,
  GPUREG_TEXUNIT2_BORDER_COLOR: 0x099,
  GPUREG_TEXUNIT2_TYPE: 0x09e,
  GPUREG_TEXENV0_SOURCE: 0x0c0,
  GPUREG_TEXENV1_SOURCE: 0x0c8,
  GPUREG_TEXENV2_SOURCE: 0x0d0,
  GPUREG_TEXENV3_SOURCE: 0x0d8,
  GPUREG_TEXENV_UPDATE_BUFFER: 0x0e0,
  GPUREG_TEXENV4_SOURCE: 0x0f0,
  GPUREG_TEXENV5_SOURCE: 0x0f8,
  GPUREG_TEXENV_BUFFER_COLOR: 0x0fd,
  GPUREG_COLOR_OPERATION: 0x100,
  GPUREG_BLEND_FUNC: 0x101,
  GPUREG_LOGIC_OP: 0x102,
  GPUREG_BLEND_COLOR: 0x103,
  GPUREG_FRAGOP_ALPHA_TEST: 0x104,
  GPUREG_STENCIL_TEST: 0x105,
  GPUREG_STENCIL_OP: 0x106,
  GPUREG_DEPTH_COLOR_MASK: 0x107,
  GPUREG_GAS_DELTAZ_DEPTH: 0x126,
  GPUREG_LIGHTING_CONFIG0: 0x1c3,
  GPUREG_LIGHTING_LUT_INDEX: 0x1c5,
  GPUREG_LIGHTING_LUT_DATA0: 0x1c8,
  GPUREG_LIGHTING_LUT_DATA7: 0x1cf,
} as const;

export const TEXENV_SOURCE_REGS = [0x0c0, 0x0c8, 0x0d0, 0x0d8, 0x0f0, 0x0f8];

export interface PICACommand {
  register: number;
  mask: number;
  parameters: number[];
}

/** Splits a command list (u32 words) into commands (SPICA PICACommandReader, without the uniform tracking). */
export function readCommands(words: readonly number[]): PICACommand[] {
  const out: PICACommand[] = [];
  let i = 0;
  while (i + 1 < words.length) {
    const param = words[i]! >>> 0;
    const header = words[i + 1]! >>> 0;
    const id = header & 0xffff;
    const mask = (header >>> 16) & 0xf;
    const extra = (header >>> 20) & 0x7ff;
    const consecutive = header >>> 31 === 1;
    i += 2;
    if (consecutive) {
      const ps = [param];
      for (let j = 0; j < extra; j++) ps.push(words[i++]! >>> 0);
      ps.forEach((p, k) => out.push({ register: id + k, mask, parameters: [p] }));
    } else {
      const ps = [param];
      for (let j = 0; j < extra; j++) ps.push(words[i++]! >>> 0);
      out.push({ register: id, mask, parameters: ps });
    }
    if (i & 1) i++; // commands are 8-byte aligned
  }
  return out;
}

/** Builds command lists (SPICA PICACommandWriter). */
export class PICACommandWriter {
  readonly words: number[] = [];
  /** One register write. */
  set(register: number, param: number, mask = 0xf): this {
    this.words.push(param >>> 0, (register | (mask << 16)) >>> 0);
    return this;
  }
  /** Several parameters: consecutive registers, or repeated writes to one register. */
  setMany(register: number, consecutive: boolean, params: readonly number[], mask = 0xf): this {
    this.words.push(params[0]! >>> 0, (register | (mask << 16) | (((params.length - 1) & 0x7ff) << 20) | (consecutive ? 0x80000000 : 0)) >>> 0);
    for (let k = 1; k < params.length; k++) this.words.push(params[k]! >>> 0);
    if (this.words.length & 1) this.words.push(0);
    return this;
  }
}

// --- register values ---------------------------------------------------------------------------------------------

export const rgbaFromU32 = (v: number): RGBA => ({ r: v & 0xff, g: (v >>> 8) & 0xff, b: (v >>> 16) & 0xff, a: v >>> 24 });
export const rgbaToU32 = (c: RGBA): number => ((c.r & 0xff) | ((c.g & 0xff) << 8) | ((c.b & 0xff) << 16) | ((c.a & 0xff) << 24)) >>> 0;
/** Colour as floats 0..1 (SPICA RGBA.ToVector4). */
export const rgbaToVec4 = (c: RGBA): [number, number, number, number] => [c.r / 255, c.g / 255, c.b / 255, c.a / 255];

export function depthColorMaskFrom(v: number): PICADepthColorMask {
  return {
    enabled: (v & 1) !== 0,
    depthFunc: (v >>> 4) & 7,
    redWrite: ((v >>> 8) & 1) !== 0,
    greenWrite: ((v >>> 9) & 1) !== 0,
    blueWrite: ((v >>> 10) & 1) !== 0,
    alphaWrite: ((v >>> 11) & 1) !== 0,
    depthWrite: ((v >>> 12) & 1) !== 0,
  };
}
export function depthColorMaskTo(m: PICADepthColorMask): number {
  return (
    (m.enabled ? 1 : 0) | ((m.depthFunc & 7) << 4) | (m.redWrite ? 0x100 : 0) | (m.greenWrite ? 0x200 : 0) |
    (m.blueWrite ? 0x400 : 0) | (m.alphaWrite ? 0x800 : 0) | (m.depthWrite ? 0x1000 : 0)
  );
}

export const colorOperationFrom = (v: number): PICAColorOperation => ({ fragOpMode: v & 3, blendMode: (v >>> 8) & 1 });
export const colorOperationTo = (c: PICAColorOperation): number => ((c.fragOpMode & 3) | ((c.blendMode & 1) << 8) | 0xe40000) >>> 0;

export function blendFunctionFrom(v: number): PICABlendFunction {
  return {
    colorEquation: v & 7,
    alphaEquation: (v >>> 8) & 7,
    colorSrcFunc: (v >>> 16) & 15,
    colorDstFunc: (v >>> 20) & 15,
    alphaSrcFunc: (v >>> 24) & 15,
    alphaDstFunc: (v >>> 28) & 15,
  };
}
export function blendFunctionTo(f: PICABlendFunction): number {
  return (
    ((f.colorEquation & 7) | ((f.alphaEquation & 7) << 8) | ((f.colorSrcFunc & 15) << 16) | ((f.colorDstFunc & 15) << 20) |
      ((f.alphaSrcFunc & 15) << 24) | ((f.alphaDstFunc & 15) << 28)) >>> 0
  );
}

export function stencilTestFrom(v: number): PICAStencilTest {
  return { enabled: (v & 1) !== 0, function: (v >>> 4) & 7, bufferMask: (v >>> 8) & 0xff, reference: (v >>> 16) & 0xff, mask: v >>> 24 };
}
export function stencilTestTo(t: PICAStencilTest): number {
  return ((t.enabled ? 1 : 0) | ((t.function & 7) << 4) | ((t.bufferMask & 0xff) << 8) | ((t.reference & 0xff) << 16) | ((t.mask & 0xff) << 24)) >>> 0;
}

export const stencilOperationFrom = (v: number): PICAStencilOperation => ({ failOp: v & 7, zFailOp: (v >>> 4) & 7, zPassOp: (v >>> 8) & 7 });
export const stencilOperationTo = (o: PICAStencilOperation): number => (o.failOp & 7) | ((o.zFailOp & 7) << 4) | ((o.zPassOp & 7) << 8);

export const alphaTestFrom = (v: number): PICAAlphaTest => ({ enabled: (v & 1) !== 0, function: (v >>> 4) & 7, reference: (v >>> 8) & 0xff });
export const alphaTestTo = (t: PICAAlphaTest): number => (t.enabled ? 1 : 0) | ((t.function & 7) << 4) | ((t.reference & 0xff) << 8);

const SRC_MASK = 0x0fff0fff;
const OPR_MASK = 0x00777fff;
const CMB_MASK = 0x000f000f;
const SCL_MASK = 0x00030003;

/** Texture combiner stage from its five parameters (source, operand, combiner, colour, scale). */
export function texEnvStageFrom(src: number, opr: number, cmb: number, col: number, scl: number): PICATexEnvStage {
  return {
    source: { color: [src & 15, (src >>> 4) & 15, (src >>> 8) & 15], alpha: [(src >>> 16) & 15, (src >>> 20) & 15, (src >>> 24) & 15] },
    operand: { color: [opr & 15, (opr >>> 4) & 15, (opr >>> 8) & 15], alpha: [(opr >>> 12) & 7, (opr >>> 16) & 7, (opr >>> 20) & 7] },
    combiner: { color: cmb & 15, alpha: (cmb >>> 16) & 15 },
    color: rgbaFromU32(col),
    scale: { color: scl & 3, alpha: (scl >>> 16) & 3 },
    otherBits: [(src & ~SRC_MASK) >>> 0, (opr & ~OPR_MASK) >>> 0, (cmb & ~CMB_MASK) >>> 0, (scl & ~SCL_MASK) >>> 0],
    updateColorBuffer: false,
    updateAlphaBuffer: false,
  };
}

/** The five parameters of a combiner stage. */
export function texEnvStageTo(s: PICATexEnvStage): [number, number, number, number, number] {
  const [c, a] = [s.source.color, s.source.alpha];
  const src = (c[0] & 15) | ((c[1] & 15) << 4) | ((c[2] & 15) << 8) | ((a[0] & 15) << 16) | ((a[1] & 15) << 20) | ((a[2] & 15) << 24);
  const [oc, oa] = [s.operand.color, s.operand.alpha];
  const opr = (oc[0] & 15) | ((oc[1] & 15) << 4) | ((oc[2] & 15) << 8) | ((oa[0] & 7) << 12) | ((oa[1] & 7) << 16) | ((oa[2] & 7) << 20);
  const cmb = (s.combiner.color & 15) | ((s.combiner.alpha & 15) << 16);
  const scl = (s.scale.color & 3) | ((s.scale.alpha & 3) << 16);
  const o = s.otherBits;
  return [(src | o[0]) >>> 0, (opr | o[1]) >>> 0, (cmb | o[2]) >>> 0, rgbaToU32(s.color), (scl | o[3]) >>> 0];
}

/** A pass-through stage (previous colour and alpha), as unused stages are written. */
export function defaultTexEnvStage(): PICATexEnvStage {
  return texEnvStageFrom(0x0f000f00 | 0x00f000f0 | 0x000f000f, 0, 0, 0, 0);
}

// --- fragment lighting LUTs --------------------------------------------------------------------------------------

/**
 * Table (256 values 0..1) of a LUT sampler's commands (SPICA GfxLUTSampler): GPUREG_LIGHTING_LUT_INDEX selects the
 * start, LUT_DATA0..7 carry entries with the value in bits 0-11 (and the difference to the next in bits 12-23).
 */
export function lutTable(commands: readonly number[]): number[] {
  const table = new Array<number>(256).fill(0);
  let index = 0;
  for (const cmd of readCommands(commands)) {
    if (cmd.register === PICAReg.GPUREG_LIGHTING_LUT_INDEX) index = cmd.parameters[0]! & 0xff;
    else if (cmd.register >= PICAReg.GPUREG_LIGHTING_LUT_DATA0 && cmd.register <= PICAReg.GPUREG_LIGHTING_LUT_DATA7)
      for (const p of cmd.parameters) if (index < 256) table[index++] = (p & 0xfff) / 0xfff;
  }
  return table;
}
