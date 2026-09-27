// ARM (A32, ARMv6K + VFPv2) disassembler for code.bin, in the GNU / capstone style ("ldr r0, [pc, #0x20]").
// Used to show what an event script does (game/scriptasm.ts); the same instruction set that game/arm.ts runs.
const COND = ['eq', 'ne', 'hs', 'lo', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le', '', ''];
const REG = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'sb', 'sl', 'fp', 'ip', 'sp', 'lr', 'pc'];
const DP = ['and', 'eor', 'sub', 'rsb', 'add', 'adc', 'sbc', 'rsc', 'tst', 'teq', 'cmp', 'cmn', 'orr', 'mov', 'bic', 'mvn'];
const SHIFT = ['lsl', 'lsr', 'asr', 'ror'];

const hex = (v: number): string => (v < 10 ? String(v) : `0x${v.toString(16)}`);
const imm = (v: number): string => `#${v < 0 ? '-' + hex(-v) : hex(v)}`;
const ror = (v: number, n: number): number => (n ? ((v >>> n) | (v << (32 - n))) >>> 0 : v);

export interface Insn {
  addr: number;
  word: number;
  text: string;
  /** Branch / call target. */
  target?: number;
  call?: boolean;
  /** Address of the literal-pool word a `ldr rX, [pc, #n]` reads. */
  literal?: number;
}

function regList(mask: number): string {
  const out: string[] = [];
  for (let k = 0; k < 16; k++) if (mask & (1 << k)) out.push(REG[k]!);
  return `{${out.join(', ')}}`;
}

function shifted(w: number): string {
  const rm = REG[w & 15]!;
  const type = (w >>> 5) & 3;
  if (w & 0x10) return `${rm}, ${SHIFT[type]} ${REG[(w >>> 8) & 15]}`;
  const amt = (w >>> 7) & 31;
  if (amt === 0) return type === 0 ? rm : type === 3 ? `${rm}, rrx` : `${rm}, ${SHIFT[type]} #32`;
  return `${rm}, ${SHIFT[type]} #${amt}`;
}

const sreg = (n: number): string => `s${n}`;
const dreg = (n: number): string => `d${n}`;

/** VFP register numbers: single = Vd:D, double = D:Vd. */
const vd = (w: number, dbl: boolean): string => (dbl ? dreg((((w >>> 22) & 1) << 4) | ((w >>> 12) & 15)) : sreg((((w >>> 12) & 15) << 1) | ((w >>> 22) & 1)));
const vn = (w: number, dbl: boolean): string => (dbl ? dreg((((w >>> 7) & 1) << 4) | ((w >>> 16) & 15)) : sreg((((w >>> 16) & 15) << 1) | ((w >>> 7) & 1)));
const vm = (w: number, dbl: boolean): string => (dbl ? dreg((((w >>> 5) & 1) << 4) | (w & 15)) : sreg(((w & 15) << 1) | ((w >>> 5) & 1)));

