// ARM (A32, ARMv6K + VFPv2) assembler for code patches: the inverse of game/disasm.ts, accepting its output
// ("ldr r0, [pc, #0x24]", "bl #0x31aa2c") plus labels, `ldr rX, =value` (literal pool) and `.word`.
// One instruction at a time: `assembleLine(text, addr, resolve)` -> words. Block assembly is in game/patch.ts.

const COND: Record<string, number> = { eq: 0, ne: 1, cs: 2, hs: 2, cc: 3, lo: 3, mi: 4, pl: 5, vs: 6, vc: 7, hi: 8, ls: 9, ge: 10, lt: 11, gt: 12, le: 13, al: 14 };
const REGS: Record<string, number> = { sb: 9, sl: 10, fp: 11, ip: 12, sp: 13, lr: 14, pc: 15 };
for (let i = 0; i < 16; i++) REGS[`r${i}`] = i;
const DP: Record<string, number> = { and: 0, eor: 1, sub: 2, rsb: 3, add: 4, adc: 5, sbc: 6, rsc: 7, tst: 8, teq: 9, cmp: 10, cmn: 11, orr: 12, mov: 13, bic: 14, mvn: 15 };
const SHIFT: Record<string, number> = { lsl: 0, asl: 0, lsr: 1, asr: 2, ror: 3 };

export class AsmError extends Error {}

/** Resolves a symbol (label, FUN_xxxxxxxx) to an address; undefined when unknown. */
export type Resolver = (name: string) => number | undefined;

export interface Assembled {
  words: number[];
  /** `ldr rX, =value`: the literal the pool must hold, and the index of the word to fix up. */
  literal?: { value: number | string; word: number; float?: boolean };
}

const fail = (msg: string): never => {
  throw new AsmError(msg);
};

function reg(s: string | undefined): number {
  const r = REGS[(s ?? '').trim().toLowerCase()];
  if (r === undefined) fail(`レジスタではありません: ${s}`);
  return r!;
}

