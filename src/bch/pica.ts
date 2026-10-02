// PICA200 command lists as BCH stores them (pairs of parameter + header words, 8-byte aligned): the register
// values and the vertex shader float uniforms they set (SPICA PICACommandReader).
import { u32 } from '../util/bytes';

export interface PicaState {
  /** Register -> first value written (one per register, like cgfx.ts picaRegs). */
  regs: Map<number, number>;
  /** Vertex shader float uniforms set by the list (index -> x, y, z, w). */
  uniforms: Map<number, [number, number, number, number]>;
  /** Fixed vertex attributes (shader input index -> x, y, z, w). */
  fixed: Map<number, number[]>;
}

const VSH_FLOATUNIFORM_INDEX = 0x2c0;
const VSH_FLOATUNIFORM_DATA0 = 0x2c1;
const VSH_FLOATUNIFORM_DATA7 = 0x2c8;
const FIXEDATTRIB_INDEX = 0x232;
const FIXEDATTRIB_DATA0 = 0x233;

/** float24 (1.7.16) -> number. */
export function float24(v: number): number {
  if ((v & 0x7fffff) === 0) return 0;
  const sign = (v >> 23) & 1;
  const exp = (v >> 16) & 0x7f;
  const mant = v & 0xffff;
  const f = new Float32Array(1);
  new Uint32Array(f.buffer)[0] = ((sign << 31) | ((exp + 64) << 23) | (mant << 7)) >>> 0;
  return f[0]!;
}

/** Three words holding four float24 (w first) -> x, y, z, w. */
function vector24(w0: number, w1: number, w2: number): number[] {
  return [float24(w2 & 0xffffff), float24((w2 >>> 24) | ((w1 & 0xffff) << 8)), float24((w1 >>> 16) | ((w0 & 0xff) << 16)), float24(w0 >>> 8)];
}

export function readPica(b: Uint8Array, o: number, words: number): PicaState {
  const regs = new Map<number, number>();
  const uniforms = new Map<number, [number, number, number, number]>();
  const fixed = new Map<number, number[]>();
  let uIndex = 0, u32bit = false, fixedIndex = 0;
  const f24: number[] = [];
  const fixedWords = [0, 0, 0];
  const write = (reg: number, v: number): void => {
    if (!regs.has(reg)) regs.set(reg, v);
    if (reg === FIXEDATTRIB_INDEX) fixedIndex = v & 0xf;
    else if (reg >= FIXEDATTRIB_DATA0 && reg <= FIXEDATTRIB_DATA0 + 2) {
      fixedWords[reg - FIXEDATTRIB_DATA0] = v;
      if (reg === FIXEDATTRIB_DATA0 + 2) fixed.set(fixedIndex, vector24(fixedWords[0]!, fixedWords[1]!, fixedWords[2]!));
    } else if (reg === VSH_FLOATUNIFORM_INDEX) {
      uIndex = (v & 0xff) << 2;
      u32bit = v >>> 31 === 1;
      f24.length = 0;
    } else if (reg >= VSH_FLOATUNIFORM_DATA0 && reg <= VSH_FLOATUNIFORM_DATA7) {
      const i = (uIndex >> 2) & 0x5f;
      const u = uniforms.get(i) ?? [0, 0, 0, 0];
      uniforms.set(i, u);
      if (u32bit) {
        // Words go w, z, y, x.
        const fv = new Float32Array(new Uint32Array([v]).buffer)[0]!;
        u[3 - (uIndex & 3)] = fv;
        uIndex++;
      } else {
        // Three words hold the four float24 components (w first).
        f24.push(v);
        if (f24.length === 3) {
          const v4 = vector24(f24[0]!, f24[1]!, f24[2]!);
          for (let k = 0; k < 4; k++) u[k] = v4[k]!;
          f24.length = 0;
          uIndex += 4;
        }
      }
    }
  };
  let i = 0;
  while (i + 1 < words) {
    let param = u32(b, o + i * 4);
    const header = u32(b, o + i * 4 + 4);
    const id = header & 0xffff;
    const extra = (header >>> 20) & 0x7ff;
    const consecutive = header >>> 31 === 1;
    i += 2;
    for (let j = 0; j <= extra; j++) {
      if (j > 0) param = u32(b, o + i++ * 4);
      write(consecutive ? id + j : id, param);
    }
    if (i & 1) i++;
  }
  return { regs, uniforms, fixed };
}
