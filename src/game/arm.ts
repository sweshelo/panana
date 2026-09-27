// A small interpreter for the game's ARM (A32, ARMv6K) code, to run code.bin functions with chosen inputs and see
// what they do: which class an event script builds (game/scripts.ts), what an appearance condition reads
// (game/conditions.ts). docs/event-list.md §3.
//
// Only the integer instructions are executed. VFP instructions are skipped (their writeback to sp is kept, a VFP
// compare leaves the flags as "greater", moves to core registers give 0). Memory that was never written reads from
// code.bin (base 0x100000) or 0. Calls are followed up to `maxDepth` levels; deeper calls, stubbed functions and
// calls to addresses outside .text return 0 at once. BLX #imm (into the Thumb helpers near 0x33BBF8) keeps r0.
import { BASE } from './codeconst';

/** End of the executable mapping: .text (to 0x4BF01C) and the code cave after it. */
export const TEXT_END = 0x4c0000;
/** Return address of the outermost call: reaching it ends the run. */
const RET = 0xdead0000;

export class ArmStop extends Error {}

/** False for words with condition 0xF that are not BLX #imm, PLD or a barrier (data, or code of another mode). */
const decodable = (w: number): boolean =>
  w >>> 28 !== 0xf || (w & 0x0e000000) === 0x0a000000 || (w & 0xfd70f000) >>> 0 === 0xf550f000 || (w & 0xffffff00) >>> 0 === 0xf57ff000;

export interface ArmCall {
  depth: number;
  target: number;
  args: [number, number, number, number];
}

export type Stub = (m: ArmMachine) => number;

export interface ArmOptions {
  stubs?: Map<number, Stub>;
  maxDepth?: number;
  maxSteps?: number;
}

const ror = (v: number, n: number): number => (n & 31 ? ((v >>> (n & 31)) | (v << (32 - (n & 31)))) >>> 0 : v >>> 0);

export class ArmMachine {
  readonly r = new Uint32Array(16);
  n = false;
  z = false;
  c = false;
  v = false;
  depth = 0;
  readonly calls: ArmCall[] = [];
  /** 32-bit stores in order: [address, value]. */
  readonly writes: [number, number][] = [];
  private readonly mem = new Map<number, number>();
  private heap = 0x30000000;
  private frames: { ret: number; saved: Uint32Array }[] = [];
  private readonly stubs: Map<number, Stub>;
  private readonly maxDepth: number;
  private readonly maxSteps: number;

  constructor(
    readonly code: Uint8Array,
    opts: ArmOptions = {},
  ) {
    this.stubs = opts.stubs ?? new Map();
    this.maxDepth = opts.maxDepth ?? 4;
    this.maxSteps = opts.maxSteps ?? 400000;
  }

  // ---- memory
  rb(a: number): number {
    a >>>= 0;
    const v = this.mem.get(a);
    if (v !== undefined) return v;
    const o = a - BASE;
    return o >= 0 && o < this.code.length ? this.code[o]! : 0;
  }
  wb(a: number, v: number): void {
    this.mem.set(a >>> 0, v & 0xff);
  }
  read(a: number, n: number): number {
    let v = 0;
    for (let k = n - 1; k >= 0; k--) v = v * 256 + this.rb(a + k);
    return v >>> 0;
  }
  write(a: number, v: number, n: number): void {
    for (let k = 0; k < n; k++) this.wb(a + k, v >>> (8 * k));
    if (n === 4) this.writes.push([a >>> 0, v >>> 0]);
  }
  alloc(size: number): number {
    const p = this.heap;
    this.heap += (size + 0xf) & ~0xf;
    return p;
  }
  private word(a: number): number | null {
    const o = a - BASE;
    if (o < 0 || a >= TEXT_END || o + 4 > this.code.length) return null;
    return (this.code[o]! | (this.code[o + 1]! << 8) | (this.code[o + 2]! << 16) | (this.code[o + 3]! << 24)) >>> 0;
  }

