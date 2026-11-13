// An author's events of an RPG FREE! stage, written as a small script and built into the content's CRO (native ARM
// code): the game runs them as it runs the shipped ones, there is no interpreter and no code.bin patch. What the game
// calls and how is written in lanai-custom-stages docs/native-events.md and 3ds/research/script-abi.md; the code shapes
// are those of 3ds/research/event-poc.ts, which ran in Azahar (event-poc.md §6).
//
//   var STATE: byte            // a number flag (0〜255) of the stage; "reset" = set back to 0 when the stage is left
//   var MET: bit reset
//   on talk(1, 5) {            // talking to the character of EventObject row 5 of MapGroup 1
//     switch (STATE) {
//       case 0: talk(0x60)
//       case 1: talk(0x61)
//       case 2: talk(0x62); return
//     }
//     if (ask(0x63)) { popup(11); se(0x84); talk(0x64); STATE = 2 } else { STATE = 1; talk(0x65) }
//   }
//   on area(1, 1) { say(0x66); disable() }   // entering the range of EventObject row 1
//
// The rows named by `on` must have the action type 0x8000002D (a script) in the data. Lines are row IDs of the group's
// talk table without the high bit (not row numbers). A boss battle is not a statement: the data's type 0x0C starts one
// and the game goes on at the map's start, not after the statement (script-abi.md §7).
import { assembleLine, encodeImm } from '../game/asm';
import { RELOC, croRegistrationHash, type Cro, type CroPatch, type CroReloc, type SegTag } from './cro';

// ------------------------------------------------------------------------------------------------ the script
export type ScriptValue =
  | { kind: 'var'; name: string }
  | { kind: 'ask'; msg: number }
  | { kind: 'item'; item: number }
  | { kind: 'state'; row: number };
export type ScriptCmp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export interface ScriptCond {
  value: ScriptValue;
  cmp: ScriptCmp;
  than: number;
}
export type ScriptNode =
  | { op: 'talk'; msg: number; auto: boolean }
  | { op: 'if'; cond: ScriptCond; then: ScriptNode[]; else: ScriptNode[] }
  | { op: 'switch'; value: ScriptValue; cases: { value: number; body: ScriptNode[] }[]; default: ScriptNode[] | null }
  | { op: 'set'; name: string; value: number }
  | { op: 'popup'; icon: number }
  | { op: 'se'; id: number }
  | { op: 'addItem'; item: number; count: number; show: boolean }
  | { op: 'addGold'; amount: number }
  | { op: 'door'; row: number; open: boolean }
  | { op: 'wait'; seconds: number }
  | { op: 'collision'; row: number | null; on: boolean }
  | { op: 'break' }
  | { op: 'return' };

export type ScriptTrigger = 'talk' | 'area';
export interface ScriptEvent {
  trigger: ScriptTrigger;
  /** The MapGroup row (what ScriptMap::GetCurrentMapGroupID() returns) and the EventObject row ID. */
  group: number;
  row: number;
  body: ScriptNode[];
  line: number;
}
export interface ScriptVar {
  name: string;
  kind: 'byte' | 'bit';
  /** Set back to 0 when the stage is left (the CRO's export 27). */
  reset: boolean;
  /** The game's flag number (ScriptByteFlag / ScriptBitFlag). */
  flag: number;
}
export interface StageScript {
  vars: ScriptVar[];
  events: ScriptEvent[];
}

/**
 * The flag numbers a stage's variables take, in the order they are declared. They are the same for every stage: the 3DS
 * patch keeps the ranges a stage owns (lanai-stage.json) in a file of the stage, so stages do not share them. Without
 * the patch they are flags of the save no shipped CRO uses (the game has 12500 byte flags and 25000 bit flags).
 */
export const STAGE_BYTE_FLAGS = { first: 12000, count: 256 } as const;
export const STAGE_BIT_FLAGS = { first: 24000, count: 256 } as const;