export function disassemble(w: number, addr: number): Insn {
  const cc = COND[w >>> 28]!;
  const out = (text: string, extra: Partial<Insn> = {}): Insn => ({ addr, word: w, text, ...extra });
  const bad = out('.word ' + `0x${w.toString(16).padStart(8, '0')}`);
  if (w >>> 28 === 0xf) {
    if ((w & 0x0e000000) === 0x0a000000) {
      let off = w & 0xffffff;
      if (off & 0x800000) off -= 0x1000000;
      const t = (addr + 8 + off * 4 + ((w >>> 23) & 2)) >>> 0;
      return out(`blx #${hex(t)}`, { target: t, call: true });
    }
    if ((w & 0xfd70f000) >>> 0 === 0xf550f000) return out(`pld [${REG[(w >>> 16) & 15]}, #${w & 0x800000 ? '' : '-'}${hex(w & 0xfff)}]`);
    return bad;
  }
  const op = (w >>> 25) & 7;
  const rn = REG[(w >>> 16) & 15]!;
  const rd = REG[(w >>> 12) & 15]!;
  if (op === 5) {
    let off = w & 0xffffff;
    if (off & 0x800000) off -= 0x1000000;
    const t = (addr + 8 + off * 4) >>> 0;
    const link = (w & 0x01000000) !== 0;
    return out(`b${link ? 'l' : ''}${cc} #${hex(t)}`, { target: t, call: link });
  }
  if (op === 4) {
    const P = (w >>> 24) & 1, U = (w >>> 23) & 1, S = (w >>> 22) & 1, W = (w >>> 21) & 1, L = (w >>> 20) & 1;
    const list = regList(w & 0xffff);
    if (((w >>> 16) & 15) === 13 && W && !S) {
      if (L && !P && U) return out(`pop${cc} ${list}`);
      if (!L && P && !U) return out(`push${cc} ${list}`);
    }
    const mode = (U ? 'i' : 'd') + (P ? 'b' : 'a');
    return out(`${L ? 'ldm' : 'stm'}${mode === 'ia' ? '' : mode}${cc} ${rn}${W ? '!' : ''}, ${list}${S ? ' ^' : ''}`);
  }
  if (op === 7 && w & 0x01000000) return out(`svc${cc} #${hex(w & 0xffffff)}`);
  if (op === 6 || op === 7) return vfp(w, cc, out) ?? bad;
  if (op === 2 || op === 3) {
    if (op === 3 && w & 0x10) return media(w, cc, out) ?? bad;
    const P = (w >>> 24) & 1, U = (w >>> 23) & 1, B = (w >>> 22) & 1, W = (w >>> 21) & 1, L = (w >>> 20) & 1;
    if ((w & 0x0fff0fff) === 0x049d0004) return out(`pop${cc} {${rd}}`);
    if ((w & 0x0fff0fff) === 0x052d0004) return out(`push${cc} {${rd}}`);
    const mn = `${L ? 'ldr' : 'str'}${B ? 'b' : ''}${!P && W ? 't' : ''}${cc}`;
    let off: string;
    let literal: number | undefined;
    if (op === 2) {
      const v = w & 0xfff;
      off = v || !U ? `, #${U ? '' : '-'}${hex(v)}` : '';
      if (((w >>> 16) & 15) === 15 && P) literal = (addr + 8 + (U ? v : -v)) >>> 0;
    } else off = `, ${U ? '' : '-'}${shifted(w & ~0x10)}`;
    const m = P ? `[${rn}${off}]${W ? '!' : ''}` : `[${rn}]${off}`;
    return out(`${mn} ${rd}, ${m}`, literal !== undefined ? { literal } : {});
  }
  // op 0 / 1
  if (op === 0 && (w & 0x90) === 0x90) {
    if ((w & 0x60) === 0) {
      const S = w & 0x100000 ? 's' : '';
      const rdH = REG[(w >>> 16) & 15], rdL = REG[(w >>> 12) & 15], rs = REG[(w >>> 8) & 15], rm = REG[w & 15];
      if ((w & 0x0f800000) === 0x00800000) {
        const mn = ['umull', 'umlal', 'smull', 'smlal'][(w >>> 21) & 3];
        return out(`${mn}${S}${cc} ${rdL}, ${rdH}, ${rm}, ${rs}`);
      }
      if ((w & 0x0ff000f0) === 0x00600090) return out(`mls${cc} ${rdH}, ${rm}, ${rs}, ${rdL}`);
      if ((w & 0x0ff000f0) === 0x00400090) return out(`umaal${cc} ${rdL}, ${rdH}, ${rm}, ${rs}`);
      if (w & 0x00200000) return out(`mla${S}${cc} ${rdH}, ${rm}, ${rs}, ${rdL}`);
      if ((w & 0x0fb00ff0) === 0x01000090) return out(`swp${w & 0x400000 ? 'b' : ''}${cc} ${rdL}, ${rm}, [${rdH}]`);
      return out(`mul${S}${cc} ${rdH}, ${rm}, ${rs}`);
    }
    const P = (w >>> 24) & 1, U = (w >>> 23) & 1, I = (w >>> 22) & 1, W = (w >>> 21) & 1, L = (w >>> 20) & 1;
    const sh = (w >>> 5) & 3;
    const tt = !P && W && L ? 't' : '';
    const mn = L ? ['', 'ldrh', 'ldrsb', 'ldrsh'][sh] + tt : ['', 'strh', 'ldrd', 'strd'][sh];
    const v = ((w >>> 4) & 0xf0) | (w & 15);
    const off = I ? (v || !U ? `, #${U ? '' : '-'}${hex(v)}` : '') : `, ${U ? '' : '-'}${REG[w & 15]}`;
    const m = P ? `[${rn}${off}]${W ? '!' : ''}` : `[${rn}]${off}`;
    const regs = sh >= 2 && !L ? `${rd}, ${REG[((w >>> 12) & 15) + 1]}` : rd;
    const literal = I && P && ((w >>> 16) & 15) === 15 && L ? (addr + 8 + (U ? v : -v)) >>> 0 : undefined;
    return out(`${mn}${cc} ${regs}, ${m}`, literal !== undefined ? { literal } : {});
  }
  if (op === 0 && (w & 0x01900000) === 0x01000000) {
    if ((w & 0x0ffffff0) === 0x012fff10) return out(`bx${cc} ${REG[w & 15]}`);
    if ((w & 0x0ffffff0) === 0x012fff30) return out(`blx${cc} ${REG[w & 15]}`, { call: true });
    if ((w & 0x0fff0ff0) === 0x016f0f10) return out(`clz${cc} ${rd}, ${REG[w & 15]}`);
    if ((w & 0x0fbf0fff) === 0x010f0000) return out(`mrs${cc} ${rd}, ${w & 0x400000 ? 'spsr' : 'apsr'}`);
    if ((w & 0x90) === 0x80) {
      // signed halfword multiplies: SMLAxy / SMLAWy / SMULWy / SMLALxy / SMULxy
      const xy = `${w & 0x20 ? 't' : 'b'}${w & 0x40 ? 't' : 'b'}`;
      const d = REG[(w >>> 16) & 15], a = REG[(w >>> 12) & 15], m = REG[w & 15], sr = REG[(w >>> 8) & 15];
      switch ((w >>> 21) & 3) {
        case 0: return out(`smla${xy}${cc} ${d}, ${m}, ${sr}, ${a}`);
        case 1: return out(w & 0x20 ? `smulw${w & 0x40 ? 't' : 'b'}${cc} ${d}, ${m}, ${sr}` : `smlaw${w & 0x40 ? 't' : 'b'}${cc} ${d}, ${m}, ${sr}, ${a}`);
        case 2: return out(`smlal${xy}${cc} ${a}, ${d}, ${m}, ${sr}`);
        default: return out(`smul${xy}${cc} ${d}, ${m}, ${sr}`);
      }
    }
    return bad;
  }
  if (op === 1 && (w & 0x01b00000) === 0x01000000) {
    const v = ((w >>> 4) & 0xf000) | (w & 0xfff);
    return out(`${w & 0x400000 ? 'movt' : 'movw'}${cc} ${rd}, #${hex(v)}`);
  }
  if (op === 1 && (w & 0x01b00000) === 0x01200000) {
    if ((w & 0x0fffffff) === 0x0320f000) return out(`nop${cc}`);
    return out(`msr${cc} ...`);
  }
  // data processing
  const opc = (w >>> 21) & 15;
  const S = (w >>> 20) & 1;
  let op2: string;
  let value: number | undefined;
  if (w & 0x02000000) {
    value = ror(w & 0xff, ((w >>> 8) & 15) * 2);
    op2 = `#${hex(value)}`;
  } else op2 = shifted(w);
  const mn = `${DP[opc]}${S && (opc < 8 || opc > 11) ? 's' : ''}${cc}`;
  if (opc >= 8 && opc <= 11) return out(`${mn} ${rn}, ${op2}`);
  if (opc === 13 || opc === 15) {
    // mov with a shift is written as the shift ("lsl r0, r1, #2")
    if (opc === 13 && !(w & 0x02000000) && (w & 0xff0) !== 0) {
      const type = (w >>> 5) & 3;
      const amt = w & 0x10 ? REG[(w >>> 8) & 15] : `#${hex((w >>> 7) & 31 || (type ? 32 : 0))}`;
      if (!(type === 3 && !(w & 0x10) && ((w >>> 7) & 31) === 0)) return out(`${SHIFT[type]}${S ? 's' : ''}${cc} ${rd}, ${REG[w & 15]}, ${amt}`);
    }
    return out(`${mn} ${rd}, ${op2}`);
  }
  // add rX, pc, #n: an address
  if (value !== undefined && ((w >>> 16) & 15) === 15 && (opc === 4 || opc === 2)) {
    const t = (addr + 8 + (opc === 4 ? value : -value)) >>> 0;
    return out(`adr${cc} ${rd}, #${hex(t)}`, { literal: undefined });
  }
  return out(`${mn} ${rd}, ${rn}, ${op2}`);
}

