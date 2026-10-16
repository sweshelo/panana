// PICA200 command lists as H3D stores them (SPICA PICACommandReader / PICACommandWriter, PICAVectorFloat24): pairs of
// parameter + header words, every command 8-byte aligned. The lists end with GPUREG_CMDBUF_JUMP1 on a 16-byte boundary.
import type { Vector4 } from './types';

/** Registers H3D uses (SPICA PICARegister). */
export const Reg = {
  GPUREG_FACECULLING_CONFIG: 0x040,
  GPUREG_TEXUNIT_CONFIG: 0x080,
  GPUREG_TEXUNIT0_BORDER_COLOR: 0x081,
  GPUREG_TEXUNIT0_DIM: 0x082,
  GPUREG_TEXUNIT0_PARAM: 0x083,
  GPUREG_TEXUNIT0_LOD: 0x084,
  GPUREG_TEXUNIT0_ADDR1: 0x085,
  GPUREG_TEXUNIT0_ADDR2: 0x086,
  GPUREG_TEXUNIT0_ADDR6: 0x08a,
  GPUREG_TEXUNIT0_TYPE: 0x08e,
  GPUREG_TEXUNIT1_BORDER_COLOR: 0x091,
  GPUREG_TEXUNIT1_DIM: 0x092,
  GPUREG_TEXUNIT1_PARAM: 0x093,
  GPUREG_TEXUNIT1_LOD: 0x094,
  GPUREG_TEXUNIT1_ADDR: 0x095,
  GPUREG_TEXUNIT1_TYPE: 0x096,
  GPUREG_TEXUNIT2_BORDER_COLOR: 0x099,
  GPUREG_TEXUNIT2_DIM: 0x09a,
  GPUREG_TEXUNIT2_PARAM: 0x09b,
  GPUREG_TEXUNIT2_LOD: 0x09c,
  GPUREG_TEXUNIT2_ADDR: 0x09d,
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
  GPUREG_FRAGOP_ALPHA_TEST: 0x104,
  GPUREG_STENCIL_TEST: 0x105,
  GPUREG_STENCIL_OP: 0x106,
  GPUREG_DEPTH_COLOR_MASK: 0x107,
  GPUREG_FRAMEBUFFER_INVALIDATE: 0x110,
  GPUREG_FRAMEBUFFER_FLUSH: 0x111,
  GPUREG_COLORBUFFER_READ: 0x112,
  GPUREG_COLORBUFFER_WRITE: 0x113,
  GPUREG_DEPTHBUFFER_READ: 0x114,
  GPUREG_DEPTHBUFFER_WRITE: 0x115,
  GPUREG_LIGHTING_LUT_INDEX: 0x1c5,
  GPUREG_LIGHTING_LUT_DATA0: 0x1c8,
  GPUREG_LIGHTING_LUT_DATA7: 0x1cf,
  GPUREG_LIGHTING_LUTINPUT_ABS: 0x1d0,
  GPUREG_LIGHTING_LUTINPUT_SELECT: 0x1d1,
  GPUREG_LIGHTING_LUTINPUT_SCALE: 0x1d2,
  GPUREG_ATTRIBBUFFERS_LOC: 0x200,
  GPUREG_ATTRIBBUFFERS_FORMAT_LOW: 0x201,
  GPUREG_ATTRIBBUFFERS_FORMAT_HIGH: 0x202,
  GPUREG_ATTRIBBUFFER0_OFFSET: 0x203,
  GPUREG_ATTRIBBUFFER0_CONFIG1: 0x204,
  GPUREG_ATTRIBBUFFER0_CONFIG2: 0x205,
  GPUREG_INDEXBUFFER_CONFIG: 0x227,
  GPUREG_NUMVERTICES: 0x228,
  GPUREG_START_DRAW_FUNC0: 0x22a,
  GPUREG_DRAWELEMENTS: 0x22f,
  GPUREG_VTX_FUNC: 0x231,
  GPUREG_FIXEDATTRIB_INDEX: 0x232,
  GPUREG_FIXEDATTRIB_DATA0: 0x233,
  GPUREG_FIXEDATTRIB_DATA1: 0x234,
  GPUREG_FIXEDATTRIB_DATA2: 0x235,
  GPUREG_CMDBUF_JUMP1: 0x23d,
  GPUREG_VSH_NUM_ATTR: 0x242,
  GPUREG_PRIMITIVE_CONFIG: 0x25e,
  GPUREG_RESTART_PRIMITIVE: 0x25f,
  GPUREG_GSH_FLOATUNIFORM_INDEX: 0x290,
  GPUREG_GSH_FLOATUNIFORM_DATA0: 0x291,
  GPUREG_GSH_FLOATUNIFORM_DATA7: 0x298,
  GPUREG_VSH_BOOLUNIFORM: 0x2b0,
  GPUREG_VSH_INPUTBUFFER_CONFIG: 0x2b9,
  GPUREG_VSH_ATTRIBUTES_PERMUTATION_LOW: 0x2bb,
  GPUREG_VSH_ATTRIBUTES_PERMUTATION_HIGH: 0x2bc,
  GPUREG_VSH_FLOATUNIFORM_INDEX: 0x2c0,
  GPUREG_VSH_FLOATUNIFORM_DATA0: 0x2c1,
  GPUREG_VSH_FLOATUNIFORM_DATA7: 0x2c8,
  GPUREG_DUMMY: 0x000,
} as const;