export class ScriptError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${line} 行目: ${message}`);
  }
}

interface Token {
  t: 'num' | 'id' | 'p' | 'end';
  s: string;
  n: number;
  line: number;
}

function tokens(src: string): Token[] {
  const out: Token[] = [];
  let line = 1;
  const re =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\n)|([ \t\r]+)|(-?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?))|([A-Za-z_]\w*)|(==|!=|<=|>=|[(){},:;=<>!])|(.)/gu;
  for (const m of src.matchAll(re)) {
    if (m[1]) line += m[1].split('\n').length - 1;
    else if (m[2]) line++;
    else if (m[4])
      out.push({ t: 'num', s: m[4], n: Number(m[4].startsWith('-') ? -Number(m[4].slice(1)) : m[4]), line });
    else if (m[5]) out.push({ t: 'id', s: m[5], n: 0, line });
    else if (m[6]) out.push({ t: 'p', s: m[6], n: 0, line });
    else if (m[7]) throw new ScriptError(`「${m[7]}」は使えない文字です`, line);
  }
  out.push({ t: 'end', s: '', n: 0, line });
  return out;
}

const CMPS: readonly string[] = ['==', '!=', '<', '<=', '>', '>='];

/** Reads a script; throws a ScriptError naming the line. */
export function parseStageScript(src: string): StageScript {
  const ts = tokens(src);
  let i = 0;
  const peek = (): Token => ts[i]!;
  const next = (): Token => ts[i++]!;
  const fail = (msg: string, t = peek()): never => {
    throw new ScriptError(msg, t.line);
  };
  const is = (s: string): boolean => peek().t !== 'num' && peek().s === s;
  const eat = (s: string): boolean => (is(s) ? (i++, true) : false);
  const need = (s: string): void => {
    if (!eat(s)) fail(`「${s}」が要ります (「${peek().s || '終わり'}」がありました)`);
  };
  const int = (what: string, min: number, max: number): number => {
    const t = next();
    const v = t.t === 'id' && (t.s === 'true' || t.s === 'false') ? Number(t.s === 'true') : t.n;
    if ((t.t !== 'num' && !(t.t === 'id' && (t.s === 'true' || t.s === 'false'))) || !Number.isInteger(v))
      fail(`${what}は整数で書きます`, t);
    if (v < min || v > max) fail(`${what}は ${min}〜${max} です`, t);
    return v;
  };
  const vars = new Map<string, ScriptVar>();
  const events: ScriptEvent[] = [];
  const used = { byte: 0, bit: 0 };

  const args = (n: number, name: string, read: (k: number) => number): number[] => {
    need('(');
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      if (k) need(',');
      out.push(read(k));
    }
    if (!eat(')')) fail(`${name} の引数は ${n} 個です`);
    return out;
  };
  const u32 = (what: string): number => int(what, 0, 0xffffffff);

  const value = (): ScriptValue => {
    const t = next();
    if (t.t !== 'id') fail('変数か ask(…) / item(…) / state(…) が要ります', t);
    if (is('(')) {
      if (t.s === 'ask') return { kind: 'ask', msg: args(1, 'ask', () => u32('台詞の行 ID'))[0]! };
      if (t.s === 'item') return { kind: 'item', item: args(1, 'item', () => u32('アイテム ID'))[0]! };
      if (t.s === 'state') return { kind: 'state', row: args(1, 'state', () => u32('イベント番号'))[0]! };
      fail(`「${t.s}」は値として使えません (ask / item / state)`, t);
    }
    if (!vars.has(t.s)) fail(`変数「${t.s}」は宣言されていません (var ${t.s}: byte)`, t);
    return { kind: 'var', name: t.s };
  };
  const cond = (): ScriptCond => {
    const not = eat('!');
    const v = value();
    if (peek().t === 'p' && CMPS.includes(peek().s)) {
      if (not) fail('「!」と比較は一緒に書けません');
      const cmp = next().s as ScriptCmp;
      return { value: v, cmp, than: int('比べる値', -0x80000000, 0x7fffffff) };
    }
    return { value: v, cmp: not ? '==' : '!=', than: 0 };
  };

  const block = (ctx: { area: boolean; inSwitch: boolean }): ScriptNode[] => {
    need('{');
    const out: ScriptNode[] = [];
    while (!is('}')) {
      if (peek().t === 'end') fail('「}」が足りません');
      const s = stmt(ctx);
      if (s) out.push(s);
    }
    next();
    return out;
  };
  const stmt = (ctx: { area: boolean; inSwitch: boolean }): ScriptNode | null => {
    if (eat(';')) return null;
    const t = next();
    if (t.t !== 'id') fail(`文が要ります (「${t.s}」がありました)`, t);
    const call = (n: number, read: (k: number) => number): number[] => args(n, t.s, read);
    switch (t.s) {
      case 'if': {
        need('(');
        const c = cond();
        need(')');
        const then = block(ctx);
        let other: ScriptNode[] = [];
        if (eat('else')) other = is('if') ? [stmt(ctx)!] : block(ctx);
        return { op: 'if', cond: c, then, else: other };
      }
      case 'switch': {
        need('(');
        const v = value();
        need(')');
        need('{');
        const cases: { value: number; body: ScriptNode[] }[] = [];
        let def: ScriptNode[] | null = null;
        while (!eat('}')) {
          const head = next();
          let body: ScriptNode[];
          if (head.t === 'id' && head.s === 'case') {
            const k = int('case の値', -0x80000000, 0x7fffffff);
            if (cases.some((c) => c.value === k)) fail(`case ${k} が 2 つあります`, head);
            body = [];
            cases.push({ value: k, body });
          } else if (head.t === 'id' && head.s === 'default') {
            if (def) fail('default が 2 つあります', head);
            body = def = [];
          } else return fail('case か default が要ります', head);
          need(':');
          while (!is('case') && !is('default') && !is('}')) {
            if (peek().t === 'end') fail('「}」が足りません');
            const s = is('{') ? null : stmt({ ...ctx, inSwitch: true });
            if (s) body.push(s);
            else if (is('{')) body.push(...block({ ...ctx, inSwitch: true }));
          }
        }
        return { op: 'switch', value: v, cases, default: def };
      }
      case 'return':
        return { op: 'return' };
      case 'break':
        if (!ctx.inSwitch) fail('break は switch の中でだけ使えます', t);
        return { op: 'break' };
      case 'talk':
      case 'say':
        return { op: 'talk', msg: call(1, () => u32('台詞の行 ID'))[0]!, auto: t.s === 'say' };
      case 'popup':
        return { op: 'popup', icon: call(1, () => int('アイコン', 0, 255))[0]! };
      case 'se':
        return { op: 'se', id: call(1, () => int('音 (SoundData の行)', 0, 0xffff))[0]! };
      case 'addItem':
      case 'getItem': {
        const [item, count] = call(2, (k) => (k ? int('個数', -9999, 9999) : u32('アイテム ID')));
        return { op: 'addItem', item: item!, count: count!, show: t.s === 'getItem' };
      }
      case 'addGold':
        return { op: 'addGold', amount: call(1, () => int('お金', -99999999, 99999999))[0]! };
      case 'openDoor':
      case 'closeDoor':
        return { op: 'door', row: call(1, () => u32('扉のイベント番号'))[0]!, open: t.s === 'openDoor' };
      case 'wait': {
        need('(');
        const n = next();
        if (n.t !== 'num' || !(n.n > 0) || n.n > 600) fail('wait の秒数は 0 より大きく 600 までです', n);
        need(')');
        return { op: 'wait', seconds: n.n };
      }
      case 'disable':
        if (!ctx.area) fail('disable() は on area の中でだけ使えます (自分の範囲を無効にする)', t);
        call(0, () => 0);
        return { op: 'collision', row: null, on: false };
      case 'collision': {
        const [row, on] = call(2, (k) => (k ? int('有効 (0 / 1)', 0, 1) : u32('範囲のイベント番号')));
        return { op: 'collision', row: row!, on: !!on };
      }
    }
    if (eat('=')) {
      const v = vars.get(t.s);
      if (!v) return fail(`変数「${t.s}」は宣言されていません (var ${t.s}: byte)`, t);
      return { op: 'set', name: t.s, value: int('入れる値', 0, v.kind === 'bit' ? 1 : 255) };
    }
    return fail(`「${t.s}」という文はありません`, t);
  };

  while (peek().t !== 'end') {
    if (eat(';')) continue;
    const t = next();
    if (t.t === 'id' && t.s === 'var') {
      const name = next();
      if (name.t !== 'id') fail('変数の名前が要ります', name);
      if (vars.has(name.s)) fail(`変数「${name.s}」は宣言済みです`, name);
      if (['if', 'else', 'switch', 'case', 'default', 'return', 'break', 'on', 'var', 'true', 'false'].includes(name.s))
        fail(`「${name.s}」は変数の名前にできません`, name);
      need(':');
      const kind = next();
      if (kind.t !== 'id' || (kind.s !== 'byte' && kind.s !== 'bit')) fail('変数の種類は byte か bit です', kind);
      const k = kind.s as 'byte' | 'bit';
      const range = k === 'byte' ? STAGE_BYTE_FLAGS : STAGE_BIT_FLAGS;
      if (used[k] >= range.count) fail(`${k} の変数は ${range.count} 個までです`, name);
      vars.set(name.s, { name: name.s, kind: k, reset: eat('reset'), flag: range.first + used[k]++ });
    } else if (t.t === 'id' && t.s === 'on') {
      const trig = next();
      if (trig.t !== 'id' || (trig.s !== 'talk' && trig.s !== 'area'))
        fail('きっかけは talk (話しかける) か area (範囲に入る) です', trig);
      const [group, row] = args(2, `on ${trig.s}`, (k) => u32(k ? 'イベント番号' : 'MapGroup の番号'));
      if (events.some((e) => e.group === group && e.row === row))
        fail(`MapGroup ${group} のイベント ${row} は 2 回書かれています`, trig);
      const body = block({ area: trig.s === 'area', inSwitch: false });
      events.push({ trigger: trig.s as ScriptTrigger, group: group!, row: row!, body, line: t.line });
    } else fail(`var か on が要ります (「${t.s}」がありました)`, t);
  }
  return { vars: [...vars.values()], events };
}

// ------------------------------------------------------------------------------------------------ the code
export const CRO_TEXT = 1,
  CRO_RODATA = 2;
/** The CRO's indexed exports the game calls: an event of a range, of a character, and when the stage is left. */
export const SLOT_AREA = 0,
  SLOT_TALK = 8,
  SLOT_LEAVE = 27;

/** Names of lanai.crs the code imports (script-abi.md, out/script-abi/signatures.tsv). */
export const SCRIPT_API = {
  group: '_ZN9ScriptMap20GetCurrentMapGroupIDEv',
  new: '_ZnwjRKSt9nothrow_t',
  del: '_ZdlPv',
  npcCtor: '_ZN13NpcCommonTurnC1EjP9ChrObjectj18ScriptMessageParamS2_b',
  esCtor: '_ZN11EventScriptC2Ej',
  ctrl: '_ZN11EventScript8CtrlFlagEv',
  waitAnim: '_ZNK13NpcCommonTurn23GetDefaultWaitAnimationEv',
  walkAnim: '_ZNK13NpcCommonTurn23GetDefaultWalkAnimationEv',
  npcCommonVt: '_ZTV9NpcCommon',
  siVt: '_ZTVN10__cxxabiv120__si_class_type_infoE',
  tiNpcTurn: '_ZTI13NpcCommonTurn',
  tiEs: '_ZTI11EventScript',
  turnNpc: '_ZN13NpcCommonTurn7TurnNpcEv',
  turnHero: '_ZN9NpcCommon8TurnHeroEv',
  anim: '_ZN11ScriptChara14StartAnimationEj10GSAnimTypeff',
  msg: '_ZN10ScriptMenu12StartMessageEjRK18ScriptMessageParamS2_13AppDialogTypebf',
  msgAuto: '_ZN10ScriptMenu16StartMessageAutoEjRK18ScriptMessageParamS2_13AppDialogTypebf',
  yesNo: '_ZN10ScriptMenu18SystemMessageYesNoEjRK18ScriptMessageParamS2_',
  getByte: '_ZN10ScriptFlag17GetScriptByteFlagEt',
  setByte: '_ZN10ScriptFlag17SetScriptByteFlagEth',
  getBit: '_ZN10ScriptFlag16GetScriptBitFlagEt',
  setBit: '_ZN10ScriptFlag16SetScriptBitFlagEtb',
  getState: '_ZN10ScriptFlag14GetScriptStateEj',
  getItem: '_ZN10ScriptFlag10GetItemNumEjb',
  addItem: '_ZN10ScriptFlag10AddItemNumEji',
  itemGet: '_ZN10ScriptMenu7ItemGetEjib',
  addGold: '_ZN10ScriptFlag7AddGoldEi',
  doorOpen: '_ZN9ScriptMap15SetDoorOpenFlagEj',
  doorClose: '_ZN9ScriptMap16SetDoorCloseFlagEj',
  waitTime: '_ZN12ScriptSystem8WaitTimeEf',
  hero: '_ZN9ScriptMap13GetPlayerHeroEv',
  charaCtor: '_ZN11ScriptCharaC1EP9ChrObject',
  charaDtor: '_ZN11ScriptCharaD1Ev',
  popup: '_ZN11ScriptChara8SetPopupEhhbabRK5GSvec',
  gsvecZero: 'GSVEC_ZERO',
  play: '_ZN11ScriptSound4PlayEtf',
  collision: '_ZN9ScriptMap20EnableEventCollisionEjb',
} as const;
const A = SCRIPT_API;

/** new sizes: NpcCommonTurn 0x74, EventScript 0xC (script-abi.md §2.2); the classes add no fields. */
const NEW_SIZE = { talk: 0x74, area: 0xc } as const;
/** The animations of a character that talks: its mouth moves while the line is shown (script-abi.md §1). */
const ANIM_TALK = 0x80000079,
  ANIM_WAIT = 0x80000075;
const F0 = 0x00000000,
  F1 = 0x3f800000,
  F02 = 0x3e4ccccd; // 0.0f, 1.0f, 0.2f

type PoolWord =
  | { kind: 'value'; value: number }
  | { kind: 'imp'; name: string; addend: number }
  | { kind: 'ro'; off: number };

const wr = (b: Uint8Array, o: number, v: number): void => {
  for (let k = 0; k < 4; k++) b[o + k] = (v >>> (8 * k)) & 0xff;
};
const hx = (v: number): string => `0x${(v >>> 0).toString(16)}`;

class Gen {
  readonly veneers: string[] = [];
  readonly textPatches: { label: string; name: string; addend: number }[] = [];
  readonly textRelocs: { label: string; roOff: number }[] = [];
  private veneerOf = new Map<string, string>();
  private n = 0;
  uniq(prefix: string): string {
    return `${prefix}_${this.n++}`;
  }
  /** The stub of an imported function: `ldr pc, [pc, #-4]` and the word the loader fills (as the shipped CROs call). */
  veneer(name: string): string {
    let l = this.veneerOf.get(name);
    if (!l) {
      l = `ven_${this.veneerOf.size}`;
      this.veneerOf.set(name, l);
      this.veneers.push(`${l}:`, 'ldr pc, [pc, #-4]', `${l}_w: .word 0`);
      this.textPatches.push({ label: `${l}_w`, name, addend: 0 });
    }
    return l;
  }
}

