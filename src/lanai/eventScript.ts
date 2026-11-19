// An author's events of an RPG FREE! stage, written as a small script and built into the content's CRO (native ARM
// code): the game runs them as it runs the shipped ones, there is no interpreter and no code.bin patch. What the game
// calls and how is written in lanai-custom-stages docs/native-events.md and 3ds/research/script-abi.md; the code shapes
// are those of 3ds/research/event-poc.ts, which ran in Azahar (event-poc.md §6), and of the shipped CROs named below.
//
//   var STATE: byte            // a number flag (0〜255) of the stage; "reset" = set back to 0 when the stage is left
//   var MET: bit reset
//   function greet() {         // one function = one event
//     switch (STATE) {
//       case 0: talk(0x60)
//       case 1: talk(0x61)
//       case 2: talk(0x62); return
//     }
//     if (ask(0x63)) { popup(hero, 11); se(0x7A); talk(0x64); STATE = 2 } else { STATE = 1; talk(0x65) }
//   }
//   on talk(1, 5) greet        // … of the character of EventObject row 5 of MapGroup 1
//   on area(1, 1) { say(0x66); disable() }   // the event written in place: entering the range of row 1
//
// What starts an event (`on`): talk (a character), area (a range), button (a button stepped on), start (the map of a
// group begins), intro (the stage is entered: the game's opening — the party walks in through the start's gate, the
// stage's name, the gate closes — then the body; once a visit), defeat (the map's monsters are all beaten; the event
// is kept by a range's row). The editor keeps the
// variables, the functions and what they are given to apart (ScriptDoc) and writes this text from them.
//
// The rows named by `on` must have the action type 0x8000002D (a script) in the data. Lines are row IDs of the group's
// talk table without the high bit (not row numbers). battle() ends the event: the game goes on at the map's start, not
// after the statement (script-abi.md §7).
import { assembleLine, encodeImm } from '../game/asm';
import { RELOC, croRegistrationHash, type Cro, type CroPatch, type CroReloc, type SegTag } from './cro';
import { SCRIPT_API_ROWS, type ScriptApiRow } from './scriptApiTable';

// ------------------------------------------------------------------------------------------------ the script
/** A character an action is done to: the party's first, the event's own (talk / button), or the one of a row. */
export type ScriptWho = { kind: 'hero' } | { kind: 'self' } | { kind: 'chara'; row: number };
export type ScriptValue =
  | { kind: 'var'; name: string }
  | { kind: 'ask'; msg: number }
  | { kind: 'item'; item: number }
  | { kind: 'state'; row: number }
  | { kind: 'monsters' }
  | { kind: 'call'; call: ScriptCall };
/** An argument of a Script API call, as the function's parameter takes it (scriptApiTable.ts). */
export type ScriptArg =
  | { k: 'i'; v: number }
  | { k: 'f'; v: number }
  | { k: 'v'; x: number; y: number; z: number }
  /** const ScriptMessageParam&: {0, 0}, not written in the script. */
  | { k: 'm' }
  /** A character: as its script object (c) or as its ChrObject* (p). */
  | { k: 'c'; who: ScriptWho }
  | { k: 'p'; who: ScriptWho };
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
  /** dialog: the window the line opens in (StartMessage's AppDialogType, TalkDialog). */
  | { op: 'talk'; msg: number; auto: boolean; dialog: TalkDialog }
  | { op: 'if'; cond: ScriptCond; then: ScriptNode[]; else: ScriptNode[] }
  | { op: 'switch'; value: ScriptValue; cases: { value: number; body: ScriptNode[] }[]; default: ScriptNode[] | null }
  | { op: 'set'; name: string; value: number }
  | { op: 'popup'; who: ScriptWho; icon: number }
  | { op: 'popupEnd'; who: ScriptWho }
  /** The eyes of the party's first; null = as they were. */
  | { op: 'emotion'; value: number | null }
  | { op: 'anim'; who: ScriptWho; id: number; type: number }
  | { op: 'waitAnim'; who: ScriptWho }
  | { op: 'move'; who: ScriptWho; x: number; y: number; z: number }
  | { op: 'turn'; who: ScriptWho; degrees: number }
  | { op: 'face'; who: ScriptWho; to: ScriptWho }
  | { op: 'show'; who: ScriptWho; on: boolean }
  /** The camera to a character, or (null) back to the party. */
  | { op: 'camera'; who: ScriptWho | null; seconds: number }
  | { op: 'fade'; out: boolean; seconds: number }
  | { op: 'follow'; on: boolean }
  | { op: 'se'; id: number }
  | { op: 'addItem'; item: number; count: number; show: boolean }
  | { op: 'addGold'; amount: number }
  /** A door opened or closed; `show`: opened as the game shows it (expandDoors). */
  | { op: 'door'; row: number; open: boolean; show?: boolean }
  /** chara(row).open(): the door's opening motion, its end, then the door open (no camera, sound or jingle). */
  | { op: 'doorMotion'; row: number }
  /** The gimmick's jingle over the paused BGM (jingleNodes). */
  | { op: 'jingle'; id: number }
  /** The BGM paused (fading out) or played again. */
  | { op: 'bgm'; pause: boolean; seconds: number }
  | { op: 'wait'; seconds: number }
  | { op: 'collision'; row: number | null; on: boolean }
  | { op: 'remove'; row: number }
  /** A defeated map monster fades out with the shipped boss effect, then its event object is deleted. */
  | { op: 'vanishMonster'; row: number }
  | { op: 'battle'; group: number }
  | { op: 'stageName' }
  | { op: 'call'; call: ScriptCall }
  | { op: 'break' }
  | { op: 'return' };

