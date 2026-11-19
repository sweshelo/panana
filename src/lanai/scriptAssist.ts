// What the editor of a function's text (ScriptCodeEditor.tsx) knows of the script's language, apart from the editor
// itself: what kind a word is (its colour), what can be written at a place (completion), where a function's text is
// wrong, which lines of talk it names and where a block folds. All from the tables the compiler reads
// (eventScript.ts, scriptDoc.ts, scriptApiTable.ts), so the editor cannot fall behind the language.
import {
  parseStageScript,
  scriptDocSource,
  ScriptError,
  SCRIPT_RESERVED,
  SCRIPT_ROW_METHODS,
  TALK_DIALOG,
  TALK_DIALOG_LABEL,
  type ScriptDoc,
  type ScriptMethod,
} from './eventScript';
import { POPUP_ICONS } from './popupIcons';
import { SCRIPT_API_ROWS, type ScriptApiRow } from './scriptApiTable';
import { SCRIPT_METHOD_WORDS, SCRIPT_WORDS } from './scriptDoc';

export type ScriptWordKind = 'keyword' | 'atom' | 'who' | 'builtin' | 'class';

const ATOMS = ['true', 'false', 'bubble', 'window'];
const WHO = ['hero', 'self', 'chara'];
/** Words of the language that are not in SCRIPT_WORDS under their own name. */
const MORE_BUILTINS = ['vec'];
const BUILTINS = new Map(SCRIPT_WORDS.filter((w) => /^[A-Za-z_]\w*$/u.test(w.word)).map((w) => [w.word, w]));
const CLASSES = new Map<string, ScriptApiRow[]>();
for (const r of SCRIPT_API_ROWS) CLASSES.set(r[0], [...(CLASSES.get(r[0]) ?? []), r]);
const OWN_METHODS = new Map(SCRIPT_METHOD_WORDS.map((w) => [w.word, w]));
/** The built-in methods of a character (`chara(N).` has all, `hero.` / `self.` those that take no event). */
const ownMethods = (chara: boolean): ScriptCompletion[] =>
  [...OWN_METHODS.values()]
    .filter((w) => chara || !SCRIPT_ROW_METHODS.includes(w.word as ScriptMethod))
    .map((w) => ({
      label: w.word,
      detail: w.form.slice(w.form.indexOf('.') + 1 + w.word.length),
      info: w.about,
      apply: `${w.word}(`,
      type: 'function' as const,
    }));
/** The classes whose functions are called on a character (`hero.` has both, the others ScriptChara). */
const MEMBER_CLASSES = ['ScriptChara', 'ScriptPlayer'];

/** The kind of a word of the language, or null: a name of the author's (or a mistake). */
export function scriptWordKind(word: string): ScriptWordKind | null {
  if (ATOMS.includes(word)) return 'atom';
  if (WHO.includes(word)) return 'who';
  if (SCRIPT_RESERVED.includes(word)) return 'keyword';
  if (BUILTINS.has(word) || MORE_BUILTINS.includes(word)) return 'builtin';
  if (CLASSES.has(word) && !MEMBER_CLASSES.includes(word)) return 'class';
  return null;
}

/** What the editor is told of the stage around a function. */
export interface ScriptAssist {
  /** The names of the variables. */
  vars: string[];
  /** The lines of talk of the MapGroup the function is given to: the ID the script names each by, and its text. */
  lines: { id: number; text: string }[];
  /** The events of that MapGroup's records: the row a statement names, and what the record is. */
  records: { row: number; label: string }[];
  /** MonsterGroup rows: battle() uses row positions, while their IDs may differ. */
  groups?: { row: number; id: number; label: string }[];
}
export const NO_ASSIST: ScriptAssist = { vars: [], lines: [], records: [] };

export interface ScriptCompletion {
  label: string;
  /** Shown beside the label. */
  detail?: string;
  /** Shown for the chosen one. */
  info?: string;
  /** What is written (the label when absent). */
  apply?: string;
  type: 'keyword' | 'function' | 'variable' | 'class' | 'method' | 'text' | 'constant';
}
export interface ScriptCompletions {
  /** Where what is replaced starts, in the text given. */
  from: number;
  options: ScriptCompletion[];
  /** Whether the editor still has to narrow the options by what is typed (false: they are narrowed already). */
  filter: boolean;
}