function media(w: number, cc: string, out: (t: string) => Insn): Insn | null {
  const rd = REG[(w >>> 12) & 15]!, rn = (w >>> 16) & 15, rm = REG[w & 15]!;
  if ((w & 0x0f8000f0) === 0x06800070) {
    const rot = (w >>> 10) & 3;
    const names: Record<number, string> = { 2: 'sxtb', 3: 'sxth', 6: 'uxtb', 7: 'uxth' };
    const base = names[(w >>> 20) & 7];
    if (!base) return null;
    const r = rot ? `, ror #${rot * 8}` : '';
    return rn === 15 ? out(`${base}${cc} ${rd}, ${rm}${r}`) : out(`${base.slice(0, 3)}a${base.slice(3)}${cc} ${rd}, ${REG[rn]}, ${rm}${r}`);
  }
  if ((w & 0x0fa00070) === 0x07a00050) {
    const lsb = (w >>> 7) & 31, width = ((w >>> 16) & 31) + 1;
    return out(`${w & 0x400000 ? 'ubfx' : 'sbfx'}${cc} ${rd}, ${rm}, #${lsb}, #${width}`);
  }
  if ((w & 0x0ff000f0) === 0x06bf0f30) return out(`rev${cc} ${rd}, ${rm}`);
  if ((w & 0x0fa00030) === 0x06a00010) {
    const sat = ((w >>> 16) & 31) + (w & 0x400000 ? 0 : 1);
    const amt = (w >>> 7) & 31;
    const sh = amt ? `, ${w & 0x40 ? 'asr' : 'lsl'} #${hex(amt)}` : '';
    return out(`${w & 0x400000 ? 'usat' : 'ssat'}${cc} ${rd}, #${sat}, ${rm}${sh}`);
  }
  if ((w & 0x0ff00030) === 0x06800010) {
    const amt = (w >>> 7) & 31;
    const tb = w & 0x40;
    const sh = amt || tb ? `, ${tb ? 'asr' : 'lsl'} #${hex(amt || 32)}` : '';
    return out(`${tb ? 'pkhtb' : 'pkhbt'}${cc} ${rd}, ${REG[rn]}, ${rm}${sh}`);
  }
  return null;
}

