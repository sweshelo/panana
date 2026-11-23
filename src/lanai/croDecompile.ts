// A shipped content's CRO turned back into stage-script text (notes/lanai-cro-decompile.md, STATE #17): the events'
// templates an author takes into the script editor. Not a round trip: what the language can say is written as script,
// the rest as `// 未対応:` notes, so the text inserted still reads.
//
// 1. Binding: the factories (indexed exports 0 area / 3 map start / 4 button / 8 talk) are run in the ARM interpreter
//    (game/arm.ts) for the map groups and row IDs their code compares with, and for the values of the flags they read:
//    (group, row, condition) → the class made (its vtable, its RTTI name).
// 2. The body: Execute (vt+0xC; IntroCommon's vt+0x18) is run symbolically: registers hold constants, the event's
//    object, stack slots, call results. Calls of the Script API become calls by name, the branches if / else and
//    switch, a walk of the party `for p in party`, the flags variables. The CtrlFlag override (vt+0x10) goes after.
// 3. The library's shapes (talk, open, jingle, camera …) are folded, from the library's own text.
// 4. The flags become `var` declarations, their numbers kept in a note; rows, lines and maps stay as they are.
import { ArmMachine, type Stub } from '../game/arm';
import { BASE } from '../game/codeconst';
import { disassemble, type Insn } from '../game/disasm';
import { parseCro, RELOC, type Cro } from './cro';
import { SCRIPT_API as A, type ScriptTrigger } from './eventScript';
import { SCRIPT_API_ROWS, type ScriptApiRow } from './scriptApiTable';
import { SCRIPT_LIBRARY } from './scriptLibrary';

// ------------------------------------------------------------------------------------------------ the CRO read
interface Ref {
  seg: number;
  off: number;
}
type Ptr = { imp: string; add: number } | { ref: Ref } | null;
const TEXT = 1;
const key = (seg: number, off: number): string => `${seg}:${off}`;

class CroView {
  readonly cro: Cro;
  readonly segs: Uint8Array[];
  readonly imports = new Map<string, { name: string; add: number }>();
  readonly relocs = new Map<string, Ref>();
  /** Text offsets of the import stubs (`ldr pc, [pc, #-4]` + the symbol's word) → the symbol. */
  readonly stubs = new Map<number, string>();
  private readonly insns = new Map<number, Insn>();
  constructor(bytes: Uint8Array) {
    this.cro = parseCro(bytes);
    this.segs = this.cro.segments.map((s) => s.bytes ?? new Uint8Array(s.size));
    for (const n of this.cro.namedImports)
      for (const p of n.patches) this.imports.set(key(p.target.seg, p.target.off), { name: n.name, add: p.addend });
    for (const r of this.cro.internalRelocs)
      if (r.type === RELOC.ABS32) this.relocs.set(key(r.target.seg, r.target.off), { seg: r.symbolSeg, off: r.addend });
    const t = this.segs[TEXT]!;
    for (let o = 0; o + 8 <= t.length; o += 4)
      if (this.u32(TEXT, o) === 0xe51ff004) {
        const i = this.imports.get(key(TEXT, o + 4));
        if (i) this.stubs.set(o, i.name);
      }
  }
  u32(seg: number, off: number): number {
    const b = this.segs[seg];
    if (!b || off < 0 || off + 4 > b.length) return 0;
    return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
  }
  ptr(seg: number, off: number): Ptr {
    const i = this.imports.get(key(seg, off));
    if (i) return { imp: i.name, add: i.add };
    const r = this.relocs.get(key(seg, off));
    return r ? { ref: r } : null;
  }
  cstr(r: Ref): string {
    const b = this.segs[r.seg]!;
    let e = r.off;
    while (e < b.length && b[e]) e++;
    return new TextDecoder().decode(b.subarray(r.off, e));
  }
  insn(off: number): Insn {
    let i = this.insns.get(off);
    if (!i) this.insns.set(off, (i = disassemble(this.u32(TEXT, off), off)));
    return i;
  }
  /** The import a call at `off` reaches (through its stub), or null for a function of the CRO. */
  callee(target: number): string | null {
    return this.stubs.get(target) ?? null;
  }
}

/** A class of the CRO by its vtable: its name (RTTI), the game's class it derives from, its functions. */
export interface CroClass {
  name: string;
  /** The game's class at the root (NpcCommonTurn, EventScript, IntroCommon …). */
  base: string;
  /** The vtable's words from where the object points: text offsets of the CRO's functions, or imports. */
  slots: ({ fn: number } | { imp: string } | null)[];
}
const typeName = (sym: string): string => /^_ZTI(?:N\d+)?\d+(\w+?)E?$/u.exec(sym)?.[1] ?? sym;
function classOf(v: CroView, vt: Ref): CroClass {
  const slots: CroClass['slots'] = [];
  for (let k = 0; k < 9; k++) {
    const p = v.ptr(vt.seg, vt.off + 4 * k);
    slots.push(!p ? null : 'imp' in p ? { imp: p.imp } : p.ref.seg === TEXT ? { fn: p.ref.off } : null);
  }
  let name = `vt_${vt.off.toString(16)}`;
  let base = '?';
  let ti = v.ptr(vt.seg, vt.off - 4);
  for (let depth = 0; ti && 'ref' in ti && depth < 8; depth++) {
    const n = v.ptr(ti.ref.seg, ti.ref.off + 4);
    if (depth === 0 && n && 'ref' in n) name = v.cstr(n.ref).replace(/^\d+/u, '');
    const up = v.ptr(ti.ref.seg, ti.ref.off + 8);
    if (up && 'imp' in up) base = typeName(up.imp);
    ti = up;
  }
  return { name, base, slots };
}

// ------------------------------------------------------------------------------------------------ 1. the factories
const FAKE = 0x0e000000;
interface Image {
  m: ArmMachine;
  at: (seg: number, off: number) => number;
  refOf: (a: number) => Ref | null;
  /** Fake address of an import → its symbol. */
  syms: Map<number, string>;
  entry: (slot: number) => number | null;
}
function croImage(v: CroView): Image {
  const bases: number[] = [];
  let end = 0;
  v.segs.forEach((s, k) => {
    bases[k] = end;
    end = (end + s.length + 0xf) & ~0xf;
  });
  const code = new Uint8Array(end);
  v.segs.forEach((s, k) => code.set(s, bases[k]!));
  const at = (seg: number, off: number): number => BASE + bases[seg]! + off;
  const put = (seg: number, off: number, val: number): void => {
    const o = bases[seg]! + off;
    for (let b = 0; b < 4; b++) code[o + b] = (val >>> (8 * b)) & 0xff;
  };
  for (const r of v.cro.internalRelocs) {
    const val = at(r.symbolSeg, r.addend);
    if (r.type === RELOC.ABS32) put(r.target.seg, r.target.off, val);
    else if (r.type === RELOC.REL32) put(r.target.seg, r.target.off, val - at(r.target.seg, r.target.off));
  }
  const syms = new Map<number, string>();
  v.cro.namedImports.forEach((n, k) => {
    const fake = FAKE + k * 0x100;
    syms.set(fake, n.name);
    for (const p of n.patches) if (p.type === RELOC.ABS32) put(p.target.seg, p.target.off, fake + p.addend);
  });
  const m = new ArmMachine(code, { maxDepth: 12, maxSteps: 20000, textEnd: BASE + end });
  const refOf = (a: number): Ref | null => {
    for (let k = bases.length - 1; k >= 0; k--)
      if (v.segs[k]!.length && a >= at(k, 0) && a < at(k, v.segs[k]!.length)) return { seg: k, off: a - at(k, 0) };
    return null;
  };
  const entry = (slot: number): number | null => {
    const t = v.cro.indexedExports[slot];
    return t && t.seg === TEXT ? at(TEXT, t.off) : null;
  };
  return { m, at, refOf, syms, entry };
}

