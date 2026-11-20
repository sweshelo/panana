// An author's events of an RPG FREE! stage, written as a small script and built into the content's CRO (native ARM
// code): the game runs them as it runs the shipped ones, there is no interpreter and no code.bin patch. What the game
// calls and how is written in lanai-custom-stages docs/native-events.md and 3ds/research/script-abi.md; the code shapes
// are those of 3ds/research/event-poc.ts, which ran in Azahar (event-poc.md §6), and of the shipped CROs named below.
//
//   var STATE: byte            // a number flag (0〜255) of the stage; "reset" = set back to 0 when the stage is left
//   var MET: bit reset
//   function greet() {         // one function = one event
//     switch (STATE) {
//       case 0: talk(0x80000060)                        // a function of the library (scriptLibrary.ts)
//       case 1: ScriptMenu.StartMessageAuto(0x80000061, 0, 0, 0.2)   // a Script API function, called by name
//     }
//     if (ScriptMenu.SystemMessageYesNo(0x80000063)) { hero.SetPopup(2, 11, 1, 1, 0, vec(0, 0, 0)); STATE = 2 }
//   }
//   on talk(1, 5) greet        // … of the character of EventObject row 5 of MapGroup 1
//   on area(1, 1) { ScriptMap.EnableEventCollision(selfRow, 0) }   // written in place: entering the range of row 1
//
// The language has no statements of its own beyond the flow (if / switch / return / break), the variables and
// vanishEffect: what an event does is the game's Script API (scriptApiTable.ts), called by name, and the functions of
// the script and of the library, written out where they are called (their arguments are known when it is built).
//
// What starts an event (`on`): talk (a character), area (a range), button (a button stepped on), start (the map of a
// group begins), intro (the stage is entered: the game's opening — the party walks in through the start's gate, the
// stage's name, the gate closes — then the body; once a visit), defeat (the map's monsters are all beaten; the event
// is kept by a range's row). The editor keeps the
// variables, the functions and what they are given to apart (ScriptDoc) and writes this text from them.
//
// The rows named by `on` must have the action type 0x8000002D (a script) in the data. Lines are the row IDs of the
// group's talk table as the game takes them (0x800000NN, not row numbers). ScriptMap.EncountBoss ends the event: the
// game goes on at the map's start, not after the statement (script-abi.md §7).
import { assembleLine, encodeImm } from '../game/asm';
import { RELOC, croRegistrationHash, type Cro, type CroPatch, type CroReloc, type SegTag } from './cro';
import { SCRIPT_API_ROWS, type ScriptApiRow } from './scriptApiTable';
import { SCRIPT_LIBRARY } from './scriptLibrary';

// ------------------------------------------------------------------------------------------------ the script
/**
 * An object a call is made on: the party's first (hero), the event's own (self: talk / button) or the one of an
 * EventObject row (obj(N): a character, a door, a chest, a monster …).
 */
export type ScriptWho = { kind: 'hero' } | { kind: 'self' } | { kind: 'chara'; row: number };
export type ScriptValue = { kind: 'var'; name: string } | { kind: 'call'; call: ScriptCall };
/** An argument of a Script API call, as the function's parameter takes it (scriptApiTable.ts). */
export type ScriptArg =
  | { k: 'i'; v: number }
  | { k: 'f'; v: number }
  | { k: 'v'; x: number; y: number; z: number }
  /** const ScriptMessageParam&: {0, 0}, not written in the script. */
  | { k: 'm' }
  /** A character: as its script object (c) or as its ChrObject* (p). */
  | { k: 'c'; who: ScriptWho }
  | { k: 'p'; who: ScriptWho }
  /** selfRow: the event's own row ID, as the game keeps it in the event's object (EventScript +4). */
  | { k: 'own' };
/** A Script API function called by its name: `ScriptSound.Play(0x84, 0)`, `hero.SetVisible(0)`. */
export interface ScriptCall {
  /** "Class::Name" as told in messages, and the symbol of lanai.crs. */
  name: string;
  sym: string;
  /** The character whose member function it is (null: a static function); `player`: of ScriptPlayer. */
  self: ScriptWho | null;
  player: boolean;
  args: ScriptArg[];
  /** The result is one byte (the bits above it are not defined). */
  byte: boolean;
  /**
   * What it returns (scriptApiTable.ts: void, bool, u8, s8, u16, s16, u32, ptr, float; "?" after it = not settled).
   * A float comes back in s0 and a void function leaves nothing: neither can be compared.
   */
  result: string;
}
export type ScriptCmp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export interface ScriptComparison {
  value: ScriptValue;
  cmp: ScriptCmp;
  than: number;
}
export type ScriptCond = ScriptComparison | { op: 'and' | 'or'; left: ScriptCond; right: ScriptCond };
export type ScriptNode =
  | { op: 'if'; cond: ScriptCond; then: ScriptNode[]; else: ScriptNode[] }
  | { op: 'switch'; value: ScriptValue; cases: { value: number; body: ScriptNode[] }[]; default: ScriptNode[] | null }
  | { op: 'set'; name: string; value: number }
  | { op: 'call'; call: ScriptCall }
  /** The shipped boss's vanishing effect at a monster's shadow (by its size), kept by the event (vanishEffect). */
  | { op: 'vanishEffect'; who: ScriptWho }
  | { op: 'break' }
  | { op: 'return' };

export const SCRIPT_TRIGGERS = ['talk', 'area', 'button', 'switch', 'start', 'intro', 'defeat'] as const;
export type ScriptTrigger = (typeof SCRIPT_TRIGGERS)[number];
export const SCRIPT_TRIGGER_LABEL: Record<ScriptTrigger, string> = {
  talk: '話しかけたとき',
  area: '範囲に入ったとき',
  button: 'ボタンを踏んだとき (降りると戻る)',
  switch: 'ボタンを踏んだとき (押したままになる)',
  start: 'マップが始まるとき',
  intro: 'ステージに入ったとき (入場の演出)',
  defeat: 'モンスターを倒しきったとき',
};
/** Whether the trigger is of a row of the EventObject table (start and intro are of the map group alone). */
export const triggerHasRow = (t: ScriptTrigger): boolean => t !== 'start' && t !== 'intro';

export interface ScriptFunction {
  name: string;
  /** Its parameters; a function with any is written out where it is called (and `body` is empty). */
  params: ScriptParam[];
  body: ScriptNode[];
  line: number;
  /** Where the text between the braces is in the source. */
  from: number;
  to: number;
}
export interface ScriptEvent {
  trigger: ScriptTrigger;
  /** The MapGroup row (what ScriptMap::GetCurrentMapGroupID() returns) and the EventObject row ID (0 for start). */
  group: number;
  row: number;
  body: ScriptNode[];
  line: number;
  /** The function the event runs; null when its statements are written in place. */
  fn: string | null;
  from: number;
  to: number;
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
  functions: ScriptFunction[];
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
    /** The message without the line. */
    readonly text: string,
    readonly line: number,
  ) {
    super(`${line} 行目: ${text}`);
  }
}

interface Token {
  t: 'num' | 'id' | 'p' | 'end';
  s: string;
  n: number;
  line: number;
  pos: number;
}

function tokens(src: string): Token[] {
  const out: Token[] = [];
  let line = 1;
  const re =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\n)|([ \t\r]+)|(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)|([A-Za-z_]\w*)|(&&|\|\||==|!=|<=|>=|[(){},:;=<>!.+\-*/])|(.)/gu;
  for (const m of src.matchAll(re)) {
    const pos = m.index;
    if (m[1]) line += m[1].split('\n').length - 1;
    else if (m[2]) line++;
    else if (m[4]) out.push({ t: 'num', s: m[4], n: Number(m[4]), line, pos });
    else if (m[5]) out.push({ t: 'id', s: m[5], n: 0, line, pos });
    else if (m[6]) out.push({ t: 'p', s: m[6], n: 0, line, pos });
    else if (m[7]) throw new ScriptError(`「${m[7]}」は使えない文字です`, line);
  }
  out.push({ t: 'end', s: '', n: 0, line, pos: src.length });
  return out;
}

const CMPS: readonly string[] = ['==', '!=', '<', '<=', '>', '>='];
/** Words a variable or a function cannot be named. */
export const SCRIPT_RESERVED: readonly string[] = [
  'if',
  'else',
  'switch',
  'case',
  'default',
  'return',
  'break',
  'on',
  'var',
  'function',
  'true',
  'false',
  'hero',
  'self',
  'obj',
  'selfRow',
  'byte',
  'bit',
  'reset',
];
export const isScriptName = (s: string): boolean => /^[A-Za-z_]\w*$/u.test(s) && !SCRIPT_RESERVED.includes(s);

/** What a body cannot do under a trigger (the object the game makes for it has no such thing), or null. */
export function eventProblem(trigger: ScriptTrigger, body: ScriptNode[]): string | null {
  const own = trigger === 'talk' || trigger === 'button' || trigger === 'switch';
  const who = (w: ScriptWho | null): string | null =>
    w && w.kind === 'self' && !own
      ? `self (イベントの持ち主) は「${SCRIPT_TRIGGER_LABEL.talk}」・ボタンのイベントでだけ使えます。obj(イベント番号) で指してください`
      : null;
  const arg = (a: ScriptArg): string | null =>
    a.k === 'c' || a.k === 'p'
      ? who(a.who)
      : a.k === 'own' && !triggerHasRow(trigger)
        ? `selfRow (このイベントの番号) は「${SCRIPT_TRIGGER_LABEL[trigger]}」のイベントにはありません`
        : null;
  const called = (c: ScriptCall): string | null => c.args.reduce<string | null>((p, a) => p ?? arg(a), who(c.self));
  const valued = (v: ScriptValue): string | null => (v.kind === 'call' ? called(v.call) : null);
  const condition = (c: ScriptCond): string | null =>
    'op' in c ? (condition(c.left) ?? condition(c.right)) : valued(c.value);
  for (const n of body) {
    let p: string | null = null;
    switch (n.op) {
      case 'if':
        p = condition(n.cond) ?? eventProblem(trigger, n.then) ?? eventProblem(trigger, n.else);
        break;
      case 'call':
        p = called(n.call);
        break;
      case 'switch':
        p = valued(n.value);
        for (const c of n.cases) p ??= eventProblem(trigger, c.body);
        p ??= n.default ? eventProblem(trigger, n.default) : null;
        break;
      case 'vanishEffect':
        p = who(n.who);
        break;
    }
    if (p) return p;
  }
  return null;
}

/** The Script API functions by "Class.Name" (several when overloaded), and the classes whose functions are static. */
const API_INDEX = new Map<string, ScriptApiRow[]>();
const MEMBER_CLASSES = new Set(['ScriptChara', 'ScriptPlayer']);
const API_CLASSES = new Set<string>();
for (const r of SCRIPT_API_ROWS) {
  const key = `${r[0]}.${r[1]}`;
  API_INDEX.set(key, [...(API_INDEX.get(key) ?? []), r]);
  if (!MEMBER_CLASSES.has(r[0])) API_CLASSES.add(r[0]);
}