/** One register write: the register, its value and the word index of that value in the list. */
export interface PICACommand {
  register: number;
  value: number;
  mask: number;
  word: number;
}

/** The register writes of a command list in order (consecutive / repeated writes expanded). */
export function readCommands(words: ArrayLike<number>): PICACommand[] {
  const out: PICACommand[] = [];
  let i = 0;
  while (i + 1 < words.length) {
    const header = words[i + 1]! >>> 0;
    const id = header & 0xffff;
    const mask = (header >>> 16) & 0xf;
    const extra = (header >>> 20) & 0x7ff;
    const consecutive = header >>> 31 === 1;
    out.push({ register: id, value: words[i]! >>> 0, mask, word: i });
    i += 2;
    for (let j = 1; j <= extra && i < words.length; j++, i++) out.push({ register: consecutive ? id + j : id, value: words[i]! >>> 0, mask, word: i });
    if (i & 1) i++;
  }
  return out;
}

const f32buf = new Float32Array(1);
const u32buf = new Uint32Array(f32buf.buffer);
export const toSingle = (v: number): number => {
  u32buf[0] = v >>> 0;
  return f32buf[0]!;
};
export const toUInt32 = (v: number): number => {
  f32buf[0] = v;
  return u32buf[0]!;
};

/** float24 (1.7.16) -> number (SPICA PICAVectorFloat24.GetFloat24). */
export function getFloat24(v: number): number {
  let f: number;
  if ((v & 0x7fffff) !== 0) f = ((v & 0xffff) << 7) | ((((v >>> 16) & 0x7f) + 64) << 23) | (((v >>> 23) & 1) << 31);
  else f = (v & 0x800000) << 8;
  return toSingle(f);
}

/** number -> float24 (SPICA GetWord24). */
export function getWord24(value: number): number {
  let w = toUInt32(value);
  if ((w & 0x7fffffff) !== 0) {
    const mantissa = w & 0x7fffff;
    const exponent = ((w >>> 23) & 0xff) - 64;
    const sign = w >>> 31;
    w = (mantissa >>> 7) | ((exponent & 0x7f) << 16) | (sign << 23);
  } else w >>>= 8;
  return w >>> 0;
}

/** The three words of a float24 vector -> x, y, z, w. */
export function vectorFromWords(w0: number, w1: number, w2: number): Vector4 {
  return [getFloat24(w2 & 0xffffff), getFloat24((w2 >>> 24) | ((w1 & 0xffff) << 8)), getFloat24((w1 >>> 16) | ((w0 & 0xff) << 16)), getFloat24(w0 >>> 8)];
}

/** x, y, z, w -> the three words of a float24 vector. */
export function wordsFromVector(v: Vector4): [number, number, number] {
  const [x, y, z, w] = v.map(getWord24) as [number, number, number, number];
  return [((w << 8) | (z >>> 16)) >>> 0, ((z << 16) | (y >>> 8)) >>> 0, ((y << 24) | x) >>> 0];
}

/** Register state of a list (SPICA PICACommandReader): last value of each register, shader uniforms, fixed attributes. */
export interface PICAState {
  regs: Map<number, number>;
  vtxUniforms: Map<number, Vector4>;
  geoUniforms: Map<number, Vector4>;
  fixed: Map<number, [number, number, number]>;
}