/** A literal is put at most this many lines after its first use (an `ldr` reaches 4 KB). */
const POOL_REACH = 600;

/** One function: a float pool before it (vldr reaches 1 KB), its lines, literal pools inside (jumped over) and after it. */
class Fn {
  readonly body: string[] = [];
  private pool: { label: string; w: PoolWord }[] = [];
  private poolFrom = 0;
  private fpool: { label: string; value: number }[] = [];
  constructor(
    private g: Gen,
    readonly name: string,
  ) {}
  op(...lines: string[]): void {
    this.body.push(...lines);
  }
  at(label: string): void {
    this.body.push(`${label}:`);
  }
  call(api: string): void {
    this.op(`bl ${this.g.veneer(api)}`);
  }
  tail(api: string): void {
    this.op(`b ${this.g.veneer(api)}`);
  }
  lit(w: PoolWord): string {
    const key = JSON.stringify(w);
    const same = this.pool.find((p) => JSON.stringify(p.w) === key);
    if (same) return same.label;
    if (!this.pool.length) this.poolFrom = this.body.length;
    const label = this.g.uniq(`${this.name}_lit`);
    this.pool.push({ label, w });
    return label;
  }
  flit(value: number): string {
    const same = this.fpool.find((p) => p.value === value);
    if (same) return same.label;
    const label = this.g.uniq(`${this.name}_flt`);
    this.fpool.push({ label, value });
    return label;
  }
  /** rd = value (mov / mvn when it fits, else the pool). */
  load(rd: string, value: number): void {
    value >>>= 0;
    if (encodeImm(value) !== null) this.op(`mov ${rd}, #${hx(value)}`);
    else if (encodeImm(~value >>> 0) !== null) this.op(`mvn ${rd}, #${hx(~value)}`);
    else this.op(`ldr ${rd}, ${this.lit({ kind: 'value', value })}`);
  }
  /** cmp{cond} rn, value (through ip when the value is not an immediate; the ldr leaves the flags alone). */
  cmp(rn: string, value: number, cond = ''): void {
    value >>>= 0;
    if (encodeImm(value) !== null) this.op(`cmp${cond} ${rn}, #${hx(value)}`);
    else {
      this.op(`ldr ip, ${this.lit({ kind: 'value', value })}`);
      this.op(`cmp${cond} ${rn}, ip`);
    }
  }
  /** Writes the pending literals here. `over`: the code runs into this place, so it jumps over them. */
  flush(over: boolean): void {
    if (!this.pool.length) return;
    const skip = this.g.uniq(`${this.name}_over`);
    if (over) this.op(`b ${skip}`);
    for (const p of this.pool) {
      if (p.w.kind === 'value') this.op(`${p.label}: .word ${hx(p.w.value)}`);
      else {
        this.op(`${p.label}: .word 0`);
        if (p.w.kind === 'imp') this.g.textPatches.push({ label: p.label, name: p.w.name, addend: p.w.addend });
        else this.g.textRelocs.push({ label: p.label, roOff: p.w.off });
      }
    }
    if (over) this.at(skip);
    this.pool = [];
  }
  /** Between statements: writes the literals before they get out of reach. */
  flushIfFar(): void {
    if (this.pool.length && this.body.length - this.poolFrom > POOL_REACH) this.flush(true);
  }
  lines(): string[] {
    this.flush(false);
    return [...this.fpool.map((f) => `${f.label}: .word ${hx(f.value)}`), `${this.name}:`, ...this.body];
  }
}