  // ---- flags
  private cond(cc: number): boolean {
    const { n, z, c, v } = this;
    switch (cc) {
      case 0: return z;
      case 1: return !z;
      case 2: return c;
      case 3: return !c;
      case 4: return n;
      case 5: return !n;
      case 6: return v;
      case 7: return !v;
      case 8: return c && !z;
      case 9: return !c || z;
      case 10: return n === v;
      case 11: return n !== v;
      case 12: return !z && n === v;
      case 13: return z || n !== v;
      default: return true;
    }
  }
  private nz(v: number): void {
    this.n = (v & 0x80000000) !== 0;
    this.z = v >>> 0 === 0;
  }
  private reg(i: number, pc: number): number {
    return i === 15 ? (pc + 8) >>> 0 : this.r[i]!;
  }

  /** Shifted register operand (bits 11-0 of a data-processing or load/store instruction): [value, carry out]. */
  private shifted(w: number, pc: number, allowReg: boolean): [number, boolean] {
    const rm = this.reg(w & 15, pc);
    const type = (w >>> 5) & 3;
    let amt: number;
    if (allowReg && w & 0x10) {
      amt = this.r[(w >>> 8) & 15]! & 0xff;
      if (amt === 0) return [rm, this.c];
    } else {
      amt = (w >>> 7) & 31;
      if (amt === 0) {
        if (type === 0) return [rm, this.c];
        if (type === 3) return [((rm >>> 1) | (this.c ? 0x80000000 : 0)) >>> 0, (rm & 1) !== 0]; // RRX
        amt = 32; // LSR / ASR #32
      }
    }
    switch (type) {
      case 0:
        return amt < 32 ? [(rm << amt) >>> 0, ((rm >>> (32 - amt)) & 1) !== 0] : [0, amt === 32 && (rm & 1) !== 0];
      case 1:
        return amt < 32 ? [rm >>> amt, ((rm >>> (amt - 1)) & 1) !== 0] : [0, amt === 32 && (rm & 0x80000000) !== 0];
      case 2:
        return amt < 32 ? [(rm >> amt) >>> 0, ((rm >> (amt - 1)) & 1) !== 0] : [rm & 0x80000000 ? 0xffffffff : 0, (rm & 0x80000000) !== 0];
      default: {
        const v = ror(rm, amt);
        return [v, (v & 0x80000000) !== 0];
      }
    }
  }

  private call(target: number, ret: number): number {
    const r = this.r;
    this.calls.push({ depth: this.depth, target, args: [r[0]!, r[1]!, r[2]!, r[3]!] });
    const stub = this.stubs.get(target);
    if (stub) {
      r[0] = stub(this) >>> 0;
      return ret;
    }
    const first = this.word(target);
    if (this.depth >= this.maxDepth || first === null || !decodable(first)) {
      r[0] = 0;
      return ret;
    }
    r[14] = ret;
    this.depth++;
    this.frames.push({ ret, saved: r.slice(4, 14) });
    return target;
  }

  /** Run the function at `entry` with r0-r3 = args; returns r0. Throws ArmStop when it gets lost. */
  run(entry: number, args: number[] = [], sp = 0x0f000000): number {
    const r = this.r;
    r.fill(0);
    args.forEach((a, k) => (r[k] = a >>> 0));
    r[13] = sp;
    r[14] = RET;
    this.frames = [];
    this.depth = 0;
    let pc = entry >>> 0;
    for (let step = 0; step < this.maxSteps; step++) {
      if (pc === RET) return r[0]!;
      const stub = this.stubs.get(pc);
      if (stub) {
        // reached by a tail call (b): run the stub and return
        this.calls.push({ depth: this.depth, target: pc, args: [r[0]!, r[1]!, r[2]!, r[3]!] });
        r[0] = stub(this) >>> 0;
        pc = r[14]!;
        continue;
      }
      const top = this.frames[this.frames.length - 1];
      if (top && pc === top.ret) {
        r.set(top.saved, 4);
        this.frames.pop();
        this.depth--;
      }
      const w = this.word(pc);
      if (w === null || !decodable(w)) {
        // lost inside a callee (a virtual call on a made-up object, or data): give up on that call
        const f = this.frames[this.frames.length - 1];
        if (!f) throw new ArmStop(`no code at ${pc.toString(16)}`);
        r[0] = 0;
        pc = f.ret;
        continue;
      }
      const next = this.step(w, pc);
      pc = next === null ? pc + 4 : next >>> 0;
    }
    throw new ArmStop('step limit');
  }

