// Event scripts (EventObject kind 0x24, and the other kinds the same way): the game builds the behaviour of a row in
// code, by dungeon and row number. Running the "make the action" function of the row's handler with game/arm.ts
// gives the class (vtable) it builds; the class's own functions give the messages it shows and the rows it
// completes. docs/event-list.md §3.
import { ArmMachine, ArmStop, TEXT_END } from './arm';
import { BASE } from './codeconst';
import { u32 } from '../util/bytes';

/** FUN_0030B788: the current dungeon (save variable 0x4F). */
export const F_DUNGEON = 0x30b788;
/** FUN_0033D690: operator new. */
export const F_ALLOC = 0x33d690;
/** FUN_0031AA2C(row): complete a row (docs/events.md §2). */
export const F_COMPLETE = 0x31aa2c;
/** MessageField_JP.gsmb */
const MSG_FIRST = 0x1bdf;
const MSG_LAST = 0x21af;
/** Callees with more callers than this are shared parts, not followed. */
const MAX_FANIN = 6;

/**
 * "Make the action" (vtable[4] of the handler the map record builds) by section and record kind.
 * docs/events.md §1. Sections 4 (chests) and 8 (ranges) have one handler each.
 */
export function makeFunction(section: number, kind: number): number | null {
  if (section === 4) return 0x4365d4;
  if (section === 8) return 0x1f41c8;
  if (section === 3) {
    if ([0, 1, 3, 9, 10].includes(kind)) return 0x4362b4;
    if (kind === 2) return 0x439bbc;
    if (kind === 6) return 0x436400;
    if (kind === 4 || kind === 5 || kind === 18) return 0x1c0270;
    if (kind >= 11 && kind <= 17) return 0x4300a4;
    if (kind >= 0x13 && kind <= 0x2e) return 0x1e1d3c;
  }
  if (section === 5) {
    if (kind === 0) return 0x42b52c;
    if (kind === 1) return 0x1f0ff0;
    if ([2, 3, 4, 8].includes(kind)) return 0x1d1970;
    if (kind === 5 || kind === 6) return 0x1da97c;
  }
  return null;
}

/** Every "make the action" function, tried for rows no map uses. */
export const MAKE_FUNCTIONS = [0x1c0270, 0x1d1970, 0x1da97c, 0x1e1d3c, 0x1f0ff0, 0x1f41c8, 0x42b52c, 0x4300a4, 0x4362b4, 0x436400, 0x4365d4, 0x439bbc];

export interface BuiltAction {
  make: number;
  vtable: number;
  /** Code addresses the build passed to calls or stored in objects (callbacks). */
  pointers: number[];
}

/**
 * Run `make` for one EventObject row as if the game loaded it in `dungeon`; the class it builds, or null when it
 * builds nothing. `kind` is the kind the handler passes (EventObject +0x4D).
 */
export function buildAction(code: Uint8Array, make: number, dungeon: number, row: number, eventRow: Uint8Array, kind = eventRow[0x4d] ?? 0x24): BuiltAction | null {
  const allocs: { depth: number; p: number }[] = [];
  const stubs = new Map([
    [F_ALLOC, (m: ArmMachine) => {
      const p = m.alloc(m.r[0]!);
      allocs.push({ depth: m.depth, p });
      return p;
    }],
    [F_DUNGEON, () => dungeon],
  ]);
  const m = new ArmMachine(code, { stubs, maxDepth: 4 });
  const handler = m.alloc(0x40), ev = m.alloc(0x50), dun = m.alloc(0x400), arg = m.alloc(0x20);
  eventRow.forEach((b, k) => m.wb(ev + k, b));
  m.write(handler + 4, row, 4);
  m.write(handler + 8, ev, 4);
  m.write(handler + 0x18, dun, 4);
  let vtable = 0;
  try {
    const obj = m.run(make, [handler, kind, arg]);
    vtable = obj ? m.read(obj, 4) : 0;
  } catch (e) {
    if (!(e instanceof ArmStop)) throw e;
    // lost on the made-up data after building: the last vtable written to the first object it made
    const first = allocs.find((a) => a.depth === 0)?.p;
    for (const [a, v] of m.writes) if (a === first && v >= 0x4c0000 && v < 0x511000) vtable = v;
  }
  if (!vtable) return null;
  const pointers = new Set<number>();
  for (const c of m.calls) if (c.target !== F_ALLOC) for (const v of c.args) if (v >= BASE && v < TEXT_END) pointers.add(v);
  for (const [a, v] of m.writes) if (a >= 0x30000000 && v >= BASE && v < TEXT_END) pointers.add(v);
  return { make, vtable, pointers: [...pointers] };
}

/** The 8 entries of a class's vtable ([1] destructor, [2] every frame ...). */
export function vtableEntries(code: Uint8Array, vtable: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 8; k++) out.push(vtable - BASE + k * 4 + 4 <= code.length ? u32(code, vtable - BASE + k * 4) : 0);
  return out;
}

const blTarget = (w: number, at: number): number | null => {
  if ((w & 0x0f000000) !== 0x0b000000 || w >>> 28 === 0xf) return null;
  let off = w & 0xffffff;
  if (off & 0x800000) off -= 0x1000000;
  return (at + 8 + off * 4) >>> 0;
};