/** A parameter of a function: an object (hero / self / obj(N), or N alone) or a number. */
export interface ScriptParam {
  name: string;
  kind: 'obj' | 'num';
}
/** What a parameter stands for where the function is written out. */
type ScriptBound = { kind: 'obj'; who: ScriptWho } | { kind: 'num'; v: number };
/** What a function's body is read with where it is written (its mistakes told there, before any call). */
const PARAM_STAND_IN: Record<ScriptParam['kind'], ScriptBound> = {
  obj: { kind: 'obj', who: { kind: 'chara', row: 1 } },
  num: { kind: 'num', v: 1 },
};
/** A function a body can call: its parameters, and where its body (the "{") is in the tokens it was read from. */
interface FnDef {
  name: string;
  params: ScriptParam[];
  ts: Token[];
  body: number;
  library: boolean;
}
/**
 * The words of the language's own statements, which a function cannot be named: vanishEffect (the one thing the
 * Script API cannot say: the event keeps the effect until it is destroyed) and vec(…) of the arguments. All else is
 * a Script API function called by name, or a function of the script or of the library (scriptLibrary.ts).
 */
export const SCRIPT_STATEMENTS: readonly string[] = ['vanishEffect', 'vec'];
/** The functions written in tokens (at the top, outside any braces), found before the bodies are read. */
function fnDefs(ts: Token[], library: boolean): FnDef[] {
  const out: FnDef[] = [];
  let depth = 0;
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k]!;
    if (t.t === 'p' && t.s === '{') depth++;
    else if (t.t === 'p' && t.s === '}') depth--;
    else if (depth === 0 && t.t === 'id' && t.s === 'function' && ts[k + 1]?.t === 'id' && ts[k + 2]?.s === '(') {
      const params: ScriptParam[] = [];
      let j = k + 3;
      while (ts[j] && ts[j]!.t !== 'end' && ts[j]!.s !== ')') {
        const kind = ts[j + 2]?.s;
        if (ts[j]!.t === 'id' && ts[j + 1]?.s === ':' && (kind === 'obj' || kind === 'num')) {
          params.push({ name: ts[j]!.s, kind });
          j += 3;
        } else j++;
      }
      if (ts[j]?.s === ')' && ts[j + 1]?.s === '{') out.push({ name: ts[k + 1]!.s, params, ts, body: j + 1, library });
    }
  }
  return out;
}