  /** Execute one instruction; returns the new pc, or null to go on to the next one. */
  private step(w: number, pc: number): number | null {
    const r = this.r;
    const cc = w >>> 28;
    if (cc === 0xf) {
      if ((w & 0x0e000000) === 0x0a000000) {
        // BLX #imm: into the Thumb helpers (array constructors and the like, which return their first argument).
        // They are not run; r0 is kept.
        r[14] = pc + 4;
        this.calls.push({ depth: this.depth, target: 0, args: [r[0]!, r[1]!, r[2]!, r[3]!] });
      }
      return null; // pld, clrex, dmb ...
    }
    if (!this.cond(cc)) return null;
    const op = (w >>> 25) & 7;
    const rn = (w >>> 16) & 15;
    const rd = (w >>> 12) & 15;

    if (op === 5) {
      // B / BL
      let off = w & 0xffffff;
      if (off & 0x800000) off -= 0x1000000;
      const t = (pc + 8 + off * 4) >>> 0;
      return w & 0x01000000 ? this.call(t, pc + 4) : t;
    }
    if (op === 4) return this.blockTransfer(w, pc);
    if (op === 6 || op === 7) return this.coprocessor(w);
    if (op === 2 || op === 3) {
      if (op === 3 && w & 0x10) return this.media(w, pc);
      // LDR / STR / LDRB / STRB
      const P = (w >>> 24) & 1, U = (w >>> 23) & 1, B = (w >>> 22) & 1, W = (w >>> 21) & 1, L = (w >>> 20) & 1;
      const off = op === 2 ? w & 0xfff : this.shifted(w, pc, false)[0];
      const base = this.reg(rn, pc);
      const moved = (U ? base + off : base - off) >>> 0;
      const ea = P ? moved : base;
      if (L) {
        const v = B ? this.rb(ea) : this.read(ea, 4);
        if (!P || W) r[rn] = moved;
        if (rd === 15) return v;
        r[rd] = v;
      } else {
        this.write(ea, this.reg(rd, pc), B ? 1 : 4);
        if (!P || W) r[rn] = moved;
      }
      return null;
    }
    // op 0 / 1: data processing, multiply, extra load/store, misc
    if (op === 0 && (w & 0x90) === 0x90) {
      if ((w & 0x60) === 0) return this.multiply(w, pc);
      return this.extraLoadStore(w, pc);
    }
    if (op === 0 && (w & 0x01900000) === 0x01000000) {
      // misc: BX / BLX reg / CLZ / MRS / MSR
      if ((w & 0x0ffffff0) === 0x012fff10) return this.reg(w & 15, pc);
      if ((w & 0x0ffffff0) === 0x012fff30) return this.call(this.reg(w & 15, pc), pc + 4);
      if ((w & 0x0fff0ff0) === 0x016f0f10) {
        const v = this.reg(w & 15, pc);
        r[rd] = v === 0 ? 32 : Math.clz32(v);
      }
      return null;
    }
    if (op === 1 && (w & 0x01b00000) === 0x01000000) {
      // MOVW / MOVT (not in ARMv6K, kept for safety)
      const imm = ((w >>> 4) & 0xf000) | (w & 0xfff);
      r[rd] = w & 0x00400000 ? ((r[rd]! & 0xffff) | (imm << 16)) >>> 0 : imm;
      return null;
    }
    if (op === 1 && (w & 0x01b00000) === 0x01200000) return null; // MSR imm / hints (nop)
    return this.dataProcessing(w, pc);
  }

