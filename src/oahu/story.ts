// 電波人間のRPG3's story (#87; naauao oahu/story.md): the story step (save key 0x74) and the navi table mapNavi.bin,
// the save values (flagData.bin) with the story values 0xF9 / flags 0xFA split by the dungeons' ranges (mapGroup),
// where the code writes them (the immediates before the calls to the writers, found by scanning the Update's
// code.bin; nothing is listed by hand), what reads them, and the appearance conditions run on a chosen state with
// game/arm.ts (FUN_004B62BC with the save getters stubbed) for the map preview.
import { ArmMachine, ArmStop } from '../game/arm';
import { encodeImm } from '../game/asm';
import { BASE } from '../game/codeconst';
import { CodeIndex } from '../game/scripts';
import { u16, u32, u8 } from '../util/bytes';
import type { OahuMaster } from './master';
import { OAHU_TEXT_END } from './scripts';

/** Save keys (rows of flagData.bin) the story uses. */
export const OAHU_KEY = { residents: 0x49, dungeon: 0x55, step: 0x74, values: 0xf9, flags: 0xfa, hint: 0xfc } as const;

/** Navi rows below this are the story steps; the others are the collection hints (`cmp r0, #0x64` at 0x1F1708). */
export const OAHU_STORY_STEPS = 100;

/** Functions of the Update's code.bin (story.md §2, §4; map.md §5.2). */
export const OAHU_STORY_CODE = {
  /** FUN_00212FB8(): the step. */
  getStep: 0x212fb8,
  /** FUN_00213010(step): sets the step (plays mapNavi +0x00, clears the hint number 0xFC). */
  setStep: 0x213010,
  /** FUN_002ECE28(obj, step): the "set the step" action built on entering a map (FUN_0018D848's checks). */
  stepAction: 0x2ece28,
  /** Writers: 0xF9[i] = v, 0xFA[i] = v, the current dungeon's value / flag i, a dungeon's value / flag i. */
  setValue: 0x1ee8f8,
  setFlag: 0x1ee850,
  setHereValue: 0x1ee30c,
  setHereFlag: 0x1ede48,
  setDungeonValue: 0x1ee3b0,
  setDungeonFlag: 0x1edeec,
  /** Readers (the conditions' getters). */
  getValue: 0x1ee8b8,
  getFlag: 0x1ee7dc,
  getHereValue: 0x1edfec,
  getDungeonValue: 0x1ee090,
  getDungeonFlag: 0x1edcf0,
  getResident: 0x2cd730,
  /** FUN_004A2D3C(save, key): a save value with one element (conditions 0x1F〜0x21). */
  getKey: 0x4a2d3c,
  /** FUN_004B62BC(row, kind, v1, v2): an appearance condition (map.md §5.2). */
  condition: 0x4b62bc,
  /** FUN_001ED9B8(n): the named conditions (kind 0x01). */
  named: 0x1ed9b8,
  /** FUN_0018D848: the checks on entering a map that build the step actions (§4.2). */
  enterChecks: 0x18d848,
} as const;

// ---- the save values

export interface OahuSaveKey {
  key: number;
  max: number;
  count: number;
  bits: number;
}

/** The rows of flagData.bin (§3.1): key = row. */
export function oahuSaveKeys(master: OahuMaster): OahuSaveKey[] {
  const t = master.table('flagData.bin');
  return Array.from({ length: t.rows }, (_, key) => {
    const r = t.row(key);
    return { key, max: u32(r, 0), count: u16(r, 8), bits: u8(r, 0x0b) / 4 };
  });
}

/** A dungeon's share of 0xF9 (values) and 0xFA (flags): mapGroup +0x26 / +0x28 and +0x2A / +0x2C. */
export interface OahuValueRange {
  dungeon: number;
  values: [start: number, count: number];
  flags: [start: number, count: number];
  /** mapGroup +0x08: the place hash (mapNavi +0x04). */
  place: number;
  /** mapGroup +0x1C. */
  nameId: number;
}

export function oahuValueRanges(master: OahuMaster): OahuValueRange[] {
  const t = master.table('mapGroup.bin');
  return Array.from({ length: t.rows }, (_, dungeon) => {
    const r = t.row(dungeon);
    return { dungeon, values: [u16(r, 0x26), u8(r, 0x28)], flags: [u16(r, 0x2a), u8(r, 0x2c)], place: u32(r, 8), nameId: u32(r, 0x1c) };
  });
}