export const lineIdText = (id: number): string => `0x${id.toString(16).toUpperCase()}`;
const PARAM: Record<string, string> = { i: '整数', f: '小数', v: 'vec(x, y, z)', c: 'だれに', p: 'だれに' };
/** A result type of the table as it is shown: "u32" = 32 bits, "?" after it = read from the code but not settled. */
export const apiResultLabel = (result: string): string => {
  const t = result.replace(/\?$/u, '');
  const name = t === 'u32' ? '32bit' : t === 'ptr' ? 'ポインター' : t;
  return result.endsWith('?') ? `${name} (推定)` : name;
};
/** The arguments an author writes for an API function (a ScriptMessageParam is not written). */
const apiForm = (r: ScriptApiRow): string =>
  `${r[1]}(${[...r[3]]
    .filter((c) => c !== 'm')
    .map((c) => PARAM[c] ?? c)
    .join(', ')})`;
const methods = (classes: string[]): ScriptCompletion[] =>
  classes.flatMap((c) =>
    (CLASSES.get(c) ?? []).map((r) => ({
      label: r[1],
      detail: apiForm(r).slice(r[1].length),
      info: `${apiResultLabel(r[5])} ${c}::${r[1]}(${r[4]})`,
      apply: `${r[1]}(`,
      type: 'method' as const,
    })),
  );

export interface ScriptHoverInfo {
  signatures: string[];
  about: string;
}

/** Help for the function under the pointer, from the same tables as completion. */
export function scriptHoverInfo(before: string, name: string): ScriptHoverInfo | null {
  if (!/^[A-Za-z_]\w*$/u.test(name)) return null;
  const line = before.slice(before.lastIndexOf('\n') + 1);
  if (line.includes('//') || before.lastIndexOf('/*') > before.lastIndexOf('*/')) return null;
  const member = /(?:([A-Za-z_]\w*)|chara\s*\([^()\n]*\))\s*\.\s*$/u.exec(before);
  if (member) {
    const receiver = member[1];
    const own = OWN_METHODS.get(name);
    if (own && (!receiver || receiver === 'hero' || receiver === 'self'))
      return { signatures: [`${own.form} — Panana の組み込み`], about: own.about };
    const classes =
      receiver === 'hero'
        ? ['ScriptPlayer', 'ScriptChara']
        : receiver === 'self' || !receiver
          ? ['ScriptChara']
          : [receiver];
    const rows = classes.flatMap((cls) => (CLASSES.get(cls) ?? []).filter((r) => r[1] === name));
    if (!rows.length) return null;
    return {
      signatures: [
        ...new Set(rows.map((r) => `${r[0]}.${apiForm(r)} — 引数 ${[...r[3]].filter((c) => c !== 'm').length} 個`)),
      ],
      about: [
        ...new Set(
          rows.map((r) => {
            const types = r[4]
              .split(', ')
              .filter((_, index) => r[3][index] !== 'm')
              .join(', ');
            return `戻り値: ${apiResultLabel(r[5])}。引数の型: ${types || 'なし'}`;
          }),
        ),
      ].join('\n'),
    };
  }
  const builtin = BUILTINS.get(name);
  if (builtin?.form.startsWith(`${name}(`)) {
    const params = builtin.form.slice(name.length + 1, builtin.form.indexOf(')', name.length));
    const max = params ? params.split(',').length : 0;
    const min = max - (params.includes('[') ? 1 : 0);
    return {
      signatures: [`${builtin.form} — 引数 ${min === max ? String(max) : `${min}〜${max}`} 個`],
      about: builtin.about,
    };
  }
  if (name === 'vec') return { signatures: ['vec(x, y, z) — 引数 3 個'], about: 'Script API の位置を表す値' };
  return null;
}