/** The constants a function (and the CRO functions it calls) compares with or loads: candidates of groups and IDs. */
function constantsOf(v: CroView, start: number): number[] {
  const out = new Set<number>();
  const seen = new Set<number>();
  const todo = [start];
  let budget = 4000;
  while (todo.length && budget > 0) {
    let o = todo.pop()!;
    if (seen.has(o)) continue;
    for (; budget-- > 0 && o + 4 <= v.segs[TEXT]!.length; o += 4) {
      if (seen.has(o)) break;
      seen.add(o);
      const i = v.insn(o);
      const w = i.word;
      if (i.literal !== undefined && !v.ptr(TEXT, i.literal)) {
        const x = v.u32(TEXT, i.literal);
        out.add(x);
        for (let d = 1; d <= 24 && x > 0x10000; d++) out.add(x + d);
      }
      if ((w >>> 26) % 4 === 0 && w & 0x02000000) {
        const op = (w >>> 21) & 15;
        const rot = ((w >>> 8) & 15) * 2;
        const imm = rot ? ((w & 0xff) >>> rot) | ((w & 0xff) << (32 - rot)) : w & 0xff;
        if (op === 10 || op === 2 || op === 13 || op === 4) out.add(imm >>> 0);
        if (op === 11) out.add(-imm >>> 0);
        if (op === 2 || op === 10) for (let d = 1; d <= 24; d++) out.add((imm + d) >>> 0);
      }
      if (i.target !== undefined && !v.callee(i.target) && i.target < v.segs[TEXT]!.length) todo.push(i.target);
      if (/^(bx lr|pop \{.*pc\}|ldr pc)/u.test(i.text) || (/^b #/u.test(i.text) && !i.call)) break;
    }
  }
  return [...out];
}

/** The values the code just after a call compares its result with (`cmp r0, #4`, `ldr r1, =hash; cmp r0, r1`). */
function comparedAfter(v: CroView, off: number): number[] {
  const out: number[] = [];
  const lits = new Map<string, number>();
  for (let o = off; o < off + 0x18 && o + 4 <= v.segs[TEXT]!.length; o += 4) {
    const i = v.insn(o);
    const ld = /^ldr (r\d+), \[pc/u.exec(i.text);
    if (ld && i.literal !== undefined && !v.ptr(TEXT, i.literal)) lits.set(ld[1]!, v.u32(TEXT, i.literal));
    const imm = /^cmp r0, #(0x[0-9a-f]+|\d+)$/iu.exec(i.text);
    if (imm) out.push(Number(imm[1]) >>> 0);
    const reg = /^cmp r0, (r\d+)$/u.exec(i.text);
    if (reg && lits.has(reg[1]!)) out.push(lits.get(reg[1]!)!);
    // a compare after a conditional branch is of the same value (CRO 73: cmp r0, #3; beq …; cmp r0, #0x1d); a call
    // or a jump ends what is compared
    if (/^(b|bl|bx|blx) /u.test(i.text) || /^pop .*pc/u.test(i.text) || /^mov r0,/u.test(i.text)) break;
  }
  return out;
}

/** The group of a binding made whatever the group is (the factories try 0 first: no group has it). */
export const ANY_GROUP = 0;

export interface CroBinding {
  trigger: ScriptTrigger;
  group: number;
  /** The row ID compared with (0 for a map's start). */
  row: number;
  cls: string;
  /** What the factory read to make it, besides the group and the row: `bit_0xB1 == 0` …; empty when always. */
  when: string[];
}
/** The objects the factories made, by class: what their constructors put in the members (ID of a monster …). */
const members = new Map<string, Uint8Array[]>();
/** The effects the constructors made, by class: offset of the ScriptEffect in the object → [EffectData row, layer]. */
const factoryEffects = new Map<string, Map<number, [number, number]>>();

/** The reads a factory makes besides the group: flags, the floor … (results it is run with). */
const GUARD_READS: Record<string, string> = {
  [A.getBit]: 'bit',
  [A.getByte]: 'byte',
  [A.getState]: 'state',
};
/** A read of a factory as script: `bit_0xB1`, `ScriptSystem.GetCurrentFloorID()`. */
const readText = (r: string): string => {
  const m = /^(bit|byte|state):(\d+)$/u.exec(r);
  if (!m) return r;
  return m[1] === 'state'
    ? `ScriptFlag.GetScriptState(${hexText(Number(m[2]))})`
    : flagVar({ kind: m[1] as 'bit', flag: Number(m[2]) });
};
const isCtor = (s: string): boolean => /C[12]E/u.test(s) || s.startsWith('__aeabi_vec_ctor');

function runFactories(v: CroView, img: Image, classAt: (r: Ref) => CroClass): CroBinding[] {
  const out: CroBinding[] = [];
  const slots: [number, ScriptTrigger][] = [
    [0, 'area'],
    [3, 'start'],
    [4, 'button'],
    [8, 'talk'],
  ];
  for (const [slot, trigger] of slots) {
    const entry = img.entry(slot);
    if (entry === null) continue;
    const consts = constantsOf(v, entry - img.at(TEXT, 0));
    const groups = [...new Set([0, ...consts.filter((c) => c < 0x400)])];
    const rows = trigger === 'start' ? [0] : [...new Set(consts)];
    const run = (
      group: number,
      row: number,
      values: number[],
    ): { made: Ref | null; reads: string[]; hints: number[][] } => {
      const reads: string[] = [];
      /** For each read, what the code after it compares the result with. */
      const hints: number[][] = [];
      let n = 0;
      /** The effects the constructors made: (the ScriptEffect's address, the EffectData row, the layer). */
      const fx: [number, number, number][] = [];
      const stubs = new Map<number, Stub>();
      for (const [fake, sym] of img.syms)
        stubs.set(fake, (m) => {
          if (sym === A.group) return group;
          if (sym === A.effectCreate) fx.push([m.r[0]!, m.r[1]!, m.r[2]!]);
          if (sym === A.new || sym === '_Znwj') return m.alloc(m.r[0]! || 4);
          if (isCtor(sym)) return m.r[0]!;
          const kind = GUARD_READS[sym];
          const row = SCRIPT_API_ROWS.find((r) => r[2] === sym);
          if ((row && row[5] === 'ptr') || sym === A.mapChara || sym === A.hero || sym === A.player)
            return m.alloc(0x100);
          if (kind || (row && !row[5].startsWith('void'))) {
            const what = kind
              ? `${kind}:${m.r[0]!}`
              : `${row![0]}.${row![1]}(${row![3].startsWith('i') ? m.r[0]! : ''})`;
            // the same read again (CRO 7 asks for the map twice) gives what it gave
            const again = reads.indexOf(what);
            if (again >= 0) {
              hints[again]!.push(...comparedAfter(v, m.r[14]! - img.at(TEXT, 0)));
              return values[again] ?? 0;
            }
            reads.push(what);
            hints.push(comparedAfter(v, m.r[14]! - img.at(TEXT, 0)));
            return values[n++] ?? 0;
          }
          return 0;
        });
      const m = new ArmMachine(img.m.code, { stubs, maxDepth: 12, maxSteps: 20000, textEnd: BASE + img.m.code.length });
      let r0 = 0;
      try {
        r0 = trigger === 'start' ? m.run(entry, []) : m.run(entry, [row, 0x20000000, 0, 0]);
      } catch {
        return { made: null, reads, hints };
      }
      if (!r0) return { made: null, reads, hints };
      const vt = img.refOf(m.read(r0, 4));
      const obj = new Uint8Array(0x200);
      for (let k = 0; k < obj.length; k++) obj[k] = m.rb(r0 + k);
      if (vt) {
        const name = classAt(vt).name;
        members.set(name, [...(members.get(name) ?? []), obj]);
        // the effects in the object (the events' objects are under 0x1000 B; past it, another object's)
        const own = factoryEffects.get(name) ?? new Map<number, [number, number]>();
        for (const [at, effect, layer] of fx) if (at >= r0 && at < r0 + 0x1000) own.set(at - r0, [effect, layer]);
        factoryEffects.set(name, own);
      }
      return { made: vt, reads, hints };
    };
    for (const group of groups)
      for (const row of rows) {
        // explore the values of what it reads (0 first, then 1 and the constants), as a tree of the reads' order
        const found: { cls: string | null; reads: string[]; values: number[] }[] = [];
        let decided = 0;
        const explore = (prefix: number[], depth: number): void => {
          const r = run(group, row, prefix);
          found.push({ cls: r.made ? classAt(r.made).name : null, reads: r.reads, values: prefix });
          decided = Math.max(decided, prefix.length);
          if (depth > 4 || found.length > 40) return;
          for (let k = prefix.length; k < Math.min(r.reads.length, prefix.length + 3); k++) {
            const base = [...prefix, ...Array<number>(k - prefix.length).fill(0)];
            const kind = r.reads[k]!.split(':')[0];
            // a byte flag's steps are small (a boss: 2 = fought, 3 = its win played; CRO 51's D01BossWin is made at 2)
            const alts =
              kind === 'bit'
                ? [1]
                : kind === 'state'
                  ? [1, 2, 3]
                  : kind === 'byte'
                    ? [...new Set([1, 2, 3, ...consts.filter((c) => c > 3 && c < 0x100).slice(0, 4)])]
                    : // what a function returns (the floor, the map …): what the code compares it with, else small ones
                      r.hints[k]!.length
                      ? [...new Set(r.hints[k]!.filter((c) => c !== 0))]
                      : [1, 2, 3, 4];
            for (const a of alts) explore([...base, a], depth + 1);
          }
        };
        explore([], 0);
        const made = found.filter((f) => f.cls);
        if (!made.length) continue;
        // made whatever the reads give: no condition; else the reads decided on, with their values (0 when not set)
        const always = found.every((f) => f.cls === made[0]!.cls);
        const seen = new Set<string>();
        const val = (f: { values: number[] }, k: number): number => f.values[k] ?? 0;
        /** The runs that differ from `f` in the value of the read `k` alone. */
        const others = (f: (typeof found)[number], k: number): typeof found =>
          found.filter(
            (g) =>
              g.reads[k] === f.reads[k] &&
              val(g, k) !== val(f, k) &&
              Array.from({ length: decided }, (_, j) => j).every((j) => j === k || val(g, j) === val(f, j)),
          );
        for (const f of made) {
          // a read is a condition when another value of it alone makes another class (or nothing); one whose other
          // values were all tried and make the same class is not (CRO 73's S01BossWin reads two bytes it ignores)
          const when = always
            ? []
            : f.reads.slice(0, decided).flatMap((x, k) => {
                const alt = others(f, k);
                const matters = alt.length ? alt.some((g) => g.cls !== f.cls) : val(f, k) !== 0;
                return matters ? [`${readText(x)} == ${hexText(val(f, k))}`] : [];
              });
          const k = `${f.cls}|${when.join(',')}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ trigger, group, row, cls: f.cls!, when });
        }
      }
  }
  // a class made for any row of a group (the factory did not compare the row) is not a binding of a row; one made at
  // group 0, which no map has, is made at the start of any group's map (CRO 71's TimerStartCommon, CRO 73's
  // ScriptColosseumMenu): kept once, as group 0
  return out.filter((b, _, all) =>
    b.trigger === 'start'
      ? b.group === ANY_GROUP || !all.some((x) => x.trigger === 'start' && x.cls === b.cls && x.group === ANY_GROUP)
      : all.filter((x) => x.trigger === b.trigger && x.group === b.group && x.cls === b.cls).length < 40,
  );
}

// ------------------------------------------------------------------------------------------------ 2. the bodies
/** A value the symbolic run keeps in a register or a stack slot. */
type Sym =
  | { k: 'n'; v: number }
  /** A float, as written (`0.5`, `p.x * 2`). */
  | { k: 'f'; t: string }
  | { k: 'this'; off: number }
  | { k: 'sp'; off: number }
  | { k: 'imp'; name: string; add: number }
  | { k: 'data'; ref: Ref }
  /** An integer worked out when the event runs (a variable, a call's result), and what was added to it. */
  | { k: 'v'; t: string; add: number; pend?: Pending; float?: boolean }
  /** A character's ChrObject* (hero, obj(N), p), and the call that gave it. */
  | { k: 'chr'; who: string; t: string }
  /** A pointer to a position (GetPos …). */
  | { k: 'vec'; t: string }
  | { k: '?'; why: string };
interface Pending {
  list: Stmt[];
  stmt: Stmt;
  text: string;
  local?: string;
}
export type Stmt =
  | { k: 'call'; who: string | null; cls: string; name: string; args: string[] }
  | { k: 'text'; text: string }
  | { k: 'note'; text: string }
  | { k: 'if'; cond: string; then: Stmt[]; else: Stmt[] }
  | { k: 'switch'; value: string; cases: { v: number; body: Stmt[] }[]; def: Stmt[] }
  | { k: 'party'; name: string; body: Stmt[] }
  | { k: 'raw'; lines: string[] };

const API_BY_SYM = new Map<string, ScriptApiRow>(SCRIPT_API_ROWS.map((r) => [r[2], r]));
const OVERLOADS = new Map<string, ScriptApiRow[]>();
for (const r of SCRIPT_API_ROWS) {
  const k = `${r[0]}.${r[1]}`;
  OVERLOADS.set(k, [...(OVERLOADS.get(k) ?? []), r]);
}
const MEMBER = new Set(['ScriptChara', 'ScriptPlayer', 'ScriptMonster', 'ScriptEffect']);
const SELF_BASES = /^(NpcCommon|NpcCommonTurn|CommonHeroMsg|GimmickPushButtonCommon|GimmickKeepPushButtonCommon)$/u;
/** Calls with no effect worth a statement (their value is written where it is used). */
const pure = (name: string): boolean => /^(Get|Is|Have|Check)/u.test(name);

export const hexText = (n: number): string =>
  n >= 0 && n < 0x100 ? String(n) : n < 0 && n > -0x100 ? String(n) : `0x${(n >>> 0).toString(16).toUpperCase()}`;
/** The shortest decimal that reads back as the same single float. */
export function floatText(x: number, decimal = false): string {
  if (!Number.isFinite(x)) return '0';
  let s = String(x);
  for (let d = 1; d <= 9; d++) {
    const t = Number(x.toPrecision(d));
    if (Math.fround(t) === Math.fround(x)) {
      s = String(t);
      break;
    }
  }
  if (/e/u.test(s)) s = x.toFixed(6).replace(/0+$/u, '');
  return decimal && !s.includes('.') ? `${s}.0` : s;
}
const f32 = (w: number): number => new Float32Array(new Uint32Array([w]).buffer)[0]!;

const COND: Record<string, [string, boolean]> = {
  eq: ['==', false],
  ne: ['!=', false],
  lt: ['<', false],
  ge: ['>=', false],
  gt: ['>', false],
  le: ['<=', false],
  lo: ['<', true],
  hs: ['>=', true],
  hi: ['>', true],
  ls: ['<=', true],
  mi: ['<', false],
  pl: ['>=', false],
};
const NEG: Record<string, string> = { '==': '!=', '!=': '==', '<': '>=', '>=': '<', '>': '<=', '<=': '>' };
const CONDS = 'eq|ne|hs|lo|mi|pl|vs|vc|hi|ls|ge|lt|gt|le';
const OP_RE = new RegExp(
  `^(vcvt|vldr|vstr|vmov|vadd|vsub|vmul|vdiv|vneg|vcmpe|vcmp|vmrs|vpush|vpop|vldmia|vstmia|vmla|vmls|vsqrt|vabs|push|pop|ldrsb|ldrsh|ldrb|ldrh|ldrd|ldr|strb|strh|strd|str|ldm|stm|mov|mvn|add|sub|rsb|and|orr|eor|bic|cmp|cmn|tst|teq|mul|mla|uxtb|uxth|sxtb|sxth|lsl|lsr|asr|blx|bx|bl|b|adr|nop)(s?)(${CONDS})?(\\..*)?$`,
  'u',
);
interface Op {
  base: string;
  s: boolean;
  cc: string | null;
  ty: string;
  ops: string[];
}
function parseOp(text: string): Op | null {
  const sp = text.indexOf(' ');
  const mn = sp < 0 ? text : text.slice(0, sp);
  let m = OP_RE.exec(mn);
  // "bls" is b + ls, not bl + s; "blo" b + lo
  if (m && m[1] === 'bl' && m[2] === 's' && !m[3]) m = /^(b)()(ls)$/u.exec(mn);
  if (!m) return null;
  const rest = sp < 0 ? '' : text.slice(sp + 1);
  const ops: string[] = [];
  let depth = 0,
    cur = '';
  for (const ch of rest) {
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      ops.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) ops.push(cur.trim());
  return { base: m[1]!, s: m[2] === 's', cc: m[3] ?? null, ty: m[4] ?? '', ops };
}
const REGS: Record<string, number> = { sb: 9, sl: 10, fp: 11, ip: 12, sp: 13, lr: 14, pc: 15 };
const regNo = (s: string): number => (s in REGS ? REGS[s]! : /^r(\d+)$/u.test(s) ? Number(s.slice(1)) : -1);
const immOf = (s: string): number | null => (/^#-?(0x)?[0-9a-f]+$/iu.test(s) ? Number(s.slice(1)) : null);
const regList = (s: string): string[] =>
  s
    .replace(/^\{|\}$/gu, '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

interface State {
  r: Sym[];
  s: Map<number, Sym>;
  stack: Map<number, Sym>;
  /** Flags: a function of the condition code → the condition text (null: not known). */
  flags: ((cc: string) => string | null) | null;
  /** Positions kept in the stack by the vector functions (VECSubtract …): offset → the local's name. */
  vecs: Map<number, string>;
}
const cloneState = (s: State): State => ({
  r: [...s.r],
  s: new Map(s.s),
  stack: new Map(s.stack),
  flags: s.flags,
  vecs: new Map(s.vecs),
});
const symKey = (a: Sym | undefined): string =>
  !a
    ? ''
    : a.k === 'v'
      ? `v:${a.t}:${a.add}:${a.float ?? ''}`
      : a.k === 'data'
        ? `d:${a.ref.seg}:${a.ref.off}`
        : a.k === '?'
          ? '?'
          : JSON.stringify(a);
const same = (a: Sym | undefined, b: Sym | undefined): boolean => a === b || (a?.k !== '?' && symKey(a) === symKey(b));
function mergeStates(a: State, b: State): State {
  const unk: Sym = { k: '?', why: '分岐のあとの値' };
  const r = a.r.map((x, k) => (same(x, b.r[k]) ? x : unk));
  const s = new Map([...a.s].filter(([k, x]) => same(x, b.s.get(k))));
  const stack = new Map([...a.stack].filter(([k, x]) => same(x, b.stack.get(k))));
  const vecs = new Map([...a.vecs].filter(([k, x]) => b.vecs.get(k) === x));
  return { r, s, stack, flags: null, vecs };
}

/** Whether two ways meet holding different known values (in r0–r12 or the float registers). */
function lostAtJoin(a: State, b: State): boolean {
  for (let k = 0; k < 13; k++) if (a.r[k]!.k !== '?' && b.r[k]!.k !== '?' && !same(a.r[k], b.r[k])) return true;
  for (const [k, x] of a.s) {
    const y = b.s.get(k);
    if (y && x.k !== '?' && y.k !== '?' && !same(x, y)) return true;
  }
  return false;
}

/** The flags read and written (number → kind), for the declarations. */
export interface FlagUse {
  kind: 'bit' | 'byte';
  flag: number;
}
export const flagVar = (u: FlagUse): string => `${u.kind}_${hexText(u.flag).replace(/^0x/u, '0x')}`;

interface Block {
  start: number;
  end: number; // the last instruction's offset
  succ: number[];
  kind: 'ret' | 'jump' | 'cond' | 'fall' | 'table' | 'tail';
  table?: number[];
}

class FunctionDecompiler {
  readonly notes: string[] = [];
  private blocks = new Map<number, Block>();
  private ipdom = new Map<number, number>();
  private objs = new Map<string, string>();
  private objIds = new Map<Sym, string>();
  private locals = 0;
  private partyDepth = 0;
  constructor(
    private readonly v: CroView,
    private readonly cls: CroClass,
    private readonly flags: Map<string, FlagUse>,
    private readonly start: number,
    /** The members every object of the class was made with (offset → byte), past the game's class. */
    private readonly made: Map<number, number> = new Map(),
  ) {}
  /** A member the factory set (the same in every object it made), or null. */
  private member(off: number, size: number): number | null {
    let v = 0;
    for (let k = size - 1; k >= 0; k--) {
      const b = this.made.get(off + k);
      if (b === undefined) return null;
      v = v * 256 + b;
    }
    return v >>> 0;
  }
  /** Members the body wrote before reading them. */
  private wrote = new Map<number, Sym>();
  /** The event's ScriptEffect members the body calls: name → offset in the event's object. */
  readonly usedEffects = new Map<string, number>();
  /** The name of the ScriptEffect member at `off` of the event's object (`fx74`), as the body uses it. */
  private effectName(off: number): string {
    const n = `fx${off.toString(16)}`;
    this.usedEffects.set(n, off);
    return n;
  }

  private note(what: string, list: Stmt[]): void {
    this.notes.push(what);
    list.push({ k: 'note', text: what });
  }

  // ---- the graph
  private buildBlocks(): void {
    const v = this.v;
    const leaders = new Set<number>([this.start]);
    const seen = new Set<number>();
    const todo = [this.start];
    const size = v.segs[TEXT]!.length;
    while (todo.length) {
      let o = todo.pop()!;
      if (seen.has(o)) continue;
      for (; o + 4 <= size; o += 4) {
        if (seen.has(o)) break;
        seen.add(o);
        const i = v.insn(o);
        const op = parseOp(i.text);
        if (!op) continue;
        const isRet =
          (op.base === 'bx' && op.ops[0] === 'lr') ||
          (op.base === 'pop' && op.ops[0]!.includes('pc')) ||
          (op.base === 'ldr' && op.ops[0] === 'pc' && !op.ops[1]!.includes('pc,'));
        if (op.base === 'ldr' && op.ops[0] === 'pc' && /\[pc, r\d+, lsl #2\]/u.test(op.ops[1]!)) {
          // jump table: the words after the next instruction (`b default`)
          const n = this.tableSize(o);
          const tab: number[] = [];
          for (let k = 0; k < n; k++) {
            const p = v.ptr(TEXT, o + 8 + 4 * k);
            if (p && 'ref' in p && p.ref.seg === TEXT) tab.push(p.ref.off);
          }
          for (const t of [...tab, o + 4]) {
            leaders.add(t);
            todo.push(t);
          }
          leaders.add(o + 4);
          break;
        }
        if (op.base === 'b' && i.target !== undefined) {
          const tail = v.callee(i.target) !== null;
          if (!tail) {
            leaders.add(i.target);
            todo.push(i.target);
          }
          if (op.cc) {
            leaders.add(o + 4);
            todo.push(o + 4);
          }
          if (op.cc || !tail) {
            leaders.add(o + 4);
            break;
          }
          break;
        }
        if (isRet && !op.cc) break;
      }
    }
    const sorted = [...leaders].filter((x) => seen.has(x)).sort((a, b) => a - b);
    for (const s of sorted) {
      let o = s;
      const b: Block = { start: s, end: s, succ: [], kind: 'fall' };
      for (; ; o += 4) {
        const i = v.insn(o);
        const op = parseOp(i.text);
        b.end = o;
        if (op?.base === 'ldr' && op.ops[0] === 'pc' && /\[pc, r\d+, lsl #2\]/u.test(op.ops[1]!)) {
          b.kind = 'table';
          const n = this.tableSize(o);
          b.table = [];
          for (let k = 0; k < n; k++) {
            const p = v.ptr(TEXT, o + 8 + 4 * k);
            b.table.push(p && 'ref' in p ? p.ref.off : -1);
          }
          b.succ = [...b.table.filter((t) => t >= 0), o + 4];
          break;
        }
        if (op?.base === 'b' && i.target !== undefined) {
          const tail = v.callee(i.target) !== null;
          if (tail && !op.cc) {
            b.kind = 'tail';
            break;
          }
          b.kind = op.cc ? 'cond' : 'jump';
          b.succ = op.cc ? [o + 4, i.target] : [i.target];
          break;
        }
        if (
          op &&
          !op.cc &&
          ((op.base === 'bx' && op.ops[0] === 'lr') ||
            (op.base === 'pop' && op.ops[0]!.includes('pc')) ||
            (op.base === 'ldr' && op.ops[0] === 'pc'))
        ) {
          b.kind = 'ret';
          break;
        }
        if (leaders.has(o + 4)) {
          b.succ = [o + 4];
          break;
        }
      }
      this.blocks.set(s, b);
    }
    // post-dominators (EXIT = -1)
    const ids = [...this.blocks.keys()];
    const all = new Set([...ids, -1]);
    const pd = new Map<number, Set<number>>();
    for (const id of ids) pd.set(id, new Set(all));
    pd.set(-1, new Set([-1]));
    const succ = (id: number): number[] => {
      const b = this.blocks.get(id)!;
      const s = b.succ.filter((x) => this.blocks.has(x));
      return b.kind === 'ret' || b.kind === 'tail' || !s.length ? [-1] : s;
    };
    for (let changed = true; changed;) {
      changed = false;
      for (const id of [...ids].reverse()) {
        const ss = succ(id).map((x) => pd.get(x)!);
        const inter = new Set([...ss[0]!].filter((x) => ss.every((s) => s.has(x))));
        inter.add(id);
        if (inter.size !== pd.get(id)!.size) {
          pd.set(id, inter);
          changed = true;
        }
      }
    }
    for (const id of ids) {
      const strict = [...pd.get(id)!].filter((x) => x !== id);
      // the immediate one: post-dominated by every other
      const imm = strict.find((c) => strict.every((o) => o === c || pd.get(c)!.has(o)));
      this.ipdom.set(id, imm ?? -1);
    }
  }
  private tableSize(o: number): number {
    // `cmp rX, #n` before `ldrls pc, [pc, rX, lsl #2]`: n + 1 entries
    for (let p = o - 4; p >= o - 24; p -= 4) {
      const op = parseOp(this.v.insn(p).text);
      if (op?.base === 'cmp') return (immOf(op.ops[1] ?? '') ?? 0) + 1;
    }
    return 0;
  }

  // ---- values
  private fresh(why: string): Sym {
    return { k: '?', why };
  }
  /** A position kept in a local (`let v1 = …`), its name. */
  private vecLocal(t: string, out: Stmt[]): string {
    if (/^[A-Za-z_]\w*$/u.test(t)) return t;
    const n = `v${++this.locals}`;
    out.push({ k: 'text', text: `let ${n} = ${t}` });
    return n;
  }
  private whoOf(p: Sym): string | null {
    if (p.k === 'this' && p.off === 0xc && SELF_BASES.test(this.cls.base)) return 'self';
    if (p.k === 'sp') return this.objs.get(`sp:${p.off}`) ?? null;
    if (p.k === 'this') return this.objs.get(`this:${p.off}`) ?? null;
    // in a walk of the party, the member's ScriptPlayer is worked out from the index (arr + i * 0x50)
    return (
      this.objIds.get(p) ??
      (this.partyDepth > 0 && p.k === '?' ? (this.partyDepth > 1 ? `p${this.partyDepth}` : 'p') : null)
    );
  }
  private setWho(p: Sym, who: string): void {
    if (p.k === 'sp' || p.k === 'this') this.objs.set(`${p.k}:${p.off}`, who);
    else this.objIds.set(p, who);
  }
  /** The integer as script text (null: not known). */
  private intText(x: Sym, list: Stmt[]): string | null {
    if (x.k === 'n') return hexText(x.v | 0) === hexText(x.v) ? hexText(x.v) : hexText(x.v >>> 0);
    if (x.k === 'v') {
      if (x.t === 'selfRow' && x.add) return null;
      const t = this.use(x, list);
      return x.add ? `${t} ${x.add > 0 ? '+' : '-'} ${Math.abs(x.add)}` : t;
    }
    if (x.k === 'chr') return x.t;
    return null;
  }
  private floatOf(x: Sym, list: Stmt[]): string | null {
    if (x.k === 'f') return x.t;
    if (x.k === 'n') return floatText(f32(x.v));
    if (x.k === 'v' && x.float) return this.use(x, list);
    return null;
  }
  /** A call's result used: written in place when its statement is the last one, else kept in a local. */
  private use(x: Extract<Sym, { k: 'v' }>, list: Stmt[]): string {
    const p = x.pend;
    if (!p) return x.t;
    if (p.local) return p.local;
    const at = p.list.indexOf(p.stmt);
    if (at >= 0 && at === p.list.length - 1 && p.list === list) {
      p.list.splice(at, 1);
      x.pend = undefined;
      return x.t;
    }
    if (at < 0) return x.t; // already used in place
    p.local = `t${++this.locals}`;
    p.list[at] = { k: 'text', text: `let ${p.local} = ${p.text}` };
    return p.local;
  }

  // ---- running a block
  private run(b: Block, st: State, out: Stmt[]): void {
    for (let o = b.start; o <= b.end; o += 4) {
      const i = this.v.insn(o);
      const op = parseOp(i.text);
      if (!op) {
        this.note(`読めない命令 ${i.text} (0x${o.toString(16)})`, out);
        continue;
      }
      if (op.base === 'b' && o === b.end && b.kind !== 'tail') break;
      if (b.kind === 'table' && o === b.end) break;
      this.step(op, i, o, st, out);
    }
  }

  private step(op: Op, i: Insn, o: number, st: State, out: Stmt[]): void {
    const r = st.r;
    const get = (s: string): Sym => {
      const n = regNo(s);
      if (n === 15) return { k: 'n', v: o + 8 };
      if (n >= 0) return r[n]!;
      const imm = immOf(s);
      return imm !== null ? { k: 'n', v: imm >>> 0 } : this.fresh(s);
    };
    const set = (s: string, x: Sym): void => {
      const n = regNo(s);
      if (n >= 0) r[n] = x;
    };
    const sv = (s: string): number => {
      const m = /^s(\d+)$/u.exec(s);
      return m ? Number(m[1]) : /^d(\d+)$/u.test(s) ? Number(s.slice(1)) * 2 : -1;
    };
    // a conditional instruction other than a branch: its result is not known (cmpne / cmpeq chain the flags)
    if (op.cc && !['b', 'bl', 'cmp', 'cmn', 'tst'].includes(op.base)) {
      if (op.ops[0] && regNo(op.ops[0]) >= 0 && !['str', 'strb', 'strh', 'push'].includes(op.base))
        set(op.ops[0], this.fresh(`条件付きの ${op.base}`));
      return;
    }
    const addr = (m: string): { base: Sym; off: number; wb: boolean; post: number } | null => {
      const x = /^\[(\w+)(?:, #(-?(?:0x)?[0-9a-f]+))?\](!?)(?:, #(-?(?:0x)?[0-9a-f]+))?$/iu.exec(m);
      if (!x) return null;
      return { base: get(x[1]!), off: x[2] ? Number(x[2]) : 0, wb: x[3] === '!', post: x[4] ? Number(x[4]) : 0 };
    };
    const offset = (base: Sym, d: number): Sym =>
      base.k === 'sp' || base.k === 'this'
        ? { ...base, off: base.off + d }
        : base.k === 'n'
          ? { k: 'n', v: (base.v + d) >>> 0 }
          : base.k === 'v' && !base.float
            ? { ...base, add: base.add + d }
            : base.k === 'imp'
              ? { ...base, add: base.add + d }
              : base.k === 'data'
                ? { k: 'data', ref: { seg: base.ref.seg, off: base.ref.off + d } }
                : d === 0
                  ? base
                  : this.fresh('ポインターの計算');
    const load = (a: Sym, size: number): Sym => {
      if (a.k === 'sp') return st.stack.get(a.off) ?? this.fresh(`スタック ${a.off}`);
      if (a.k === 'this') {
        if (a.off === 4) return { k: 'v', t: 'selfRow', add: 0 };
        const w = this.wrote.get(a.off);
        if (w) return w;
        const m = a.off >= baseSize(this.cls.base) ? this.member(a.off, size) : null;
        if (m !== null) return { k: 'n', v: m };
        return this.fresh(`イベントのメンバー +0x${a.off.toString(16)}`);
      }
      if (a.k === 'n' && a.v >= 0 && a.v < this.v.segs[TEXT]!.length + 8) {
        const p = this.v.ptr(TEXT, a.v);
        if (p) return 'imp' in p ? { k: 'imp', name: p.imp, add: p.add } : { k: 'data', ref: p.ref };
        return { k: 'n', v: size === 4 ? this.v.u32(TEXT, a.v) : this.v.u32(TEXT, a.v) & (size === 1 ? 0xff : 0xffff) };
      }
      if (a.k === 'vec' || (a.k === '?' && false)) return this.fresh('位置');
      return this.fresh('メモリーの読み出し');
    };
    const store = (a: Sym, x: Sym): void => {
      if (a.k === 'sp') st.stack.set(a.off, x);
      else if (a.k === 'this') {
        this.wrote.set(a.off, x);
        if (!this.notes.includes(`イベントのメンバー +0x${a.off.toString(16)} に書く`))
          this.note(`イベントのメンバー +0x${a.off.toString(16)} に書く`, out);
      }
    };
    const imm = (s: string | undefined): number | null => (s === undefined ? null : immOf(s));
    switch (op.base) {
      case 'nop':
      case 'vmrs':
        if (op.base === 'vmrs') return; // the float compare's flags (set by vcmp)
        return;
      case 'push':
      case 'vpush': {
        const n = regList(op.ops[0]!).length * (op.ops[0]!.includes('d') ? 2 : 1);
        const sp = r[13]! as Extract<Sym, { k: 'sp' }>;
        r[13] = { k: 'sp', off: sp.off - 4 * n };
        return;
      }
      case 'pop':
      case 'vpop': {
        const n = regList(op.ops[0]!).length * (op.ops[0]!.includes('d') ? 2 : 1);
        const sp = r[13]! as Extract<Sym, { k: 'sp' }>;
        r[13] = { k: 'sp', off: sp.off + 4 * n };
        if (op.base === 'pop')
          for (const x of regList(op.ops[0]!)) if (regNo(x) >= 4 && regNo(x) < 13) set(x, this.saved[regNo(x)]!);
        return;
      }
      case 'mov':
      case 'mvn': {
        let x = get(op.ops[1]!);
        if (op.ops[2]) x = this.shift(x, op.ops[2]);
        if (op.base === 'mvn') x = x.k === 'n' ? { k: 'n', v: ~x.v >>> 0 } : this.fresh('mvn');
        set(op.ops[0]!, x);
        if (op.s) st.flags = this.cmpFlags(x, { k: 'n', v: 0 }, out);
        return;
      }
      case 'add':
      case 'sub':
      case 'rsb': {
        const a = get(op.ops[1]!);
        let b = get(op.ops[2]!);
        if (op.ops[3]) b = this.shift(b, op.ops[3]);
        let x: Sym;
        if (b.k === 'n' && op.base !== 'rsb') x = offset(a, op.base === 'add' ? b.v | 0 : -(b.v | 0));
        else if (a.k === 'n' && op.base === 'add') x = offset(b, a.v | 0);
        else if (a.k === 'n' && b.k === 'n') x = { k: 'n', v: (op.base === 'rsb' ? b.v - a.v : a.v - b.v) >>> 0 };
        else x = this.fresh(`${op.base} の計算`);
        set(op.ops[0]!, x);
        if (op.s) st.flags = this.cmpFlags(x, { k: 'n', v: 0 }, out);
        return;
      }
      case 'and':
      case 'uxtb':
      case 'uxth':
      case 'sxtb':
      case 'sxth': {
        const a = get(op.ops[1]!);
        const m = op.base === 'and' ? imm(op.ops[2]) : 0;
        // a byte / bool / u16 result kept as it is
        const x =
          a.k === 'n' && m !== null
            ? {
                k: 'n' as const,
                v: op.base === 'and' ? (a.v & m) >>> 0 : a.v & (op.base.endsWith('b') ? 0xff : 0xffff),
              }
            : a.k === 'v' && (m === null || m === 0 || m === 0xff || m === 0xffff)
              ? a
              : this.fresh(op.base);
        set(op.ops[0]!, x);
        if (op.s) st.flags = this.cmpFlags(x, { k: 'n', v: 0 }, out);
        return;
      }
      case 'orr':
      case 'eor':
      case 'bic':
      case 'mul':
      case 'mla':
      case 'lsl':
      case 'lsr':
      case 'asr': {
        const a = get(op.ops[1]!);
        const b = get(op.ops[2] ?? '#0');
        let x: Sym = this.fresh(op.base);
        if (a.k === 'n' && b.k === 'n') {
          const f: Record<string, (p: number, q: number) => number> = {
            orr: (p, q) => p | q,
            eor: (p, q) => p ^ q,
            bic: (p, q) => p & ~q,
            mul: (p, q) => Math.imul(p, q),
            lsl: (p, q) => p << q,
            lsr: (p, q) => p >>> q,
            asr: (p, q) => p >> q,
          };
          if (f[op.base]) x = { k: 'n', v: f[op.base]!(a.v, b.v) >>> 0 };
        } else if ((op.base === 'lsl' || op.base === 'asr' || op.base === 'lsr') && a.k === 'v') x = a; // (s8) / (u16)
        set(op.ops[0]!, x);
        return;
      }
      case 'adr':
        set(op.ops[0]!, { k: 'n', v: i.target ?? 0 });
        return;
      case 'cmp':
      case 'cmn':
      case 'tst': {
        const a = get(op.ops[0]!);
        let b = get(op.ops[1]!);
        if (op.base === 'cmn' && b.k === 'n') b = { k: 'n', v: -b.v >>> 0 };
        const f =
          op.base === 'tst'
            ? b.k === 'n' && (b.v === 0xff || b.v === 0xffff || b.v === 1)
              ? this.cmpFlags(a, { k: 'n', v: 0 }, out)
              : null
            : this.cmpFlags(a, b, out);
        if (!op.cc) st.flags = f;
        else {
          // cmpne after a compare: Z = before's Z || this; cmpeq: before's && this
          const prev = st.flags;
          const or = op.cc === 'ne';
          st.flags =
            prev && f && (op.cc === 'ne' || op.cc === 'eq')
              ? (cc) => {
                  const p = prev('eq'),
                    q = f('eq');
                  if (!p || !q || (cc !== 'eq' && cc !== 'ne')) return null;
                  const both = or ? `${p} || ${q}` : `${p} && ${q}`;
                  return cc === 'eq' ? both : `!(${both})`;
                }
              : null;
        }
        return;
      }
      case 'vcmp':
      case 'vcmpe': {
        const a = this.sreg(st, sv(op.ops[0]!), out);
        const b = op.ops[1]!.startsWith('#') ? '0' : this.sreg(st, sv(op.ops[1]!), out);
        st.flags =
          a && b
            ? (cc) => {
                const c = COND[cc];
                return c ? `${a} ${c[0]} ${b}` : null;
              }
            : null;
        return;
      }
      case 'ldr':
      case 'ldrb':
      case 'ldrh':
      case 'ldrsb':
      case 'ldrsh': {
        const size = op.base === 'ldr' ? 4 : op.base.endsWith('b') ? 1 : 2;
        if (i.literal !== undefined) {
          set(op.ops[0]!, load({ k: 'n', v: i.literal }, 4));
          return;
        }
        const a = addr(op.ops[1]!);
        if (!a) return set(op.ops[0]!, this.fresh(`読み出し ${op.ops[1]}`));
        const ea = offset(a.base, a.off);
        set(op.ops[0]!, load(ea, size));
        if (a.wb) set(/^\[(\w+)/u.exec(op.ops[1]!)![1]!, ea);
        if (a.post) set(/^\[(\w+)/u.exec(op.ops[1]!)![1]!, offset(a.base, a.post));
        return;
      }
      case 'str':
      case 'strb':
      case 'strh': {
        const a = addr(op.ops[1]!);
        if (!a) return;
        const ea = offset(a.base, a.off);
        store(ea, get(op.ops[0]!));
        const rn = /^\[(\w+)/u.exec(op.ops[1]!)![1]!;
        if (a.wb) set(rn, ea);
        if (a.post) set(rn, offset(a.base, a.post));
        return;
      }
      case 'strd':
      case 'ldrd':
        if (op.base === 'ldrd') {
          set(op.ops[0]!, this.fresh('ldrd'));
          set(op.ops[1]!, this.fresh('ldrd'));
        }
        return;
      case 'stm':
      case 'ldm': {
        const base = op.ops[0]!.replace('!', '');
        let a = get(base);
        for (const x of regList(op.ops[1]!)) {
          if (op.base === 'stm') store(a, get(x));
          else set(x, load(a, 4));
          a = offset(a, 4);
        }
        if (op.ops[0]!.endsWith('!')) set(base, a);
        return;
      }
      case 'vldr':
      case 'vstr': {
        const n = sv(op.ops[0]!);
        const m = /^\[(\w+)(?:, #(-?(?:0x)?[0-9a-f]+))?\]$/iu.exec(op.ops[1]!);
        if (!m) return;
        const base = get(m[1]!);
        const d = m[2] ? Number(m[2]) : 0;
        if (op.base === 'vldr') {
          if (m[1] === 'pc') st.s.set(n, { k: 'f', t: floatText(f32(this.v.u32(TEXT, o + 8 + d))) });
          else if (base.k === 'vec' && d >= 0 && d <= 8 && d % 4 === 0)
            st.s.set(n, { k: 'f', t: `${base.t}.${'xyz'[d / 4]}` });
          else if (base.k === 'sp') {
            const x = st.stack.get(base.off + d);
            st.s.set(
              n,
              x?.k === 'f' ? x : x?.k === 'n' ? { k: 'f', t: floatText(f32(x.v)) } : (x ?? this.fresh('スタック')),
            );
          } else st.s.set(n, this.fresh(`小数の読み出し ${op.ops[1]}`));
        } else if (base.k === 'sp') st.stack.set(base.off + d, st.s.get(n) ?? this.fresh('小数'));
        else if (base.k === 'this') this.note(`イベントのメンバー +0x${(base.off + d).toString(16)} に小数を書く`, out);
        return;
      }
      case 'vstmia':
      case 'vldmia': {
        let a = get(op.ops[0]!.replace('!', ''));
        for (const x of regList(op.ops[1]!)) {
          if (op.base === 'vstmia' && a.k === 'sp') st.stack.set(a.off, st.s.get(sv(x)) ?? this.fresh('小数'));
          else if (op.base === 'vldmia')
            st.s.set(sv(x), a.k === 'sp' ? (st.stack.get(a.off) ?? this.fresh('スタック')) : this.fresh('小数'));
          a = offset(a, 4);
        }
        return;
      }
      case 'vmov': {
        const [d, s] = [op.ops[0]!, op.ops[1]!];
        if (sv(d) >= 0 && sv(s) >= 0) st.s.set(sv(d), st.s.get(sv(s)) ?? this.fresh('小数'));
        else if (sv(d) >= 0) {
          const x = get(s);
          st.s.set(sv(d), x.k === 'n' ? { k: 'f', t: floatText(f32(x.v)) } : x);
        } else if (op.ty.includes('f32') && immOf(s) !== null) set(d, this.fresh('vmov'));
        else set(d, st.s.get(sv(s)) ?? this.fresh('小数'));
        if (sv(d) >= 0 && /^#/u.test(s)) st.s.set(sv(d), { k: 'f', t: floatText(Number(s.slice(1))) });
        return;
      }
      case 'vcvt': {
        const d = sv(op.ops[0]!),
          s = sv(op.ops[1]!);
        const x = st.s.get(s);
        if (op.ty.startsWith('.f32.')) {
          // integer → float: the integer's text
          const t = x && x.k !== 'f' ? this.intText(x, out) : null;
          st.s.set(d, t !== null ? { k: 'f', t } : (x ?? this.fresh('vcvt')));
        } else st.s.set(d, x?.k === 'f' ? { k: 'v', t: x.t, add: 0, float: true } : this.fresh('vcvt'));
        return;
      }
      case 'vadd':
      case 'vsub':
      case 'vmul':
      case 'vdiv':
      case 'vneg':
      case 'vsqrt':
      case 'vabs':
      case 'vmla':
      case 'vmls': {
        const d = sv(op.ops[0]!);
        const a = this.sreg(st, sv(op.ops[op.ops.length === 2 ? 1 : 1]!), out);
        const b = op.ops[2] ? this.sreg(st, sv(op.ops[2]), out) : null;
        const sym: Record<string, string> = { vadd: '+', vsub: '-', vmul: '*', vdiv: '/' };
        let t: string | null = null;
        if (op.base === 'vneg' && a) t = `-${a}`;
        else if (sym[op.base] && a && b) t = `(${a} ${sym[op.base]} ${b})`;
        else if ((op.base === 'vmla' || op.base === 'vmls') && a && b) {
          const acc = this.sreg(st, d, out);
          if (acc) t = `(${acc} ${op.base === 'vmla' ? '+' : '-'} ${a} * ${b})`;
        }
        st.s.set(d, t ? { k: 'f', t } : this.fresh(`${op.base} (言語に無い計算)`));
        return;
      }
      case 'bl':
      case 'b':
      case 'blx':
        return this.call(op, i, o, st, out);
      case 'bx':
        return;
      default:
        this.note(`扱えない命令 ${i.text}`, out);
    }
  }
  private saved: Sym[] = [];
  private shift(x: Sym, s: string): Sym {
    const m = /^(lsl|lsr|asr) #(\d+)$/u.exec(s);
    if (!m) return this.fresh('シフト');
    if (x.k === 'n') {
      const n = Number(m[2]);
      return { k: 'n', v: (m[1] === 'lsl' ? x.v << n : m[1] === 'lsr' ? x.v >>> n : x.v >> n) >>> 0 };
    }
    return x.k === 'v' ? x : this.fresh('シフト');
  }
  private sreg(st: State, n: number, out: Stmt[]): string | null {
    const x = st.s.get(n);
    return x ? this.floatOf(x, out) : null;
  }
  /** The flags of comparing a with b: the condition text for each condition code. */
  private cmpFlags(a: Sym, b: Sym, out: Stmt[]): ((cc: string) => string | null) | null {
    if (b.k !== 'n') return null;
    if ((a.k === 'v' && a.t !== 'selfRow') || a.k === 'chr') {
      const isBit = a.k === 'v' && /^bit_/u.test(a.t);
      return (cc) => {
        const c = COND[cc];
        if (!c) return null;
        const t = a.k === 'chr' ? a.t : this.use(a, out);
        const add = a.k === 'v' ? a.add : 0;
        let than = (b.v | 0) - add;
        if (c[1] && than < 0) than = b.v >>> 0;
        if (than === 0 && (c[0] === '!=' || (c[1] && c[0] === '>'))) return isBit ? t : `${t} != 0`;
        if (than === 0 && (c[0] === '==' || (c[1] && c[0] === '<='))) return isBit ? `!${t}` : `${t} == 0`;
        if (isBit && than === 1) return c[0] === '==' ? t : c[0] === '!=' ? `!${t}` : null;
        return `${t} ${c[0]} ${hexText(than)}`;
      };
    }
    return null;
  }

  private call(op: Op, i: Insn, o: number, st: State, out: Stmt[]): void {
    const r = st.r;
    if (op.base === 'blx') {
      this.note(`関数ポインターの呼び出し (${i.text})`, out);
      r[0] = this.fresh('blx');
      return;
    }
    const t = i.target!;
    const sym = this.v.callee(t);
    if (!sym) {
      this.note(`CRO の中の関数 0x${t.toString(16)} を呼ぶ (中身は書いていない)`, out);
      for (const k of [0, 1, 2, 3, 12]) r[k] = this.fresh('関数の呼び出し');
      return;
    }
    this.importCall(sym, st, out);
    for (const k of [1, 2, 3, 12]) r[k] = this.fresh('呼び出しで壊れる');
    for (let k = 0; k < 16; k++) if (st.s.get(k)?.k === '?' || k > 0) st.s.delete(k);
  }

  private importCall(sym: string, st: State, out: Stmt[]): void {
    const r = st.r;
    const arg = (k: number): Sym =>
      k < 4 ? r[k]! : (st.stack.get((r[13] as { off: number }).off + 4 * (k - 4)) ?? this.fresh('スタックの引数'));
    // the game's rare item direction, an object of the event: rareItem(item, num, intro, restore, party, formation)
    if (sym === A.rareStart || sym === A.rareStartNum) {
      const num = sym === A.rareStartNum;
      const vals = [1, 2, 3, 4, 5, 6].map((k) =>
        num ? arg(k) : k === 2 ? ({ k: 'n', v: 1 } as Sym) : arg(k - (k > 2 ? 1 : 0)),
      );
      const texts = vals.map((x, k) => (k === 0 ? this.intText(x, out) : x.k === 'n' ? hexText(x.v) : null));
      const flagsOk = texts.slice(2).every((t) => t === '0' || t === '1');
      if (r[0]!.k !== 'this' || texts.some((t) => t === null) || !flagsOk) {
        this.note(`rareItem(${texts.map((t) => t ?? '?').join(', ')}) (アイテム・数・0 / 1 のどれかが決まらない)`, out);
        return;
      }
      out.push({ k: 'text', text: `rareItem(${texts.join(', ')})` });
      return;
    }
    // objects of the script: made around a character, the party's array, destructors
    if (sym === A.charaCtor || sym === A.playerCtor || sym === A.monsterCtor) {
      const c = r[1]!;
      if (c.k === 'chr') this.setWho(r[0]!, c.who);
      else this.note(`キャラが決まらない ScriptChara (${sym})`, out);
      return;
    }
    if (sym === A.playerSet) {
      const c = r[1]!;
      if (c.k === 'chr') this.setWho(r[0]!, c.who);
      return;
    }
    // the party's ScriptPlayer[8]: its first is the hero (the loops set each one, outside them only [0] is read)
    if (sym === A.vecCtor && r[1]!.k === 'imp' && r[1]!.name === A.playerNew) this.setWho(r[0]!, 'hero');
    if (/D[012]Ev$/u.test(sym) || sym === A.vecCtor || sym === A.vecDtor || sym === A.playerNew || sym === A.ctrl) {
      if (sym === A.ctrl) out.push({ k: 'note', text: 'ここでゲームの後処理 (EventScript::CtrlFlag) が走る' });
      return;
    }
    if (sym === A.mapChara) {
      const n = r[0]!;
      r[0] =
        n.k === 'n'
          ? { k: 'chr', who: `obj(${hexText(n.v)})`, t: `ScriptMap.GetMapChara(${hexText(n.v)})` }
          : this.fresh('GetMapChara の行が決まらない');
      return;
    }
    if (sym === A.hero) {
      r[0] = { k: 'chr', who: 'hero', t: 'ScriptMap.GetPlayerHero()' };
      return;
    }
    if (sym === A.player && this.partyDepth > 0) {
      const p = this.partyDepth > 1 ? `p${this.partyDepth}` : 'p';
      r[0] = { k: 'chr', who: p, t: p };
      return;
    }
    if (sym === A.playerNum && this.partyDepth > 0) {
      r[0] = this.fresh('GetPlayerNum');
      return;
    }
    const ev = Object.entries({
      TurnNpc: A.turnNpc,
      TurnHero: A.turnHero,
      TurnNpcRecover: '_ZN13NpcCommonTurn14TurnNpcRecoverEv',
      ZoomHeroCamera: '_ZN9NpcCommon14ZoomHeroCameraEv',
      RecoverHeroCamera: '_ZN9NpcCommon17RecoverHeroCameraEv',
    }).find(([, s]) => s === sym);
    if (ev) {
      if (r[0]!.k === 'this' && r[0]!.off === 0) out.push({ k: 'text', text: `event.${ev[0]}()` });
      else this.note(`${ev[0]} をイベント以外に呼ぶ`, out);
      r[0] = this.fresh(ev[0]);
      return;
    }
    // flags as variables
    if ((sym === A.getBit || sym === A.getByte) && r[0]!.k === 'n') {
      const u: FlagUse = { kind: sym === A.getBit ? 'bit' : 'byte', flag: r[0]!.v & 0xffff };
      this.flags.set(flagVar(u), u);
      r[0] = { k: 'v', t: flagVar(u), add: 0 };
      return;
    }
    if ((sym === A.setBit || sym === A.setByte) && r[0]!.k === 'n') {
      const u: FlagUse = { kind: sym === A.setBit ? 'bit' : 'byte', flag: r[0]!.v & 0xffff };
      const val = r[1]!;
      const t =
        val.k === 'n' ? String(u.kind === 'bit' ? Number((val.v & 0xff) !== 0) : val.v & 0xff) : this.intText(val, out);
      if (t !== null) {
        this.flags.set(flagVar(u), u);
        out.push({ k: 'text', text: `${flagVar(u)} = ${t}` });
        return;
      }
    }
    // the vector functions: a local position (VECAdd / VECSubtract into the stack), a squared length
    const vfn = /^_Z\d+VEC(Add|Subtract|SquareMag|Scale)/u.exec(sym)?.[1];
    if (vfn) {
      const a = this.vecArg(r[0]!, st);
      if (vfn === 'SquareMag' || vfn === 'Mag') {
        if (a !== null) {
          const n = this.vecLocal(a, out);
          const sq = `(${n}.x * ${n}.x + ${n}.y * ${n}.y + ${n}.z * ${n}.z)`;
          st.s.set(0, { k: 'f', t: vfn === 'Mag' ? `ScriptMath.Sqrt${sq}` : sq });
          if (vfn === 'Mag') this.note('VECMag (平方根) を書いた形は未確認', out);
          return;
        }
      } else if (vfn === 'Scale') {
        const s = st.s.get(0);
        const f = s ? this.floatOf(s, out) : null;
        if (a !== null && f !== null && r[1]!.k === 'sp') {
          st.vecs.set(r[1]!.off, this.vecLocal(`(${a} * ${f})`, out));
          return;
        }
      } else {
        const b = this.vecArg(r[1]!, st);
        if (a !== null && b !== null && r[2]!.k === 'sp') {
          st.vecs.set(r[2]!.off, this.vecLocal(`(${a} ${vfn === 'Add' ? '+' : '-'} ${b})`, out));
          return;
        }
      }
    }
    const row = API_BY_SYM.get(sym);
    if (!row) {
      this.note(`言語で呼べない関数 ${demangle(sym)}`, out);
      r[0] = this.fresh(demangle(sym));
      st.s.set(0, this.fresh(demangle(sym)));
      return;
    }
    const [cls, name, , params, , result] = row;
    const member = MEMBER.has(cls);
    let core = member ? 1 : 0,
      fl = 0;
    const args: string[] = [];
    const missing: string[] = [];
    let who: string | null = null;
    if (member) {
      // a ScriptEffect member of the event (its constructor's, or one the body makes): `effect fxNN`
      who = cls === 'ScriptEffect' && r[0]!.k === 'this' ? this.effectName(r[0]!.off) : this.whoOf(r[0]!);
      if (!who) missing.push('相手');
    }
    const decimal = (OVERLOADS.get(`${cls}.${name}`)?.length ?? 1) > 1;
    for (const p of params) {
      if (p === 'f') {
        const x = st.s.get(fl++);
        const t = x ? this.floatOf(x, out) : null;
        if (t === null) missing.push('小数');
        args.push(t === null ? '?' : decimal && /^-?\d+$/u.test(t) ? `${t}.0` : t);
        continue;
      }
      const x = arg(core++);
      if (p === 'm') continue;
      if (p === 'i') {
        const t = this.intText(x, out);
        if (t === null) missing.push(`整数 (${x.k === '?' ? x.why : x.k})`);
        args.push(t ?? '?');
      } else if (p === 'v') {
        const t = this.vecArg(x, st);
        if (t === null) missing.push('位置');
        args.push(t ?? '?');
      } else if (p === 'c') {
        const w = this.whoOf(x);
        if (!w) missing.push('キャラ');
        args.push(w ?? '?');
      } else if (p === 'p') {
        const w = x.k === 'chr' ? x.who : null;
        if (!w) missing.push('キャラ');
        args.push(w ?? '?');
      }
    }
    const text = `${member ? (who ?? '?') : cls}.${name}(${args.join(', ')})`;
    // what the language cannot say: an overload of the same parameters, a function of another object's class
    const letters = params.replace(/m/gu, '');
    if ((OVERLOADS.get(`${cls}.${name}`) ?? []).some((o) => o[2] !== sym && o[3].replace(/m/gu, '') === letters))
      missing.push('同じ引数の形の別の関数があり、呼び分け');
    const player = who === 'hero' || /^p\d*$/u.test(who ?? '');
    if (
      member &&
      ((cls === 'ScriptPlayer' && !player) ||
        (cls === 'ScriptMonster' && player) ||
        (cls === 'ScriptEffect' && !this.usedEffects.has(who ?? '')))
    )
      missing.push(`${cls} の関数を ${who} に呼ぶ書き方`);
    if (args.some((a) => /selfRow/u.test(a) && a !== 'selfRow')) missing.push('selfRow の計算');
    // as the compiler takes them (eventScript.ts apiCall)
    const count = (c: string): number => [...params].filter((x) => x === c).length;
    if (
      count('v') > 2 ||
      count('m') > 2 ||
      count('c') > 1 ||
      count('p') > 2 ||
      (member ? 1 : 0) + params.replace(/f/gu, '').length > 8
    )
      missing.push('引数が多い呼び出しの書き方');
    if (missing.length) {
      this.note(`${text} (${missing.join('、')}が決まらない)`, out);
      r[0] = this.fresh(name);
      return;
    }
    const res = result.replace('?', '');
    if (res === 'void') {
      out.push({ k: 'call', who: member ? who : null, cls, name, args });
      return;
    }
    if (VEC_SYMS.has(sym)) {
      r[0] = { k: 'vec', t: text };
      return;
    }
    if (res === 'ptr') {
      if (!pure(name)) out.push({ k: 'call', who: member ? who : null, cls, name, args });
      r[0] = this.fresh(`${name} のポインター`);
      return;
    }
    let pend: Pending | undefined;
    if (!pure(name)) {
      const stmt: Stmt = { k: 'call', who: member ? who : null, cls, name, args };
      out.push(stmt);
      pend = { list: out, stmt, text };
    }
    const value: Sym = { k: 'v', t: text, add: 0, pend, float: res === 'float' };
    if (res === 'float') st.s.set(0, value);
    else r[0] = value;
  }
  private vecArg(x: Sym, st: State): string | null {
    if (x.k === 'imp' && x.name === A.gsvecZero) return 'vec(0, 0, 0)';
    if (x.k === 'imp' && /^GSVEC_AXIS_[XYZ]$/u.test(x.name))
      return ['vec(1, 0, 0)', 'vec(0, 1, 0)', 'vec(0, 0, 1)']['XYZ'.indexOf(x.name.slice(-1))]!;
    if (x.k === 'sp' && st.vecs.has(x.off)) return st.vecs.get(x.off)!;
    if (x.k === 'vec') return x.t;
    if (x.k === 'sp') {
      const c = [0, 4, 8].map((d) => {
        const y = st.stack.get(x.off + d);
        return !y ? null : y.k === 'f' ? y.t : y.k === 'n' ? floatText(f32(y.v)) : null;
      });
      return c.every((y) => y !== null) ? `vec(${c.join(', ')})` : null;
    }
    return null;
  }

  // ---- the structure
  decompile(): Stmt[] {
    this.buildBlocks();
    const st: State = {
      r: Array.from({ length: 16 }, (_, k): Sym => (k === 0 ? { k: 'this', off: 0 } : this.fresh(`r${k}`))),
      s: new Map(),
      stack: new Map(),
      vecs: new Map(),
      flags: null,
    };
    st.r[13] = { k: 'sp', off: 0 };
    this.saved = [...st.r];
    const out: Stmt[] = [];
    this.region(this.start, new Set([-1]), st, out, -1);
    return out;
  }

  private loopOf(h: number): Set<number> | null {
    const backs = [...this.blocks.values()].filter((b) => b.start >= h && b.succ.includes(h));
    const latches = backs.filter((b) => b.start >= h);
    if (!latches.length) return null;
    const body = new Set<number>([h]);
    const todo = latches.map((b) => b.start);
    while (todo.length) {
      const x = todo.pop()!;
      if (body.has(x)) continue;
      body.add(x);
      for (const b of this.blocks.values()) if (b.succ.includes(x) && b.start >= h) todo.push(b.start);
    }
    return body;
  }

  /** Statements from block `b` until a block of `stops`; returns the state at the end. */
  private depth = 0;
  private dups = 0;
  private region(b: number, stops: Set<number>, st: State, out: Stmt[], loopAt: number): State {
    if (++this.depth > 200)
      throw new Error(
        `region too deep at 0x${b.toString(16)} stops ${[...stops].map((x) => x.toString(16))} fn 0x${this.start.toString(16)}`,
      );
    try {
      return this.region1(b, stops, st, out, loopAt);
    } finally {
      this.depth--;
    }
  }
  private region1(b: number, stops: Set<number>, st: State, out: Stmt[], loopAt: number): State {
    let guard = 0;
    while (!stops.has(b) || b === loopAt) {
      if (guard++ > 2000) {
        this.note('構造が読めない', out);
        return st;
      }
      const blk = this.blocks.get(b);
      if (!blk) return st;
      if (b !== loopAt) {
        const loop = this.loopOf(b);
        if (loop) {
          const outs = [...loop].flatMap((x) => this.blocks.get(x)!.succ.filter((y) => !loop.has(y)));
          const exit = outs.length
            ? outs.sort((p, q) => outs.filter((y) => y === q).length - outs.filter((y) => y === p).length || p - q)[0]!
            : -1;
          const party = [...loop].some((x) => {
            const bb = this.blocks.get(x)!;
            for (let o = bb.start; o <= bb.end; o += 4) {
              const i = this.v.insn(o);
              if (
                i.target !== undefined &&
                ([A.player, A.playerNum] as string[]).includes(this.v.callee(i.target) ?? '')
              )
                return true;
            }
            return false;
          });
          const inner = cloneState(st);
          // what the loop changes is not known at its head
          for (const x of loop) {
            const bb = this.blocks.get(x)!;
            for (let o = bb.start; o <= bb.end; o += 4) {
              const op = parseOp(this.v.insn(o).text);
              const d = op?.ops[0] ? regNo(op.ops[0]) : -1;
              if (d >= 0 && d < 13 && !['str', 'strb', 'strh', 'cmp', 'cmn', 'tst', 'stm', 'push'].includes(op!.base))
                inner.r[d] = this.fresh('くり返しで変わる');
            }
          }
          const body: Stmt[] = [];
          if (party) this.partyDepth++;
          this.region(b, new Set([b, exit, -1]), inner, body, b);
          if (party) {
            this.partyDepth--;
            out.push({ k: 'party', name: this.partyDepth ? `p${this.partyDepth + 1}` : 'p', body });
          } else {
            this.notes.push('くり返し');
            out.push({ k: 'note', text: `くり返し (0x${b.toString(16)}): 言語に無いので、1 回分をコメントにした` });
            out.push({ k: 'raw', lines: render(body, 0).map((l) => `// ${l}`) });
          }
          st = mergeStates(st, inner);
          for (const k of [0, 1, 2, 3, 12]) st.r[k] = this.fresh('くり返しのあと');
          b = exit;
          continue;
        }
      }
      loopAt = -2;
      this.run(blk, st, out);
      if (blk.kind === 'ret') {
        return st;
      }
      if (blk.kind === 'tail') {
        return st;
      }
      if (blk.kind === 'jump' || blk.kind === 'fall') {
        b = blk.succ[0]!;
        continue;
      }
      const join = this.ipdom.get(b) ?? -1;
      const inner = new Set([...stops, join]);
      if (blk.kind === 'table') {
        const value = this.tableValue(blk, st, out);
        const cases: { v: number; body: Stmt[] }[] = [];
        let end: State | null = null;
        const targets = blk.table!;
        const def: Stmt[] = [];
        targets.forEach((t, k) => {
          if (t < 0 || t === join) return;
          // values that go to the same code: a case each with the same statements (the language has no `case 1, 2:`)
          const first = targets.indexOf(t);
          const prev = first < k ? cases.find((c) => c.v === first + value.base) : undefined;
          if (prev) return void cases.push({ v: k + value.base, body: prev.body });
          const body: Stmt[] = [];
          const s2 = this.region(t, inner, cloneState(st), body, -1);
          end = end ? mergeStates(end, s2) : s2;
          cases.push({ v: k + value.base, body });
        });
        const ds = this.region(blk.succ[blk.succ.length - 1]!, inner, cloneState(st), def, -1);
        end = end ? mergeStates(end, ds) : ds;
        if (value.text) out.push({ k: 'switch', value: value.text, cases, def });
        else this.note('switch の値が決まらない', out);
        st = end;
        b = join;
        continue;
      }
      // if / else: the branch is taken when the condition holds
      const [fall, taken] = blk.succ as [number, number];
      const op = parseOp(this.v.insn(blk.end).text)!;
      const cond = st.flags?.(op.cc!) ?? null;
      let thenBody: Stmt[] = [],
        elseBody: Stmt[] = [];
      const noted = this.notes.length;
      let sFall = this.region(fall, inner, cloneState(st), elseBody, -1);
      let sTaken = this.region(taken, inner, cloneState(st), thenBody, -1);
      let tail = false;
      if (join !== -1 && !stops.has(join) && this.dups < 24 && lostAtJoin(sFall, sTaken)) {
        // the two ways meet with different values (a line ID each) used after: the rest is written in both
        this.dups++;
        this.notes.length = noted;
        thenBody = [];
        elseBody = [];
        sFall = this.region(fall, stops, cloneState(st), elseBody, -1);
        sTaken = this.region(taken, stops, cloneState(st), thenBody, -1);
        tail = true;
      }
      if (!thenBody.length && !elseBody.length) {
        // both ways meet with nothing between (a loop's end, a check that does not matter)
      } else if (cond === null) {
        this.note(`条件が決まらない分岐 (0x${blk.end.toString(16)})`, out);
        out.push({ k: 'if', cond: '?', then: thenBody, else: elseBody });
      } else if (!thenBody.length && elseBody.length)
        out.push({ k: 'if', cond: negate(cond), then: elseBody, else: [] });
      else if (thenBody.length || elseBody.length) {
        // the fall-through first, as it is written in the code
        out.push(
          elseBody.length
            ? { k: 'if', cond: negate(cond), then: elseBody, else: thenBody }
            : { k: 'if', cond, then: thenBody, else: [] },
        );
      }
      st = mergeStates(sFall, sTaken);
      if (join === -1 || tail) return st;
      b = join;
    }
    return st;
  }
  private tableValue(blk: Block, st: State, out: Stmt[]): { text: string | null; base: number } {
    const m = /\[pc, (r\d+), lsl #2\]/u.exec(this.v.insn(blk.end).text);
    const x = m ? st.r[regNo(m[1]!)]! : null;
    if (x?.k === 'v') return { text: this.use({ ...x, add: 0 }, out), base: -x.add };
    return { text: null, base: 0 };
  }
}
/** The size of the game's class an event derives from (its members are the game's, set by its constructor). */
const baseSize = (base: string): number =>
  ({
    EventScript: 0xc,
    NpcCommonTurn: 0x74,
    NpcCommon: 0x74,
    CommonHeroMsg: 0x74,
    IntroCommon: 0x78,
    GimmickPushButtonCommon: 0x68,
    GimmickKeepPushButtonCommon: 0x68,
  })[base] ?? 0x1000;
const VEC_SYMS = new Set(['_ZNK11ScriptChara6GetPosEv', '_ZNK11ScriptChara12GetShadowPosEv']);
function negate(c: string): string {
  const m = /^(.*) (==|!=|<|>=|>|<=) ([^ ]+)$/u.exec(c);
  if (m && !/&&|\|\|/u.test(c)) return `${m[1]} ${NEG[m[2]!]} ${m[3]}`;
  if (/^!\w+$/u.test(c)) return c.slice(1);
  if (/^\w+$/u.test(c)) return `!${c}`;
  if (/^!\((.*)\)$/u.test(c)) return c.slice(2, -1);
  return `!(${c})`;
}
/** A mangled name, readable ("ScriptChara::Foo"). */
export function demangle(sym: string): string {
  const m = /^_ZNK?((?:\d+\w+?)+)E/u.exec(sym);
  if (!m) return sym;
  const parts: string[] = [];
  let s = m[1]!;
  while (s) {
    const n = /^(\d+)/u.exec(s);
    if (!n) break;
    const len = Number(n[1]);
    parts.push(s.slice(n[1]!.length, n[1]!.length + len));
    s = s.slice(n[1]!.length + len);
  }
  return parts.join('::');
}

// ------------------------------------------------------------------------------------------------ 3. the library
interface Template {
  name: string;
  params: string[];
  kinds: string[];
  lines: string[];
}
const TEMPLATES: Template[] = SCRIPT_LIBRARY.filter((f) => !['turn', 'face', 'vanish'].includes(f.name)).map((f) => {
  const head = /function (\w+)\(([^)]*)\)/u.exec(f.source)!;
  const body = f.source.slice(f.source.indexOf('{') + 1, f.source.lastIndexOf('}'));
  return {
    name: head[1]!,
    params: head[2]!
      .split(',')
      .map((p) => p.split(':')[0]!.trim())
      .filter(Boolean),
    kinds: head[2]!
      .split(',')
      .filter((p) => p.trim())
      .map((p) => p.split(':')[1]!.trim()),
    lines: body
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/u, '').trim())
      .filter(Boolean)
      .map((l) => l.replace(/^obj\((\w+)\)\.open\(\)$/u, 'open($1)')),
  };
});
// the ones made of others last (openDoor uses camera, open, jingle, cameraBack; walk uses move)
TEMPLATES.sort(
  (a, b) => Number(a.lines.some((l) => /^[a-z]\w*\(/u.test(l))) - Number(b.lines.some((l) => /^[a-z]\w*\(/u.test(l))),
);

const numOf = (s: string): number | null => (/^-?(0x[0-9a-f]+|\d+(\.\d+)?)$/iu.test(s) ? Number(s) : null);
const sameNum = (a: number, b: number): boolean => a === b || Math.fround(a) === Math.fround(b);
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let d = 0,
    cur = '';
  for (const ch of s) {
    if (ch === '(') d++;
    if (ch === ')') d--;
    if (ch === ',' && d === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Matches a statement's text with a template line, binding the parameters. */
function matchLine(tpl: string, text: string, params: string[], bind: Map<string, string>): boolean {
  const a = /^([\w.]+(?:\([^()]*\))?)\.?(\w*)\((.*)\)$/u.exec(tpl);
  const b = /^([\w.]+(?:\([^()]*\))?)\.?(\w*)\((.*)\)$/u.exec(text);
  if (!a || !b) return false;
  const term = (t: string, x: string): boolean => {
    if (params.includes(t)) {
      const old = bind.get(t);
      if (old !== undefined)
        return old === x || (numOf(old) !== null && numOf(x) !== null && sameNum(numOf(old)!, numOf(x)!));
      bind.set(t, x);
      return true;
    }
    const call = /^([\w.]+)\((.*)\)$/u.exec(t),
      call2 = /^([\w.]+)\((.*)\)$/u.exec(x);
    if (call && call2) {
      if (call[1] !== call2[1]) return false;
      const p = splitArgs(call[2]!),
        q = splitArgs(call2[2]!);
      return p.length === q.length && p.every((y, k) => term(y, q[k]!));
    }
    const n = numOf(t),
      m = numOf(x);
    if (n !== null && m !== null) return sameNum(n, m);
    return t === x;
  };
  // receiver: `who.F(…)` or `obj(door).F(…)` or `Class.F(…)` or `f(…)`
  const ra = tpl.slice(
    0,
    tpl.indexOf('(') >= 0 && !tpl.startsWith('obj(') ? tpl.lastIndexOf('.', tpl.indexOf('(')) : tpl.indexOf(').') + 1,
  );
  const rb = text.slice(
    0,
    text.indexOf('(') >= 0 && !text.startsWith('obj(')
      ? text.lastIndexOf('.', text.indexOf('('))
      : text.indexOf(').') + 1,
  );
  const fa = tpl.slice(ra.length).replace(/^\./u, ''),
    fb = text.slice(rb.length).replace(/^\./u, '');
  const na = fa.slice(0, fa.indexOf('(')),
    nb = fb.slice(0, fb.indexOf('('));
  if (na !== nb) return false;
  if ((ra === '') !== (rb === '')) return false;
  if (ra && !term(ra, rb)) return false;
  const pa = splitArgs(fa.slice(fa.indexOf('(') + 1, -1)),
    pb = splitArgs(fb.slice(fb.indexOf('(') + 1, -1));
  return pa.length === pb.length && pa.every((t, k) => term(t, pb[k]!));
}
export function stmtText(s: Stmt): string | null {
  if (s.k === 'call') return `${s.who ?? s.cls}.${s.name}(${s.args.join(', ')})`;
  if (s.k === 'text') return s.text;
  return null;
}
/** Folds the library's shapes in a list (and the lists inside). */
export function fold(list: Stmt[]): Stmt[] {
  for (const s of list) {
    if (s.k === 'if') {
      s.then = fold(s.then);
      s.else = fold(s.else);
    } else if (s.k === 'switch') {
      for (const c of s.cases) c.body = fold(c.body);
      s.def = fold(s.def);
    } else if (s.k === 'party') s.body = fold(s.body);
  }
  let cur = list;
  for (const t of TEMPLATES) {
    const next: Stmt[] = [];
    for (let k = 0; k < cur.length; k++) {
      const bind = new Map<string, string>();
      let ok = k + t.lines.length <= cur.length;
      for (let j = 0; ok && j < t.lines.length; j++) {
        const x = stmtText(cur[k + j]!);
        ok = x !== null && matchLine(t.lines[j]!, x, t.params, bind);
      }
      // the arguments must be what the parameter takes: a number, or a character for obj
      const fits = (p: string, k: number): boolean => {
        const x = bind.get(p);
        if (x === undefined) return false;
        return t.kinds[k] === 'obj'
          ? /^(hero|self|p\d*|obj\(\w+\))$/u.test(x)
          : numOf(x) !== null || /^obj\(\w+\)$/u.test(x);
      };
      if (ok && t.params.every(fits)) {
        // obj(N) bound to a number parameter (open(door): obj(door)) is N
        const args = t.params.map((p) =>
          bind
            .get(p)!
            .replace(/^obj\((.*)\)$/u, (m, n: string) => (t.lines.some((l) => l.includes(`obj(${p})`)) ? n : m)),
        );
        next.push({ k: 'text', text: `${t.name}(${args.join(', ')})` });
        k += t.lines.length - 1;
      } else next.push(cur[k]!);
    }
    cur = next;
  }
  return cur;
}

// ------------------------------------------------------------------------------------------------ output
export function render(list: Stmt[], depth: number): string[] {
  const pad = '  '.repeat(depth);
  const out: string[] = [];
  for (const s of list) {
    switch (s.k) {
      case 'call':
      case 'text':
        out.push(pad + stmtText(s)!);
        break;
      case 'note':
        out.push(`${pad}// 未対応: ${s.text}`);
        break;
      case 'raw':
        out.push(...s.lines.map((l) => pad + l));
        break;
      case 'if':
        if (s.cond === '?') {
          out.push(`${pad}// 未対応: 条件が決まらない。成り立つときの処理:`);
          out.push(...render(s.then, 0).map((l) => `${pad}// ${l}`));
          if (s.else.length) {
            out.push(`${pad}// 成り立たないときの処理:`);
            out.push(...render(s.else, depth));
          }
          break;
        }
        out.push(`${pad}if (${s.cond}) {`, ...render(s.then, depth + 1));
        if (s.else.length === 1 && s.else[0]!.k === 'if' && s.else[0]!.cond !== '?') {
          const inner = render(s.else, depth);
          out.push(`${pad}} else ${inner[0]!.trimStart()}`, ...inner.slice(1));
        } else if (s.else.length) out.push(`${pad}} else {`, ...render(s.else, depth + 1), `${pad}}`);
        else out.push(`${pad}}`);
        break;
      case 'switch':
        out.push(`${pad}switch (${s.value}) {`);
        for (const c of s.cases) out.push(`${pad}  case ${hexText(c.v)}:`, ...render(c.body, depth + 2));
        if (s.def.length) out.push(`${pad}  default:`, ...render(s.def, depth + 2));
        out.push(`${pad}}`);
        break;
      case 'party':
        out.push(`${pad}for ${s.name} in party {`, ...render(s.body, depth + 1), `${pad}}`);
        break;
    }
  }
  return out;
}

/** A class's event, decompiled. */
export interface CroEventSource {
  cls: string;
  base: string;
  /** Where the factories bind it (empty: made some other way, e.g. by another event). */
  bindings: CroBinding[];
  /** The function's text (`function NAME() { … }`). */
  text: string;
  /** What could not be written as script (empty: the text is the event). */
  notes: string[];
  flags: FlagUse[];
}
export interface CroDecompiled {
  events: CroEventSource[];
  /** The flags set back to 0 when the stage is left (export 27). */
  resets: Set<string>;
}

/** Simplifications of a body: the talk event's opening (our compiler writes it), a party loop's guard. */
function tidy(list: Stmt[], base: string): Stmt[] {
  let out = list;
  if (/^NpcCommon/u.test(base)) {
    const first = out.slice(0, 2).map(stmtText);
    if (first.includes('event.TurnHero()') && first.includes('event.TurnNpc()')) out = out.slice(2);
  }
  // `if (ScriptMap.GetPlayerNum() != 0) { for p in party { … } }`: the loop alone
  out = out.map((s) =>
    s.k === 'if' &&
    /GetPlayerNum\(\)/u.test(s.cond) &&
    s.then.length === 1 &&
    s.then[0]!.k === 'party' &&
    !s.else.length
      ? s.then[0]!
      : s,
  );
  while (out.length && out[out.length - 1]!.k === 'text' && (out[out.length - 1] as { text: string }).text === 'return')
    out = out.slice(0, -1);
  return out;
}

/** The trigger of a class made by a factory slot, by its game class. */
const triggerOf = (b: CroBinding, base: string): ScriptTrigger =>
  b.trigger === 'start' && base === 'IntroCommon'
    ? 'intro'
    : b.trigger === 'button' && base === 'GimmickKeepPushButtonCommon'
      ? 'switch'
      : b.trigger;

/** Reads a content's CRO and writes its events back as script. */
export function decompileContentCro(bytes: Uint8Array): CroDecompiled {
  const v = new CroView(bytes);
  const img = croImage(v);
  const classes = new Map<string, CroClass>();
  const classAt = (r: Ref): CroClass => {
    const k = key(r.seg, r.off);
    let c = classes.get(k);
    if (!c) classes.set(k, (c = classOf(v, r)));
    return c;
  };
  members.clear();
  factoryEffects.clear();
  const bindings = runFactories(v, img, classAt);
  // classes no factory makes (made by another event, by the stage's own code): kept by their vtables in the data
  const byName = new Map<string, CroClass>();
  for (const c of classes.values()) byName.set(c.name, c);
  const events: CroEventSource[] = [];
  const resets = leaveResets(v, img);
  for (const [name, c] of byName) {
    const own = bindings.filter((b) => b.cls === name).map((b) => ({ ...b, trigger: triggerOf(b, c.base) }));
    const intro = c.base === 'IntroCommon';
    const execSlot = c.slots[intro ? 6 : 3];
    const notes: string[] = [];
    const flags = new Map<string, FlagUse>();
    let body: Stmt[] = [];
    /** The ScriptEffect members the functions call (name → offset in the event's object). */
    const usedFx = new Map<string, number>();
    if (execSlot && 'fn' in execSlot) {
      const d = new FunctionDecompiler(v, c, flags, execSlot.fn, agreed(name));
      try {
        body = d.decompile();
        notes.push(...d.notes);
      } catch (e) {
        body = [];
        notes.push(`本体を読めなかった (${(e as Error).message})`);
        body.push({ k: 'note', text: notes[notes.length - 1]! });
      }
      d.usedEffects.forEach((o, n) => usedFx.set(n, o));
    } else notes.push(`本体はゲームの ${c.base} のまま (CRO にはない)`);
    const ctrl = c.slots[4];
    if (ctrl && 'fn' in ctrl) {
      const d = new FunctionDecompiler(v, c, flags, ctrl.fn, agreed(name));
      let after: Stmt[];
      try {
        after = d.decompile();
      } catch (e) {
        after = [{ k: 'note', text: `CtrlFlag を読めなかった (${(e as Error).message})` }];
        d.notes.push('CtrlFlag を読めなかった');
      }
      if (after.length) {
        body.push({ k: 'note', text: '以下は Execute のあとの CtrlFlag (ゲームが状態を進める処理の上書き)' });
        body.push(...after.filter((s) => !(s.k === 'note' && /EventScript::CtrlFlag/u.test(s.text))));
      }
      notes.push(...d.notes.map((n) => `CtrlFlag: ${n}`));
      if (!d.notes.length) notes.push('CtrlFlag を本体の末尾に移した');
      d.usedEffects.forEach((o, n) => usedFx.set(n, o));
    }
    // the preparation when the map is read (vt+0x8): the language has no place for it, so it is written as comments
    // before the body (what it does to the map's things: hides them, puts them away, makes the effects …)
    const prep = c.slots[2];
    let prepLines: string[] = [];
    if (prep && 'fn' in prep && !isEmptyFn(v, prep.fn)) {
      notes.push('マップを読み込んだときの準備 (vt+0x8) がある');
      const d = new FunctionDecompiler(v, c, flags, prep.fn, agreed(name));
      let pre: Stmt[];
      try {
        pre = tidy(fold(d.decompile()), c.base);
      } catch (e) {
        pre = [{ k: 'note', text: `準備を読めなかった (${(e as Error).message})` }];
      }
      d.usedEffects.forEach((o, n) => usedFx.set(n, o));
      prepLines = [
        '  // マップを読み込んだときの準備 (vt+0x8)。言語に書く所がないので、コメントにした:',
        ...render(pre, 0).map((l) => `  // ${l}`),
      ];
    }
    body = tidy(fold(body), c.base);
    // the effects: declared, and made as the constructor made them (when the functions do not make them)
    const made = factoryEffects.get(name) ?? new Map<number, [number, number]>();
    const fxLines: string[] = [];
    const callsText = render(body, 0).join('\n');
    for (const [n, off] of [...usedFx].sort((a, b) => a[1] - b[1])) {
      fxLines.push(`  effect ${n}`);
      const m = made.get(off);
      if (m && !callsText.includes(`${n}.CreateEffect(`))
        fxLines.push(
          `  ${n}.CreateEffect(${hexText(m[0])}, ${m[1]})   // コンストラクタで作る (EffectData の行 ${hexText(m[0])})`,
        );
    }
    const lines = [...fxLines, ...prepLines, ...render(body, 1)];
    const head = [
      ...(notes.filter((n) => !/^CtrlFlag を本体/u.test(n)).length ? [] : []),
      ...own.map(
        (b) =>
          `// 元の割り当て: on ${b.trigger}(${b.group}${b.trigger === 'start' || b.trigger === 'intro' ? '' : `, ${hexText(b.row)}`}) ${name}${b.when.length ? `  (生成の条件: ${b.when.join(', ')})` : ''}`,
      ),
    ];
    if (!own.length) head.push('// 元の割り当て: ファクトリからは作られない (ほかのイベントが作るか、使われていない)');
    events.push({
      cls: name,
      base: c.base,
      bindings: own,
      text: [...head, `function ${name}() {`, ...lines, '}'].join('\n'),
      notes: notes.filter((n) => !/^CtrlFlag を本体/u.test(n)),
      flags: [...flags.values()],
    });
  }
  return { events, resets };
}
const isEmptyFn = (v: CroView, o: number): boolean => /^bx lr$/u.test(v.insn(o).text);

/** What export 27 (the stage is left) sets back to 0: those variables are `reset`. */
function leaveResets(v: CroView, img: Image): Set<string> {
  const out = new Set<string>();
  const entry = img.entry(27);
  if (entry === null) return out;
  const stubs = new Map<number, Stub>();
  for (const [fake, sym] of img.syms)
    stubs.set(fake, (m) => {
      if ((sym === A.setBit || sym === A.setByte) && (m.r[1]! & 0xff) === 0)
        out.add(flagVar({ kind: sym === A.setBit ? 'bit' : 'byte', flag: m.r[0]! & 0xffff }));
      return 0;
    });
  try {
    new ArmMachine(img.m.code, { stubs, maxDepth: 8, maxSteps: 20000, textEnd: BASE + img.m.code.length }).run(
      entry,
      [],
    );
  } catch {
    // a part of it is enough
  }
  return out;
}

/** The text to insert for some of a CRO's events: the variables they use, then their functions. */
export function decompiledSource(d: CroDecompiled, names: string[], content?: number): string {
  const chosen = d.events.filter((e) => names.includes(e.cls));
  const flags = new Map<string, FlagUse>();
  for (const e of chosen) for (const f of e.flags) flags.set(flagVar(f), f);
  const vars = [...flags.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([n, f]) =>
        `var ${n}: ${f.kind}${d.resets.has(n) ? ' reset' : ''}   // 元: Script${f.kind === 'bit' ? 'Bit' : 'Byte'}Flag ${hexText(f.flag)} (このステージ専用の番号に替わる)`,
    );
  return [
    `// コンテンツ ${content ?? '?'} の CRO から逆変換した雛形。行 ID・台詞・マップは元のステージのもの`,
    ...vars,
    ...chosen.map((e) => e.text),
  ].join('\n');
}

/** The bytes every object the factories made of a class has in common. */
function agreed(name: string): Map<number, number> {
  const objs = members.get(name) ?? [];
  const out = new Map<number, number>();
  if (!objs.length) return out;
  for (let k = 0; k < objs[0]!.length; k++) if (objs.every((o) => o[k] === objs[0]![k])) out.set(k, objs[0]![k]!);
  return out;
}