export type ValueKind = 'values' | 'flags';
export const VALUE_KEY: Record<ValueKind, number> = { values: OAHU_KEY.values, flags: OAHU_KEY.flags };

/** The dungeon whose range holds element `index` of 0xF9 / 0xFA. */
export function oahuRangeOf(ranges: OahuValueRange[], kind: ValueKind, index: number): OahuValueRange | undefined {
  return ranges.find((g) => index >= g[kind][0] && index < g[kind][0] + g[kind][1]);
}

/** "0xF9[4]" / "0xFA[12]". */
export const valueLabel = (kind: ValueKind, index: number): string => `0x${VALUE_KEY[kind].toString(16).toUpperCase()}[${index}]`;
/** Key of a value's name in the session ("values.4"). */
export const valueNameKey = (kind: ValueKind, index: number): string => `${kind}.${index}`;

// ---- reading arguments out of the code

const COND_AL = 14;
const word = (code: Uint8Array, a: number): number => u32(code, a - BASE);
const rotImm = (w: number): number => {
  const rot = ((w >>> 8) & 15) * 2;
  const v = w & 0xff;
  return rot ? ((v >>> rot) | (v << (32 - rot))) >>> 0 : v;
};

/** b / bl (any condition, not BLX #imm): the target. */
export function branchTarget(w: number, at: number): number | null {
  if ((w & 0x0e000000) !== 0x0a000000 || w >>> 28 === 0xf) return null;
  let off = w & 0xffffff;
  if (off & 0x800000) off -= 0x1000000;
  return (at + 8 + off * 4) >>> 0;
}

/** Whether the instruction ends the straight run before it (a branch, a return, a call). */
function endsRun(w: number): boolean {
  if ((w & 0x0e000000) === 0x0a000000) return true; // b, bl, blx #imm
  if ((w & 0x0ffffff0) === 0x012fff10 || (w & 0x0ffffff0) === 0x012fff30) return true; // bx, blx reg
  if ((w & 0x0e108000) === 0x08108000) return true; // ldm / pop with pc
  if ((w & 0x0c00f000) === 0x0400f000 && w & 0x100000) return true; // ldr pc
  if ((w & 0x0c00f000) === 0x0000f000 && (w & 0x0e000000) !== 0 && ((w >>> 21) & 0xf) < 8) return true; // add pc, …
  return false;
}

type Writes = 'no' | 'mov-imm' | 'mvn-imm' | 'mov-reg' | 'other';

/** What an instruction does to register r (VFP and coprocessor moves that leave the core registers count as no). */
function writes(w: number, r: number): Writes {
  const top = w & 0x0e000000;
  if (top === 0x02000000 || (top === 0 && (w & 0x90) !== 0x90)) {
    const op = (w >>> 21) & 0xf;
    const s = (w >>> 20) & 1;
    const rd = (w >>> 12) & 0xf;
    if (op >= 8 && op <= 11) {
      if (s) return 'no'; // tst / teq / cmp / cmn
      if (top === 0x02000000 && (op === 8 || op === 10)) return rd === r ? 'other' : 'no'; // movw / movt
      return (w & 0x0ff000f0) === 0x01200010 || (w & 0x0ff000f0) === 0x01600010 ? 'no' : rd === r ? 'other' : 'no'; // bx / misc
    }
    if (rd !== r) return 'no';
    if (op === 13 && top === 0x02000000) return 'mov-imm';
    if (op === 15 && top === 0x02000000) return 'mvn-imm';
    if (op === 13 && (w & 0xff0) === 0) return 'mov-reg';
    return 'other';
  }
  if (top === 0) {
    // multiply / extra load-store
    if ((w & 0xf0) === 0x90) return ((w >>> 16) & 0xf) === r || ((w >>> 12) & 0xf) === r ? 'other' : 'no';
    if (w & 0x100000 && ((w >>> 12) & 0xf) === r) return 'other';
    if (w & 0x200000 && ((w >>> 16) & 0xf) === r) return 'other';
    return 'no';
  }
  if (top === 0x04000000 || (top === 0x06000000 && !(w & 0x10))) {
    if (w & 0x100000 && ((w >>> 12) & 0xf) === r) return 'other';
    if ((w & 0x200000 || !(w & 0x1000000)) && ((w >>> 16) & 0xf) === r) return 'other';
    return 'no';
  }
  if (top === 0x06000000) return ((w >>> 12) & 0xf) === r || ((w >>> 16) & 0xf) === r ? 'other' : 'no'; // media (uxth …)
  if (top === 0x08000000) return w & 0x100000 && w & (1 << r) ? 'other' : 'no';
  if ((w & 0x0f100f10) === 0x0e100a10 || (w & 0x0fe00fd0) === 0x0c500a10) return ((w >>> 12) & 0xf) === r || ((w >>> 16) & 0xf) === r ? 'other' : 'no';
  return 'no';
}