  private dataProcessing(w: number, pc: number): number | null {
    const r = this.r;
    const opc = (w >>> 21) & 15;
    const S = (w >>> 20) & 1;
    const rn = (w >>> 16) & 15;
    const rd = (w >>> 12) & 15;
    let b: number, sc: boolean;
    if (w & 0x02000000) {
      const rot = ((w >>> 8) & 15) * 2;
      b = ror(w & 0xff, rot);
      sc = rot ? (b & 0x80000000) !== 0 : this.c;
    } else [b, sc] = this.shifted(w, pc, true);
    const a = this.reg(rn, pc);
    let res: number;
    let logical = true;
    let carry = sc, over = this.v;
    const add = (x: number, y: number, cin: number): number => {
      const s = x + y + cin;
      carry = s > 0xffffffff;
      const v = s >>> 0;
      over = ((~(x ^ y) & (x ^ v)) & 0x80000000) !== 0;
      logical = false;
      return v;
    };
    const sub = (x: number, y: number, cin: number): number => add(x, ~y >>> 0, cin);
    switch (opc) {
      case 0: res = (a & b) >>> 0; break;
      case 1: res = (a ^ b) >>> 0; break;
      case 2: res = sub(a, b, 1); break;
      case 3: res = sub(b, a, 1); break;
      case 4: res = add(a, b, 0); break;
      case 5: res = add(a, b, this.c ? 1 : 0); break;
      case 6: res = sub(a, b, this.c ? 1 : 0); break;
      case 7: res = sub(b, a, this.c ? 1 : 0); break;
      case 8: res = (a & b) >>> 0; break;
      case 9: res = (a ^ b) >>> 0; break;
      case 10: res = sub(a, b, 1); break;
      case 11: res = add(a, b, 0); break;
      case 12: res = (a | b) >>> 0; break;
      case 13: res = b; break;
      case 14: res = (a & ~b) >>> 0; break;
      default: res = ~b >>> 0; break;
    }
    if (S && rd !== 15) {
      this.nz(res);
      this.c = carry;
      if (!logical) this.v = over;
    }
    if (opc >= 8 && opc <= 11) return null; // TST / TEQ / CMP / CMN
    if (rd === 15) return res;
    r[rd] = res;
    return null;
  }

  private multiply(w: number, pc: number): number | null {
    const r = this.r;
    const rdHi = (w >>> 16) & 15, rdLo = (w >>> 12) & 15;
    const rs = this.reg((w >>> 8) & 15, pc), rm = this.reg(w & 15, pc);
    const S = (w >>> 20) & 1;
    if ((w & 0x0f800000) === 0x00800000) {
      // UMULL / UMLAL / SMULL / SMLAL
      const signed = (w & 0x00400000) !== 0;
      let p = signed ? BigInt(rm | 0) * BigInt(rs | 0) : BigInt(rm) * BigInt(rs);
      if (w & 0x00200000) p += (BigInt(r[rdHi]!) << 32n) | BigInt(r[rdLo]!);
      p = BigInt.asUintN(64, p);
      r[rdLo] = Number(p & 0xffffffffn);
      r[rdHi] = Number(p >> 32n);
      if (S) {
        this.n = (r[rdHi]! & 0x80000000) !== 0;
        this.z = p === 0n;
      }
      return null;
    }
    // MUL / MLA / MLS
    let v = Math.imul(rm, rs);
    if ((w & 0x0ff000f0) === 0x00600090) v = this.reg(rdLo, pc) - v;
    else if (w & 0x00200000) v += this.reg(rdLo, pc);
    r[rdHi] = v >>> 0;
    if (S) this.nz(v >>> 0);
    return null;
  }

  private extraLoadStore(w: number, pc: number): number | null {
    const r = this.r;
    const P = (w >>> 24) & 1, U = (w >>> 23) & 1, I = (w >>> 22) & 1, W = (w >>> 21) & 1, L = (w >>> 20) & 1;
    const rn = (w >>> 16) & 15, rd = (w >>> 12) & 15;
    const sh = (w >>> 5) & 3;
    const off = I ? ((w >>> 4) & 0xf0) | (w & 15) : this.reg(w & 15, pc);
    const base = this.reg(rn, pc);
    const moved = (U ? base + off : base - off) >>> 0;
    const ea = P ? moved : base;
    if (L) {
      if (sh === 1) r[rd] = this.read(ea, 2);
      else if (sh === 2) r[rd] = ((this.rb(ea) << 24) >> 24) >>> 0;
      else r[rd] = ((this.read(ea, 2) << 16) >> 16) >>> 0;
    } else if (sh === 1) this.write(ea, this.reg(rd, pc), 2);
    else if (sh === 2) {
      // LDRD
      r[rd] = this.read(ea, 4);
      r[rd + 1] = this.read(ea + 4, 4);
    } else {
      // STRD
      this.write(ea, this.reg(rd, pc), 4);
      this.write(ea + 4, this.reg(rd + 1, pc), 4);
    }
    if (!P || W) r[rn] = moved;
    return null;
  }