/**
 * The window a line opens in: StartMessage's AppDialogType (code.bin 0x2E0920). 0 lets the line's row choose by its
 * speaker kind (talk table +0x08, read through the message source's vt+0x10, 0x45FB58): 0 opens the system's window
 * (that of signs), any other the talk balloon (0x2DF254). A type other than 0 opens the window it names instead
 * (OpenMessage(AppDialogType), 0x2DF2FC): 2 the system's window, any other the balloon. The ROM's CROs pass 0 (and
 * call OpenMessage(1) 4 times); 1 and 2 through StartMessage were read from the code, not yet seen in the game.
 */
export type TalkDialog = 0 | 1 | 2;
export const TALK_DIALOG = { row: 0, bubble: 1, window: 2 } as const satisfies Record<string, TalkDialog>;
export const TALK_DIALOG_LABEL: Record<TalkDialog, string> = {
  0: '台詞の行の話者で決まる (話者なし = システムのウィンドウ、ほか = 会話の吹き出し)',
  1: '会話の吹き出し (NPC の台詞と同じ)',
  2: 'システムのウィンドウ (看板と同じ)',
};

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
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\n)|([ \t\r]+)|(-?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?))|([A-Za-z_]\w*)|(&&|\|\||==|!=|<=|>=|[(){},:;=<>!.])|(.)/gu;
  for (const m of src.matchAll(re)) {
    const pos = m.index;
    if (m[1]) line += m[1].split('\n').length - 1;
    else if (m[2]) line++;
    else if (m[4])
      out.push({ t: 'num', s: m[4], n: Number(m[4].startsWith('-') ? -Number(m[4].slice(1)) : m[4]), line, pos });
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
  'chara',
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
      ? `self (イベントの持ち主) は「${SCRIPT_TRIGGER_LABEL.talk}」・ボタンのイベントでだけ使えます。chara(イベント番号) で指してください`
      : null;
  const called = (c: ScriptCall): string | null =>
    c.args.reduce<string | null>((p, a) => p ?? (a.k === 'c' || a.k === 'p' ? who(a.who) : null), who(c.self));
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
      case 'collision':
        if (n.row === null && trigger !== 'area' && trigger !== 'defeat')
          p = `disable() は範囲のイベントの中でだけ使えます (自分の範囲を無効にする)。collision(イベント番号, 0) で指してください`;
        break;
      case 'face':
        p = who(n.who) ?? who(n.to);
        break;
      case 'popup':
      case 'popupEnd':
      case 'anim':
      case 'waitAnim':
      case 'move':
      case 'turn':
      case 'show':
      case 'camera':
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

/**
 * The built-in methods of a character (`hero.anim(…)`, `chara(3).open()`): each the statement of the same name with the
 * character first. Script API functions after the dot begin with a capital letter, so the two do not meet.
 */
export const SCRIPT_METHODS = [
  'anim',
  'waitAnim',
  'move',
  'turn',
  'face',
  'show',
  'hide',
  'camera',
  'popup',
  'popupEnd',
  'open',
  'close',
  'remove',
  'vanishMonster',
] as const;
export type ScriptMethod = (typeof SCRIPT_METHODS)[number];
export const isScriptMethod = (s: string): s is ScriptMethod => (SCRIPT_METHODS as readonly string[]).includes(s);
/** The methods that take the event of chara(row) (a door, an object or a monster): not hero or self. */
export const SCRIPT_ROW_METHODS: readonly ScriptMethod[] = ['open', 'close', 'remove', 'vanishMonster'];

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
  const num = (what: string, min: number, max: number): number => {
    const t = next();
    if (t.t !== 'num' || !Number.isFinite(t.n)) fail(`${what}は数で書きます`, t);
    if (t.n < min || t.n > max) fail(`${what}は ${min}〜${max} です`, t);
    return t.n;
  };
  const vars = new Map<string, ScriptVar>();
  const functions = new Map<string, ScriptFunction>();
  const events: ScriptEvent[] = [];
  const pending: { event: ScriptEvent; name: string; at: Token }[] = [];
  const used = { byte: 0, bit: 0 };

  const u32 = (what: string): number => int(what, 0, 0xffffffff);
  const row = (what = 'イベント番号'): number => u32(what);
  const seconds = (what: string, positive = false): number => {
    const t = peek();
    const v = num(`${what}の秒数`, 0, 600);
    if (positive && !(v > 0)) fail(`${what}の秒数は 0 より大きく 600 までです`, t);
    return v;
  };
  const who = (): ScriptWho => {
    const t = next();
    if (t.t === 'id' && (t.s === 'hero' || t.s === 'self')) return { kind: t.s };
    if (t.t === 'id' && t.s === 'chara') {
      need('(');
      const r = row('キャラのイベント番号');
      need(')');
      return { kind: 'chara', row: r };
    }
    return fail('だれに: hero (先頭の電波人間) / self (イベントの持ち主) / chara(イベント番号) が要ります', t);
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

  const WHO_WORDS = ['hero', 'self', 'chara'];
  /** A built-in method after `who.` (SCRIPT_METHODS): the statement of that name with the character first. */
  const method = (w: ScriptWho, m: Token, name: ScriptMethod): ScriptNode => {
    const rowOf = (): number =>
      w.kind === 'chara' ? w.row : fail(`.${name}() は chara(イベント番号) にだけ書けます`, m);
    switch (name) {
      case 'anim': {
        need('(');
        const id = u32('アニメの番号');
        const type = eat(',') ? int('アニメの種類', 0, 2) : 0;
        if (!eat(')')) fail('.anim の引数は (アニメ[, 種類]) です');
        return { op: 'anim', who: w, id, type };
      }
      case 'waitAnim':
        call(name);
        return { op: 'waitAnim', who: w };
      case 'move': {
        const pos = (): number => num('位置', -1e6, 1e6);
        const [x, y, z] = call(name, pos, pos, pos);
        return { op: 'move', who: w, x, y, z };
      }
      case 'turn':
        return { op: 'turn', who: w, degrees: call(name, () => num('向き (度)', -3600, 3600))[0] };
      case 'face':
        return { op: 'face', who: w, to: call(name, who)[0] };
      case 'show':
      case 'hide':
        call(name);
        return { op: 'show', who: w, on: name === 'show' };
      case 'camera':
        return { op: 'camera', who: w, seconds: call(name, () => seconds('カメラ'))[0] };
      case 'popup':
        return { op: 'popup', who: w, icon: call(name, () => int('アイコン', 0, 255))[0] };
      case 'popupEnd':
        call(name);
        return { op: 'popupEnd', who: w };
      case 'open':
      case 'close':
      case 'remove':
      case 'vanishMonster': {
        const r = rowOf();
        call(name);
        if (name === 'open') return { op: 'doorMotion', row: r };
        if (name === 'close') return { op: 'door', row: r, open: false };
        return { op: name, row: r };
      }
    }
  };
  /** A built-in method statement beginning at the token just read, or null (the tokens left as they were). */
  const methodAt = (t: Token): ScriptNode | null => {
    if (t.t !== 'id' || !WHO_WORDS.includes(t.s)) return null;
    const at = i;
    i--;
    const w = who();
    const m = ts[i + 1];
    if (is('.') && m?.t === 'id' && isScriptMethod(m.s)) {
      i += 2;
      return method(w, m, m.s);
    }
    i = at;
    return null;
  };
  /**
   * A Script API function called by name, the token before the dot read: `Class.Name(args)` or `who.Name(args)`.
   * The arguments are numbers, vec(x, y, z) and characters; the function is the one of that name they fit.
   */
  const apiCall = (cls: string | null, self: ScriptWho | null, at: Token): ScriptCall => {
    need('.');
    const fn = next();
    if (fn.t !== 'id') fail('関数の名前が要ります', fn);
    if (self && isScriptMethod(fn.s)) fail(`.${fn.s}(…) は値を返しません。文として書きます`, fn);
    const classes = cls ? [cls] : self!.kind === 'hero' ? ['ScriptPlayer', 'ScriptChara'] : ['ScriptChara'];
    const rows = classes.flatMap((c) => API_INDEX.get(`${c}.${fn.s}`) ?? []);
    const shown = `${cls ?? classes[classes.length - 1]}::${fn.s}`;
    if (!rows.length) fail(`${shown} という Script API はありません (またはスクリプトから呼べない引数を持ちます)`, fn);
    type Raw =
      | { kind: 'num'; v: number; whole: boolean }
      | { kind: 'vec'; x: number; y: number; z: number }
      | { kind: 'who'; who: ScriptWho };
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
      } else if (t.t === 'id' && WHO_WORDS.includes(t.s)) raw.push({ kind: 'who', who: who() });
      else if (t.t === 'id' && (t.s === 'true' || t.s === 'false'))
        raw.push({ kind: 'num', v: Number(next().s === 'true'), whole: true });
      else if (t.t === 'num') raw.push({ kind: 'num', v: next().n, whole: !t.s.includes('.') });
      else fail(`${shown} の引数は、数・vec(x, y, z)・キャラ (hero / self / chara(イベント番号)) で書きます`, t);
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
    const chosen = fits.filter((x) => x.score === best);
    if (chosen.length > 1) fail(`${shown} のどれを呼ぶのか決まりません: ${forms}`, at);
    const r = chosen[0]!.r;
    let k = 0;
    const args: ScriptArg[] = [...r[3]].map((want): ScriptArg => {
      if (want === 'm') return { k: 'm' };
      const a = raw[k++]!;
      if (a.kind === 'vec') return { k: 'v', x: a.x, y: a.y, z: a.z };
      if (a.kind === 'who') return { k: want as 'c' | 'p', who: a.who };
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
  /** A call that begins at the token just read (a class's name or a character), or null. */
  const apiCallAt = (t: Token): ScriptCall | null => {
    if (t.t !== 'id') return null;
    if (API_CLASSES.has(t.s) && is('.')) return apiCall(t.s, null, t);
    if (WHO_WORDS.includes(t.s)) {
      i--;
      const w = who();
      if (is('.')) return apiCall(null, w, t);
      return fail('キャラの後には .関数(…) が要ります (例: hero.SetVisible(0))', t);
    }
    return null;
  };

  const value = (): ScriptValue => {
    const t = next();
    if (t.t !== 'id') fail('変数か ask(…) / item(…) / state(…) / monsters() が要ります', t);
    const api = apiCallAt(t);
    if (api) {
      // read from the game's code (script-returns.md); an unsettled void ("void?") is left to the author
      if (api.result === 'void') fail(`${api.name} は値を返しません (戻り値は void)。比べずに、文として呼びます`, t);
      if (api.result.startsWith('float'))
        fail(`${api.name} は小数 (float) を返します。スクリプトの条件では整数しか比べられません`, t);
      return { kind: 'call', call: api };
    }
    if (is('(')) {
      if (t.s === 'ask') return { kind: 'ask', msg: call('ask', () => u32('台詞の行 ID'))[0] };
      if (t.s === 'item') return { kind: 'item', item: call('item', () => u32('アイテム ID'))[0] };
      if (t.s === 'state') return { kind: 'state', row: call('state', () => row())[0] };
      if (t.s === 'monsters') {
        call('monsters');
        return { kind: 'monsters' };
      }
      fail(`「${t.s}」は値として使えません (ask / item / state / monsters)`, t);
    }
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
      const s = stmt(ctx);
      if (s) out.push(s);
    }
    const close = next();
    return { body: out, from: open.pos + 1, to: close.pos };
  };
  const stmt = (ctx: Ctx): ScriptNode | null => {
    if (eat(';')) return null;
    const t = next();
    if (t.t !== 'id') fail(`文が要ります (「${t.s}」がありました)`, t);
    const own = methodAt(t);
    if (own) return own;
    const api = apiCallAt(t);
    if (api) return { op: 'call', call: api };
    switch (t.s) {
      case 'if': {
        need('(');
        const c = cond();
        need(')');
        const then = block(ctx).body;
        let other: ScriptNode[] = [];
        if (eat('else')) other = is('if') ? [stmt(ctx)!] : block(ctx).body;
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
            else if (is('{')) body.push(...block({ ...ctx, inSwitch: true }).body);
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
      case 'say': {
        // talk(line[, bubble | window | 0〜2])
        need('(');
        const msg = u32('台詞の行 ID');
        let dialog: TalkDialog = TALK_DIALOG.row;
        if (eat(',')) {
          const d = peek();
          if (d.t === 'id' && (d.s === 'bubble' || d.s === 'window')) {
            next();
            dialog = TALK_DIALOG[d.s];
          } else if (d.t === 'num') dialog = int('吹き出しの種類', 0, 2) as TalkDialog;
          else fail(`${t.s} の 2 つ目は吹き出しの種類です: bubble (会話の吹き出し) / window (システムのウィンドウ)`, d);
        }
        if (!eat(')')) fail(`${t.s} の引数は (台詞の行 ID[, bubble / window]) です`);
        return { op: 'talk', msg, auto: t.s === 'say', dialog };
      }
      case 'popup': {
        // popup(icon) is popup(hero, icon)
        need('(');
        const w: ScriptWho = peek().t === 'num' ? { kind: 'hero' } : who();
        if (peek().t !== 'num') need(',');
        const icon = int('アイコン', 0, 255);
        if (!eat(')')) fail('popup の引数は (だれに, アイコン) です');
        return { op: 'popup', who: w, icon };
      }
      case 'popupEnd':
        return { op: 'popupEnd', who: call(t.s, who)[0] };
      case 'emotion':
        return { op: 'emotion', value: call(t.s, () => int('表情', 0, 255))[0] };
      case 'emotionEnd':
        call(t.s);
        return { op: 'emotion', value: null };
      case 'anim': {
        need('(');
        const w = who();
        need(',');
        const id = u32('アニメの番号');
        const type = eat(',') ? int('アニメの種類', 0, 2) : 0;
        if (!eat(')')) fail('anim の引数は (だれに, アニメ[, 種類]) です');
        return { op: 'anim', who: w, id, type };
      }
      case 'waitAnim':
        return { op: 'waitAnim', who: call(t.s, who)[0] };
      case 'move': {
        const pos = (): number => num('位置', -1e6, 1e6);
        const [w, x, y, z] = call(t.s, who, pos, pos, pos);
        return { op: 'move', who: w, x, y, z };
      }
      case 'turn': {
        const [w, degrees] = call(t.s, who, () => num('向き (度)', -3600, 3600));
        return { op: 'turn', who: w, degrees };
      }
      case 'face': {
        const [w, to] = call(t.s, who, who);
        return { op: 'face', who: w, to };
      }
      case 'show':
      case 'hide':
        return { op: 'show', who: call(t.s, who)[0], on: t.s === 'show' };
      case 'camera': {
        const [w, s] = call(t.s, who, () => seconds('カメラ'));
        return { op: 'camera', who: w, seconds: s };
      }
      case 'cameraBack':
        return { op: 'camera', who: null, seconds: call(t.s, () => seconds('カメラ'))[0] };
      case 'fadeOut':
      case 'fadeIn':
        return { op: 'fade', out: t.s === 'fadeOut', seconds: call(t.s, () => seconds('フェード'))[0] };
      case 'follow':
        return { op: 'follow', on: !!call(t.s, () => int('ついてくる (0 / 1)', 0, 1))[0] };
      case 'se':
        return { op: 'se', id: call(t.s, () => int('音 (SoundData の行)', 0, 0xffff))[0] };
      case 'addItem':
      case 'getItem': {
        const [item, count] = call(
          t.s,
          () => u32('アイテム ID'),
          () => int('個数', -9999, 9999),
        );
        return { op: 'addItem', item, count, show: t.s === 'getItem' };
      }
      case 'addGold':
        return { op: 'addGold', amount: call(t.s, () => int('お金', -99999999, 99999999))[0] };
      case 'openDoor':
      case 'openDoorNow':
      case 'closeDoor':
        return {
          op: 'door',
          row: call(t.s, () => row('扉のイベント番号'))[0],
          open: t.s !== 'closeDoor',
          ...(t.s === 'openDoor' ? { show: true } : {}),
        };
      case 'jingle': {
        need('(');
        const id = is(')') ? DOOR_SHOW.jingle : int('音 (SoundData の行)', 0, 0xffff);
        if (!eat(')')) fail('jingle の引数は ([音]) です');
        return { op: 'jingle', id };
      }
      case 'bgmPause':
      case 'bgmResume':
        return { op: 'bgm', pause: t.s === 'bgmPause', seconds: call(t.s, () => seconds('BGM'))[0] };
      case 'wait':
        return { op: 'wait', seconds: call(t.s, () => seconds('wait ', true))[0] };
      case 'disable':
        call(t.s);
        return { op: 'collision', row: null, on: false };
      case 'collision': {
        const [r, on] = call(
          t.s,
          () => row('範囲のイベント番号'),
          () => int('有効 (0 / 1)', 0, 1),
        );
        return { op: 'collision', row: r, on: !!on };
      }
      case 'remove':
        return { op: 'remove', row: call(t.s, () => row())[0] };
      case 'vanishMonster':
        return { op: 'vanishMonster', row: call(t.s, () => row('モンスターのイベント番号'))[0] };
      case 'battle':
        return { op: 'battle', group: call(t.s, () => u32('モンスターの群れ (MonsterGroup の行)'))[0] };
      case 'stageName':
        call(t.s);
        return { op: 'stageName' };
    }
    if (eat('=')) {
      const v = vars.get(t.s);
      if (!v) return fail(`変数「${t.s}」はありません`, t);
      return { op: 'set', name: t.s, value: int('入れる値', 0, v.kind === 'bit' ? 1 : 255) };
    }
    return fail(`「${t.s}」という文はありません`, t);
  };

  const name = (what: string): Token => {
    const t = next();
    if (t.t !== 'id') fail(`${what}の名前が要ります`, t);
    if (SCRIPT_RESERVED.includes(t.s)) fail(`「${t.s}」は${what}の名前にできません`, t);
    return t;
  };
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
      need('(');
      need(')');
      functions.set(n.s, { name: n.s, line: t.line, ...block({ inSwitch: false }) });
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
  /** `body`: the statements, without the braces. */
  functions: { name: string; body: string }[];
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
    out.push(`function ${f.name}() {`);
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
  // each function alone first: a brace left open must not be told as a mistake of the function after it
  for (const f of doc.functions) {
    const alone = scriptDocSource({ vars: doc.vars, functions: [f], bindings: [] });
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
    functions: s.functions.map((f) => ({ name: f.name, body: dedent(src.slice(f.from, f.to)) })),
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
/** The animations of a character that talks: its mouth moves while the line is shown (script-abi.md §1). */
const ANIM_TALK = 0x80000079,
  ANIM_WAIT = 0x80000075;
/** The party's: standing and walking (ScriptPlayer::StartAnimation, script-abi.md §3 B). */
const PLAYER_WAIT = 0x80000001,
  PLAYER_WALK = 0x80000003;
/** ScriptChara::WaitAnimation's argument in every shipped call. */
const WAIT_ANIM_ARG = 0x3e;
/** GSDisplay of the fades (both screens in the shipped calls) and GSAnimMode of the camera's moves. */
const FADE_DISPLAY = 2,
  CAMERA_MODE = 2;
/** How long a turn takes (RotateTo's most used time is 0.5; this is the second). */
const TURN_SECONDS = 0.25;
const F0 = 0x00000000,
  F1 = 0x3f800000,
  F02 = 0x3e4ccccd; // 0.0f, 1.0f, 0.2f
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
 * r4 = this, r5 = 0, r6 = 0x80000079, r7 = 0x80000075, r8 = the camera is held; s16 = 0.0, s17 = 1.0, s18 = 0.2.
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

function zeroSmps(fn: Fn): void {
  fn.op(
    `str r5, [sp, #${hx(FRAME.smpA)}]`,
    `str r5, [sp, #${hx(FRAME.smpA + 4)}]`,
    `str r5, [sp, #${hx(FRAME.smpB)}]`,
    `str r5, [sp, #${hx(FRAME.smpB + 4)}]`,
  );
}
const smpArgs = (fn: Fn): void => fn.op(`add r1, sp, #${hx(FRAME.smpA)}`, `add r2, sp, #${hx(FRAME.smpB)}`);

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
    case 'state':
      fn.load('r0', v.row);
      fn.call(A.getState);
      fn.op('and r0, r0, #0xff');
      break;
    case 'item':
      fn.load('r0', scriptRowId(v.item));
      fn.op('mov r1, #1');
      fn.call(A.getItem);
      break;
    case 'ask':
      zeroSmps(fn);
      fn.load('r0', scriptRowId(v.msg));
      smpArgs(fn);
      fn.call(A.yesNo);
      fn.op('cmp r0, #0', 'movne r0, #1');
      break;
    case 'monsters':
      fn.call(A.monsters);
      break;
    case 'call':
      compileCall(c, v.call);
      if (v.call.byte) fn.op('and r0, r0, #0xff');
      break;
  }
}

/**
 * A Script API function called with its arguments laid as AAPCS-VFP has them: `this` and the integers and pointers
 * in r0-r3 then on the stack, the floats in s0 on; r0 = what it returns.
 */
function compileCall(c: Ctx, call: ScriptCall): void {
  const { fn } = c;
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
    if (call.self) withChara(c, call.self, FRAME.obj, call.player, (ref) => emit(ref, chara));
    else emit(null, chara);
  };
  if (other && other.k === 'c') withChara(c, other.who, FRAME.obj2, false, (ref) => withSelf(ref));
  else withSelf(null);
}

/**
 * A door opened as the game shows it, by the event that opens the door after the boss of content 1 (CRO 117
 * D01BossWin, code 0xF34〜0x1048, then SetDoorOpenFlag in its CtrlFlag): the camera to the door, 0.5 s, the unlocking
 * sound 0x79, 1.5 s, the opening sound 0x7A with the door's motion 0x80000073, its end; then, after the last door of a
 * run, the BGM paused (0.3 s) for the gimmick's jingle 0x41, 1 s, the BGM again, 0.3 s, and the camera back.
 */
export const DOOR_SHOW = {
  camera: 1,
  beforeUnlock: 0.5,
  unlock: 0x79,
  beforeOpen: 1.5,
  open: 0x7a,
  motion: 0x73,
  bgmFade: 0.3,
  jingle: 0x41,
  jingleWait: 1,
  after: 0.3,
} as const;
const isShownDoor = (n: ScriptNode): boolean => n.op === 'door' && n.open && !!n.show;

/** chara(row).open(): the door's opening motion, its end, then the door open (DOOR_SHOW, without camera or sound). */
export const doorMotionNodes = (row: number): ScriptNode[] => {
  const door: ScriptWho = { kind: 'chara', row };
  return [
    { op: 'anim', who: door, id: DOOR_SHOW.motion, type: 0 },
    { op: 'waitAnim', who: door },
    { op: 'door', row, open: true },
  ];
};
/** jingle(id): the BGM paused, the jingle, 1 s, the BGM again (DOOR_SHOW). */
export const jingleNodes = (id: number = DOOR_SHOW.jingle): ScriptNode[] => [
  { op: 'bgm', pause: true, seconds: DOOR_SHOW.bgmFade },
  { op: 'se', id },
  { op: 'wait', seconds: DOOR_SHOW.jingleWait },
  { op: 'bgm', pause: false, seconds: DOOR_SHOW.bgmFade },
];

/**
 * The nodes with each run of openDoor() written out as the game shows doors opening (DOOR_SHOW), and the parts a
 * script writes itself (chara(row).open(), jingle()) written out as theirs. openDoor(row) is the same as
 * `chara(row).camera(1); wait(0.5); se(0x79); wait(1.5); se(0x7A); chara(row).open(); jingle(); wait(0.3);
 * cameraBack(1)`, the jingle and the camera's return only after the last of doors opened one after another.
 */
export function expandDoors(nodes: ScriptNode[]): ScriptNode[] {
  const out: ScriptNode[] = [];
  nodes.forEach((n, i) => {
    if (n.op === 'doorMotion') return void out.push(...doorMotionNodes(n.row));
    if (n.op === 'jingle') return void out.push(...jingleNodes(n.id));
    if (n.op !== 'door' || !isShownDoor(n)) return void out.push(n);
    const d = DOOR_SHOW;
    out.push(
      { op: 'camera', who: { kind: 'chara', row: n.row }, seconds: d.camera },
      { op: 'wait', seconds: d.beforeUnlock },
      { op: 'se', id: d.unlock },
      { op: 'wait', seconds: d.beforeOpen },
      { op: 'se', id: d.open },
      ...doorMotionNodes(n.row),
    );
    const next = nodes[i + 1];
    if (next && isShownDoor(next)) return;
    out.push(...jingleNodes(), { op: 'wait', seconds: d.after }, { op: 'camera', who: null, seconds: d.camera });
  });
  return out;
}

const usesCamera = (nodes: ScriptNode[]): boolean =>
  nodes.some(
    (n) =>
      n.op === 'camera' ||
      isShownDoor(n) ||
      (n.op === 'if' && (usesCamera(n.then) || usesCamera(n.else))) ||
      (n.op === 'switch' && (n.cases.some((k) => usesCamera(k.body)) || usesCamera(n.default ?? []))),
  );
const usesVanish = (nodes: ScriptNode[]): boolean =>
  nodes.some(
    (n) =>
      n.op === 'vanishMonster' ||
      (n.op === 'if' && (usesVanish(n.then) || usesVanish(n.else))) ||
      (n.op === 'switch' && (n.cases.some((k) => usesVanish(k.body)) || usesVanish(n.default ?? []))),
  );
const fadesIn = (nodes: ScriptNode[]): boolean =>
  nodes.some(
    (n) =>
      (n.op === 'fade' && !n.out) ||
      (n.op === 'if' && (fadesIn(n.then) || fadesIn(n.else))) ||
      (n.op === 'switch' && (n.cases.some((k) => fadesIn(k.body)) || fadesIn(n.default ?? []))),
  );

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

function compileNodes(c: Ctx, written: ScriptNode[]): void {
  const { fn, g } = c;
  const nodes = expandDoors(written);
  const mouth = (reg: string): void => {
    fn.op('add r0, r4, #0xc', `mov r1, ${reg}`, 'mov r2, #0', 'vmov.f32 s0, s17', 'vmov.f32 s1, s16');
    fn.call(A.anim);
  };
  /** StartAnimation(id, type, 1.0, 0.0) of the object `ref` writes to r0. */
  const startAnim = (ref: () => void, id: number, type: number, player: boolean): void => {
    ref();
    fn.load('r1', id);
    fn.op(`mov r2, #${type}`, 'vmov.f32 s0, s17', 'vmov.f32 s1, s16');
    fn.call(player ? A.playerAnim : A.anim);
  };
  const waitSeconds = (seconds: number): void => {
    fmov(fn, 's0', seconds, 'r0');
    fn.call(A.waitTime);
  };
  for (const n of nodes) {
    fn.flushIfFar();
    switch (n.op) {
      case 'talk': {
        const moves = c.trigger === 'talk' && !n.auto;
        if (moves) mouth('r6');
        zeroSmps(fn);
        fn.op('str r5, [sp]'); // the 5th argument: bool = 0
        fn.load('r0', scriptRowId(n.msg));
        smpArgs(fn);
        fn.op(`mov r3, #${n.dialog}`, 'vmov.f32 s0, s18');
        fn.call(moves ? A.msg : A.msgAuto);
        if (moves) mouth('r7');
        break;
      }
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
      case 'popup':
        // ScriptChara c(chr); c.SetPopup(2, icon, 1, 1, 0, GSVEC_ZERO); c.+0xB = 0xFF; ~c
        // SetPopup keeps the kind it showed at +0xB (0xFF from the ctor, 0x2E2750) and ~ScriptChara takes the icon
        // down when it is not 0xFF (0x2FFD74 → 0x2D51B0): the ROM's CROs keep their ScriptChara for the whole event
        // (an NPC's at this+0xC), ours lives for the statement, so the icon would go as it came. The hero's survived
        // only by the dtor's own test for the party (0x2FFD8C). popupEnd() (FinishPopupIcon) does not read +0xB.
        withChara(c, n.who, FRAME.obj, false, (ref) => {
          fn.op(
            'mov r0, #1',
            'str r0, [sp]',
            'str r5, [sp, #4]',
            `ldr r0, ${fn.lit({ kind: 'imp', name: A.gsvecZero, addend: 0 })}`,
            'str r0, [sp, #8]',
          );
          ref();
          fn.op('mov r1, #2');
          fn.load('r2', n.icon);
          fn.op('mov r3, #1');
          fn.call(A.popup);
          if (n.who.kind !== 'self') fn.op('mov r0, #0xff', `strb r0, [sp, #${hx(FRAME.obj + POPUP_KIND)}]`);
        });
        break;
      case 'popupEnd':
        withChara(c, n.who, FRAME.obj, false, (ref) => {
          ref();
          fn.call(A.popupEnd);
        });
        break;
      case 'emotion':
        withChara(c, { kind: 'hero' }, FRAME.obj, true, (ref) => {
          ref();
          if (n.value === null) fn.call(A.restoreEmotion);
          else {
            fn.load('r1', n.value);
            fn.op('vmov.f32 s0, s16');
            fn.call(A.setEmotion);
          }
        });
        break;
      case 'anim': {
        const player = n.who.kind === 'hero';
        withChara(c, n.who, FRAME.obj, player, (ref) => startAnim(ref, scriptRowId(n.id), n.type, player));
        break;
      }
      case 'waitAnim':
        withChara(c, n.who, FRAME.obj, false, (ref) => {
          ref();
          fn.load('r1', WAIT_ANIM_ARG);
          fn.call(A.waitAnimation);
        });
        break;
      case 'move': {
        // MoveTo(pos, 0, 0, 0, 0, 0) then WaitNodeAnimation; the party's first walks (script-abi.md §3 B)
        const player = n.who.kind === 'hero';
        [n.x, n.y, n.z].forEach((v, k) => {
          fn.load('r0', fbits(v));
          fn.op(`str r0, [sp, #${hx(FRAME.vec + 4 * k)}]`);
        });
        fn.op(`str r5, [sp, #${hx(FRAME.vec + 12)}]`);
        withChara(c, n.who, FRAME.obj, player, (ref) => {
          if (player) startAnim(ref, PLAYER_WALK, 0, true);
          fn.op('str r5, [sp]');
          ref();
          fn.op(`add r1, sp, #${hx(FRAME.vec)}`, 'mov r2, #0', 'mov r3, #0', 'vmov.f32 s0, s16', 'vmov.f32 s1, s16');
          fn.call(A.moveTo);
          ref();
          fn.call(A.waitNode);
          if (player) startAnim(ref, PLAYER_WAIT, 0, true);
        });
        break;
      }
      case 'turn':
        // RotateTo(angle, seconds, 0, 0, 0, 1), then the time it takes
        withChara(c, n.who, FRAME.obj, false, (ref) => {
          fn.op('mov r0, #1', 'str r0, [sp]');
          fmov(fn, 's0', (n.degrees * Math.PI) / 180);
          fmov(fn, 's1', TURN_SECONDS);
          ref();
          fn.op('mov r1, #0', 'mov r2, #0', 'mov r3, #0');
          fn.call(A.rotateTo);
        });
        waitSeconds(TURN_SECONDS);
        break;
      case 'face':
        // who.RotateCharaTo(to, seconds, 0, 0, 0)
        withChara(c, n.to, FRAME.obj2, false, (to) =>
          withChara(c, n.who, FRAME.obj, false, (ref) => {
            fn.op('str r5, [sp]');
            fmov(fn, 's0', TURN_SECONDS);
            to();
            fn.op('mov r1, r0');
            ref();
            fn.op('mov r2, #0', 'mov r3, #0');
            fn.call(A.rotateCharaTo);
          }),
        );
        waitSeconds(TURN_SECONDS);
        break;
      case 'show':
        withChara(c, n.who, FRAME.obj, false, (ref) => {
          ref();
          fn.op(`mov r1, #${n.on ? 1 : 0}`);
          fn.call(A.setVisible);
        });
        break;
      case 'camera': {
        const skip = g.uniq(`${fn.name}_cam`);
        if (n.who) {
          // PauseCameraUpdater (once); MoveEyeAndTarget(chr, seconds, ZERO, ZERO, 2); WaitAnimation (CRO 18's button)
          fn.op('cmp r8, #0', `bne ${skip}`);
          fn.call(A.camPause);
          fn.op('mov r8, #1');
          fn.at(skip);
          chrOf(c, n.who);
          fmov(fn, 's0', n.seconds);
          fn.op(`ldr r1, ${fn.lit({ kind: 'imp', name: A.gsvecZero, addend: 0 })}`, 'mov r2, r1');
          fn.load('r3', CAMERA_MODE);
          fn.call(A.camTo);
          fn.call(A.camWait);
        } else {
          // MoveFieldCamera(seconds, 2); WaitAnimation; ResumeCameraUpdater — nothing when the camera is not held
          fn.op('cmp r8, #0', `beq ${skip}`);
          fmov(fn, 's0', n.seconds);
          fn.load('r0', CAMERA_MODE);
          fn.call(A.camField);
          fn.call(A.camWait);
          fn.call(A.camResume);
          fn.op('mov r8, #0');
          fn.at(skip);
        }
        break;
      }
      case 'fade':
        fmov(fn, 's0', n.seconds);
        fn.load('r0', FADE_DISPLAY);
        fn.call(n.out ? A.fadeOut : A.fadeIn);
        break;
      case 'follow':
        fn.op(`mov r0, #${n.on ? 1 : 0}`);
        fn.call(A.formation);
        break;
      case 'se':
        fn.load('r0', n.id);
        fn.op('vmov.f32 s0, s16');
        fn.call(A.play);
        break;
      case 'addItem':
        fn.load('r0', scriptRowId(n.item));
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
      case 'bgm':
        fmov(fn, 's0', n.seconds, 'r0');
        fn.call(n.pause ? A.pauseBgm : A.replayBgm);
        break;
      case 'wait':
        waitSeconds(n.seconds);
        break;
      case 'collision':
        if (n.row === null) fn.op('ldr r0, [r4, #4]');
        else fn.load('r0', n.row);
        fn.op(`mov r1, #${n.on ? 1 : 0}`);
        fn.call(A.collision);
        break;
      case 'remove':
        fn.load('r0', n.row);
        fn.call(A.deleteObject);
        break;
      case 'vanishMonster': {
        // contents0001 D01BossWin (+0x94c/+0x9b8): keep ScriptEffect on the event until its destructor.
        const at = c.effectAt!;
        const small = g.uniq(`${fn.name}_vanish_small`),
          large = g.uniq(`${fn.name}_vanish_large`),
          created = g.uniq(`${fn.name}_vanish_created`),
          noEffect = g.uniq(`${fn.name}_vanish_no_effect`),
          done = g.uniq(`${fn.name}_vanish_done`);
        fn.load('r0', n.row);
        fn.call(A.mapChara);
        fn.op('cmp r0, #0', `beq ${done}`, `str r0, [sp, #${hx(FRAME.tmp)}]`, 'mov r1, r0');
        fn.op(`add r0, sp, #${hx(FRAME.obj)}`);
        fn.call(A.charaCtor);
        fn.op(`ldr r0, [sp, #${hx(FRAME.tmp)}]`);
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
          `beq ${large}`,
          'mov r0, #0',
          `str r0, [sp, #${hx(FRAME.tmp + 4)}]`,
          `b ${created}`,
        );
        fn.at(small);
        fn.load('r1', 0xc1);
        fn.op(`b ${created}_make`);
        fn.at(large);
        fn.load('r1', 0xc2);
        fn.at(`${created}_make`);
        fn.op(`add r0, r4, #${hx(at)}`, 'mov r2, #3');
        fn.call(A.effectCreate);
        fn.op('mov r0, #1', `str r0, [sp, #${hx(FRAME.tmp + 4)}]`);
        fn.at(created);
        const ref = (): void => fn.op(`add r0, sp, #${hx(FRAME.obj)}`);
        ref();
        fn.call(A.cancelAutoAnim);
        startAnim(ref, 0x80000066, 0, false);
        ref();
        fn.op('mov r1, #0');
        fn.call(A.blendAnim);
        ref();
        fn.load('r1', WAIT_ANIM_ARG);
        fn.call(A.waitAnimation);
        ref();
        fn.op('vmov.f32 s0, s16', 'vmov.f32 s1, s17', 'vmov.f32 s2, s16', 'mov r1, #2', 'mov r2, #0', 'mov r3, #0');
        fn.call(A.alphaTo);
        fn.load('r0', 0xb8);
        fn.op('vmov.f32 s0, s16');
        fn.call(A.play);
        fn.op(`ldr r0, [sp, #${hx(FRAME.tmp + 4)}]`, 'cmp r0, #0', `beq ${noEffect}`);
        ref();
        fn.call(A.shadowPos);
        fn.op('mov r1, r0', `add r0, r4, #${hx(at)}`);
        fn.call(A.setPos);
        fn.op(`add r0, r4, #${hx(at)}`, 'vmov.f32 s0, s17');
        fn.call(A.effectStart);
        fn.at(noEffect);
        ref();
        fn.call(A.waitNode);
        fn.load('r0', n.row);
        fn.call(A.deleteObject);
        ref();
        fn.call(A.charaDtor);
        fn.at(done);
        break;
      }
      case 'battle':
        // EncountBoss asks for the battle and returns; the event ends here (script-abi.md §7). The group is looked up
        // in the content's MonsterGroup (master +0x1068, an _ENCOUNT table) by FUN_0031C038: a value below 0x80000000
        // is a row number (what the boss range 0C passes: 0x2E281C ldrh), else a row ID. The row IDs are not the row
        // numbers (content 1: 0x80000000, 0x80000010, 0x80000011 …), and a value not there gives row 0, the empty group.
        fn.load('r0', n.group);
        fn.op('mov r1, #0');
        fn.call(A.encount);
        fn.op(`b ${c.exit}`);
        break;
      case 'stageName':
        fn.call(A.stageName);
        break;
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