export function commandState(words: ArrayLike<number>): PICAState {
  const regs = new Map<number, number>();
  const fixed = new Map<number, [number, number, number]>();
  const uniforms = (): { map: Map<number, Vector4>; index: number; is32: boolean; f24: number[] } => ({ map: new Map(), index: 0, is32: false, f24: [] });
  const vsh = uniforms(), gsh = uniforms();
  let fixedIndex = 0;
  const fixedWords = [0, 0, 0];
  const setUniform = (u: ReturnType<typeof uniforms>, v: number): void => {
    const idx = (u.index >> 2) & 0x5f;
    const cur = u.map.get(idx) ?? [0, 0, 0, 0];
    u.map.set(idx, cur);
    if (u.is32) {
      cur[3 - (u.index & 3)] = toSingle(v);
      u.index++;
    } else {
      u.f24[u.index & 3] = v;
      if ((u.index & 3) === 2) {
        const vec = vectorFromWords(u.f24[0] ?? 0, u.f24[1] ?? 0, u.f24[2] ?? 0);
        for (let k = 0; k < 4; k++) cur[k] = vec[k]!;
        u.index++;
      }
      u.index++;
    }
  };
  for (const c of readCommands(words)) {
    regs.set(c.register, c.value);
    if (c.register === Reg.GPUREG_VSH_FLOATUNIFORM_INDEX) {
      vsh.index = (c.value & 0xff) << 2;
      vsh.is32 = c.value >>> 31 === 1;
    } else if (c.register >= Reg.GPUREG_VSH_FLOATUNIFORM_DATA0 && c.register <= Reg.GPUREG_VSH_FLOATUNIFORM_DATA7) setUniform(vsh, c.value);
    else if (c.register === Reg.GPUREG_GSH_FLOATUNIFORM_INDEX) {
      gsh.index = (c.value & 0xff) << 2;
      gsh.is32 = c.value >>> 31 === 1;
    } else if (c.register >= Reg.GPUREG_GSH_FLOATUNIFORM_DATA0 && c.register <= Reg.GPUREG_GSH_FLOATUNIFORM_DATA7) setUniform(gsh, c.value);
    else if (c.register === Reg.GPUREG_FIXEDATTRIB_INDEX) fixedIndex = c.value & 0xf;
    else if (c.register >= Reg.GPUREG_FIXEDATTRIB_DATA0 && c.register <= Reg.GPUREG_FIXEDATTRIB_DATA2) {
      fixedWords[c.register - Reg.GPUREG_FIXEDATTRIB_DATA0] = c.value;
      if (c.register === Reg.GPUREG_FIXEDATTRIB_DATA2) fixed.set(fixedIndex, [fixedWords[0]!, fixedWords[1]!, fixedWords[2]!]);
    }
  }
  return { regs, vtxUniforms: vsh.map, geoUniforms: gsh.map, fixed };
}

/** SPICA PICACommandWriter. */
export class PICACommandWriter {
  readonly words: number[] = [];

  get index(): number {
    return this.words.length;
  }

  setCommand(register: number, param: number, mask = 0xf): void {
    this.words.push(param >>> 0, (register | (mask << 16)) >>> 0);
  }

  /** Several parameters: consecutive registers, or the same register repeatedly. */
  setCommands(register: number, consecutive: boolean, mask: number, params: number[]): void {
    this.words.push(params[0]! >>> 0, (register | (mask << 16) | (((params.length - 1) & 0x7ff) << 20) | (consecutive ? 0x80000000 : 0)) >>> 0);
    for (let i = 1; i < params.length; i++) this.words.push(params[i]! >>> 0);
    if (this.words.length & 1) this.words.push(0);
  }

  /** Bits as a 1-masked command (SPICA SetCommand(Register, params bool[])). */
  setBits(register: number, ...bits: boolean[]): void {
    let v = 0;
    bits.forEach((b, i) => {
      if (b) v |= 1 << i;
    });
    this.setCommand(register, v, 1);
  }

  writeEnd(): void {
    if ((this.index & 3) === 0) this.setCommand(Reg.GPUREG_DUMMY, 0, 0);
    this.setCommand(Reg.GPUREG_CMDBUF_JUMP1, 1);
  }

  buffer(): Uint32Array {
    return Uint32Array.from(this.words);
  }
}