  private blockTransfer(w: number, pc: number): number | null {
    const r = this.r;
    const P = (w >>> 24) & 1, U = (w >>> 23) & 1, W = (w >>> 21) & 1, L = (w >>> 20) & 1;
    const rn = (w >>> 16) & 15;
    const list: number[] = [];
    for (let k = 0; k < 16; k++) if (w & (1 << k)) list.push(k);
    const base = r[rn]!;
    const n = list.length * 4;
    let a = U ? (P ? base + 4 : base) : P ? base - n : base - n + 4;
    let npc: number | null = null;
    for (const k of list) {
      if (L) {
        const v = this.read(a, 4);
        if (k === 15) npc = v;
        else r[k] = v;
      } else this.write(a, this.reg(k, pc), 4);
      a += 4;
    }
    if (W && !(L && list.includes(rn))) r[rn] = (U ? base + n : base - n) >>> 0;
    return npc;
  }

  /** VFP: only what moves sp or core registers matters. */
  private coprocessor(w: number): number | null {
    const r = this.r;
    const op = (w >>> 25) & 7;
    if (op === 6) {
      if ((w & 0x0fe00000) === 0x0c400000) {
        // VMOV two core registers <-> d / s pair
        if (w & 0x00100000) {
          r[(w >>> 12) & 15] = 0;
          r[(w >>> 16) & 15] = 0;
        }
        return null;
      }
      // VLDM / VSTM / VPUSH / VPOP / VLDR / VSTR: writeback of the base
      if (w & 0x00200000) {
        const rn = (w >>> 16) & 15;
        const n = (w & 0xff) * 4;
        r[rn] = (w & 0x00800000 ? r[rn]! + n : r[rn]! - n) >>> 0;
      }
      return null;
    }
    if ((w & 0x0fff0fff) === 0x0ef10a10) {
      // VMRS APSR_nzcv, fpscr: say "greater"
      if (((w >>> 12) & 15) === 15) {
        this.n = false;
        this.z = false;
        this.c = true;
        this.v = false;
      } else r[(w >>> 12) & 15] = 0;
      return null;
    }
    if ((w & 0x0f100f10) === 0x0e100a10) r[(w >>> 12) & 15] = 0; // VMOV core <- s
    return null;
  }

  /** Media instructions: the extends (UXTB / UXTH / SXTB / SXTH and the add forms), UBFX / SBFX. */
  private media(w: number, pc: number): number | null {
    const r = this.r;
    const rd = (w >>> 12) & 15, rn = (w >>> 16) & 15;
    if ((w & 0x0f8000f0) === 0x06800070) {
      const v = ror(this.reg(w & 15, pc), ((w >>> 10) & 3) * 8);
      let x: number;
      switch ((w >>> 20) & 7) {
        case 2: x = (v << 24) >> 24; break; // SXTB
        case 3: x = (v << 16) >> 16; break; // SXTH
        case 6: x = v & 0xff; break; // UXTB
        case 7: x = v & 0xffff; break; // UXTH
        default: x = v; break;
      }
      r[rd] = (rn === 15 ? x : this.reg(rn, pc) + x) >>> 0;
      return null;
    }
    if ((w & 0x0fa00070) === 0x07a00050) {
      const lsb = (w >>> 7) & 31, width = ((w >>> 16) & 31) + 1;
      const v = this.reg(w & 15, pc) >>> lsb;
      const mask = width >= 32 ? 0xffffffff : (1 << width) - 1;
      let x = v & mask;
      if (!(w & 0x00400000) && width < 32 && x & (1 << (width - 1))) x -= 1 << width; // SBFX
      r[rd] = x >>> 0;
    }
    return null;
  }
}