/** Reads a script; throws a ScriptError naming the line. */
export function parseStageScript(src: string): StageScript {
  let ts = tokens(src);
  let i = 0;
  /** The arguments of the function being written out where it is called (expandCall), by the names of its parameters. */
  let env = new Map<string, ScriptBound>();
  const numParam = (t: Token): number | undefined => {
    const b = t.t === 'id' ? env.get(t.s) : undefined;
    return b?.kind === 'num' ? b.v : undefined;
  };
  const objParam = (s: string): ScriptWho | undefined => {
    const b = env.get(s);
    return b?.kind === 'obj' ? b.who : undefined;
  };
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
  /**
   * A number worked out when the script is built: numbers, true / false, num parameters, + - * / and ( ). `whole`: no
   * number with a decimal point went into it and it came out whole (an integer argument of the Script API).
   */
  const expr = (what: string): { v: number; whole: boolean; at: Token } => {
    const at = peek();
    let decimal = false;
    const factor = (): number => {
      const t = next();
      if (t.t === 'p' && t.s === '(') {
        const v = sum();
        need(')');
        return v;
      }
      if (t.t === 'p' && t.s === '-') return -factor();
      if (t.t === 'num') {
        if (t.s.includes('.')) decimal = true;
        return t.n;
      }
      if (t.t === 'id' && (t.s === 'true' || t.s === 'false')) return Number(t.s === 'true');
      const p = numParam(t);
      if (p !== undefined) {
        if (!Number.isInteger(p)) decimal = true;
        return p;
      }
      if (t.t === 'id' && t.s === 'selfRow')
        fail(
          'selfRow はゲームが実行時に決める値なので、Script API の引数にそのまま書きます (計算や関数の引数には使えません)',
          t,
        );
      return fail(`${what}は数で書きます`, t);
    };
    const product = (): number => {
      let v = factor();
      for (;;) {
        if (eat('*')) v *= factor();
        else if (is('/')) {
          const t = next();
          const d = factor();
          if (d === 0) fail('0 では割れません', t);
          v /= d;
        } else return v;
      }
    };
    const sum = (): number => {
      let v = product();
      for (;;) {
        if (eat('+')) v += product();
        else if (eat('-')) v -= product();
        else return v;
      }
    };
    const v = sum();
    return { v, whole: !decimal && Number.isInteger(v), at };
  };
  const int = (what: string, min: number, max: number): number => {
    const { v, at } = expr(what);
    if (!Number.isInteger(v)) fail(`${what}は整数です (${v})`, at);
    if (v < min || v > max) fail(`${what}は ${min}〜${max} です (${v})`, at);
    return v;
  };
  const num = (what: string, min: number, max: number): number => {
    const { v, at } = expr(what);
    if (!Number.isFinite(v) || v < min || v > max) fail(`${what}は ${min}〜${max} です (${v})`, at);
    return v;
  };
  const vars = new Map<string, ScriptVar>();
  const functions = new Map<string, ScriptFunction>();
  const defs = new Map<string, FnDef>();
  /** The functions being written out, the outermost first (a function cannot call itself). */
  const calling: string[] = [];
  const events: ScriptEvent[] = [];
  const pending: { event: ScriptEvent; name: string; at: Token }[] = [];
  const used = { byte: 0, bit: 0 };

  const u32 = (what: string): number => int(what, 0, 0xffffffff);
  const row = (what = 'イベント番号'): number => u32(what);
  const WHO_WORDS = ['hero', 'self', 'obj'];
  /** A word that names an object: hero, self, obj or a parameter that is one. */
  const isWhoWord = (s: string): boolean => WHO_WORDS.includes(s) || objParam(s) !== undefined;
  const who = (): ScriptWho => {
    const t = next();
    if (t.t === 'id' && (t.s === 'hero' || t.s === 'self')) return { kind: t.s };
    const p = t.t === 'id' ? objParam(t.s) : undefined;
    if (p) return p;
    if (t.t === 'id' && t.s === 'obj') {
      need('(');
      const r = row('obj のイベント番号');
      need(')');
      return { kind: 'chara', row: r };
    }
    return fail('hero (先頭の電波人間) / self (イベントの持ち主) / obj(イベント番号) が要ります', t);
  };
  /** The arguments of a call: each reader takes one, commas between. */
  const call = <T extends unknown[]>(name: string, ...read: { [K in keyof T]: () => T[K] }): T => {
    need('(');
    const out: unknown[] = [];
    read.forEach((f, k) => {
      if (k) {
        if (!eat(',')) fail(`${name} の引数は ${read.length} 個です`);
      }
      out.push(f());
    });
    if (!eat(')')) fail(`${name} の引数は ${read.length} 個です`);
    return out as T;
  };

  /**
   * `who.name(…)` with a name in lower case, the object's token just read: the function `name` (the script's or the
   * library's) with the object as its first argument. Null (the tokens left as they were) when it is not one.
   */
  const methodAt = (t: Token): ScriptNode[] | null => {
    if (t.t !== 'id' || !isWhoWord(t.s)) return null;
    const at = i;
    i--;
    const w = who();
    const m = ts[i + 1];
    if (is('.') && m?.t === 'id' && /^[a-z_]/u.test(m.s)) {
      i += 2;
      const d = defs.get(m.s);
      if (!d || env.has(m.s)) return fail(`関数「${m.s}」はありません (大文字で始まる名前は Script API の関数です)`, m);
      if (!d.params.length) return fail(`${m.s} は引数がないので、${m.s}() と書きます`, m);
      return expandCall(d, m, w);
    }
    i = at;
    return null;
  };
  /**
   * A Script API function called by name, the token before the dot read: `Class.Name(args)` or `who.Name(args)`.
   * The arguments are numbers, vec(x, y, z), objects and selfRow; the function is the one of that name they fit.
   */
  const apiCall = (cls: string | null, self: ScriptWho | null, at: Token): ScriptCall => {
    need('.');
    const fn = next();
    if (fn.t !== 'id') fail('関数の名前が要ります', fn);
    if (self && defs.has(fn.s)) fail(`${fn.s}(…) は値を返しません。文として書きます`, fn);
    const classes = cls ? [cls] : self!.kind === 'hero' ? ['ScriptPlayer', 'ScriptChara'] : ['ScriptChara'];
    const rows = classes.flatMap((c) => API_INDEX.get(`${c}.${fn.s}`) ?? []);
    const shown = `${cls ?? classes[classes.length - 1]}::${fn.s}`;
    if (!rows.length) fail(`${shown} という Script API はありません (またはスクリプトから呼べない引数を持ちます)`, fn);
    type Raw =
      | { kind: 'num'; v: number; whole: boolean }
      | { kind: 'vec'; x: number; y: number; z: number }
      | { kind: 'who'; who: ScriptWho }
      | { kind: 'own' };
    const raw: Raw[] = [];
    need('(');
    while (!eat(')')) {
      if (raw.length) need(',');
      const t = peek();
      if (t.t === 'id' && t.s === 'vec') {
        next();
        const pos = (): number => num('vec の値', -1e9, 1e9);
        const [x, y, z] = call('vec', pos, pos, pos);
        raw.push({ kind: 'vec', x, y, z });
      } else if (t.t === 'id' && t.s === 'selfRow' && !['+', '-', '*', '/'].includes(ts[i + 1]?.s ?? '')) {
        next();
        raw.push({ kind: 'own' });
      } else if (t.t === 'id' && isWhoWord(t.s)) raw.push({ kind: 'who', who: who() });
      else {
        const e = expr(`${shown} の引数 (数・vec(x, y, z)・hero / self / obj(イベント番号)・selfRow) `);
        raw.push({ kind: 'num', v: e.v, whole: e.whole });
      }
    }
    /** How well the arguments fit a function's parameters (0: they do not). */
    const fit = (r: ScriptApiRow): number => {
      const params = [...r[3]].filter((k) => k !== 'm');
      if (params.length !== raw.length) return 0;
      let score = 1;
      for (let k = 0; k < raw.length; k++) {
        const a = raw[k]!,
          want = params[k]!;
        if (a.kind === 'num' && want === 'i' && a.whole) score += 2;
        else if (a.kind === 'num' && want === 'f') score += a.whole ? 1 : 2;
        else if (a.kind === 'own' && want === 'i') score += 2;
        else if (a.kind === 'vec' && want === 'v') score += 2;
        else if (a.kind === 'who' && want === 'p') score += 2;
        else if (a.kind === 'who' && want === 'c') score += 1;
        else return 0;
      }
      return score;
    };
    const fits = rows.map((r) => ({ r, score: fit(r) })).filter((x) => x.score > 0);
    const forms = rows.map((r) => `${r[0]}::${r[1]}(${r[4]})`).join(' / ');
    if (!fits.length) fail(`${shown} の引数が合いません: ${forms} (ScriptMessageParam は書きません)`, at);
    const best = Math.max(...fits.map((x) => x.score));
    let chosen = fits.filter((x) => x.score === best);
    // the hero's: ScriptPlayer's before ScriptChara's of the same form (its StartAnimation, as the game's CROs call)
    const first = classes.find((c) => chosen.some((x) => x.r[0] === c));
    chosen = chosen.filter((x) => x.r[0] === first);
    if (chosen.length > 1) fail(`${shown} のどれを呼ぶのか決まりません: ${forms}`, at);
    const r = chosen[0]!.r;
    let k = 0;
    const args: ScriptArg[] = [...r[3]].map((want): ScriptArg => {
      if (want === 'm') return { k: 'm' };
      const a = raw[k++]!;
      if (a.kind === 'vec') return { k: 'v', x: a.x, y: a.y, z: a.z };
      if (a.kind === 'who') return { k: want as 'c' | 'p', who: a.who };
      if (a.kind === 'own') return { k: 'own' };
      if (want === 'i' && (a.v < -0x80000000 || a.v > 0xffffffff))
        fail(`${shown} の整数の引数は 32 ビットに収まる値です`, at);
      return { k: want as 'i' | 'f', v: a.v };
    });
    const count = (w: string): number => args.filter((a) => a.k === w).length;
    const words = (self ? 1 : 0) + args.filter((a) => a.k !== 'f').length;
    if (count('v') > 2 || count('m') > 2 || count('c') > 1 || count('p') > 2 || words > 8 || count('f') > 8)
      fail(`${shown} は引数が多く、スクリプトからは呼べません`, at);
    return {
      name: `${r[0]}::${r[1]}`,
      sym: r[2],
      self,
      player: r[0] === 'ScriptPlayer',
      args,
      byte: /^(bool|u8)/u.test(r[5]),
      result: r[5],
    };
  };
  /** A call that begins at the token just read (a class's name or an object), or null. */
  const apiCallAt = (t: Token): ScriptCall | null => {
    if (t.t !== 'id') return null;
    if (API_CLASSES.has(t.s) && is('.')) return apiCall(t.s, null, t);
    if (isWhoWord(t.s)) {
      i--;
      const w = who();
      if (is('.')) return apiCall(null, w, t);
      return fail('hero / self / obj(…) の後には .関数(…) が要ります (例: hero.SetVisible(0))', t);
    }
    return null;
  };

  const value = (): ScriptValue => {
    const t = next();
    if (t.t !== 'id') fail('変数か Script API の呼び出しが要ります', t);
    const api = apiCallAt(t);
    if (api) {
      // read from the game's code (script-returns.md); an unsettled void ("void?") is left to the author
      if (api.result === 'void') fail(`${api.name} は値を返しません (戻り値は void)。比べずに、文として呼びます`, t);
      if (api.result.startsWith('float'))
        fail(`${api.name} は小数 (float) を返します。スクリプトの条件では整数しか比べられません`, t);
      return { kind: 'call', call: api };
    }
    if (is('('))
      fail(
        defs.has(t.s)
          ? `関数「${t.s}」は値を返しません`
          : `「${t.s}」は値として使えません (変数か、Script API の呼び出しを書きます)`,
        t,
      );
    if (!vars.has(t.s)) fail(`変数「${t.s}」はありません`, t);
    return { kind: 'var', name: t.s };
  };
  const conditionAtom = (): ScriptCond => {
    if (eat('(')) {
      const inner = cond();
      need(')');
      return inner;
    }
    const not = eat('!');
    const v = value();
    if (peek().t === 'p' && CMPS.includes(peek().s)) {
      if (not) fail('「!」と比較は一緒に書けません');
      const cmp = next().s as ScriptCmp;
      return { value: v, cmp, than: int('比べる値', -0x80000000, 0x7fffffff) };
    }
    return { value: v, cmp: not ? '==' : '!=', than: 0 };
  };
  const conditionAnd = (): ScriptCond => {
    let left = conditionAtom();
    while (eat('&&')) left = { op: 'and', left, right: conditionAtom() };
    return left;
  };
  const cond = (): ScriptCond => {
    let left = conditionAnd();
    while (eat('||')) left = { op: 'or', left, right: conditionAnd() };
    return left;
  };

  interface Ctx {
    inSwitch: boolean;
  }
  /** The statements between braces, with where the text between them is. */
  const block = (ctx: Ctx): { body: ScriptNode[]; from: number; to: number } => {
    const open = peek();
    need('{');
    const out: ScriptNode[] = [];
    while (!is('}')) {
      if (peek().t === 'end') fail('「}」が足りません');
      out.push(...stmt(ctx));
    }
    const close = next();
    return { body: out, from: open.pos + 1, to: close.pos };
  };
  /** The parameters of a function: `name: obj` (an object) or `name: num` (a number), commas between. */
  const params = (): ScriptParam[] => {
    need('(');
    const out: ScriptParam[] = [];
    while (!eat(')')) {
      if (out.length) need(',');
      const n = name('引数');
      if (out.some((p) => p.name === n.s)) fail(`引数「${n.s}」は 2 つあります`, n);
      if (vars.has(n.s)) fail(`「${n.s}」は変数の名前です`, n);
      need(':');
      const k = next();
      if (k.t !== 'id' || (k.s !== 'obj' && k.s !== 'num'))
        fail('引数の種類は obj (hero / self / obj(イベント番号)、またはイベント番号) か num (数) です', k);
      out.push({ name: n.s, kind: k.s as ScriptParam['kind'] });
    }
    return out;
  };
  /**
   * A call of a function (the script's or the library's): its body written out here, the arguments put in.
   * `receiver`: the object before the dot (`obj(3).open()`), its first argument.
   */
  const expandCall = (d: FnDef, at: Token, receiver?: ScriptWho): ScriptNode[] => {
    need('(');
    const bound = new Map<string, ScriptBound>();
    const written = d.params.length - (receiver ? 1 : 0);
    const count = (): never => fail(`${d.name} の引数は ${written} 個です`);
    d.params.forEach((p, k) => {
      const what = `${d.name} の引数 ${p.name} `;
      if (k === 0 && receiver) {
        if (p.kind === 'obj') bound.set(p.name, { kind: 'obj', who: receiver });
        else if (receiver.kind === 'chara') bound.set(p.name, { kind: 'num', v: receiver.row });
        else fail(`${what}は数なので、obj(イベント番号).${d.name}(…) とだけ書けます`, at);
        return;
      }
      if ((k > (receiver ? 1 : 0) && !eat(',')) || is(')')) count();
      const t = peek();
      const isObj = t.t === 'id' && isWhoWord(t.s);
      if (p.kind === 'obj')
        // an object: hero / self / obj(N), or the event's number alone
        bound.set(p.name, { kind: 'obj', who: isObj ? who() : { kind: 'chara', row: row(what) } });
      else if (isObj) {
        // a number given obj(N): its event's number
        const w = who();
        if (w.kind !== 'chara') fail(`${what}は数か obj(イベント番号) です`, t);
        bound.set(p.name, { kind: 'num', v: (w as { row: number }).row });
      } else bound.set(p.name, { kind: 'num', v: num(what, -0x80000000, 0xffffffff) });
    });
    if (!eat(')')) count();
    if (calling.includes(d.name)) fail(`関数「${d.name}」は自分を (ほかの関数を通しても) 呼べません`, at);
    if (calling.length >= 16) fail('関数の呼び出しが深すぎます', at);
    const save = { ts, i, env };
    ts = d.ts;
    i = d.body;
    env = bound;
    calling.push(d.name);
    try {
      return block({ inSwitch: false }).body;
    } catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      const where = d.library ? `${d.name} (ライブラリ)` : `関数「${d.name}」(${e.line} 行目)`;
      throw new ScriptError(`${where} の中: ${e.text}`, at.line);
    } finally {
      ts = save.ts;
      i = save.i;
      env = save.env;
      calling.pop();
    }
  };
  const stmt = (ctx: Ctx): ScriptNode[] => {
    const s = statement(ctx);
    return s === null ? [] : Array.isArray(s) ? s : [s];
  };
  const statement = (ctx: Ctx): ScriptNode | ScriptNode[] | null => {
    if (eat(';')) return null;
    const t = next();
    if (t.t !== 'id') fail(`文が要ります (「${t.s}」がありました)`, t);
    const def = defs.get(t.s);
    if (def && is('(') && !env.has(t.s)) return expandCall(def, t);
    const method = methodAt(t);
    if (method) return method;
    const api = apiCallAt(t);
    if (api) return { op: 'call', call: api };
    switch (t.s) {
      case 'if': {
        need('(');
        const c = cond();
        need(')');
        const then = block(ctx).body;
        let other: ScriptNode[] = [];
        if (eat('else')) other = is('if') ? stmt(ctx) : block(ctx).body;
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
            if (is('{')) body.push(...block({ ...ctx, inSwitch: true }).body);
            else body.push(...stmt({ ...ctx, inSwitch: true }));
          }
        }
        return { op: 'switch', value: v, cases, default: def };
      }
      case 'return':
        return { op: 'return' };
      case 'break':
        if (!ctx.inSwitch) fail('break は switch の中でだけ使えます', t);
        return { op: 'break' };
      case 'vanishEffect':
        return { op: 'vanishEffect', who: call(t.s, who)[0] };
    }
    if (eat('=')) {
      const v = vars.get(t.s);
      if (!v) return fail(`変数「${t.s}」はありません`, t);
      return { op: 'set', name: t.s, value: int('入れる値', 0, v.kind === 'bit' ? 1 : 255) };
    }
    return fail(
      is('(')
        ? `関数「${t.s}」はありません (Script API はクラス名から書きます: 例 ScriptSound.Play(0x7A, 0))`
        : `「${t.s}」という文はありません`,
      t,
    );
  };

  const name = (what: string): Token => {
    const t = next();
    if (t.t !== 'id') fail(`${what}の名前が要ります`, t);
    if (SCRIPT_RESERVED.includes(t.s)) fail(`「${t.s}」は${what}の名前にできません`, t);
    return t;
  };
  // the functions a body can call, before any body is read: the library's, then the script's (in their place)
  for (const f of SCRIPT_LIBRARY) for (const d of fnDefs(tokens(f.source), true)) defs.set(d.name, d);
  for (const d of fnDefs(ts, false)) defs.set(d.name, d);
  while (peek().t !== 'end') {
    if (eat(';')) continue;
    const t = next();
    if (t.t === 'id' && t.s === 'var') {
      const n = name('変数');
      if (vars.has(n.s)) fail(`変数「${n.s}」は 2 つあります`, n);
      need(':');
      const kind = next();
      if (kind.t !== 'id' || (kind.s !== 'byte' && kind.s !== 'bit')) fail('変数の種類は byte か bit です', kind);
      const k = kind.s as 'byte' | 'bit';
      const range = k === 'byte' ? STAGE_BYTE_FLAGS : STAGE_BIT_FLAGS;
      if (used[k] >= range.count) fail(`${k} の変数は ${range.count} 個までです`, n);
      vars.set(n.s, { name: n.s, kind: k, reset: eat('reset'), flag: range.first + used[k]++ });
    } else if (t.t === 'id' && t.s === 'function') {
      const n = name('関数');
      if (functions.has(n.s)) fail(`関数「${n.s}」は 2 つあります`, n);
      if (SCRIPT_STATEMENTS.includes(n.s)) fail(`「${n.s}」は組み込みの文の名前なので、関数の名前にできません`, n);
      const ps = params();
      // a function with parameters is read with stand-ins for them here (to tell its mistakes where it is written),
      // and again with the arguments wherever it is called
      env = new Map(ps.map((p): [string, ScriptBound] => [p.name, PARAM_STAND_IN[p.kind]]));
      const read = block({ inSwitch: false });
      env = new Map();
      functions.set(n.s, { name: n.s, line: t.line, params: ps, ...read, body: ps.length ? [] : read.body });
    } else if (t.t === 'id' && t.s === 'on') {
      const trig = next();
      if (trig.t !== 'id' || !(SCRIPT_TRIGGERS as readonly string[]).includes(trig.s))
        fail(`きっかけは ${SCRIPT_TRIGGERS.join(' / ')} です`, trig);
      const trigger = trig.s as ScriptTrigger;
      const [group, r] = triggerHasRow(trigger)
        ? call(
            `on ${trigger}`,
            () => u32('MapGroup の番号'),
            () => row(),
          )
        : [...call(`on ${trigger}`, () => u32('MapGroup の番号')), 0];
      if (triggerHasRow(trigger) && events.some((e) => triggerHasRow(e.trigger) && e.group === group && e.row === r))
        fail(`MapGroup ${group} のイベント ${r} には、もうイベントが割り当てられています`, trig);
      if (
        events.some(
          (e) => e.trigger === trigger && e.group === group && (!triggerHasRow(trigger) || trigger === 'defeat'),
        )
      )
        fail(`MapGroup ${group} の「${SCRIPT_TRIGGER_LABEL[trigger]}」は 1 つだけです`, trig);
      const event: ScriptEvent = { trigger, group, row: r, body: [], line: t.line, fn: null, from: 0, to: 0 };
      if (is('{')) Object.assign(event, block({ inSwitch: false }));
      else {
        const at = next();
        if (at.t !== 'id') fail('{ … } か関数の名前が要ります', at);
        event.fn = at.s;
        pending.push({ event, name: at.s, at });
      }
      events.push(event);
    } else fail(`var / function / on が要ります (「${t.s}」がありました)`, t);
  }
  for (const p of pending) {
    const f = functions.get(p.name);
    if (!f) return fail(`関数「${p.name}」がありません`, p.at);
    if (f.params.length)
      fail(`関数「${p.name}」は引数があるので、イベントには割り当てられません (ほかの関数から呼びます)`, p.at);
    Object.assign(p.event, { body: f.body, from: f.from, to: f.to });
  }
  for (const e of events) {
    const p = eventProblem(e.trigger, e.body);
    if (p) throw new ScriptError(e.fn ? `関数「${e.fn}」(${SCRIPT_TRIGGER_LABEL[e.trigger]}): ${p}` : p, e.line);
  }
  return { vars: [...vars.values()], functions: [...functions.values()], events };
}