export interface FunctionScan {
  calls: number[];
  messages: Set<number>;
  completes: Set<number>;
}

/** Function bounds and callers in .text, and what each function loads (code.bin). */
export class CodeIndex {
  readonly fanin = new Map<number, number>();
  private readonly starts: number[];
  private readonly startSet: Set<number>;
  private readonly cache = new Map<number, FunctionScan>();

  constructor(
    readonly code: Uint8Array,
    vtables: Iterable<number> = [],
  ) {
    const end = Math.min(TEXT_END, BASE + code.length);
    const starts = new Set<number>();
    for (let a = BASE; a < end; a += 4) {
      const w = u32(code, a - BASE);
      const t = blTarget(w, a);
      if (t !== null && t >= BASE && t < end) {
        this.fanin.set(t, (this.fanin.get(t) ?? 0) + 1);
        starts.add(t);
      }
      if ((w & 0xffff4000) >>> 0 === 0xe92d4000) starts.add(a); // push {..., lr}
    }
    for (const vt of vtables) for (const e of vtableEntries(code, vt)) if (e >= BASE && e < end) starts.add(e);
    this.startSet = starts;
    this.starts = [...starts].sort((a, b) => a - b);
  }

  isStart(a: number): boolean {
    return this.startSet.has(a);
  }

  /** End of the function at `f` (the next start). */
  end(f: number): number {
    let lo = 0, hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid]! <= f) lo = mid + 1;
      else hi = mid;
    }
    return this.starts[lo] ?? TEXT_END;
  }

  scan(f: number): FunctionScan {
    let s = this.cache.get(f);
    if (s) return s;
    s = { calls: [], messages: new Set(), completes: new Set() };
    const code = this.code;
    for (let a = f; a < this.end(f); a += 4) {
      const w = u32(code, a - BASE);
      const t = blTarget(w, a);
      if (t !== null) {
        s.calls.push(t);
        if (t === F_COMPLETE) {
          // mov r0, #n shortly before (nops skipped)
          for (let b = a - 4; b > a - 16; b -= 4) {
            const p = u32(code, b - BASE);
            if (p === 0xe320f000) continue;
            if ((p & 0xfffff000) >>> 0 === 0xe3a00000) s.completes.add(rotImm(p));
            break;
          }
        }
      } else if ((w & 0x0f7f0000) === 0x051f0000 && w >>> 28 !== 0xf) {
        const imm = w & 0xfff;
        const lit = a + 8 + (w & 0x800000 ? imm : -imm);
        if (lit >= BASE && lit + 4 <= BASE + code.length) {
          const v = u32(code, lit - BASE);
          if (v >= MSG_FIRST && v <= MSG_LAST) s.messages.add(v);
        }
      }
    }
    this.cache.set(f, s);
    return s;
  }

  /** Messages and completed rows of the functions reachable from `roots` (callees with few callers only). */
  reach(roots: number[]): { functions: number[]; messages: number[]; completes: number[] } {
    const seen = new Set<number>();
    const stack = [...roots];
    const messages = new Set<number>(), completes = new Set<number>();
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f) || f < BASE || f >= TEXT_END) continue;
      seen.add(f);
      const s = this.scan(f);
      s.messages.forEach((v) => messages.add(v));
      s.completes.forEach((v) => completes.add(v));
      for (const t of s.calls) if ((this.fanin.get(t) ?? 0) <= MAX_FANIN) stack.push(t);
    }
    const num = (a: number, b: number) => a - b;
    return { functions: [...seen].sort(num), messages: [...messages].sort(num), completes: [...completes].sort(num) };
  }
}

const rotImm = (w: number): number => {
  const rot = ((w >>> 8) & 15) * 2;
  const v = w & 0xff;
  return rot ? ((v >>> rot) | (v << (32 - rot))) >>> 0 : v;
};

export interface ScriptClass {
  vtable: number;
  /** Functions of the class no other script class shares, and the callbacks its build registered. */
  roots: number[];
  messages: number[];
  completes: number[];
}

/**
 * Describe the classes: roots = vtable entries unique among `built` plus the callbacks the builds registered;
 * then the messages / completed rows reachable from them.
 */
export function describeClasses(code: Uint8Array, built: BuiltAction[]): Map<number, ScriptClass> {
  const vtables = new Set(built.map((b) => b.vtable));
  const index = new CodeIndex(code, vtables);
  const shared = new Map<number, number>();
  for (const vt of vtables) for (const e of vtableEntries(code, vt)) shared.set(e, (shared.get(e) ?? 0) + 1);
  const pointers = new Map<number, Set<number>>();
  for (const b of built) {
    let s = pointers.get(b.vtable);
    if (!s) pointers.set(b.vtable, (s = new Set()));
    b.pointers.forEach((p) => s.add(p));
  }
  const out = new Map<number, ScriptClass>();
  for (const vt of vtables) {
    const roots = vtableEntries(code, vt).filter((e) => e >= BASE && e < TEXT_END && shared.get(e) === 1);
    for (const p of pointers.get(vt) ?? []) if (index.isStart(p) && (index.fanin.get(p) ?? 0) <= MAX_FANIN && !roots.includes(p)) roots.push(p);
    const { messages, completes } = index.reach(roots);
    out.set(vt, { vtable: vt, roots, messages, completes });
  }
  return out;
}