/** Two-pass assembly at text offset `base`: every line that is not a label alone is one word. */
function assembleAll(lines: string[], base: number): { words: number[]; labels: Map<string, number> } {
  const labels = new Map<string, number>();
  const body: { text: string; at: number }[] = [];
  let pc = base;
  for (const l of lines) {
    const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(l);
    if (m) {
      if (labels.has(m[1]!)) throw new Error(`duplicate label ${m[1]}`);
      labels.set(m[1]!, pc);
      if (!m[2]) continue;
      body.push({ text: m[2], at: pc });
    } else body.push({ text: l, at: pc });
    pc += 4;
  }
  const words: number[] = [];
  for (const b of body) {
    const a = assembleLine(b.text, b.at, (n) => labels.get(n));
    if (a.words.length !== 1 || a.literal) throw new Error(`one word expected: ${b.text}`);
    words.push(a.words[0]!);
  }
  return { words, labels };
}

/**
 * The frame of Execute: push {r4-r8, lr} (24) + vpush {d8, d9} (16) + sub sp, #0x38, 8-aligned.
 *   [sp+0x00..0x0F] stack arguments    [sp+0x10] / [sp+0x18] two ScriptMessageParam {0, 0}
 *   [sp+0x20..0x37] the ScriptChara (0x18) of a popup
 * r4 = this, r5 = 0, r6 = 0x80000079, r7 = 0x80000075; s16 = 0.0, s17 = 1.0, s18 = 0.2.
 */