/** The statements and values that name a line of talk, and those that name an event's row. */
const LINE_CALLS = ['talk', 'say', 'ask'];
const ROW_CALLS = ['chara', 'openDoor', 'openDoorNow', 'closeDoor', 'collision', 'remove', 'vanishMonster', 'state'];

/** Calls in code, excluding comments, whose argument is a MonsterGroup row position. */
export function scriptBattleMarks(source: string): { row: number; at: number }[] {
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, (c) => c.replace(/[^\n]/gu, ' '));
  return [...code.matchAll(/\bbattle\s*\(\s*(0[xX][0-9a-fA-F]+|\d+)\s*\)/gu)].map((m) => ({
    row: Number(m[1]),
    at: m.index + m[0].length,
  }));
}

/** What can be written at the end of `before` (a function's text up to the cursor), or null: nothing to offer. */
export function scriptCompletions(before: string, assist: ScriptAssist, explicit = false): ScriptCompletions | null {
  // inside a comment of the line: nothing
  const line = before.slice(before.lastIndexOf('\n') + 1);
  if (/\/\//u.test(line)) return null;

  // after "Class." / "hero." / "self." / "chara(…)."
  const dot = /(?:([A-Za-z_]\w*)|(\)))\s*\.\s*(\w*)$/u.exec(before);
  if (dot) {
    const from = before.length - dot[3]!.length;
    const left = dot[1];
    if (left === 'hero')
      return { from, options: [...ownMethods(false), ...methods(['ScriptPlayer', 'ScriptChara'])], filter: true };
    if (left === 'self') return { from, options: [...ownMethods(false), ...methods(['ScriptChara'])], filter: true };
    if (dot[2]) return { from, options: [...ownMethods(true), ...methods(['ScriptChara'])], filter: true };
    if (left && CLASSES.has(left)) return { from, options: methods([left]), filter: true };
    return null;
  }

  // the line of a talk: the lines of the table, found by their text or their ID
  const call = /\b([A-Za-z_]\w*)\s*\(\s*([^(),\n]*)$/u.exec(before);
  if (call && LINE_CALLS.includes(call[1]!)) {
    const typed = call[2]!.trim();
    const q = typed.toLowerCase();
    const options = assist.lines
      .filter((l) => !q || l.text.toLowerCase().includes(q) || lineIdText(l.id).toLowerCase().startsWith(q))
      .slice(0, 200)
      .map((l) => ({ label: `${lineIdText(l.id)} ${l.text}`, apply: lineIdText(l.id), type: 'text' as const }));
    return options.length ? { from: before.length - call[2]!.length, options, filter: false } : null;
  }
  if (call && ROW_CALLS.includes(call[1]!) && /^\w*$/u.test(call[2]!)) {
    const options = assist.records
      .filter((r) => String(r.row).startsWith(call[2]!))
      .map((r) => ({ label: `${r.row} ${r.label}`, apply: String(r.row), type: 'constant' as const }));
    return options.length ? { from: before.length - call[2]!.length, options, filter: false } : null;
  }
  // the second argument: the window of a line, the icon of a popup
  const second = /\b(talk|say|popup)\s*\(\s*[^(),\n]*(?:\([^()\n]*\))?\s*,\s*(\w*)$/u.exec(before);
  if (second) {
    const typed = second[2]!;
    const options: ScriptCompletion[] =
      second[1] === 'popup'
        ? POPUP_ICONS.map((p) => ({
            label: `${p.icon} ${p.label}`,
            apply: String(p.icon),
            type: 'constant' as const,
          })).filter((o) => o.apply.startsWith(typed))
        : (['bubble', 'window'] as const)
            .filter((k) => k.startsWith(typed))
            .map((k) => ({
              label: k,
              detail: ` ${TALK_DIALOG_LABEL[TALK_DIALOG[k]]}`,
              type: 'constant' as const,
            }));
    return options.length ? { from: before.length - typed.length, options, filter: false } : null;
  }
  if (call?.[1] === 'battle' && /^\d*$/u.test(call[2]!)) {
    const options = (assist.groups ?? [])
      .filter((g) => String(g.row).startsWith(call[2]!))
      .map((g) => ({
        label: `群れ #${g.row} ${g.label}`,
        detail: `行番号 ${g.row} · 行 ID ${lineIdText(g.id)}`,
        info: `battle(${g.row}) と書きます。MonsterGroup の行 ${g.row}、行 ID ${lineIdText(g.id)}。${g.label}`,
        apply: String(g.row),
        type: 'constant' as const,
      }));
    return options.length ? { from: before.length - call[2]!.length, options, filter: false } : null;
  }

  // a word
  const word = /[A-Za-z_]\w*$/u.exec(before)?.[0] ?? '';
  if (!word && !explicit) return null;
  if (/[\d.]$/u.test(before.slice(0, before.length - word.length))) return null;
  const options: ScriptCompletion[] = [
    ...[...BUILTINS.values()].map((w) => ({
      label: w.word,
      detail: w.form.slice(w.word.length),
      info: w.about,
      apply:
        w.word === 'if' || w.word === 'switch'
          ? `${w.word} (`
          : SCRIPT_RESERVED.includes(w.word) && !WHO.includes(w.word)
            ? w.word
            : `${w.word}(`,
      type: SCRIPT_RESERVED.includes(w.word) ? ('keyword' as const) : ('function' as const),
    })),
    ...['else', 'case', 'default', 'break', 'true', 'false']
      .filter((k) => !BUILTINS.has(k))
      .map((k) => ({ label: k, type: 'keyword' as const })),
    { label: 'vec', detail: '(x, y, z)', info: 'Script API の引数に書く位置', apply: 'vec(', type: 'function' },
    ...assist.vars.map((v) => ({ label: v, detail: ' 変数', type: 'variable' as const })),
    ...[...CLASSES.keys()]
      .filter((c) => !MEMBER_CLASSES.includes(c))
      .map((c) => ({ label: c, detail: ' Script API', apply: `${c}.`, type: 'class' as const })),
  ];
  // hero / self are words on their own (chara takes a row)
  for (const o of options) if (o.label === 'hero' || o.label === 'self') o.apply = o.label;
  return { from: before.length - word.length, options, filter: true };
}

/** Where a function's text is wrong (the first place), or null. The line is counted in the function's text. */
export function scriptFunctionProblem(vars: ScriptDoc['vars'], body: string): { line: number; message: string } | null {
  let alone: ReturnType<typeof scriptDocSource>;
  try {
    alone = scriptDocSource({ vars, functions: [{ name: 'f', body }], bindings: [] });
  } catch {
    return null;
  }
  try {
    parseStageScript(alone.text);
    return null;
  } catch (e) {
    if (!(e instanceof ScriptError)) return null;
    const b = alone.bodies[0]!;
    // a mistake in the variables is told at the table, not at every function
    if (e.line < b.first) return null;
    return { line: Math.max(1, Math.min(e.line - b.first + 1, b.lines)), message: e.text };
  }
}

/** The lines of talk a function's text names: the ID, and the place just after the call's closing parenthesis. */
export function scriptLineMarks(body: string): { id: number; at: number }[] {
  const code = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, (c) => ' '.repeat(c.length));
  return [...code.matchAll(/\b(?:talk|say|ask)\s*\(\s*(0[xX][0-9a-fA-F]+|\d+)\s*(?:,\s*\w+\s*)?\)/gu)].map((m) => ({
    id: Number(m[1]),
    at: m.index + m[0].length,
  }));
}

/** The block that opens on the line [from, to) of `text` and closes on a later line: what folding it hides. */
export function scriptFoldRange(text: string, from: number, to: number): { from: number; to: number } | null {
  const code = text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, (c) => c.replace(/[^\n]/gu, ' '));
  // the last brace of the line that the line itself does not close
  const open: number[] = [];
  for (let k = from; k < to; k++) {
    if (code[k] === '{') open.push(k);
    else if (code[k] === '}') open.pop();
  }
  const start = open.pop();
  if (start === undefined) return null;
  let depth = 0;
  for (let k = start; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}' && --depth === 0) return k > to ? { from: start + 1, to: k } : null;
  }
  return null;
}
