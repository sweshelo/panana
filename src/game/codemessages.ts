// Messages the game's code shows by ID: the story and event conversations of MessageField (the first meeting, the
// bosses, the ending ...), which no EventObject row names. The code keeps the IDs as literal-pool words loaded by
// `ldr rX, [pc, #imm]`, or as `movw` immediates (docs/analysis.md "GMSG").
//
// A function is taken to start at the nearest `push` (stmdb sp!) before the instruction that uses the ID. That is
// a guess: leaf functions without a push fall into the function before them, so a group can be two functions.
import { BASE } from './codebin';
import { u32 } from '../util/bytes';

/** Size of the .text segment of v1.1.0 (exheader +0x18); code.bin holds .rodata / .data after it. */
export const TEXT_SIZE = 0x3bf01c;

export interface CodeMessageRef {
  id: number;
  /** Address of the instruction that loads the ID. */
  at: number;
}

export interface CodeMessageGroup {
  /** Address of the function (the push it starts with). */
  fn: number;
  /** Message IDs in ID order (each once). */
  ids: number[];
  refs: CodeMessageRef[];
}

const isPush = (w: number): boolean => w >>> 16 === 0xe92d;

/** Every place in .text that loads an ID in first..last (ARM code). */
export function findCodeMessageRefs(code: Uint8Array, first: number, last: number): CodeMessageRef[] {
  const end = Math.min(TEXT_SIZE, code.length) & ~3;
  const out: CodeMessageRef[] = [];
  for (let o = 0; o < end; o += 4) {
    const w = u32(code, o);
    if (w >>> 28 === 0xf) continue;
    if ((w & 0x0f7f0000) === 0x051f0000) {
      // LDR rd, [pc, #±imm12]: pc = this + 8
      const imm = w & 0xfff;
      const t = o + 8 + (w & 0x800000 ? imm : -imm);
      if (t >= 0 && t + 4 <= code.length && !(t & 3)) {
        const v = u32(code, t);
        if (v >= first && v <= last) out.push({ id: v, at: BASE + o });
      }
    } else if (((w >>> 20) & 0xff) === 0x30) {
      // MOVW rd, #imm16
      const v = ((w >>> 4) & 0xf000) | (w & 0xfff);
      if (v >= first && v <= last) out.push({ id: v, at: BASE + o });
    }
  }
  return out;
}

/** The refs grouped by function, in order of their lowest ID. */
export function groupByFunction(code: Uint8Array, refs: CodeMessageRef[]): CodeMessageGroup[] {
  const groups = new Map<number, CodeMessageGroup>();
  for (const r of refs) {
    let o = r.at - BASE;
    while (o > 0 && !isPush(u32(code, o))) o -= 4;
    const fn = BASE + o;
    let g = groups.get(fn);
    if (!g) groups.set(fn, (g = { fn, ids: [], refs: [] }));
    g.refs.push(r);
  }
  for (const g of groups.values()) g.ids = [...new Set(g.refs.map((r) => r.id))].sort((a, b) => a - b);
  return [...groups.values()].sort((a, b) => a.ids[0]! - b.ids[0]! || a.fn - b.fn);
}

export const fnName = (fn: number): string => `FUN_${fn.toString(16).toUpperCase().padStart(8, '0')}`;

/** The message file the story conversations are in. */
export const STORY_FILE = /^MessageField_JP\.gsmb$/;

const cache = new WeakMap<Uint8Array, CodeMessageGroup[]>();

/** Groups of the MessageField IDs that code.bin loads (cached per code.bin). */
export function storyGroups(code: Uint8Array, first: number, last: number): CodeMessageGroup[] {
  let g = cache.get(code);
  if (!g) cache.set(code, (g = groupByFunction(code, findCodeMessageRefs(code, first, last))));
  return g;
}