/** An immediate that sets an argument: the `mov` (or `mvn`) at `at`, under its condition. */
export interface Imm {
  value: number;
  at: number;
  cond: number;
  /** A `mvn` (the value is ~imm): not offered as an edit. */
  mvn?: boolean;
}

/** The values an argument register can hold at a call. */
export interface Operand {
  reg: number;
  imms: Imm[];
  /** The register can also hold a value the code computes (or one set before a branch to the call). */
  open: boolean;
}

const COND_PAIR = (a: number, b: number): boolean => a < 14 && (a ^ 1) === b;

/**
 * Walks back from the call at `at` for what sets `reg` (up to 12 instructions, through one `mov reg, rX`). A
 * conditional branch over the call (`bhs` after `cmp r0, #N; movlo r0, #N`) leaves its opposite condition holding at
 * the call. With `fnStart`, the branches of the function that jump to the call with `mov<c> reg, #imm; b<c>` before
 * them are added too (and the run before the call counts only when it falls through).
 */
export function operandAt(code: Uint8Array, at: number, reg: number, fnStart?: number, limit = 12): Operand {
  const imms: Imm[] = [];
  // a conditional call (bllo) runs only under its condition: a mov under the same one sets the argument
  let holds = word(code, at) >>> 28;
  let r = reg;
  let open = true;
  // the register that holds the value before each instruction of the run runs (for the branches into the run)
  const regBefore = new Map<number, number>([[at, reg]]);
  for (let a = at - 4, n = 0; n < limit && a >= BASE; a -= 4, n++) {
    const w = word(code, a);
    regBefore.set(a, r);
    const t = branchTarget(w, a);
    if (t !== null && (w & 0x0f000000) === 0x0a000000 && w >>> 28 !== COND_AL && t > at && holds === COND_AL) {
      holds = (w >>> 28) ^ 1;
      continue;
    }
    if (t !== null && (w & 0x0f000000) === 0x0a000000 && w >>> 28 === COND_AL && a === at - 4) {
      // the call is only reached by the branches to it
      open = false;
      break;
    }
    if (endsRun(w)) break;
    const kind = writes(w, r);
    if (kind === 'no') continue;
    const cond = w >>> 28;
    if (kind === 'mov-imm' || kind === 'mvn-imm') {
      imms.push({ value: kind === 'mvn-imm' ? ~rotImm(w) >>> 0 : rotImm(w), at: a, cond, ...(kind === 'mvn-imm' ? { mvn: true } : {}) });
      if (cond === COND_AL || cond === holds) {
        open = false;
        break;
      }
      // movne / moveq: both sides set it
      if (imms.length === 2 && COND_PAIR(imms[0]!.cond, imms[1]!.cond)) {
        open = false;
        break;
      }
      continue;
    }
    if (kind === 'mov-reg' && w >>> 28 === COND_AL && !imms.length) {
      r = w & 0xf;
      regBefore.set(a, r);
      continue;
    }
    break;
  }
  if (fnStart !== undefined)
    for (let a = fnStart; a < at; a += 4) {
      const w = word(code, a);
      const t = branchTarget(w, a);
      const into = t === null || (w & 0x0f000000) !== 0x0a000000 ? undefined : regBefore.get(t);
      if (into === undefined || (a < at && a >= at - 4 * limit && regBefore.has(a))) continue;
      const p = word(code, a - 4);
      if (writes(p, into) === 'mov-imm' && p >>> 28 === w >>> 28) imms.push({ value: rotImm(p), at: a - 4, cond: p >>> 28 });
      else open = true;
    }
  return { reg, imms, open };
}