// ------------------------------------------------------------------------------------------------ the editor's form
/** What the editor keeps of a stage's script: the variables as a table, one text per function, and what runs which. */
export interface ScriptDoc {
  vars: { name: string; kind: 'byte' | 'bit'; reset: boolean }[];
  /** `params`: the text between the parentheses (absent: none); `body`: the statements, without the braces. */
  functions: { name: string; params?: string; body: string }[];
  bindings: ScriptBinding[];
}
export interface ScriptBinding {
  trigger: ScriptTrigger;
  group: number;
  /** The EventObject row (0 for start and intro). */
  row: number;
  /** The function; '' for nothing after the game's part (intro alone: the opening without statements of its own). */
  fn: string;
}
export const emptyScriptDoc = (): ScriptDoc => ({ vars: [], functions: [], bindings: [] });
export const scriptDocIsEmpty = (d: ScriptDoc): boolean => !d.vars.length && !d.functions.length && !d.bindings.length;

const bindingText = (b: ScriptBinding): string =>
  `on ${b.trigger}(${triggerHasRow(b.trigger) ? `${b.group}, ${b.row}` : b.group}) ${b.fn || '{}'}`;

/** The script's text of a document, and the line each function's body begins at. */
export function scriptDocSource(doc: ScriptDoc): {
  text: string;
  bodies: { name: string; first: number; lines: number }[];
} {
  const out: string[] = [];
  const bodies: { name: string; first: number; lines: number }[] = [];
  for (const v of doc.vars) out.push(`var ${v.name}: ${v.kind}${v.reset ? ' reset' : ''}`);
  for (const f of doc.functions) {
    out.push(`function ${f.name}(${f.params?.trim() ?? ''}) {`);
    const lines = f.body.replace(/\r\n?/gu, '\n').split('\n');
    bodies.push({ name: f.name, first: out.length + 1, lines: lines.length });
    // a line comment on the last line must not take the closing brace with it
    out.push(...lines.map((line) => (line.trim() ? `  ${line}` : line)), '}');
  }
  for (const b of doc.bindings) out.push(bindingText(b));
  return { text: `${out.join('\n')}\n`, bodies };
}

/** A problem of a document: in a function's text (the line counted in it), or of the document as a whole. */
export class ScriptDocError extends Error {
  constructor(
    message: string,
    readonly fn: string | null,
    readonly line: number,
  ) {
    super(fn ? `関数「${fn}」の ${line} 行目: ${message}` : message);
  }
}

/** The script of a document. Throws a ScriptDocError that names the function and the line in it. */
export function scriptOfDoc(doc: ScriptDoc): StageScript {
  const seen = new Set<string>();
  for (const x of [...doc.vars, ...doc.functions]) {
    if (!isScriptName(x.name))
      throw new ScriptDocError(
        `「${x.name}」は名前にできません (英字で始まる英数字と _。if や hero などの言葉は使えません)`,
        null,
        0,
      );
    if (seen.has(x.name)) throw new ScriptDocError(`「${x.name}」という名前が 2 つあります`, null, 0);
    seen.add(x.name);
  }
  // each function alone first: a brace left open must not be told as a mistake of the function after it (the others
  // are there with empty bodies, so that it can call them)
  for (const f of doc.functions) {
    const others = doc.functions.filter((o) => o !== f).map((o) => ({ ...o, body: '' }));
    const alone = scriptDocSource({ vars: doc.vars, functions: [f, ...others], bindings: [] });
    try {
      parseStageScript(alone.text);
    } catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      const b = alone.bodies[0]!;
      throw new ScriptDocError(e.text, f.name, Math.max(1, Math.min(e.line - b.first + 1, b.lines)));
    }
  }
  const { text, bodies } = scriptDocSource(doc);
  try {
    return parseStageScript(text);
  } catch (e) {
    if (!(e instanceof ScriptError)) throw e;
    const b = bodies.find((x) => e.line >= x.first && e.line <= x.first + x.lines);
    if (b) throw new ScriptDocError(e.text, b.name, Math.min(e.line - b.first + 1, b.lines));
    throw new ScriptDocError(e.text, null, 0);
  }
}

/** Takes the indentation the lines share off, and the empty lines around. */
function dedent(text: string): string {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/u.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).trimEnd()).join('\n');
}

/** The document of a script's text: an event written in place becomes a function named after what starts it. */
export function scriptDocFromSource(src: string): ScriptDoc {
  const s = parseStageScript(src);
  const doc: ScriptDoc = {
    vars: s.vars.map((v) => ({ name: v.name, kind: v.kind, reset: v.reset })),
    functions: s.functions.map((f) => ({
      name: f.name,
      ...(f.params.length ? { params: f.params.map((p) => `${p.name}: ${p.kind}`).join(', ') } : {}),
      body: dedent(src.slice(f.from, f.to)),
    })),
    bindings: [],
  };
  const names = new Set([...s.vars.map((v) => v.name), ...s.functions.map((f) => f.name)]);
  for (const e of s.events) {
    let fn = e.fn;
    // an intro with nothing of its own stays without a function (the game's opening alone)
    if (!fn && e.trigger === 'intro' && !e.body.length && !src.slice(e.from, e.to).trim()) fn = '';
    else if (!fn) {
      const stem = triggerHasRow(e.trigger) ? `${e.trigger}_${e.group}_${e.row}` : `${e.trigger}_${e.group}`;
      fn = stem;
      for (let k = 2; names.has(fn); k++) fn = `${stem}_${k}`;
      names.add(fn);
      doc.functions.push({ name: fn, body: dedent(src.slice(e.from, e.to)) });
    }
    doc.bindings.push({ trigger: e.trigger, group: e.group, row: e.row, fn });
  }
  return doc;
}

// ------------------------------------------------------------------------------------------------ the code
export const CRO_TEXT = 1,
  CRO_RODATA = 2;
/**
 * The CRO's indexed exports the game calls (event-dispatch.md §1.2): the event of a range's row, of the map's start, of
 * a button's row, of a character's row; every frame of the field (where "all monsters beaten" is seen); and when the
 * stage is left.
 */