function vfp(w: number, cc: string, out: (t: string) => Insn): Insn | null {
  const cp = (w >>> 8) & 15;
  if (cp !== 10 && cp !== 11) return null;
  const dbl = cp === 11;
  const t = dbl ? 'f64' : 'f32';
  const rn = REG[(w >>> 16) & 15]!;
  const rt = REG[(w >>> 12) & 15]!;
  if (((w >>> 25) & 7) === 6) {
    if ((w & 0x0fe00000) === 0x0c400000) {
      // vmov two core registers
      const L = w & 0x100000;
      const m = dbl ? vm(w, true) : `${vm(w, false)}, s${(((w & 15) << 1) | ((w >>> 5) & 1)) + 1}`;
      return out(L ? `vmov${cc} ${rt}, ${rn}, ${m}` : `vmov${cc} ${m}, ${rt}, ${rn}`);
    }
    const P = (w >>> 24) & 1, U = (w >>> 23) & 1, W = (w >>> 21) & 1, L = (w >>> 20) & 1;
    const off = (w & 0xff) * 4;
    const first = vd(w, dbl);
    if (P && !W) return out(`${L ? 'vldr' : 'vstr'}${cc} ${first}, [${rn}${off ? `, #${U ? '' : '-'}${hex(off)}` : ''}]`);
    const n = dbl ? (w & 0xff) / 2 : w & 0xff;
    const num = parseInt(first.slice(1), 10);
    const list = `{${Array.from({ length: n }, (_, k) => `${first[0]}${num + k}`).join(', ')}}`;
    if (((w >>> 16) & 15) === 13 && W && P && !U && !L) return out(`vpush${cc} ${list}`);
    if (((w >>> 16) & 15) === 13 && W && !P && U && L) return out(`vpop${cc} ${list}`);
    return out(`${L ? 'vldm' : 'vstm'}${P ? 'db' : 'ia'}${cc} ${rn}${W ? '!' : ''}, ${list}`);
  }
  // op 7: data processing / transfers
  if (w & 0x10) {
    if ((w & 0x0fffffff) === 0x0ef1fa10) return out(`vmrs${cc} apsr_nzcv, fpscr`);
    if ((w & 0x0fff0fff) === 0x0ef10a10) return out(`vmrs${cc} ${rt}, fpscr`);
    if ((w & 0x0ff00f7f) === 0x0e000a10) return out(`vmov${cc} ${vn(w, false)}, ${rt}`);
    if ((w & 0x0ff00f7f) === 0x0e100a10) return out(`vmov${cc} ${rt}, ${vn(w, false)}`);
    return null;
  }
  const opc1 = (w >>> 20) & 0xb, opc3 = (w >>> 6) & 1;
  const D = vd(w, dbl), N = vn(w, dbl), M = vm(w, dbl);
  switch (opc1) {
    case 0: return out(`${opc3 ? 'vmls' : 'vmla'}${cc}.${t} ${D}, ${N}, ${M}`);
    case 2: return out(`${opc3 ? 'vnmul' : 'vmul'}${cc}.${t} ${D}, ${N}, ${M}`);
    case 3: return out(`${opc3 ? 'vsub' : 'vadd'}${cc}.${t} ${D}, ${N}, ${M}`);
    case 8: return out(`vdiv${cc}.${t} ${D}, ${N}, ${M}`);
  }
  if (opc1 === 0xb) {
    const opc2 = (w >>> 16) & 15;
    if (!opc3) {
      // vmov immediate
      const v = ((w >>> 12) & 0xf0) | (w & 15);
      return out(`vmov${cc}.${t} ${D}, #${fpImm(v)}`);
    }
    switch (opc2) {
      case 0: return out(`${(w >>> 7) & 1 ? 'vabs' : 'vmov'}${cc}.${t} ${D}, ${M}`);
      case 1: return out(`${(w >>> 7) & 1 ? 'vsqrt' : 'vneg'}${cc}.${t} ${D}, ${M}`);
      case 4: return out(`vcmp${(w >>> 7) & 1 ? 'e' : ''}${cc}.${t} ${D}, ${M}`);
      case 5: return out(`vcmp${(w >>> 7) & 1 ? 'e' : ''}${cc}.${t} ${D}, #0`);
      case 7: return out(`vcvt${cc}.${dbl ? 'f32.f64' : 'f64.f32'} ${vd(w, !dbl)}, ${M}`);
      case 8: return out(`vcvt${cc}.${t}.${(w >>> 7) & 1 ? 's32' : 'u32'} ${D}, ${vm(w, false)}`);
      case 12: case 13: return out(`vcvt${(w >>> 7) & 1 ? '' : 'r'}${cc}.${opc2 === 13 ? 's32' : 'u32'}.${t} ${vd(w, false)}, ${M}`);
    }
  }
  return null;
}

function fpImm(v: number): string {
  // VFPExpandImm: exponent NOT(b):b...b:c:d, fraction efgh
  const b = (v >>> 6) & 1, cd = (v >>> 4) & 3;
  const n = b ? cd - 3 : cd + 1;
  return String((v & 0x80 ? -1 : 1) * ((16 + (v & 15)) / 16) * 2 ** n);
}