// ---- where the story values are written

export type WriteKind = 'step' | 'stepAction' | 'value' | 'flag' | 'hereValue' | 'hereFlag' | 'dungeonValue' | 'dungeonFlag';

interface Writer {
  fn: number;
  kind: WriteKind;
  /** Registers of the arguments. */
  dungeon?: number;
  index?: number;
  value: number;
}

const WRITERS: Writer[] = [
  { fn: OAHU_STORY_CODE.setStep, kind: 'step', value: 0 },
  { fn: OAHU_STORY_CODE.stepAction, kind: 'stepAction', value: 1 },
  { fn: OAHU_STORY_CODE.setValue, kind: 'value', index: 0, value: 1 },
  { fn: OAHU_STORY_CODE.setFlag, kind: 'flag', index: 0, value: 1 },
  { fn: OAHU_STORY_CODE.setHereValue, kind: 'hereValue', index: 0, value: 1 },
  { fn: OAHU_STORY_CODE.setHereFlag, kind: 'hereFlag', index: 0, value: 1 },
  { fn: OAHU_STORY_CODE.setDungeonValue, kind: 'dungeonValue', dungeon: 0, index: 1, value: 2 },
  { fn: OAHU_STORY_CODE.setDungeonFlag, kind: 'dungeonFlag', dungeon: 0, index: 1, value: 2 },
];

export const WRITE_KIND_LABEL: Record<WriteKind, string> = {
  step: '段階',
  stepAction: '段階 (マップに入ったときの動作)',
  value: '値 0xF9',
  flag: 'フラグ 0xFA',
  hereValue: '今のダンジョンの値',
  hereFlag: '今のダンジョンのフラグ',
  dungeonValue: 'ダンジョンの値',
  dungeonFlag: 'ダンジョンのフラグ',
};

/** A call that writes the step or a story value. */
export interface OahuWriteSite {
  /** The call (bl or a tail call b). */
  at: number;
  /** Start of the function that holds it. */
  fn: number;
  kind: WriteKind;
  dungeon?: Operand;
  index?: Operand;
  value: Operand;
  /** Steps: the `cmp r0, #N` of "if the step < N, set N" before the call (changed with the value). */
  guard?: { at: number; value: number };
}

/** FUN_002ECE00: the run of the step action (sets the step it holds at +0x0E). */
const STEP_ACTION_RUN = 0x2ece00;

/** The `cmp r0, #value` within a few instructions before `from` (the step guard). */
function findGuard(code: Uint8Array, from: number, value: number): { at: number; value: number } | undefined {
  for (let a = from - 4; a > from - 28; a -= 4) {
    const w = word(code, a);
    if ((w & 0x0ffff000) === 0x03500000 && rotImm(w) === value) return { at: a, value };
    const t = branchTarget(w, a);
    if (t !== null && t !== OAHU_STORY_CODE.getStep && (w & 0x0f000000) === 0x0b000000) return undefined;
  }
  return undefined;
}

/**
 * Every call to the writers in .text (bl and tail calls), with the immediates of their arguments. `index` gives the
 * function bounds (built when not given).
 */
export function oahuWriteSites(code: Uint8Array, index?: CodeIndex): OahuWriteSite[] {
  const idx = index ?? new CodeIndex(code, [], { textEnd: OAHU_TEXT_END, msgFirst: 0, msgLast: -1, complete: 0 });
  const byFn = new Map(WRITERS.map((w) => [w.fn, w]));
  const out: OahuWriteSite[] = [];
  const end = Math.min(OAHU_TEXT_END, BASE + code.length);
  for (let a = BASE; a < end; a += 4) {
    const t = branchTarget(word(code, a), a);
    const wr = t === null ? undefined : byFn.get(t);
    if (!wr) continue;
    const fn = idx.startOf(a);
    // the step action's own run (FUN_002ECE00) passes on the step its builders gave (the stepAction sites)
    if (fn === STEP_ACTION_RUN) continue;
    const value = operandAt(code, a, wr.value, fn);
    const site: OahuWriteSite = { at: a, fn, kind: wr.kind, value };
    if (wr.index !== undefined) site.index = operandAt(code, a, wr.index, fn);
    if (wr.dungeon !== undefined) site.dungeon = operandAt(code, a, wr.dungeon, fn);
    if (wr.kind === 'step' && value.imms.length === 1 && !value.imms[0]!.mvn) site.guard = findGuard(code, value.imms[0]!.at, value.imms[0]!.value);
    out.push(site);
  }
  return out;
}