export const SLOT_AREA = 0,
  SLOT_START = 3,
  SLOT_BUTTON = 4,
  SLOT_TALK = 8,
  SLOT_DEFEAT = 24,
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
  // the stage's opening (CRO 28 D01Intro and its kin; lanai-custom-stages 3ds/research/stage-intro.md): IntroCommon's Execute calls vt+0x18 when
  // the map is the one it was made with (+0x74), else fades in
  introCtor: '_ZN11IntroCommonC2Ej',
  introExec: '_ZN11IntroCommon7ExecuteEv',
  introPos: '_ZN11IntroCommon18GetActionBeforePosEP5GSvecS1_iihffh',
  tiIntro: '_ZTI11IntroCommon',
  heroMsgD1: '_ZN13CommonHeroMsgD1Ev',
  partyCollision: '_ZN9ScriptMap20EnablePartyCollisionEb',
  removePop: '_ZN9ScriptMap19RemovePopMonsterAllEv',
  partyPos: '_ZN9ScriptMap16SetPartyPositionERK5GSvechbf',
  playerNum: '_ZN9ScriptMap12GetPlayerNumEv',
  player: '_ZN9ScriptMap9GetPlayerEi',
  denpaInvisible: '_ZN9ScriptMap17SetDenpaInvisibleEib',
  vecCtor: '__aeabi_vec_ctor_nocookie_nodtor',
  vecDtor: '__aeabi_vec_dtor',
  playerNew: '_ZN12ScriptPlayerC1Ev',
  playerSet: '_ZN12ScriptPlayer8SetCharaEP9ChrObject',
  isFloat: '_ZN12ScriptPlayer7IsFloatEv',
  autoAnim: '_ZN11ScriptChara16SetAutoAnimationEj',
  viewActive: '_ZN11ScriptChara13SetViewActiveEb',
  getPos: '_ZNK11ScriptChara6GetPosEv',
  setPos: '_ZN11ScriptChara6SetPosERK5GSvec',
  fadeInNow: '_ZN12ScriptSystem6FadeInEf9GSDisplay',
  anim: '_ZN11ScriptChara14StartAnimationEj10GSAnimTypeff',
  msg: '_ZN10ScriptMenu12StartMessageEjRK18ScriptMessageParamS2_13AppDialogTypebf',
  msgAuto: '_ZN10ScriptMenu16StartMessageAutoEjRK18ScriptMessageParamS2_13AppDialogTypebf',
  yesNo: '_ZN10ScriptMenu18SystemMessageYesNoEjRK18ScriptMessageParamS2_',
  getByte: '_ZN10ScriptFlag17GetScriptByteFlagEt',
  setByte: '_ZN10ScriptFlag17SetScriptByteFlagEth',
  getBit: '_ZN10ScriptFlag16GetScriptBitFlagEt',
  setBit: '_ZN10ScriptFlag16SetScriptBitFlagEtb',
  getState: '_ZN10ScriptFlag14GetScriptStateEj',
  setState: '_ZN10ScriptFlag14SetScriptStateEjh',
  getItem: '_ZN10ScriptFlag10GetItemNumEjb',
  addItem: '_ZN10ScriptFlag10AddItemNumEji',
  itemGet: '_ZN10ScriptMenu7ItemGetEjib',
  addGold: '_ZN10ScriptFlag7AddGoldEi',
  doorOpen: '_ZN9ScriptMap15SetDoorOpenFlagEj',
  doorClose: '_ZN9ScriptMap16SetDoorCloseFlagEj',
  waitTime: '_ZN12ScriptSystem8WaitTimeEf',
  hero: '_ZN9ScriptMap13GetPlayerHeroEv',
  mapChara: '_ZN9ScriptMap11GetMapCharaEj',
  charaCtor: '_ZN11ScriptCharaC1EP9ChrObject',
  charaDtor: '_ZN11ScriptCharaD1Ev',
  playerCtor: '_ZN12ScriptPlayerC1EP9ChrObject',
  playerDtor: '_ZN12ScriptPlayerD1Ev',
  playerAnim: '_ZN12ScriptPlayer14StartAnimationEj10GSAnimTypeff',
  setEmotion: '_ZN12ScriptPlayer10SetEmotionEN9ChrPlayer10EyeEmotionEf',
  restoreEmotion: '_ZN12ScriptPlayer14RestoreEmotionEv',
  popup: '_ZN11ScriptChara8SetPopupEhhbabRK5GSvec',
  popupEnd: '_ZN11ScriptChara15FinishPopupIconEv',
  waitAnimation: '_ZN11ScriptChara13WaitAnimationEj',
  moveTo: '_ZN11ScriptChara6MoveToERK5GSvecf10GSAnimModebbf',
  waitNode: '_ZN11ScriptChara17WaitNodeAnimationEv',
  rotateTo: '_ZN11ScriptChara8RotateToEff10GSAnimModebbb',
  rotateCharaTo: '_ZN11ScriptChara13RotateCharaToERS_f10GSAnimModebb',
  setVisible: '_ZN11ScriptChara10SetVisibleEb',
  cancelAutoAnim: '_ZN11ScriptChara19CancelAutoAnimationEv',
  blendAnim: '_ZN11ScriptChara12SetBlendAnimEb',
  alphaTo: '_ZN11ScriptChara7AlphaToEff10GSAnimModebbf',
  shadowPos: '_ZNK11ScriptChara12GetShadowPosEv',
  monsterSize: '_ZN17ScriptMonsterCtrl14GetMonsterSizeEP9ChrObject',
  effectCtor: '_ZN12ScriptEffectC1Ev',
  effectCreate: '_ZN12ScriptEffect12CreateEffectEj9GSLayerID',
  effectStart: '_ZN12ScriptEffect11StartEffectEf',
  gsvecZero: 'GSVEC_ZERO',
  play: '_ZN11ScriptSound4PlayEtf',
  pauseBgm: '_ZN11ScriptSound8PauseBGMEf',
  replayBgm: '_ZN11ScriptSound9ReplayBGMEf',
  collision: '_ZN9ScriptMap20EnableEventCollisionEjb',
  deleteObject: '_ZN9ScriptMap17DeleteEventObjectEj',
  formation: '_ZN9ScriptMap18SetUpdateFormationEb',
  encount: '_ZN9ScriptMap11EncountBossEjj',
  monsters: '_ZN9ScriptMap20GetMonsterLimitCountEv',
  startEvent: '_ZN15EventScriptCtrl16StartEventScriptEj',
  stageName: '_ZN10ScriptMenu13ShowStageNameEv',
  camPause: '_ZN12ScriptCamera18PauseCameraUpdaterEv',
  camResume: '_ZN12ScriptCamera19ResumeCameraUpdaterEv',
  camTo: '_ZN12ScriptCamera16MoveEyeAndTargetEPK9ChrObjectfRK5GSvecS5_10GSAnimMode',
  camField: '_ZN12ScriptCamera15MoveFieldCameraEf10GSAnimMode',
  camWait: '_ZN12ScriptCamera13WaitAnimationEv',
  fadeOut: '_ZN12ScriptSystem11FadeOutWaitEf9GSDisplay',
  fadeIn: '_ZN12ScriptSystem10FadeInWaitEf9GSDisplay',
  buttonCtor: '_ZN23GimmickPushButtonCommonC1EjP10ChrGimmick',
  buttonVt: '_ZTV23GimmickPushButtonCommon',
  tiButton: '_ZTI23GimmickPushButtonCommon',
  buttonExec: '_ZN23GimmickPushButtonCommon7ExecuteEv',
  buttonCtrl: '_ZN23GimmickPushButtonCommon8CtrlFlagEv',
  buttonSteps: '_ZN23GimmickPushButtonCommon20GetStepOntoButtonNumEv',
  buttonIsPush: '_ZN23GimmickPushButtonCommon6IsPushEv',
  buttonDown: '_ZN23GimmickPushButtonCommon10MoveGroundEv',
  buttonUp: '_ZN23GimmickPushButtonCommon13RestoreGroundEv',
  // the button that stays down (CRO 108 D01GimmickCommon): its Execute has the push half of GimmickPushButtonCommon's
  // (0x33E0A8; the other's also lifts it when nothing stands on it, 0x32F284)
  keepCtor: '_ZN27GimmickKeepPushButtonCommonC1EjP10ChrGimmick',
  keepExec: '_ZN27GimmickKeepPushButtonCommon7ExecuteEv',
  // vt+0x14: 0 once pressed (0x33E098), so stepping on it again starts no event (does not hide the menu)
  keepMenu: '_ZN27GimmickKeepPushButtonCommon11GetMenuMaskEv',
  tiKeep: '_ZTI27GimmickKeepPushButtonCommon',
} as const;
const A = SCRIPT_API;

/**
 * What the game's object of an event is built on, by what starts it (script-abi.md §2.2):
 *   talk    NpcCommonTurn (0x74), its ScriptChara at +0xC
 *   button  GimmickPushButtonCommon (0x68, its ScriptChara at +0xC) and a byte at +0x68: "pressed in this run";
 *           switch: GimmickKeepPushButtonCommon (the same object; it is not lifted when stepped off)
 *   area / defeat / start   EventScript (0xC); start has the ID 0x1000000, the event of a floor's start
 *   intro   IntroCommon (0x78: CommonHeroMsg with the ID 0x1000000, +0x74 the map it plays in); vt+0x18 is the event
 */
type Shape = 'npc' | 'button' | 'plain' | 'intro';
const SHAPE: Record<ScriptTrigger, Shape> = {
  talk: 'npc',
  button: 'button',
  switch: 'button',
  area: 'plain',
  defeat: 'plain',
  start: 'plain',
  intro: 'intro',
};
const NEW_SIZE: Record<Shape, number> = { npc: 0x74, button: 0x6c, plain: 0xc, intro: 0x78 };
const BUTTON_PRESSED = 0x68;
const START_EVENT_ID = 0x1000000;

/**
 * The opening of a map group (stage-intro.md): the map IntroCommon is made with (the group's first map: elsewhere it
 * only fades in), the bit flag that keeps it to once a visit (set by CtrlFlag, cleared when the stage is left), and
 * the gate of the group's start point (a record of section 3) when there is one: its tile, the way the party walks
 * in (GetActionBeforePos: 1 = +z, 2 = +x, 4 = −z, 8 = −x; the opposite of the record's facing) and the EventObject
 * row of the gate's door (0: no door to close). No gate: the screen fades in and the stage's name is shown.
 */
export interface IntroSpec {
  map: number;
  flag: number;
  gate: { x: number; z: number; dir: 1 | 2 | 4 | 8; door: number } | null;
}
/** The party's animations of the walk in: standing, walking, floating (ScriptPlayer::IsFloat). */
const INTRO_FLOAT = 0x80000026;
/** The gate's door: open (when the opening's object is made), closing (after the party is in); its sound. */
const DOOR_OPEN = 0x8000006e,
  DOOR_CLOSE = 0x80000074,
  DOOR_SOUND = 0x7a;
/** IntroCommon::GetActionBeforePos's direction from a section 3 record's facing (+0x14) (91 of 91 shipped intros). */
export const INTRO_DIR: Record<number, 1 | 2 | 4 | 8> = { 1: 4, 4: 1, 2: 8, 8: 2 };
/**
 * Execute's frame of an intro: FRAME, then the party (ScriptPlayer[8], 0x50 each, alive through the event as in
 * D01Intro) and the two points GetActionBeforePos gives (where the party is put, where it walks to).
 */
const INTRO_FRAME = { players: 0xb0, from: 0x330, to: 0x33c, size: 0x348 } as const;
const PLAYER_SIZE = 0x50,
  PLAYERS = 8;
/** The party's: standing and walking (ScriptPlayer::StartAnimation, script-abi.md §3 B). */
const PLAYER_WAIT = 0x80000001,
  PLAYER_WALK = 0x80000003;
/** ScriptChara::WaitAnimation's argument in every shipped call. */
const WAIT_ANIM_ARG = 0x3e;
/** GSDisplay of the fades (both screens in the shipped calls). */
const FADE_DISPLAY = 2;
const F0 = 0x00000000,
  F1 = 0x3f800000; // 0.0f, 1.0f
const fbits = (v: number): number => new Uint32Array(new Float32Array([v]).buffer)[0]!;

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
 * The frame of Execute: push {r4-r8, lr} (24) + vpush {d8, d9} (16) + sub sp, #0xB0, 8-aligned.
 *   [sp+0x00..0x0F] stack arguments    [sp+0x10] / [sp+0x18] two ScriptMessageParam {0, 0}
 *   [sp+0x20..0x6F] a ScriptPlayer (0x50) or ScriptChara (0x18) of the character a statement acts on
 *   [sp+0x70..0x87] a second ScriptChara (the one face() turns to)    [sp+0x88..0x97] a GSvec
 *   [sp+0x98..0xA7] a second GSvec and [sp+0xA8..0xAF] two ChrObject* of a Script API call's arguments
 * r4 = this, r5 = 0, r8 = the camera is held (ScriptCamera::PauseCameraUpdater); s16 = 0.0, s17 = 1.0.
 */
/** ScriptChara +0xB: the popup kind it showed (0xFF: none; see the popup statement). */
const POPUP_KIND = 0xb;
const FRAME = { size: 0xb0, smpA: 0x10, smpB: 0x18, obj: 0x20, obj2: 0x70, vec: 0x88, vec2: 0x98, tmp: 0xa8 } as const;

const BRANCH_IF_NOT: Record<ScriptCmp, string> = {
  '==': 'bne',
  '!=': 'beq',
  '<': 'bge',
  '<=': 'bgt',
  '>': 'ble',
  '>=': 'blt',
};
/** Item IDs are row IDs (0x800000NN); the script may leave the high bit out. */
export const scriptRowId = (n: number): number => (0x80000000 | n) >>> 0;

interface Ctx {
  fn: Fn;
  g: Gen;
  trigger: ScriptTrigger;
  vars: Map<string, ScriptVar>;
  exit: string;
  breakTo: string | null;
  effectAt: number | null;
}

/** sN = value: from s16 / s17 when it is 0 / 1, else through `tmp` (set the integer arguments after it). */
function fmov(fn: Fn, s: string, value: number, tmp = 'r3'): void {
  if (value === 0) fn.op(`vmov.f32 ${s}, s16`);
  else if (value === 1) fn.op(`vmov.f32 ${s}, s17`);
  else fn.op(`ldr ${tmp}, ${fn.lit({ kind: 'value', value: fbits(value) })}`, `vmov ${s}, ${tmp}`);
}

/** r0 = the ChrObject* of the character. */
function chrOf(c: Ctx, who: ScriptWho): void {
  const { fn } = c;
  if (who.kind === 'hero') fn.call(A.hero);
  else if (who.kind === 'self') fn.op('ldr r0, [r4, #0x10]'); // the event's ScriptChara (+0xC): its ChrObject* (+4)
  else {
    fn.load('r0', who.row);
    fn.call(A.mapChara);
  }
}

/**
 * A script object of the character around `use`, whose argument writes `r0 = the object`: the event's own ScriptChara,
 * or one made in the frame and destroyed after (`player`: a ScriptPlayer, for what only the party's have).
 */