function num(s: string, resolve?: Resolver): number {
  const t = s.trim().replace(/^#/, '');
  if (/^-?(0x[0-9a-f]+|\d+)$/i.test(t)) {
    const neg = t.startsWith('-');
    const v = Number(neg ? t.slice(1) : t);
    return neg ? -v : v;
  }
  const r = resolve?.(t);
  if (r === undefined) fail(`数か名前ではありません: ${s}`);
  return r!;
}

/** Split operands at top-level commas. */
function operands(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** ARM modified immediate: the 12-bit field, or null. */
export function encodeImm(v: number): number | null {
  v >>>= 0;
  for (let rot = 0; rot < 16; rot++) {
    const x = ((v << (rot * 2)) | (v >>> (32 - rot * 2))) >>> 0; // rotate left by 2*rot
    if (rot === 0 ? v <= 0xff : x <= 0xff) return (rot << 8) | (rot === 0 ? v : x);
  }
  return null;
}

/** "r1", "r1, lsl #2", "r1, lsl r2", "r1, rrx" -> bits 11-0 of a register operand. */
function shiftedReg(parts: string[], allowReg = true): number {
  const rm = reg(parts[0]);
  if (parts.length === 1) return rm;
  const sh = parts[1]!.trim().toLowerCase();
  if (sh === 'rrx') return (3 << 5) | rm;
  const m = /^(lsl|asl|lsr|asr|ror)\s+(.+)$/.exec(sh);
  if (!m) fail(`シフトが読めません: ${parts[1]}`);
  const type = SHIFT[m![1]!]!;
  const amt = m![2]!.trim();
  if (!amt.startsWith('#')) {
    if (!allowReg) fail('ここではレジスタでシフトできません');
    return (reg(amt) << 8) | (type << 5) | 0x10 | rm;
  }
  let n = num(amt);
  if (n === 32 && (type === 1 || type === 2)) n = 0;
  if (n < 0 || n > 31 || (n === 0 && type === 3)) fail(`シフト量が範囲外です: ${amt}`);
  return (n << 7) | (type << 5) | rm;
}

/** Split a mnemonic into a known base, the rest (flags and condition). */
function splitMnemonic(m: string, bases: string[]): { base: string; s: boolean; cond: number; rest: string }[] {
  const out: { base: string; s: boolean; cond: number; rest: string }[] = [];
  for (const base of bases) {
    if (!m.startsWith(base)) continue;
    let rest = m.slice(base.length);
    let s = false;
    if (rest.startsWith('s') && COND[rest.slice(1)] !== undefined && COND[rest] === undefined) {
      s = true;
      rest = rest.slice(1);
    } else if (rest === 's') {
      s = true;
      rest = '';
    }
    if (rest === '') out.push({ base, s, cond: 14, rest: '' });
    else if (COND[rest] !== undefined) out.push({ base, s, cond: COND[rest]!, rest: '' });
  }
  return out;
}

const vreg = (s: string): { n: number; dbl: boolean } => {
  const m = /^([sd])(\d+)$/i.exec(s.trim());
  if (!m) fail(`VFP のレジスタではありません: ${s}`);
  return { n: Number(m![2]), dbl: m![1]!.toLowerCase() === 'd' };
};
/** Vd / Vn / Vm fields of a VFP register. */
const vD = (r: { n: number; dbl: boolean }) => (r.dbl ? ((r.n & 15) << 12) | ((r.n >> 4) << 22) : ((r.n >> 1) << 12) | ((r.n & 1) << 22));
const vN = (r: { n: number; dbl: boolean }) => (r.dbl ? ((r.n & 15) << 16) | ((r.n >> 4) << 7) : ((r.n >> 1) << 16) | ((r.n & 1) << 7));
const vM = (r: { n: number; dbl: boolean }) => (r.dbl ? (r.n & 15) | ((r.n >> 4) << 5) : (r.n >> 1) | ((r.n & 1) << 5));

function regList(s: string): number {
  const t = s.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) fail(`レジスタの並びではありません: ${s}`);
  let mask = 0;
  for (const part of t.slice(1, -1).split(',')) {
    const [a, b] = part.split('-').map((x) => x.trim());
    const from = reg(a), to = b ? reg(b) : from;
    for (let r = from; r <= to; r++) mask |= 1 << r;
  }
  return mask;
}

/** Assemble one line at `addr`. Throws AsmError. */
export function assembleLine(line: string, addr: number, resolve?: Resolver): Assembled {
  const text = line.replace(/;.*$/, '').replace(/\/\/.*$/, '').trim();
  const sp = text.search(/\s/);
  const mn = (sp < 0 ? text : text.slice(0, sp)).toLowerCase();
  const ops = operands(sp < 0 ? '' : text.slice(sp + 1));
  const one = (w: number): Assembled => ({ words: [w >>> 0] });
  const target = (s: string): number => {
    const v = num(s, resolve) >>> 0;
    return v;
  };

  if (mn === '.word') return one(target(ops[0] ?? fail('.word に値がありません')));
  if (mn === 'nop') return one(0xe320f000);

  // ---- branches
  for (const c of splitMnemonic(mn, ['blx', 'bl', 'bx', 'b'])) {
    if (c.s) continue;
    const cc = c.cond << 28;
    if (c.base === 'bx') return one(cc | 0x012fff10 | reg(ops[0]));
    if (c.base === 'blx') {
      if (REGS[ops[0]?.toLowerCase() ?? ''] !== undefined) return one(cc | 0x012fff30 | reg(ops[0]));
      if (c.cond !== 14) fail('blx #imm に条件は付けられません');
      const t = target(ops[0]!);
      const off = t - (addr + 8);
      return one(0xfa000000 | (((off >> 1) & 1) << 24) | ((off >> 2) & 0xffffff));
    }
    const t = target(ops[0] ?? fail('分岐先がありません'));
    const off = (t - (addr + 8)) >> 2;
    if (off < -0x800000 || off > 0x7fffff) fail('分岐先が遠すぎます');
    return one(cc | (c.base === 'bl' ? 0x0b000000 : 0x0a000000) | (off & 0xffffff));
  }

  // ---- push / pop / ldm / stm
  for (const c of splitMnemonic(mn, ['push', 'pop'])) {
    if (c.s) continue;
    const mask = regList(ops.join(','));
    const cc = c.cond << 28;
    if ((mask & (mask - 1)) === 0) {
      const r = 31 - Math.clz32(mask);
      return one(cc | (c.base === 'push' ? 0x052d0004 : 0x049d0004) | (r << 12));
    }
    return one(cc | (c.base === 'push' ? 0x092d0000 : 0x08bd0000) | mask);
  }
  {
    const m = /^(ldm|stm)(ia|ib|da|db|fd|ed|fa|ea)?([a-z]{2})?$/.exec(mn);
    if (m && (m[3] === undefined || COND[m[3]] !== undefined)) {
      const L = m[1] === 'ldm';
      const mode = { fd: L ? 'ia' : 'db', ed: L ? 'ib' : 'da', fa: L ? 'da' : 'ib', ea: L ? 'db' : 'ia' }[m[2] ?? ''] ?? m[2] ?? 'ia';
      const P = mode[1] === 'b' ? 1 : 0, U = mode[0] === 'i' ? 1 : 0;
      const base = ops[0]!;
      const W = base.endsWith('!') ? 1 : 0;
      const rn = reg(base.replace('!', ''));
      let list = ops.slice(1).join(',');
      const S = list.trim().endsWith('^') ? 1 : 0;
      list = list.replace('^', '');
      return one(((m[3] ? COND[m[3]]! : 14) << 28) | 0x08000000 | (P << 24) | (U << 23) | (S << 22) | (W << 21) | ((L ? 1 : 0) << 20) | (rn << 16) | regList(list));
    }
  }

  // ---- loads and stores
  {
    const m = /^(ldr|str)(b|h|sb|sh|d)?(t)?([a-z]{2})?$/.exec(mn) ?? /^(ldr|str)(b|h|sb|sh|d)?([a-z]{2})(t)$/.exec(mn);
    if (m) {
      const L = m[1] === 'ldr';
      const size = m[2] ?? '';
      const tt = m[3] === 't' || m[4] === 't';
      const condStr = m[3] === 't' ? m[4] : m[3] !== 't' && m[3] ? m[3] : m[4] !== 't' ? m[4] : undefined;
      if (condStr !== undefined && COND[condStr] === undefined) fail(`命令が分かりません: ${mn}`);
      const cc = (condStr ? COND[condStr]! : 14) << 28;
      const rd = reg(ops[0]);
      let memIdx = 1;
      if (size === 'd' && REGS[ops[1]?.toLowerCase() ?? ''] !== undefined && !ops[1]!.startsWith('[')) memIdx = 2;
      const mem = ops[memIdx] ?? fail('アドレスがありません');
      // literal: ldr rd, =value
      if (mem.startsWith('=')) {
        if (!L || size) fail('=値 は ldr / vldr だけで使えます');
        return { words: [cc | 0x059f0000 | (rd << 12)], literal: { value: mem.slice(1).trim(), word: 0 } };
      }
      if (!mem.startsWith('[')) {
        // pc-relative to a label or address
        const t = target(mem);
        const off = t - (addr + 8);
        const U = off >= 0 ? 1 : 0;
        const a = Math.abs(off);
        if (!size) {
          if (a > 0xfff) fail('ラベルが遠すぎます (4KB まで)');
          return one(cc | 0x05000000 | (U << 23) | ((L ? 1 : 0) << 20) | (15 << 16) | (rd << 12) | a);
        }
        if (a > 0xff) fail('ラベルが遠すぎます (256 バイトまで)');
        const sh = size === 'h' ? 1 : size === 'sb' ? 2 : 3;
        return one(cc | 0x01400090 | (U << 23) | ((L ? 1 : 0) << 20) | (15 << 16) | (rd << 12) | ((a & 0xf0) << 4) | (sh << 5) | (a & 15));
      }
      const close = mem.indexOf(']');
      const inner = operands(mem.slice(1, close));
      const after = mem.slice(close + 1).trim();
      const W = after === '!' ? 1 : 0;
      const post = ops.slice(memIdx + 1);
      const P = post.length ? 0 : 1;
      const rn = reg(inner[0]);
      const offParts = post.length ? post : inner.slice(1);
      let U = 1, I = 0, field = 0;
      if (offParts.length) {
        const o = offParts[0]!;
        if (o.startsWith('#')) {
          const v = num(o);
          U = v < 0 || o.startsWith('#-') ? 0 : 1;
          field = Math.abs(v);
          I = 1;
        } else {
          U = o.startsWith('-') ? 0 : 1;
          const parts = [o.replace(/^[-+]/, ''), ...offParts.slice(1)];
          field = shiftedReg(parts, false);
        }
      } else I = 1;
      if (tt && P) fail('t の付く命令は後置きのアドレスだけです');
      if (!size || size === 'b') {
        if (I && field > 0xfff) fail('オフセットが大きすぎます (4095 まで)');
        const Bb = size === 'b' ? 1 : 0;
        return one(cc | (I ? 0x04000000 : 0x06000000) | (P << 24) | (U << 23) | (Bb << 22) | ((W || tt ? 1 : 0) << 21) | ((L ? 1 : 0) << 20) | (rn << 16) | (rd << 12) | field);
      }
      // halfword / signed / doubleword
      if (!I && field > 15) fail('この命令ではレジスタのシフトはできません');
      if (I && field > 0xff) fail('オフセットが大きすぎます (255 まで)');
      let sh: number, l = L ? 1 : 0;
      if (size === 'h') sh = 1;
      else if (size === 'sb') sh = 2;
      else if (size === 'sh') sh = 3;
      else {
        sh = L ? 2 : 3;
        l = 0;
      }
      if (!L && (size === 'sb' || size === 'sh')) fail(`命令が分かりません: ${mn}`);
      const lo = I ? ((field & 0xf0) << 4) | (field & 15) : field;
      return one(cc | (P << 24) | (U << 23) | (I << 22) | ((W || tt ? 1 : 0) << 21) | (l << 20) | (rn << 16) | (rd << 12) | 0x90 | (sh << 5) | lo);
    }
  }

  // ---- multiplies
  for (const c of splitMnemonic(mn, ['umull', 'umlal', 'smull', 'smlal', 'umaal', 'mul', 'mla', 'mls'])) {
    const cc = c.cond << 28;
    const S = c.s ? 1 << 20 : 0;
    const r = ops.map(reg);
    switch (c.base) {
      case 'mul': return one(cc | S | (r[0]! << 16) | (r[2]! << 8) | 0x90 | r[1]!);
      case 'mla': return one(cc | 0x00200000 | S | (r[0]! << 16) | (r[3]! << 12) | (r[2]! << 8) | 0x90 | r[1]!);
      case 'mls': return one(cc | 0x00600000 | (r[0]! << 16) | (r[3]! << 12) | (r[2]! << 8) | 0x90 | r[1]!);
      case 'umaal': return one(cc | 0x00400000 | (r[1]! << 16) | (r[0]! << 12) | (r[3]! << 8) | 0x90 | r[2]!);
      default: {
        const op = { umull: 0, umlal: 1, smull: 2, smlal: 3 }[c.base]!;
        return one(cc | 0x00800000 | (op << 21) | S | (r[1]! << 16) | (r[0]! << 12) | (r[3]! << 8) | 0x90 | r[2]!);
      }
    }
  }

  // ---- misc
  for (const c of splitMnemonic(mn, ['clz', 'uxtab', 'uxtah', 'sxtab', 'sxtah', 'uxtb', 'uxth', 'sxtb', 'sxth', 'ubfx', 'sbfx', 'svc', 'adr', 'rev'])) {
    if (c.s) continue;
    const cc = c.cond << 28;
    switch (c.base) {
      case 'clz': return one(cc | 0x016f0f10 | (reg(ops[0]) << 12) | reg(ops[1]));
      case 'rev': return one(cc | 0x06bf0f30 | (reg(ops[0]) << 12) | reg(ops[1]));
      case 'svc': return one(cc | 0x0f000000 | (num(ops[0]!) & 0xffffff));
      case 'ubfx':
      case 'sbfx': {
        const lsb = num(ops[2]!), width = num(ops[3]!);
        return one(cc | (c.base === 'ubfx' ? 0x07e00050 : 0x07a00050) | ((width - 1) << 16) | (reg(ops[0]) << 12) | (lsb << 7) | reg(ops[1]));
      }
      case 'adr': {
        const off = target(ops[1]!) - (addr + 8);
        const imm = encodeImm(Math.abs(off));
        if (imm === null) fail('adr の先を表せません');
        return one(cc | (off >= 0 ? 0x028f0000 : 0x024f0000) | (reg(ops[0]) << 12) | imm!);
      }
      default: {
        const op = { sxtb: 2, sxth: 3, uxtb: 6, uxth: 7, sxtab: 2, sxtah: 3, uxtab: 6, uxtah: 7 }[c.base]!;
        const acc = c.base.length === 5;
        const rn = acc ? reg(ops[1]) : 15;
        const rmIdx = acc ? 2 : 1;
        let rot = 0;
        const r = ops[rmIdx + 1];
        if (r) {
          const m = /^ror\s+#(\d+)$/i.exec(r.trim());
          if (!m || Number(m[1]) % 8) fail('回転は ror #8 / #16 / #24 です');
          rot = Number(m![1]) / 8;
        }
        return one(cc | 0x06800070 | (op << 20) | (rn << 16) | (reg(ops[0]) << 12) | (rot << 10) | reg(ops[rmIdx]));
      }
    }
  }

  // ---- VFP
  if (mn.startsWith('v')) return vfp(mn, ops, addr, resolve);

  // ---- shifts as instructions: lsl rd, rm, #n / rs
  for (const c of splitMnemonic(mn, ['lsl', 'lsr', 'asr', 'ror', 'rrx'])) {
    const cc = c.cond << 28;
    const S = c.s ? 1 << 20 : 0;
    if (c.base === 'rrx') return one(cc | 0x01a00060 | S | (reg(ops[0]) << 12) | reg(ops[1]));
    return one(cc | 0x01a00000 | S | (reg(ops[0]) << 12) | shiftedReg([ops[1]!, `${c.base} ${ops[2]}`]));
  }

  // ---- data processing
  for (const c of splitMnemonic(mn, Object.keys(DP).sort((a, b) => b.length - a.length))) {
    let opc = DP[c.base]!;
    const cc = c.cond << 28;
    const test = opc >= 8 && opc <= 11;
    const S = test || c.s ? 1 << 20 : 0;
    const rd = test ? 0 : reg(ops[0]);
    const rn = opc === 13 || opc === 15 ? 0 : reg(test ? ops[0] : ops[1]);
    const src = ops.slice(test || opc === 13 || opc === 15 ? 1 : 2);
    if (!src.length) fail('オペランドが足りません');
    if (src[0]!.startsWith('#') || /^-?(0x[0-9a-f]+|\d+)$/i.test(src[0]!)) {
      let v = num(src[0]!, resolve);
      let imm = encodeImm(v >>> 0);
      if (imm === null) {
        // the paired instruction with the inverted / negated value
        const alt: Record<number, [number, number]> = { 13: [15, ~v], 15: [13, ~v], 4: [2, -v], 2: [4, -v], 10: [11, -v], 11: [10, -v], 0: [14, ~v], 14: [0, ~v] };
        const a = alt[opc];
        if (a && encodeImm(a[1] >>> 0) !== null) {
          opc = a[0];
          v = a[1];
          imm = encodeImm(v >>> 0);
        }
      }
      if (imm === null) fail(`即値を表せません: ${src[0]} (ldr rX, =値 を使ってください)`);
      return one(cc | 0x02000000 | (opc << 21) | S | (rn << 16) | (rd << 12) | imm!);
    }
    return one(cc | (opc << 21) | S | (rn << 16) | (rd << 12) | shiftedReg(src));
  }
  return fail(`命令が分かりません: ${mn}`);
}

const VFP_BASES = ['vldmia', 'vstmia', 'vldmdb', 'vstmdb', 'vpush', 'vpop', 'vldr', 'vstr', 'vmrs', 'vmov', 'vnmul', 'vmla', 'vmls', 'vadd', 'vsub', 'vmul', 'vdiv', 'vabs', 'vneg', 'vsqrt', 'vcmpe', 'vcmp', 'vcvtr', 'vcvt'];

function vfp(mn: string, ops: string[], addr: number, resolve?: Resolver): Assembled {
  const dot = mn.indexOf('.');
  const head = dot < 0 ? mn : mn.slice(0, dot);
  const types = dot < 0 ? [] : mn.slice(dot + 1).split('.');
  const found = VFP_BASES.map((b) => ({ b, rest: head.startsWith(b) ? head.slice(b.length) : null })).find((x) => x.rest !== null && (x.rest === '' || COND[x.rest] !== undefined));
  if (!found) fail(`命令が分かりません: ${mn}`);
  const base = found!.b, cc = (found!.rest ? COND[found!.rest]! : 14) << 28;
  const one = (w: number): Assembled => ({ words: [w >>> 0] });
  const list = (s: string) => {
    const regs = s.trim().slice(1, -1).split(',').map((x) => vreg(x));
    return { first: regs[0]!, count: regs.length, dbl: regs[0]!.dbl };
  };
  switch (base) {
    case 'vpush':
    case 'vpop': {
      const l = list(ops.join(','));
      const n = l.dbl ? l.count * 2 : l.count;
      return one(cc | (base === 'vpush' ? 0x0d2d0a00 : 0x0cbd0a00) | (l.dbl ? 0x100 : 0) | vD(l.first) | n);
    }
    case 'vldmia':
    case 'vstmia':
    case 'vldmdb':
    case 'vstmdb': {
      const W = ops[0]!.endsWith('!') ? 1 : 0;
      const rn = reg(ops[0]!.replace('!', ''));
      const l = list(ops.slice(1).join(','));
      const n = l.dbl ? l.count * 2 : l.count;
      const L = base.startsWith('vld') ? 1 : 0;
      const db = base.endsWith('db');
      return one(cc | 0x0c000a00 | ((db ? 1 : 0) << 24) | ((db ? 0 : 1) << 23) | (W << 21) | (L << 20) | (rn << 16) | (l.dbl ? 0x100 : 0) | vD(l.first) | n);
    }
    case 'vldr':
    case 'vstr': {
      const r = vreg(ops[0]!);
      const L = base === 'vldr' ? 1 : 0;
      const mem = ops[1]!;
      if (mem.startsWith('=')) {
        if (!L || r.dbl) fail('vldr sN, =値 だけ使えます');
        return { words: [cc | 0x0d9f0a00 | vD(r)], literal: { value: mem.slice(1).trim(), word: 0, float: true } };
      }
      let rn: number, off: number;
      if (!mem.startsWith('[')) {
        rn = 15;
        off = num(mem, resolve) - ((addr + 8) & ~3);
      } else {
        const inner = operands(mem.slice(1, mem.indexOf(']')));
        rn = reg(inner[0]);
        off = inner[1] ? num(inner[1]) : 0;
      }
      if (off % 4 || Math.abs(off) > 1020) fail('vldr / vstr のオフセットは 4 の倍数で ±1020 までです');
      return one(cc | 0x0d000a00 | ((off >= 0 ? 1 : 0) << 23) | (L << 20) | (rn << 16) | (r.dbl ? 0x100 : 0) | vD(r) | (Math.abs(off) >> 2));
    }
    case 'vmrs':
      if (ops[0]?.toLowerCase() === 'apsr_nzcv') return one(cc | 0x0ef1fa10);
      return one(cc | 0x0ef10a10 | (reg(ops[0]) << 12));
    case 'vmov': {
      const a = ops[0]!, b = ops[1]!;
      const isCore = (s: string) => REGS[s.toLowerCase()] !== undefined;
      if (ops.length === 2 && isCore(a) && !isCore(b)) return one(cc | 0x0e100a10 | (reg(a) << 12) | vN(vreg(b)));
      if (ops.length === 2 && !isCore(a) && isCore(b)) return one(cc | 0x0e000a10 | (reg(b) << 12) | vN(vreg(a)));
      if (ops.length === 2) {
        const d = vreg(a), s = vreg(b);
        return one(cc | 0x0eb00a40 | (d.dbl ? 0x100 : 0) | vD(d) | vM(s));
      }
      fail('この形の vmov は使えません');
      break;
    }
    case 'vadd': case 'vsub': case 'vmul': case 'vdiv': case 'vnmul': case 'vmla': case 'vmls': {
      const d = vreg(ops[0]!), n = vreg(ops[1]!), mm = vreg(ops[2]!);
      const op = { vmla: [0x0e000a00, 0], vmls: [0x0e000a40, 0], vmul: [0x0e200a00, 0], vnmul: [0x0e200a40, 0], vadd: [0x0e300a00, 0], vsub: [0x0e300a40, 0], vdiv: [0x0e800a00, 0] }[base]!;
      return one(cc | op[0]! | (d.dbl ? 0x100 : 0) | vD(d) | vN(n) | vM(mm));
    }
    case 'vabs': case 'vneg': case 'vsqrt': {
      const d = vreg(ops[0]!), s = vreg(ops[1]!);
      const op = { vabs: 0x0eb00ac0, vneg: 0x0eb10a40, vsqrt: 0x0eb10ac0 }[base]!;
      return one(cc | op | (d.dbl ? 0x100 : 0) | vD(d) | vM(s));
    }
    case 'vcmp': case 'vcmpe': {
      const d = vreg(ops[0]!);
      const E = base === 'vcmpe' ? 0x80 : 0;
      if (ops[1]?.trim() === '#0') return one(cc | 0x0eb50a40 | E | (d.dbl ? 0x100 : 0) | vD(d));
      return one(cc | 0x0eb40a40 | E | (d.dbl ? 0x100 : 0) | vD(d) | vM(vreg(ops[1]!)));
    }
    case 'vcvt': case 'vcvtr': {
      const [to, from] = types as [string, string];
      const d = vreg(ops[0]!), s = vreg(ops[1]!);
      if ((to === 'f32' || to === 'f64') && (from === 's32' || from === 'u32'))
        return one(cc | 0x0eb80a40 | (from === 's32' ? 0x80 : 0) | (to === 'f64' ? 0x100 : 0) | vD(d) | vM(s));
      if ((to === 's32' || to === 'u32') && (from === 'f32' || from === 'f64'))
        return one(cc | (to === 's32' ? 0x0ebd0a40 : 0x0ebc0a40) | (base === 'vcvt' ? 0x80 : 0) | (from === 'f64' ? 0x100 : 0) | vD(d) | vM(s));
      if (to === 'f64' && from === 'f32') return one(cc | 0x0eb70ac0 | vD(d) | vM(s));
      if (to === 'f32' && from === 'f64') return one(cc | 0x0eb70bc0 | vD(d) | vM(s));
      fail(`この vcvt は使えません: ${mn}`);
      break;
    }
  }
  return fail(`命令が分かりません: ${mn}`);
}

/** A float literal ("1.0", "0.5f") as its bits, or a number / name as is. */
export function literalValue(v: string, float: boolean, resolve?: Resolver): number {
  if (float) {
    const f = Number(v.replace(/f$/i, ''));
    if (Number.isNaN(f)) fail(`小数ではありません: ${v}`);
    const b = new DataView(new ArrayBuffer(4));
    b.setFloat32(0, f, true);
    return b.getUint32(0, true);
  }
  return num(v, resolve) >>> 0;
}