/** The single value of an operand, or undefined when it can hold several or a computed one. */
export const single = (o: Operand | undefined): number | undefined => (o && !o.open && o.imms.length === 1 ? o.imms[0]!.value : undefined);

/** "2 / 3 / (計算)". */
export function operandText(o: Operand): string {
  const parts = o.imms.map((i) => String(i.value));
  if (o.open) parts.push('(計算した値)');
  return parts.join(' / ');
}

/** Which elements of 0xF9 / 0xFA a write site writes (dungeon: the current dungeon for the "here" writers). */
export function siteTargets(site: OahuWriteSite, ranges: OahuValueRange[], here: number[] = []): { kind: ValueKind; index: number }[] {
  const kind: ValueKind | null = site.kind === 'value' || site.kind === 'hereValue' || site.kind === 'dungeonValue' ? 'values' : site.kind === 'flag' || site.kind === 'hereFlag' || site.kind === 'dungeonFlag' ? 'flags' : null;
  if (!kind || !site.index) return [];
  const idx = site.index.imms.map((i) => i.value);
  if (site.kind === 'value' || site.kind === 'flag') return idx.map((index) => ({ kind, index }));
  const ds = site.kind === 'dungeonValue' || site.kind === 'dungeonFlag' ? (site.dungeon?.imms.map((i) => i.value) ?? []) : here;
  const out: { kind: ValueKind; index: number }[] = [];
  for (const d of ds) {
    const g = ranges[d];
    if (g) for (const i of idx) if (i < g[kind][1]) out.push({ kind, index: g[kind][0] + i });
  }
  return out;
}

/** The functions of the code that read 0xF9 / 0xFA by an immediate index (calls to the getters). */
export interface OahuReadSite {
  at: number;
  fn: number;
  kind: ValueKind;
  /** The global element, when the index (and dungeon) are immediates. */
  indices: number[];
}

export function oahuReadSites(code: Uint8Array, ranges: OahuValueRange[], index?: CodeIndex): OahuReadSite[] {
  const idx = index ?? new CodeIndex(code, [], { textEnd: OAHU_TEXT_END, msgFirst: 0, msgLast: -1, complete: 0 });
  const C = OAHU_STORY_CODE;
  const readers = new Map<number, { kind: ValueKind; dungeon?: number; index: number }>([
    [C.getValue, { kind: 'values', index: 0 }],
    [C.getFlag, { kind: 'flags', index: 0 }],
    [C.getDungeonValue, { kind: 'values', dungeon: 0, index: 1 }],
    [C.getDungeonFlag, { kind: 'flags', dungeon: 0, index: 1 }],
  ]);
  const out: OahuReadSite[] = [];
  const end = Math.min(OAHU_TEXT_END, BASE + code.length);
  for (let a = BASE; a < end; a += 4) {
    const t = branchTarget(word(code, a), a);
    const rd = t === null ? undefined : readers.get(t);
    if (!rd || (a >= C.condition && a < C.condition + 0x400)) continue;
    const fn = idx.startOf(a);
    const i = operandAt(code, a, rd.index, fn).imms.map((x) => x.value);
    let indices = i;
    if (rd.dungeon !== undefined) {
      const ds = operandAt(code, a, rd.dungeon, fn).imms.map((x) => x.value);
      indices = ds.flatMap((d) => (ranges[d] ? i.filter((k) => k < ranges[d]![rd.kind][1]).map((k) => ranges[d]![rd.kind][0] + k) : []));
    }
    out.push({ at: a, fn, kind: rd.kind, indices });
  }
  return out;
}

// ---- code edits (the immediates and the scripts' message literals), exported in code.ips

/** An edit of the Update's code.bin: the immediate of the `mov` / `cmp` at `at`, or the literal word at `at`. */
export interface StoryCodeEdit {
  at: number;
  kind: 'imm' | 'word';
  value: number;
  /** The word as it is in the game (to tell the edit belongs to this code.bin). */
  before: number;
}