const FRAME = { size: 0x38, smpA: 0x10, smpB: 0x18, chara: 0x20 } as const;

const BRANCH_IF_NOT: Record<ScriptCmp, string> = {
  '==': 'bne',
  '!=': 'beq',
  '<': 'bge',
  '<=': 'bgt',
  '>': 'ble',
  '>=': 'blt',
};
/** Item IDs are row IDs (0x800000NN); the script may leave the high bit out. */
const rowId = (n: number): number => (0x80000000 | n) >>> 0;

interface Ctx {
  fn: Fn;
  g: Gen;
  trigger: ScriptTrigger;
  vars: Map<string, ScriptVar>;
  exit: string;
  breakTo: string | null;
}

function zeroSmps(fn: Fn): void {
  fn.op(
    `str r5, [sp, #${hx(FRAME.smpA)}]`,
    `str r5, [sp, #${hx(FRAME.smpA + 4)}]`,
    `str r5, [sp, #${hx(FRAME.smpB)}]`,
    `str r5, [sp, #${hx(FRAME.smpB + 4)}]`,
  );
}
const smpArgs = (fn: Fn): void => fn.op(`add r1, sp, #${hx(FRAME.smpA)}`, `add r2, sp, #${hx(FRAME.smpB)}`);

/** r0 = the value. */
function compileValue(c: Ctx, v: ScriptValue): void {
  const { fn } = c;
  switch (v.kind) {
    case 'var': {
      const x = c.vars.get(v.name)!;
      fn.load('r0', x.flag);
      fn.call(x.kind === 'byte' ? A.getByte : A.getBit);
      fn.op('and r0, r0, #0xff');
      break;
    }
    case 'state':
      fn.load('r0', v.row);
      fn.call(A.getState);
      fn.op('and r0, r0, #0xff');
      break;
    case 'item':
      fn.load('r0', rowId(v.item));
      fn.op('mov r1, #1');
      fn.call(A.getItem);
      break;
    case 'ask':
      zeroSmps(fn);
      fn.load('r0', rowId(v.msg));
      smpArgs(fn);
      fn.call(A.yesNo);
      fn.op('cmp r0, #0', 'movne r0, #1');
      break;
  }
}