function withChara(c: Ctx, who: ScriptWho, at: number, player: boolean, use: (ref: () => void) => void): void {
  const { fn } = c;
  if (who.kind === 'self' && !player) {
    use(() => fn.op('add r0, r4, #0xc'));
    return;
  }
  const ref = (): void => fn.op(`add r0, sp, #${hx(at)}`);
  chrOf(c, who);
  fn.op('mov r1, r0');
  ref();
  fn.call(player ? A.playerCtor : A.charaCtor);
  use(ref);
  ref();
  fn.call(player ? A.playerDtor : A.charaDtor);
}

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
    case 'call':
      compileCall(c, v.call);
      if (v.call.byte) fn.op('and r0, r0, #0xff');
      break;
  }
}

/**
 * A Script API function called with its arguments laid as AAPCS-VFP has them: `this` and the integers and pointers
 * in r0-r3 then on the stack, the floats in s0 on; r0 = what it returns. A few functions are called as the game's
 * CROs call them around them (the camera held, the popup kept, the battle ending the event).
 */
function compileCall(c: Ctx, call: ScriptCall): void {
  const { fn, g } = c;
  if (call.sym === A.camPause) {
    // r8 = the camera is held: paused once, and given back when the event ends (compileStageScript) unless the script
    // resumed it (as CRO 18's button pauses it once)
    const skip = g.uniq(`${fn.name}_cam`);
    fn.op('cmp r8, #0', `bne ${skip}`);
    fn.call(call.sym);
    fn.op('mov r8, #1');
    fn.at(skip);
    return;
  }
  const other = call.args.find((a) => a.k === 'c');
  const emit = (self: (() => void) | null, chara: (() => void) | null): void => {
    // the characters passed as ChrObject* first: finding them calls the game
    const chrAt = new Map<ScriptArg, number>();
    for (const a of call.args)
      if (a.k === 'p') {
        chrOf(c, a.who);
        chrAt.set(a, FRAME.tmp + 4 * chrAt.size);
        fn.op(`str r0, [sp, #${hx(chrAt.get(a)!)}]`);
      }
    // what the references point at
    const refAt = new Map<ScriptArg, number>();
    let vecs = 0,
      smps = 0;
    for (const a of call.args) {
      if (a.k === 'v') {
        const at = vecs++ ? FRAME.vec2 : FRAME.vec;
        refAt.set(a, at);
        [a.x, a.y, a.z].forEach((v, k) => {
          fn.load('r0', fbits(v));
          fn.op(`str r0, [sp, #${hx(at + 4 * k)}]`);
        });
        fn.op(`str r5, [sp, #${hx(at + 12)}]`);
      } else if (a.k === 'm') {
        const at = smps++ ? FRAME.smpB : FRAME.smpA;
        refAt.set(a, at);
        fn.op(`str r5, [sp, #${hx(at)}]`, `str r5, [sp, #${hx(at + 4)}]`);
      }
    }
    /** rd = the word of an argument. */
    const word = (rd: string, a: ScriptArg): void => {
      if (a.k === 'i') fn.load(rd, a.v);
      else if (a.k === 'v' || a.k === 'm') fn.op(`add ${rd}, sp, #${hx(refAt.get(a)!)}`);
      else if (a.k === 'p') fn.op(`ldr ${rd}, [sp, #${hx(chrAt.get(a)!)}]`);
      else if (a.k === 'own') fn.op(`ldr ${rd}, [r4, #4]`); // the event's ID (EventScript +4)
      else if (a.k === 'c') {
        chara!();
        if (rd !== 'r0') fn.op(`mov ${rd}, r0`);
      }
    };
    const words: (ScriptArg | null)[] = [...(self ? [null] : []), ...call.args.filter((a) => a.k !== 'f')];
    // the words beyond r3 on the stack, then the floats (through r3), then the registers: the character's object
    // first (it is found through r0), r0 last
    words.slice(4).forEach((a, k) => {
      word('r0', a!);
      fn.op(`str r0, [sp, #${hx(4 * k)}]`);
    });
    call.args.filter((a) => a.k === 'f').forEach((a, k) => fmov(fn, `s${k}`, (a as { v: number }).v));
    const regs = words.slice(0, 4);
    const isChara = (k: number): number => Number(regs[k]?.k === 'c');
    const order = regs.map((_, k) => k).sort((x, y) => isChara(y) - isChara(x) || y - x);
    for (const k of order) {
      const a = regs[k];
      if (!a) self!();
      else word(`r${k}`, a);
    }
    fn.call(call.sym);
  };
  const withSelf = (chara: (() => void) | null): void => {
    if (call.self)
      withChara(c, call.self, FRAME.obj, call.player, (ref) => {
        emit(ref, chara);
        // SetPopup keeps the kind it showed at +0xB (0xFF from the ctor, 0x2E2750) and ~ScriptChara takes the icon
        // down when it is not 0xFF (0x2FFD74 → 0x2D51B0): the ROM's CROs keep their ScriptChara for the whole event
        // (an NPC's at this+0xC), ours lives for the call, so the icon would go as it came. FinishPopupIcon does not
        // read +0xB.
        if (call.sym === A.popup && call.self!.kind !== 'self')
          fn.op('mov r0, #0xff', `strb r0, [sp, #${hx(FRAME.obj + POPUP_KIND)}]`);
      });
    else emit(null, chara);
  };
  if (other && other.k === 'c') withChara(c, other.who, FRAME.obj2, false, (ref) => withSelf(ref));
  else withSelf(null);
  if (call.sym === A.camResume) fn.op('mov r8, #0');
  // EncountBoss asks for the battle and returns; the event ends here (script-abi.md §7). The group is looked up in the
  // content's MonsterGroup (master +0x1068, an _ENCOUNT table) by FUN_0031C038: a value below 0x80000000 is a row
  // number (what the boss range 0C passes: 0x2E281C ldrh), else a row ID. The row IDs are not the row numbers
  // (content 1: 0x80000000, 0x80000010, 0x80000011 …), and a value not there gives row 0, the empty group.
  if (call.sym === A.encount) fn.op(`b ${c.exit}`);
}

/** Whether a body (its branches too) has a node of a kind. */
const has = (nodes: ScriptNode[], is: (n: ScriptNode) => boolean): boolean =>
  nodes.some(
    (n) =>
      is(n) ||
      (n.op === 'if' && (has(n.then, is) || has(n.else, is))) ||
      (n.op === 'switch' && (n.cases.some((k) => has(k.body, is)) || has(n.default ?? [], is))),
  );
const calls = (n: ScriptNode, ...syms: string[]): boolean => n.op === 'call' && syms.includes(n.call.sym);
const usesCamera = (nodes: ScriptNode[]): boolean => has(nodes, (n) => calls(n, A.camPause));
const usesVanish = (nodes: ScriptNode[]): boolean => has(nodes, (n) => n.op === 'vanishEffect');
const fadesIn = (nodes: ScriptNode[]): boolean => has(nodes, (n) => calls(n, A.fadeIn, A.fadeInNow));

/** Branch to exactly one target; a skipped side never evaluates its calls. */
function compileCondition(c: Ctx, condition: ScriptCond, whenTrue: string, whenFalse: string): void {
  const { fn, g } = c;
  if ('op' in condition) {
    const next = g.uniq(`${fn.name}_condition`);
    if (condition.op === 'and') {
      compileCondition(c, condition.left, next, whenFalse);
      fn.at(next);
      compileCondition(c, condition.right, whenTrue, whenFalse);
    } else {
      compileCondition(c, condition.left, whenTrue, next);
      fn.at(next);
      compileCondition(c, condition.right, whenTrue, whenFalse);
    }
    return;
  }
  compileValue(c, condition.value);
  fn.cmp('r0', condition.than);
  fn.op(`${BRANCH_IF_NOT[condition.cmp]} ${whenFalse}`, `b ${whenTrue}`);
}