/** The new word of an edit, or why it cannot be made. */
export function editWord(code: Uint8Array, e: StoryCodeEdit): number | string {
  const w = word(code, e.at);
  if (w !== e.before) return `0x${e.at.toString(16).toUpperCase()} の命令が違います (別の code.bin)`;
  if (e.kind === 'word') return e.value >>> 0;
  if ((w & 0x0e000000) !== 0x02000000) return `0x${e.at.toString(16).toUpperCase()} は即値の命令ではありません`;
  const imm = encodeImm(e.value >>> 0);
  if (imm === null) return `${e.value} は ARM の即値にできません (8 ビットの値を偶数ビット回転したものだけ。0〜255 は使えます)`;
  return ((w & ~0xfff) | imm) >>> 0;
}

/** code.ips records of the edits, and the edits that cannot be made. */
export function storyRecords(code: Uint8Array, edits: StoryCodeEdit[]): { records: [number, Uint8Array][]; errors: { edit: StoryCodeEdit; message: string }[] } {
  const records: [number, Uint8Array][] = [];
  const errors: { edit: StoryCodeEdit; message: string }[] = [];
  for (const e of edits) {
    const w = editWord(code, e);
    if (typeof w === 'string') {
      errors.push({ edit: e, message: w });
      continue;
    }
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, w, true);
    records.push([e.at - BASE, b]);
  }
  return { records, errors };
}

/** The value an immediate instruction holds now (with the session's edits). */
export function editedImm(code: Uint8Array, edits: StoryCodeEdit[], at: number): number {
  const e = edits.find((x) => x.at === at);
  return e ? e.value : rotImm(word(code, at));
}

export const codeWordAt = word;

// ---- running the appearance conditions on a chosen state (the preview)

/** A state of the save to try the conditions with. */
export interface StoryState {
  step: number;
  /** 0xF9, by global element. */
  values: number[];
  /** 0xFA (0 / 1). */
  flags: number[];
  /** Key 0x49 (the residents / islands, condition 0x17 / 0x18): every element true, or every one false. */
  residents: boolean;
}

export const emptyStoryState = (values = 540, flags = 596): StoryState => ({ step: 0, values: new Array(values).fill(0), flags: new Array(flags).fill(0), residents: true });

/** Functions a condition calls that the preview cannot answer (map.md §5.2 未解析). */
const UNKNOWN = [0x1ed3f0, 0x1ed418, 0x4ef1a4, 0x4cbc68, 0x38d37c, 0x38d290, 0x38d250, 0x38d30c, 0x21152c];

export type Truth = boolean | null;

/** Runs FUN_004B62BC for (kind, v1, v2) in dungeon `here` on a state; null when it needs a value the state has not. */
export class OahuConditions {
  private readonly cache = new Map<string, Truth>();

  constructor(
    private readonly code: Uint8Array,
    private readonly ranges: OahuValueRange[],
    private readonly state: StoryState,
  ) {}

  private inRange(d: number, kind: ValueKind, i: number): number | undefined {
    const g = this.ranges[d];
    if (!d || !g || i >= g[kind][1]) return undefined;
    return g[kind][0] + i;
  }