function compileNodes(c: Ctx, nodes: ScriptNode[]): void {
  const { fn, g } = c;
  const anim = (reg: string): void => {
    fn.op('add r0, r4, #0xc', `mov r1, ${reg}`, 'mov r2, #0', 'vmov.f32 s0, s17', 'vmov.f32 s1, s16');
    fn.call(A.anim);
  };
  for (const n of nodes) {
    fn.flushIfFar();
    switch (n.op) {
      case 'talk': {
        const mouth = c.trigger === 'talk' && !n.auto;
        if (mouth) anim('r6');
        zeroSmps(fn);
        fn.op('str r5, [sp]'); // the 5th argument: bool = 0
        fn.load('r0', rowId(n.msg));
        smpArgs(fn);
        fn.op('mov r3, #0', 'vmov.f32 s0, s18');
        fn.call(mouth ? A.msg : A.msgAuto);
        if (mouth) anim('r7');
        break;
      }
      case 'if': {
        const other = g.uniq(`${fn.name}_else`),
          end = g.uniq(`${fn.name}_fi`);
        compileValue(c, n.cond.value);
        fn.cmp('r0', n.cond.than);
        fn.op(`${BRANCH_IF_NOT[n.cond.cmp]} ${other}`);
        compileNodes(c, n.then);
        if (n.else.length) fn.op(`b ${end}`);
        fn.at(other);
        compileNodes(c, n.else);
        fn.at(end);
        break;
      }
      case 'switch': {
        const end = g.uniq(`${fn.name}_sw`);
        const labels = n.cases.map(() => g.uniq(`${fn.name}_case`));
        compileValue(c, n.value);
        n.cases.forEach((k, j) => {
          fn.cmp('r0', k.value);
          fn.op(`beq ${labels[j]}`);
        });
        const inner = { ...c, breakTo: end };
        if (n.default) compileNodes(inner, n.default);
        fn.op(`b ${end}`);
        n.cases.forEach((k, j) => {
          fn.at(labels[j]!);
          compileNodes(inner, k.body);
          fn.op(`b ${end}`);
        });
        fn.at(end);
        break;
      }
      case 'set': {
        const x = c.vars.get(n.name)!;
        fn.load('r0', x.flag);
        fn.load('r1', n.value & 0xff);
        fn.call(x.kind === 'byte' ? A.setByte : A.setBit);
        break;
      }
      case 'popup': {
        // ScriptChara c(GetPlayerHero()); c.SetPopup(2, icon, 1, 1, 0, GSVEC_ZERO); ~c
        const at = `#${hx(FRAME.chara)}`;
        fn.call(A.hero);
        fn.op('mov r1, r0', `add r0, sp, ${at}`);
        fn.call(A.charaCtor);
        fn.op(
          'mov r0, #1',
          'str r0, [sp]',
          'str r5, [sp, #4]',
          `ldr r0, ${fn.lit({ kind: 'imp', name: A.gsvecZero, addend: 0 })}`,
          'str r0, [sp, #8]',
        );
        fn.op(`add r0, sp, ${at}`, 'mov r1, #2');
        fn.load('r2', n.icon);
        fn.op('mov r3, #1');
        fn.call(A.popup);
        fn.op(`add r0, sp, ${at}`);
        fn.call(A.charaDtor);
        break;
      }
      case 'se':
        fn.load('r0', n.id);
        fn.op('vmov.f32 s0, s16');
        fn.call(A.play);
        break;
      case 'addItem':
        fn.load('r0', rowId(n.item));
        fn.load('r1', n.count);
        if (n.show) fn.op('mov r2, #1');
        fn.call(n.show ? A.itemGet : A.addItem);
        break;
      case 'addGold':
        fn.load('r0', n.amount);
        fn.call(A.addGold);
        break;
      case 'door':
        fn.load('r0', n.row);
        fn.call(n.open ? A.doorOpen : A.doorClose);
        break;
      case 'wait': {
        const f = new Float32Array([n.seconds]);
        fn.op(`ldr r0, ${fn.lit({ kind: 'value', value: new Uint32Array(f.buffer)[0]! })}`, 'vmov s0, r0');
        fn.call(A.waitTime);
        break;
      }
      case 'collision':
        if (n.row === null) fn.op('ldr r0, [r4, #4]');
        else fn.load('r0', n.row);
        fn.op(`mov r1, #${n.on ? 1 : 0}`);
        fn.call(A.collision);
        break;
      case 'break':
        fn.op(`b ${c.breakTo}`);
        break;
      case 'return':
        fn.op(`b ${c.exit}`);
        break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ the CRO
/** A flag the CRO sets back to 0 when the stage is left (export 27). */
export interface LeaveReset {
  kind: 'byte' | 'bit';
  flag: number;
}

export interface StageScriptBuild {
  cro: Cro;
  /** Text offsets of the labels (`slot_0`, `slot_8`, `slot_27`, `<class>_exec`, `<class>_d1`, `<class>_d0`). */
  labels: Map<string, number>;
  /** Rodata offsets: `<class>_vt` (where the object's vtable pointer points), `<class>_ti`, `zero`. */
  ro: Record<string, number>;
  /** The class of each event, in the script's order. */
  classes: string[];
  /** What export 27 sets to 0. */
  resets: LeaveReset[];
}

/**
 * The script's events laid into a CRO that has none (content 99's): text = the CRO's + stubs + functions, rodata = the
 * CRO's + type infos + vtables + names; the exports 0 / 8 make the event of a row, 27 sets the flags to reset back to 0.
 * `resets`: flags to set back besides the script's `reset` variables (the boss flags of the data).
 */
export function compileStageScript(base: Cro, script: StageScript, resets: LeaveReset[] = []): StageScriptBuild {
  const g = new Gen();
  const vars = new Map(script.vars.map((v) => [v.name, v]));
  const events = script.events.map((e, k) => ({ ...e, cls: `PnEvent${k}` }));
  // ---- rodata first: its offsets go into the code as relocations
  const ro0 = base.segments[CRO_RODATA]!.bytes ?? new Uint8Array(0);
  type RoWord = PoolWord | { kind: 'text'; label: string };
  const roWords: { off: number; w: RoWord }[] = [];
  let roOff = (ro0.length + 3) & ~3;
  const ro: Record<string, number> = {};
  const put = (w: RoWord): number => {
    roWords.push({ off: roOff, w });
    roOff += 4;
    return roOff - 4;
  };
  ro.zero = put({ kind: 'value', value: 0 });
  // type info: {__si_class_type_info's vtable + 8, name, the base's type info}
  const nameAt: number[] = [];
  for (const e of events) {
    ro[`${e.cls}_ti`] = put({ kind: 'imp', name: A.siVt, addend: 8 });
    nameAt.push(put({ kind: 'value', value: 0 }));
    put({ kind: 'imp', name: e.trigger === 'talk' ? A.tiNpcTurn : A.tiEs, addend: 0 });
  }
  // vtable: [offset to top 0][type info] then where the object points: [D1][D0][+8][+C Execute][+10 CtrlFlag][+14] …
  for (const e of events) {
    put({ kind: 'value', value: 0 });
    put({ kind: 'ro', off: ro[`${e.cls}_ti`]! });
    ro[`${e.cls}_vt`] = roOff;
    put({ kind: 'text', label: `${e.cls}_d1` });
    put({ kind: 'text', label: `${e.cls}_d0` });
    put({ kind: 'text', label: 'pn_prepare' });
    put({ kind: 'text', label: `${e.cls}_exec` });
    put({ kind: 'imp', name: A.ctrl, addend: 0 });
    put({ kind: 'text', label: 'pn_hides_menu' });
    if (e.trigger === 'talk') {
      put({ kind: 'imp', name: A.waitAnim, addend: 0 });
      put({ kind: 'imp', name: A.walkAnim, addend: 0 });
    }
  }
  const nameBytes: number[] = [];
  events.forEach((e, k) => {
    roWords.find((x) => x.off === nameAt[k])!.w = { kind: 'ro', off: roOff + nameBytes.length };
    for (const ch of `${e.cls.length}${e.cls}`) nameBytes.push(ch.charCodeAt(0));
    nameBytes.push(0);
  });
  const nameStart = roOff;
  const roEnd = (roOff + nameBytes.length + 3) & ~3;

  // ---- functions
  const fns: Fn[] = [];
  const prepare = new Fn(g, 'pn_prepare');
  prepare.op('bx lr');
  const hides = new Fn(g, 'pn_hides_menu');
  hides.op('ldrsb r0, [r0, #0xa]', 'bx lr'); // (s8)this[+0xA], as every shipped class
  fns.push(prepare, hides);

  const allResets: LeaveReset[] = [
    ...script.vars.filter((v) => v.reset).map((v) => ({ kind: v.kind, flag: v.flag })),
    ...resets,
  ].filter((r, k, a) => a.findIndex((x) => x.kind === r.kind && x.flag === r.flag) === k);
  if (allResets.length) {
    const f = new Fn(g, `slot_${SLOT_LEAVE}`);
    f.op('push {r4, lr}');
    for (const r of allResets) {
      f.flushIfFar();
      f.op('mov r1, #0');
      f.load('r0', r.flag);
      f.call(r.kind === 'byte' ? A.setByte : A.setBit);
    }
    f.op('pop {r4, pc}');
    fns.push(f);
  }

  // one function per export: it finds the event of (map group, row) and makes its object, or returns 0
  const makers = (slot: number, trigger: ScriptTrigger): void => {
    const own = events.filter((e) => e.trigger === trigger);
    if (!own.length) return;
    const f = new Fn(g, `slot_${slot}`);
    const ret = g.uniq(`slot_${slot}_ret`);
    const id = trigger === 'talk' ? 'r5' : 'r4';
    if (trigger === 'talk') f.op('push {r4, r5, lr}', 'sub sp, sp, #0x14', 'mov r5, r0', 'mov r4, r1');
    else f.op('push {r4, lr}', 'mov r4, r0');
    f.call(A.group);
    for (const e of own) {
      f.cmp('r0', e.group);
      f.cmp(id, e.row, 'eq');
      f.op(`beq ${e.cls}_make`);
    }
    f.op('mov r0, #0');
    f.at(ret);
    if (trigger === 'talk') f.op('add sp, sp, #0x14', 'pop {r4, r5, pc}');
    else f.op('pop {r4, pc}');
    for (const e of own) {
      f.flush(false);
      f.at(`${e.cls}_make`);
      f.load('r0', NEW_SIZE[trigger]);
      f.call(A.new);
      f.op('cmp r0, #0', `beq ${ret}`);
      if (trigger === 'talk') {
        // NpcCommonTurn(obj, row, chr, 0, {0, &zero}, {0, &zero}, false), as the shipped CROs pass it
        f.op(
          `ldr r3, ${f.lit({ kind: 'ro', off: ro.zero! })}`,
          'mov r5, #0',
          'mov r2, r4',
          'str r3, [sp, #0xc]',
          'str r3, [sp, #4]',
          'mov r3, r5',
        );
        f.load('r1', e.row);
        f.op('str r5, [sp, #0x10]', 'str r5, [sp, #8]', 'str r5, [sp]');
        f.call(A.npcCtor);
      } else {
        f.op('mov r1, r4');
        f.call(A.esCtor);
      }
      f.op(`ldr r1, ${f.lit({ kind: 'ro', off: ro[`${e.cls}_vt`]! })}`, 'str r1, [r0]', `b ${ret}`);
    }
    fns.push(f);
  };
  makers(SLOT_AREA, 'area');
  makers(SLOT_TALK, 'talk');

  for (const e of events) {
    const x = new Fn(g, `${e.cls}_exec`);
    const exit = g.uniq(`${e.cls}_exit`);
    x.op(
      'push {r4, r5, r6, r7, r8, lr}',
      'vpush {d8, d9}',
      `sub sp, sp, #${hx(FRAME.size)}`,
      'mov r4, r0',
      'mov r5, #0',
    );
    x.op(`vldr s16, ${x.flit(F0)}`, `vldr s17, ${x.flit(F1)}`, `vldr s18, ${x.flit(F02)}`);
    if (e.trigger === 'talk') {
      x.op(
        `ldr r6, ${x.lit({ kind: 'value', value: ANIM_TALK })}`,
        `ldr r7, ${x.lit({ kind: 'value', value: ANIM_WAIT })}`,
      );
      x.op('mov r0, r4');
      x.call(A.turnNpc);
      x.op('mov r0, r4');
      x.call(A.turnHero);
    }
    compileNodes({ fn: x, g, trigger: e.trigger, vars, exit, breakTo: null }, e.body);
    x.at(exit);
    x.op(`add sp, sp, #${hx(FRAME.size)}`, 'vpop {d8, d9}', 'pop {r4, r5, r6, r7, r8, pc}');
    fns.push(x);

    const d1 = new Fn(g, `${e.cls}_d1`),
      d0 = new Fn(g, `${e.cls}_d0`);
    if (e.trigger === 'talk') {
      // vtable = NpcCommon's, ~ScriptChara(this + 0xC), (delete): as the shipped classes of NpcCommonTurn
      const ztv = { kind: 'imp' as const, name: A.npcCommonVt, addend: 8 };
      d1.op(`ldr r1, ${d1.lit(ztv)}`, 'push {r4, lr}', 'str r1, [r0], #0xc');
      d1.call(A.charaDtor);
      d1.op('sub r0, r0, #0xc', 'pop {r4, pc}');
      d0.op(`ldr r1, ${d0.lit(ztv)}`, 'push {r4, lr}', 'str r1, [r0], #0xc');
      d0.call(A.charaDtor);
      d0.op('pop {r4, lr}', 'sub r0, r0, #0xc');
      d0.tail(A.del);
    } else {
      d1.op('bx lr'); // EventScript's destructor is empty
      d0.tail(A.del);
    }
    fns.push(d1, d0);
  }

  // ---- assemble: the stubs first, as the shipped CROs have them
  const text0 = base.segments[CRO_TEXT]!.bytes!;
  const at = (text0.length + 3) & ~3;
  const fnLines = fns.flatMap((f) => f.lines());
  const { words, labels } = assembleAll([...g.veneers, ...fnLines], at);
  const text = new Uint8Array(at + words.length * 4);
  text.set(text0);
  words.forEach((w, k) => wr(text, at + k * 4, w));
  const roBytes = new Uint8Array(roEnd);
  roBytes.set(ro0);
  nameBytes.forEach((b, k) => (roBytes[nameStart + k] = b));

  // ---- imports and relocations
  const T = (off: number): SegTag => ({ seg: CRO_TEXT, off });
  const R = (off: number): SegTag => ({ seg: CRO_RODATA, off });
  const label = (l: string): number => {
    const v = labels.get(l);
    if (v === undefined) throw new Error(`no label ${l}`);
    return v;
  };
  const patches = new Map<string, CroPatch[]>();
  const imp = (name: string, target: SegTag, addend: number): void =>
    void patches.set(name, [...(patches.get(name) ?? []), { target, type: RELOC.ABS32, addend, resolved: 0 }]);
  const relocs: CroReloc[] = [];
  const rel = (target: SegTag, symbolSeg: number, addend: number): void =>
    void relocs.push({ target, type: RELOC.ABS32, symbolSeg, addend });
  for (const p of g.textPatches) imp(p.name, T(label(p.label)), p.addend);
  for (const r of g.textRelocs) rel(T(label(r.label)), CRO_RODATA, r.roOff);
  for (const { off, w } of roWords) {
    if (w.kind === 'value') wr(roBytes, off, w.value);
    else if (w.kind === 'imp') imp(w.name, R(off), w.addend);
    else if (w.kind === 'ro') rel(R(off), CRO_RODATA, w.off);
    else rel(R(off), CRO_TEXT, label(w.label));
  }
  const namedImports = base.namedImports.map((x) => ({ ...x, patches: [...x.patches] }));
  for (const [name, ps] of patches) {
    const have = namedImports.find((x) => x.name === name);
    if (have) have.patches.push(...ps);
    else namedImports.push({ name, patches: ps });
  }
  const segments = base.segments.map((s, k) =>
    k === CRO_TEXT
      ? { ...s, size: text.length, bytes: text }
      : k === CRO_RODATA
        ? { ...s, size: roBytes.length, bytes: roBytes }
        : s,
  );
  const indexedExports = base.indexedExports.map((t) => ({ ...t }));
  for (const slot of [SLOT_AREA, SLOT_TALK, SLOT_LEAVE])
    if (labels.has(`slot_${slot}`)) indexedExports[slot] = T(label(`slot_${slot}`));
  return {
    cro: { ...base, segments, namedImports, indexedExports, internalRelocs: [...base.internalRelocs, ...relocs] },
    labels,
    ro,
    classes: events.map((e) => e.cls),
    resets: allResets,
  };
}

/** The CRR of the built CRO: a copy of one that registers a single CRO (content 99's) with the hash replaced. */
export function stageScriptCrr(base: Uint8Array, cro: Uint8Array): Uint8Array {
  const out = base.slice();
  const rd = (o: number): number => (out[o]! | (out[o + 1]! << 8) | (out[o + 2]! << 16) | (out[o + 3]! << 24)) >>> 0;
  if (rd(0x354) !== 1) throw new Error(`CRR が登録する CRO が ${rd(0x354)} 個あります (1 個のものが要ります)`);
  out.set(croRegistrationHash(cro), rd(0x350));
  return out;
}