function compileNodes(c: Ctx, nodes: ScriptNode[]): void {
  const { fn, g } = c;
  for (const n of nodes) {
    fn.flushIfFar();
    switch (n.op) {
      case 'if': {
        const yes = g.uniq(`${fn.name}_then`),
          other = g.uniq(`${fn.name}_else`),
          end = g.uniq(`${fn.name}_fi`);
        compileCondition(c, n.cond, yes, other);
        fn.at(yes);
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
      case 'vanishEffect': {
        // contents0001 D01BossWin (+0x94c/+0x9b8): the effect by the monster's size (small 0xC1, large 0xC2, none for
        // the others) at its shadow; the event keeps the ScriptEffect until its destructor (effectAt). Nothing when
        // the object is not on the map.
        const at = c.effectAt!;
        const small = g.uniq(`${fn.name}_vanish_small`),
          make = g.uniq(`${fn.name}_vanish_make`),
          done = g.uniq(`${fn.name}_vanish_done`);
        chrOf(c, n.who);
        fn.op('cmp r0, #0', `beq ${done}`, `str r0, [sp, #${hx(FRAME.tmp)}]`);
        fn.call(A.monsterSize);
        fn.op(
          'cmp r0, #1',
          'cmpne r0, #2',
          'cmpne r0, #4',
          `beq ${small}`,
          'cmp r0, #6',
          'cmpne r0, #8',
          'cmpne r0, #0xa',
          'cmpne r0, #0x10',
          `bne ${done}`,
        );
        fn.load('r1', 0xc2);
        fn.op(`b ${make}`);
        fn.at(small);
        fn.load('r1', 0xc1);
        fn.at(make);
        fn.op(`add r0, r4, #${hx(at)}`, 'mov r2, #3');
        fn.call(A.effectCreate);
        fn.op(`ldr r1, [sp, #${hx(FRAME.tmp)}]`, `add r0, sp, #${hx(FRAME.obj)}`);
        fn.call(A.charaCtor);
        fn.op(`add r0, sp, #${hx(FRAME.obj)}`);
        fn.call(A.shadowPos);
        fn.op('mov r1, r0', `add r0, r4, #${hx(at)}`);
        fn.call(A.setPos);
        fn.op(`add r0, sp, #${hx(FRAME.obj)}`);
        fn.call(A.charaDtor);
        fn.op(`add r0, r4, #${hx(at)}`, 'vmov.f32 s0, s17');
        fn.call(A.effectStart);
        fn.at(done);
        break;
      }
      case 'call':
        compileCall(c, n.call);
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
  /** Text offsets of the labels (`slot_0`, `slot_8`, `slot_27` …, `<class>_exec`, `<class>_d1`, `<class>_d0`). */
  labels: Map<string, number>;
  /** Rodata offsets: `<class>_vt` (where the object's vtable pointer points), `<class>_ti`, `zero`. */
  ro: Record<string, number>;
  /** The class of each event, in the script's order. */
  classes: string[];
  /** What export 27 sets to 0. */
  resets: LeaveReset[];
}

/** r7 = &players[r6] (ScriptPlayer, 0x50 each, from INTRO_FRAME.players). */
const introPlayerAt = (x: Fn): void =>
  x.op('add r7, r6, r6, lsl #2', 'add r7, sp, r7, lsl #4', `add r7, r7, #${hx(INTRO_FRAME.players)}`);

/**
 * The game's part of an intro before the body (stage-intro.md; CRO 28 D01Intro vt+0x18 `E98`, CRO 1 `2034`): with a
 * gate, the party is put outside it, the followers hidden, the screen fades in, the stage's name is shown, the leader
 * walks in and the door closes behind; without, the fade and the name (S01Intro). The party's ScriptPlayer[8] stays
 * alive to introAfter. Uses r6 / r7 (free outside talk events).
 */
function introBefore(x: Fn, g: Gen, cls: string, intro: IntroSpec): void {
  const F = INTRO_FRAME;
  const gate = intro.gate;
  if (!gate) {
    fmov(x, 's0', 0.3);
    x.load('r0', FADE_DISPLAY);
    x.call(A.fadeIn);
    fmov(x, 's0', 0.7);
    x.call(A.waitTime);
    x.call(A.stageName);
    fmov(x, 's0', 0.5);
    x.call(A.waitTime);
    return;
  }
  // GetActionBeforePos(this, &from, &to, x, z, [sp] z, [sp+4] dir, s0 0, s1 0, [sp+8] 0)
  x.load('r1', gate.z);
  x.op('str r1, [sp]');
  x.load('r1', gate.dir);
  x.op('str r1, [sp, #4]', 'str r5, [sp, #8]', 'mov r0, r4', `add r1, sp, #${hx(F.from)}`, `add r2, sp, #${hx(F.to)}`);
  x.load('r3', gate.x);
  x.op('vmov.f32 s0, s16', 'vmov.f32 s1, s16');
  x.call(A.introPos);
  x.op('mov r0, #0');
  x.call(A.formation);
  x.op('mov r0, #0');
  x.call(A.partyCollision);
  x.call(A.removePop);
  // SetPartyPosition(from, 4, true, 100.0)
  fmov(x, 's0', 100);
  x.op(`add r0, sp, #${hx(F.from)}`, 'mov r1, #4', 'mov r2, #1');
  x.call(A.partyPos);
  x.op(`add r0, sp, #${hx(F.players)}`, `ldr r1, ${x.lit({ kind: 'imp', name: A.playerNew, addend: 0 })}`);
  x.load('r2', PLAYER_SIZE);
  x.load('r3', PLAYERS);
  x.call(A.vecCtor);
  // every member stands; the followers are hidden until the leader is in
  const each = g.uniq(`${cls}_party`),
    lead = g.uniq(`${cls}_lead`),
    shown = g.uniq(`${cls}_shown`);
  x.op('mov r6, #0');
  x.at(each);
  x.call(A.playerNum);
  x.op('cmp r0, r6', `bls ${shown}`, 'mov r0, r6');
  x.call(A.player);
  x.op('mov r1, r0');
  introPlayerAt(x);
  x.op('mov r0, r7');
  x.call(A.playerSet);
  x.load('r1', PLAYER_WAIT);
  x.op('mov r0, r7', 'mov r2, #0', 'vmov.f32 s0, s17', 'vmov.f32 s1, s16');
  x.call(A.playerAnim);
  x.load('r1', PLAYER_WAIT);
  x.op('mov r0, r7');
  x.call(A.autoAnim);
  x.op('cmp r6, #0', `beq ${lead}`, 'mov r0, r7', 'mov r1, #0');
  x.call(A.setVisible);
  x.op('mov r0, r7', 'mov r1, #0');
  x.call(A.viewActive);
  x.op('mov r0, r6', 'mov r1, #1');
  x.call(A.denpaInvisible);
  x.at(lead);
  x.op('add r6, r6, #1', `b ${each}`);
  x.flush(false);
  x.at(shown);
  // FadeIn(0.3, 2); WaitTime(0.7); ShowStageName(); WaitTime(0.5)
  fmov(x, 's0', 0.3);
  x.load('r0', FADE_DISPLAY);
  x.call(A.fadeInNow);
  fmov(x, 's0', 0.7);
  x.call(A.waitTime);
  x.call(A.stageName);
  fmov(x, 's0', 0.5);
  x.call(A.waitTime);
  // the leader walks (floats) in: StartAnimation(IsFloat() ? 0x80000026 : 0x80000003); MoveTo(to, 0, 0, 0, 0, 0)
  const walk = g.uniq(`${cls}_walk`);
  x.op(`add r0, sp, #${hx(F.players)}`);
  x.call(A.isFloat);
  x.op('cmp r0, #0');
  x.load('r1', PLAYER_WALK);
  x.op(`beq ${walk}`);
  x.load('r1', INTRO_FLOAT);
  x.at(walk);
  x.op(`add r0, sp, #${hx(F.players)}`, 'mov r2, #0', 'vmov.f32 s0, s17', 'vmov.f32 s1, s16');
  x.call(A.playerAnim);
  x.op(
    'str r5, [sp]',
    `add r0, sp, #${hx(F.players)}`,
    `add r1, sp, #${hx(F.to)}`,
    'mov r2, #0',
    'mov r3, #0',
    'vmov.f32 s0, s16',
    'vmov.f32 s1, s16',
  );
  x.call(A.moveTo);
  if (gate.door) {
    // WaitTime(1.3); Play(0x7A); the door closes (0x80000074)
    fmov(x, 's0', 1.3);
    x.call(A.waitTime);
    x.op('vmov.f32 s0, s16');
    x.load('r0', DOOR_SOUND);
    x.call(A.play);
    x.load('r0', gate.door);
    x.call(A.mapChara);
    x.op('mov r1, r0', `add r0, sp, #${hx(FRAME.obj)}`);
    x.call(A.charaCtor);
    x.load('r1', DOOR_CLOSE);
    x.op(`add r0, sp, #${hx(FRAME.obj)}`, 'mov r2, #0', 'vmov.f32 s0, s17', 'vmov.f32 s1, s16');
    x.call(A.anim);
    x.op(`add r0, sp, #${hx(FRAME.obj)}`);
    x.call(A.charaDtor);
  }
  x.op(`add r0, sp, #${hx(F.players)}`);
  x.call(A.waitNode);
  x.load('r1', PLAYER_WAIT);
  x.op(`add r0, sp, #${hx(F.players)}`, 'mov r2, #0', 'vmov.f32 s0, s17', 'vmov.f32 s1, s16');
  x.call(A.playerAnim);
}

/** The game's part of an intro after the body: the followers to the leader, the formation and collision back on. */
function introAfter(x: Fn, g: Gen, cls: string): void {
  const F = INTRO_FRAME;
  const each = g.uniq(`${cls}_follow`),
    done = g.uniq(`${cls}_followed`);
  x.op('mov r6, #1');
  x.at(each);
  x.call(A.playerNum);
  x.op('cmp r0, r6', `bls ${done}`, `add r0, sp, #${hx(F.players)}`);
  x.call(A.getPos);
  x.op('mov r1, r0');
  introPlayerAt(x);
  x.op('mov r0, r7');
  x.call(A.setPos);
  x.op('add r6, r6, #1', `b ${each}`);
  x.flush(false);
  x.at(done);
  x.op('mov r0, #1');
  x.call(A.formation);
  x.op('mov r0, #1');
  x.call(A.partyCollision);
  x.op(`add r0, sp, #${hx(F.players)}`, `ldr r1, ${x.lit({ kind: 'imp', name: A.playerDtor, addend: 0 })}`);
  x.load('r2', PLAYER_SIZE);
  x.load('r3', PLAYERS);
  x.call(A.vecDtor);
}

/**
 * The script's events laid into a CRO that has none (content 99's): text = the CRO's + stubs + functions, rodata = the
 * CRO's + type infos + vtables + names; the exports 0 / 3 / 4 / 8 make the event of a row (3: of the map group), 24
 * starts the event of "all monsters beaten", 27 sets the flags to reset back to 0.
 * `resets`: flags to set back besides the script's `reset` variables (the boss flags of the data).
 * `intros`: the opening of each map group that has an intro event (by group; stageScript.ts reads it off the maps).
 */
export function compileStageScript(
  base: Cro,
  script: StageScript,
  resets: LeaveReset[] = [],
  intros: Record<number, IntroSpec> = {},
): StageScriptBuild {
  const g = new Gen();
  const vars = new Map(script.vars.map((v) => [v.name, v]));
  const events = script.events.map((e, k) => ({
    ...e,
    cls: `PnEvent${k}`,
    shape: SHAPE[e.trigger],
    effect: usesVanish(e.body),
    intro: e.trigger === 'intro' ? intros[e.group] : undefined,
  }));
  for (const e of events) {
    const p = eventProblem(e.trigger, e.body);
    if (p) throw new ScriptError(p, e.line);
    if (e.trigger === 'intro' && (!e.intro || !e.intro.map))
      throw new ScriptError(`MapGroup ${e.group} の入場の演出: 最初のマップが分かりません`, e.line);
  }
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
  const TI_BASE: Record<Shape, string> = { npc: A.tiNpcTurn, button: A.tiButton, plain: A.tiEs, intro: A.tiIntro };
  const nameAt: number[] = [];
  for (const e of events) {
    ro[`${e.cls}_ti`] = put({ kind: 'imp', name: A.siVt, addend: 8 });
    nameAt.push(put({ kind: 'value', value: 0 }));
    put({ kind: 'imp', name: e.trigger === 'switch' ? A.tiKeep : TI_BASE[e.shape], addend: 0 });
  }
  // vtable: [offset to top 0][type info] then where the object points: [D1][D0][+8][+C Execute][+10 CtrlFlag][+14] …
  for (const e of events) {
    put({ kind: 'value', value: 0 });
    put({ kind: 'ro', off: ro[`${e.cls}_ti`]! });
    ro[`${e.cls}_vt`] = roOff;
    put({ kind: 'text', label: `${e.cls}_d1` });
    put({ kind: 'text', label: `${e.cls}_d0` });
    put({ kind: 'text', label: 'pn_prepare' });
    // an intro keeps IntroCommon's Execute (the map check) and has the event at +0x18 (D01Intro)
    if (e.shape === 'intro') put({ kind: 'imp', name: A.introExec, addend: 0 });
    else put({ kind: 'text', label: `${e.cls}_exec` });
    // after Execute: the game's (the row's state goes on), the button's, "done" for the event of the beaten monsters
    // (it must not start again), nothing for the map's start (it has no row; S01Intro of content 4 has its own too),
    // "played in this visit" for the intro (D01Intro's CtrlFlag: SetScriptBitFlag(0xB1, 1))
    if (e.shape === 'intro') put({ kind: 'text', label: `${e.cls}_ctrl` });
    else if (e.trigger === 'start') put({ kind: 'text', label: 'pn_prepare' });
    else if (e.trigger === 'defeat') put({ kind: 'text', label: 'pn_done' });
    else put({ kind: 'imp', name: e.shape === 'button' ? A.buttonCtrl : A.ctrl, addend: 0 });
    if (e.trigger === 'switch') put({ kind: 'imp', name: A.keepMenu, addend: 0 });
    else put({ kind: 'text', label: e.shape === 'button' ? 'pn_button_menu' : 'pn_hides_menu' });
    if (e.shape === 'npc') {
      put({ kind: 'imp', name: A.waitAnim, addend: 0 });
      put({ kind: 'imp', name: A.walkAnim, addend: 0 });
    }
    if (e.shape === 'intro') put({ kind: 'text', label: `${e.cls}_exec` });
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
  if (events.some((e) => e.trigger === 'defeat')) {
    const done = new Fn(g, 'pn_done');
    done.op('ldr r0, [r0, #4]', 'mov r1, #1'); // SetScriptState(this->id, 1)
    done.tail(A.setState);
    fns.push(done);
  }
  if (events.some((e) => e.trigger === 'button')) {
    // vt+0x14 of a button (CRO 18 D01WaterGateCommon): GetStepOntoButtonNum() != 0
    const menu = new Fn(g, 'pn_button_menu');
    menu.op('push {r4, lr}');
    menu.call(A.buttonSteps);
    menu.op('cmp r0, #0', 'movne r0, #1', 'pop {r4, pc}');
    fns.push(menu);
  }

  const allResets: LeaveReset[] = [
    ...script.vars.filter((v) => v.reset).map((v) => ({ kind: v.kind, flag: v.flag })),
    ...resets,
    // the intro plays again on the next visit (export 27 of CRO 28 clears D01Intro's bit 0xB1)
    ...events.flatMap((e) => (e.intro ? [{ kind: 'bit' as const, flag: e.intro.flag }] : [])),
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
  const makers = (slot: number, triggers: ScriptTrigger[]): void => {
    // a group's intro comes before its start: the first match is made (CRO 28's export 3: the intro while its bit is
    // clear, then the other events of the map's start)
    const own = events
      .filter((e) => triggers.includes(e.trigger))
      .sort((a, b) => Number(b.shape === 'intro') - Number(a.shape === 'intro'));
    if (!own.length) return;
    const shape = own[0]!.shape === 'intro' ? 'plain' : own[0]!.shape;
    const byGroup = triggers.includes('start');
    const f = new Fn(g, `slot_${slot}`);
    const ret = g.uniq(`slot_${slot}_ret`);
    // (row ID, the character, arguments): r5 / r4 for the classes that take the character, r4 = the ID for the plain
    const id = shape === 'plain' ? 'r4' : 'r5';
    if (shape === 'npc') f.op('push {r4, r5, lr}', 'sub sp, sp, #0x14', 'mov r5, r0', 'mov r4, r1');
    else if (shape === 'button') f.op('push {r4, r5, r6, lr}', 'mov r5, r0', 'mov r4, r1');
    else f.op('push {r4, lr}', 'mov r4, r0');
    f.call(A.group);
    for (const e of own) {
      f.cmp('r0', e.group);
      if (!byGroup) f.cmp(id, e.row, 'eq');
      f.op(`beq ${e.cls}_make`);
    }
    f.op('mov r0, #0');
    f.at(ret);
    if (shape === 'npc') f.op('add sp, sp, #0x14', 'pop {r4, r5, pc}');
    else if (shape === 'button') f.op('pop {r4, r5, r6, pc}');
    else f.op('pop {r4, pc}');
    for (const e of own) {
      f.flush(false);
      f.at(`${e.cls}_make`);
      if (e.intro) {
        // played in this visit: the group's start (if it has one) or nothing
        const after = own.find((x) => x.trigger === 'start' && x.group === e.group);
        f.load('r0', e.intro.flag);
        f.call(A.getBit);
        f.op('tst r0, #0xff', 'movne r0, #0', `bne ${after ? `${after.cls}_make` : ret}`);
        f.load('r0', NEW_SIZE.intro + (e.effect ? 0x4c : 0));
        f.call(A.new);
        f.op('cmp r0, #0', `beq ${ret}`);
        f.load('r1', e.intro.map);
        f.call(A.introCtor);
        f.op(`ldr r1, ${f.lit({ kind: 'ro', off: ro[`${e.cls}_vt`]! })}`, 'str r1, [r0]');
        if (e.effect) {
          f.op('mov r4, r0', `add r0, r0, #${hx(NEW_SIZE.intro)}`);
          f.call(A.effectCtor);
          f.op('mov r0, r4');
        }
        // the gate's door stands open until the party is in (D01Intro's factory: StartAnimation(0x8000006E))
        if (e.intro.gate?.door) f.op('mov r4, r0', `bl ${e.cls}_open`, 'mov r0, r4');
        f.op(`b ${ret}`);
        continue;
      }
      f.load('r0', NEW_SIZE[shape] + (e.effect ? 0x4c : 0));
      f.call(A.new);
      f.op('cmp r0, #0', `beq ${ret}`);
      if (shape === 'npc') {
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
      } else if (shape === 'button') {
        // GimmickPushButtonCommon(obj, row, chr)
        f.load('r1', e.row);
        f.op('mov r2, r4');
        f.call(e.trigger === 'switch' ? A.keepCtor : A.buttonCtor);
        f.op('mov r1, #0', `strb r1, [r0, #${hx(BUTTON_PRESSED)}]`);
      } else {
        if (byGroup) f.load('r1', START_EVENT_ID);
        else f.op('mov r1, r4');
        f.call(A.esCtor);
      }
      if (e.effect) {
        f.op('mov r4, r0', `add r0, r0, #${hx(NEW_SIZE[shape])}`);
        f.call(A.effectCtor);
        f.op('mov r0, r4');
      }
      f.op(`ldr r1, ${f.lit({ kind: 'ro', off: ro[`${e.cls}_vt`]! })}`, 'str r1, [r0]', `b ${ret}`);
    }
    fns.push(f);
  };
  makers(SLOT_AREA, ['area', 'defeat']);
  makers(SLOT_START, ['start', 'intro']);
  makers(SLOT_BUTTON, ['button', 'switch']);
  makers(SLOT_TALK, ['talk']);

  // every frame of the field, (EventScriptCtrl*): the map's monsters are all beaten and the event has not run → start
  // it and return 1 (CRO 28's export 24)
  const defeats = events.filter((e) => e.trigger === 'defeat');
  if (defeats.length) {
    const f = new Fn(g, `slot_${SLOT_DEFEAT}`);
    const none = g.uniq('defeat_none');
    f.op('push {r4, lr}', 'mov r4, r0');
    f.call(A.group);
    for (const e of defeats) {
      f.cmp('r0', e.group);
      f.op(`beq ${e.cls}_beaten`);
    }
    f.at(none);
    f.op('mov r0, #0', 'pop {r4, pc}');
    for (const e of defeats) {
      f.flush(false);
      f.at(`${e.cls}_beaten`);
      f.call(A.monsters);
      f.op('cmp r0, #0', `bne ${none}`);
      f.load('r0', e.row);
      f.call(A.getState);
      f.op('tst r0, #0xff', `bne ${none}`);
      f.op('mov r0, r4');
      f.load('r1', e.row);
      f.call(A.startEvent);
      f.op('mov r0, #1', 'pop {r4, pc}');
    }
    fns.push(f);
  }

  for (const e of events) {
    const x = new Fn(g, `${e.cls}_exec`);
    const exit = g.uniq(`${e.cls}_exit`);
    const camera = usesCamera(e.body);
    const frame = e.intro ? INTRO_FRAME.size : FRAME.size;
    x.op(
      'push {r4, r5, r6, r7, r8, lr}',
      'vpush {d8, d9}',
      `sub sp, sp, #${hx(frame)}`,
      'mov r4, r0',
      'mov r5, #0',
      'mov r8, #0',
    );
    x.op(`vldr s16, ${x.flit(F0)}`, `vldr s17, ${x.flit(F1)}`);
    if (e.trigger === 'talk') {
      x.op('mov r0, r4');
      x.call(A.turnNpc);
      x.op('mov r0, r4');
      x.call(A.turnHero);
    } else if (e.shape === 'button') {
      // as CRO 18's button: pressed = stepped on and not pushed yet; the base's Execute; then the button goes down
      const stepped = g.uniq(`${e.cls}_stepped`);
      x.op(`strb r5, [r4, #${hx(BUTTON_PRESSED)}]`, 'mov r0, r4');
      x.call(A.buttonSteps);
      x.op('cmp r0, #0', `beq ${stepped}`, 'mov r0, r4');
      x.call(A.buttonIsPush);
      x.op('cmp r0, #0', 'moveq r0, #1', `strbeq r0, [r4, #${hx(BUTTON_PRESSED)}]`);
      x.at(stepped);
      x.op('mov r0, r4');
      x.call(e.trigger === 'switch' ? A.keepExec : A.buttonExec);
      x.op(`ldrb r0, [r4, #${hx(BUTTON_PRESSED)}]`, 'cmp r0, #0', `beq ${exit}`, 'mov r0, r4');
      x.call(A.buttonDown);
      x.op('add r0, r4, #0xc');
      x.load('r1', WAIT_ANIM_ARG);
      x.call(A.waitAnimation);
      x.op('mov r0, r4');
      x.call(A.buttonUp);
    } else if (e.trigger === 'start' && !fadesIn(e.body)) {
      // the screen is black when a map's start event runs: FadeInWait(0.3, 2), as S01Intro of content 4
      fmov(x, 's0', 0.3);
      x.load('r0', FADE_DISPLAY);
      x.call(A.fadeIn);
    } else if (e.intro) introBefore(x, g, e.cls, e.intro);
    compileNodes(
      { fn: x, g, trigger: e.trigger, vars, exit, breakTo: null, effectAt: e.effect ? NEW_SIZE[e.shape] : null },
      e.body,
    );
    x.at(exit);
    if (camera) {
      // an event that ends with the camera held gives it back at once
      const free = g.uniq(`${e.cls}_free`);
      x.op('cmp r8, #0', `beq ${free}`, 'vmov.f32 s0, s16', 'mov r0, #0');
      x.call(A.camField);
      x.call(A.camResume);
      x.at(free);
    }
    if (e.intro?.gate) introAfter(x, g, e.cls);
    x.op(`add sp, sp, #${hx(frame)}`, 'vpop {d8, d9}', 'pop {r4, r5, r6, r7, r8, pc}');
    fns.push(x);

    const d1 = new Fn(g, `${e.cls}_d1`),
      d0 = new Fn(g, `${e.cls}_d0`);
    if (e.effect) {
      for (const d of [d1, d0]) {
        d.op('push {r4, lr}', 'mov r4, r0', `add r0, r0, #${hx(NEW_SIZE[e.shape])}`);
        d.call(A.charaDtor);
        d.op('mov r0, r4', 'pop {r4, lr}');
      }
    }
    if (e.intro) {
      // IntroCommon's own: CommonHeroMsg's destructor (it puts its vtable back), then delete (0x1A0648 / 0x1A0658)
      d1.tail(A.heroMsgD1);
      d0.op('push {r4, lr}');
      d0.call(A.heroMsgD1);
      d0.op('pop {r4, lr}');
      d0.tail(A.del);
      // CtrlFlag: played in this visit
      const ctrl = new Fn(g, `${e.cls}_ctrl`);
      ctrl.load('r0', e.intro.flag);
      ctrl.op('mov r1, #1');
      ctrl.tail(A.setBit);
      fns.push(ctrl);
      if (e.intro.gate?.door) {
        // the door stands open: ScriptChara(GetMapChara(door)).StartAnimation(0x8000006E, 0, 1.0, 0.0)
        const open = new Fn(g, `${e.cls}_open`);
        open.op('push {r4, lr}', `sub sp, sp, #${hx(PLAYER_SIZE)}`);
        open.load('r0', e.intro.gate.door);
        open.call(A.mapChara);
        open.op('mov r1, r0', 'mov r0, sp');
        open.call(A.charaCtor);
        open.load('r1', DOOR_OPEN);
        open.op('mov r0, sp', 'mov r2, #0', `vldr s0, ${open.flit(F1)}`, `vldr s1, ${open.flit(F0)}`);
        open.call(A.anim);
        open.op('mov r0, sp');
        open.call(A.charaDtor);
        open.op(`add sp, sp, #${hx(PLAYER_SIZE)}`, 'pop {r4, pc}');
        fns.push(open);
      }
    } else if (e.shape !== 'plain') {
      // vtable = the base's, ~ScriptChara(this + 0xC), (delete): as the shipped classes of NpcCommonTurn and of
      // GimmickPushButtonCommon (CRO 18)
      const ztv = { kind: 'imp' as const, name: e.shape === 'npc' ? A.npcCommonVt : A.buttonVt, addend: 8 };
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
  for (const slot of [SLOT_AREA, SLOT_START, SLOT_BUTTON, SLOT_TALK, SLOT_DEFEAT, SLOT_LEAVE])
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