  test(kind: number, v1: number, v2: number, here: number): Truth {
    if (!kind) return null;
    const key = `${kind}.${v1}.${v2}.${here}`;
    const have = this.cache.get(key);
    if (have !== undefined) return have;
    const C = OAHU_STORY_CODE;
    const s = this.state;
    let unknown = false;
    const val = (i: number | undefined): number => (i === undefined ? 0 : (s.values[i] ?? 0));
    const flag = (i: number | undefined): number => (i === undefined ? 0 : s.flags[i] ? 1 : 0);
    const stubs = new Map<number, (m: ArmMachine) => number>([
      [C.getValue, (m) => val(m.r[0]!)],
      [C.getFlag, (m) => flag(m.r[0]!)],
      [C.getHereValue, (m) => val(this.inRange(here, 'values', m.r[0]!))],
      [C.getDungeonValue, (m) => val(this.inRange(m.r[0]!, 'values', m.r[1]!))],
      [C.getDungeonFlag, (m) => flag(this.inRange(m.r[0]!, 'flags', m.r[1]!))],
      [C.getResident, (m) => (m.r[0] === 0 || s.residents ? 1 : 0)],
      [C.getKey, (m) => {
        const k = m.r[1]!;
        if (k === OAHU_KEY.step) return s.step;
        if (k === OAHU_KEY.dungeon) return here;
        unknown = true;
        return 0;
      }],
      ...UNKNOWN.map((a): [number, (m: ArmMachine) => number] => [a, () => ((unknown = true), 0)]),
    ]);
    let out: Truth;
    try {
      const m = new ArmMachine(this.code, { stubs, maxDepth: 4, maxSteps: 20000, textEnd: OAHU_TEXT_END });
      out = (m.run(C.condition, [0, kind, v1, v2]) & 0xff) !== 0;
      if (unknown) out = null;
    } catch (e) {
      if (!(e instanceof ArmStop)) throw e;
      out = null;
    }
    this.cache.set(key, out);
    return out;
  }

  /**
   * Whether an EventObject row is placed (FUN_004B6AC8 / FUN_004B6B38): 'hidden' = its +0x53 condition does not
   * hold yet, 'gone' = its +0x54 one holds, 'unknown' = a condition the state cannot answer.
   */
  placed(row: Uint8Array, here: number): 'shown' | 'hidden' | 'gone' | 'unknown' {
    const appear = row[0x53] ? this.test(row[0x53], u32(row, 0), u32(row, 4), here) : true;
    if (appear === false) return 'hidden';
    const gone = row[0x54] ? this.test(row[0x54], u32(row, 8), u32(row, 0x0c), here) : false;
    if (gone === true) return 'gone';
    return appear === null || gone === null ? 'unknown' : 'shown';
  }
}

/** What a named condition (kind 0x01, FUN_001ED9B8(n)) reads: the getters it calls, found by running it. */
export function oahuNamedReads(code: Uint8Array, ranges: OahuValueRange[], n: number): { kind: ValueKind; index: number }[] {
  const C = OAHU_STORY_CODE;
  const out: { kind: ValueKind; index: number }[] = [];
  const add = (kind: ValueKind, d: number | null, i: number): void => {
    if (d === null) out.push({ kind, index: i });
    else {
      const g = ranges[d];
      if (g && d && i < g[kind][1]) out.push({ kind, index: g[kind][0] + i });
    }
  };
  const stubs = new Map<number, (m: ArmMachine) => number>([
    [C.getValue, (m) => (add('values', null, m.r[0]!), 0)],
    [C.getFlag, (m) => (add('flags', null, m.r[0]!), 0)],
    [C.getDungeonValue, (m) => (add('values', m.r[0]!, m.r[1]!), 0)],
    [C.getDungeonFlag, (m) => (add('flags', m.r[0]!, m.r[1]!), 0)],
  ]);
  try {
    new ArmMachine(code, { stubs, maxDepth: 4, maxSteps: 20000, textEnd: OAHU_TEXT_END }).run(C.named, [n]);
  } catch (e) {
    if (!(e instanceof ArmStop)) throw e;
  }
  return out;
}

/** The elements of 0xF9 / 0xFA an EventObject condition reads (row in dungeon `here`). */
export function conditionReads(code: Uint8Array | null, ranges: OahuValueRange[], kind: number, v1: number, v2: number, here: number): { kind: ValueKind; index: number }[] {
  const at = (d: number, k: ValueKind, i: number): { kind: ValueKind; index: number }[] => {
    const g = ranges[d];
    return g && d && i < g[k][1] ? [{ kind: k, index: g[k][0] + i }] : [];
  };
  if (kind === 0x01) return code ? oahuNamedReads(code, ranges, v1) : [];
  if (kind === 0x02 || kind === 0x03) return at(v1, 'flags', v2);
  if (kind >= 0x04 && kind <= 0x06) return at(here, 'values', v1);
  if (kind >= 0x07 && kind <= 0x11) return at(v1, 'values', v2);
  if (kind === 0x12 || kind === 0x13) return [{ kind: 'flags', index: v1 }];
  if (kind >= 0x14 && kind <= 0x16) return [{ kind: 'values', index: v1 }];
  return [];
}
