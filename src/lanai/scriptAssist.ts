// What the editor of a function's text (ScriptCodeEditor.tsx) knows of the script's language, apart from the editor
// itself: what kind a word is (its colour), what can be written at a place (completion), where a function's text is
// wrong, which lines of talk it names and where a block folds. All from the tables the compiler reads
// (eventScript.ts, scriptDoc.ts, scriptApiTable.ts), so the editor cannot fall behind the language.
import { parseStageScript, scriptDocSource, ScriptError, SCRIPT_RESERVED, type ScriptDoc } from './eventScript';
import { POPUP_ICONS } from './popupIcons';
import { SCRIPT_API_DOCS } from './scriptApiDocs';
import { SCRIPT_API_ROWS, type ScriptApiRow } from './scriptApiTable';
import { callEnd, SCRIPT_LINE_CALLS, SCRIPT_WORDS, type ScriptWord } from './scriptDoc';
import { libraryForm, SCRIPT_LIBRARY, type ScriptLibraryFunction } from './scriptLibrary';

export { scriptLineMarks } from './scriptDoc';

export type ScriptWordKind = 'keyword' | 'atom' | 'who' | 'builtin' | 'class';

const ATOMS = ['true', 'false', 'selfRow'];
const WHO = ['hero', 'self', 'obj'];
/** The words of the help and the library's functions (the help shows those apart, with their text). */
const BUILTINS = new Map<string, ScriptWord>([
  ...SCRIPT_WORDS.filter((w) => /^[A-Za-z_]\w*$/u.test(w.word)).map((w): [string, ScriptWord] => [w.word, w]),
  ...SCRIPT_LIBRARY.map((f): [string, ScriptWord] => [
    f.name,
    { kind: 'statement', form: libraryForm(f), word: f.name, about: `${f.about} (ライブラリの関数)` },
  ]),
]);
const CLASSES = new Map<string, ScriptApiRow[]>();
for (const r of SCRIPT_API_ROWS) CLASSES.set(r[0], [...(CLASSES.get(r[0]) ?? []), r]);
/** The kind of a library function's first parameter (`obj` / `num`), or null when it has none. */
const firstParam = (f: ScriptLibraryFunction): string | null =>
  /^\w+\s*\(\s*\w+\s*:\s*(\w+)/u.exec(libraryForm(f))?.[1] ?? null;
/**
 * The library's functions an object can be written before (`obj(3).open()`): those whose first parameter is an object,
 * and (for obj(N)) an event's number.
 */
const ownMethods = (obj: boolean): ScriptCompletion[] =>
  SCRIPT_LIBRARY.filter((f) => firstParam(f) === 'obj' || (obj && firstParam(f) === 'num')).map((f) => {
    const form = libraryForm(f);
    const rest = form.slice(form.indexOf('(') + 1).replace(/^\s*\w+\s*:\s*\w+\s*,?\s*/u, '');
    return {
      label: f.name,
      detail: `(${rest}`,
      info: `${f.about} (ライブラリの関数 ${form})`,
      apply: `${f.name}(`,
      type: 'function' as const,
    };
  });
/** The classes whose functions are called on a character (`hero.` has both, the others ScriptChara). */
const MEMBER_CLASSES = ['ScriptChara', 'ScriptPlayer'];

/** The kind of a word of the language, or null: a name of the author's (or a mistake). */
export function scriptWordKind(word: string): ScriptWordKind | null {
  if (ATOMS.includes(word)) return 'atom';
  if (WHO.includes(word)) return 'who';
  if (SCRIPT_RESERVED.includes(word)) return 'keyword';
  if (BUILTINS.has(word)) return 'builtin';
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
  /** MonsterGroup rows: ScriptMap.EncountBoss takes row positions, while their IDs may differ. */
  groups?: { row: number; id: number; label: string }[];
  /** The script's own functions. */
  functions?: ScriptOwnFunction[];
}

/** A function the script declares: its name and its parameters (`kind` as written: obj / num, or '' if not yet). */
export interface ScriptOwnFunction {
  name: string;
  params: { name: string; kind: string }[];
}
/** The text with its comments blanked (same length, so places stay). */
const blankComments = (text: string): string =>
  text.replace(/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/gu, (c) => c.replace(/[^\n]/gu, ' '));
const readParams = (text: string): ScriptOwnFunction['params'] =>
  text
    .split(',')
    .map((p) => /^\s*([A-Za-z_]\w*)\s*(?::\s*(\w*))?/u.exec(p))
    .filter((m): m is RegExpExecArray => !!m && !SCRIPT_RESERVED.includes(m[1]!))
    .map((m) => ({ name: m[1]!, kind: m[2] ?? '' }));
/**
 * The variables and functions a script's text declares, read by their words alone: a text being written (which the
 * compiler does not read until it is whole) still names them.
 */
export function scriptOwnNames(source: string): { vars: string[]; functions: ScriptOwnFunction[] } {
  const code = blankComments(source);
  // the stage's variables and the locals (let) written anywhere: their names are offered wherever they are
  const vars = [...code.matchAll(/\b(?:var|let|effect)\s+([A-Za-z_]\w*)/gu)].map((m) => m[1]!);
  const functions: ScriptOwnFunction[] = [];
  for (const m of code.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\)?)?/gu))
    if (!functions.some((f) => f.name === m[1])) functions.push({ name: m[1]!, params: readParams(m[2] ?? '') });
  const name = (n: string): boolean => !SCRIPT_RESERVED.includes(n);
  return { vars: [...new Set(vars)].filter(name), functions: functions.filter((f) => name(f.name)) };
}
/** The parameters of the function the end of `before` is in the body of ([] outside a function). */
function enclosingParams(before: string): ScriptOwnFunction['params'] {
  const code = blankComments(before);
  const heads = [...code.matchAll(/\bfunction\s+[A-Za-z_]\w*\s*\(([^)]*)\)\s*\{/gu)];
  const last = heads[heads.length - 1];
  if (!last) return [];
  let depth = 0;
  for (const ch of code.slice(last.index! + last[0].length - 1)) {
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return [];
  }
  return readParams(last[1]!);
}
const ownFunctionCompletion = (f: ScriptOwnFunction, rest: boolean): ScriptCompletion => {
  const ps = (rest ? f.params.slice(1) : f.params).map((p) => (p.kind ? `${p.name}: ${p.kind}` : p.name));
  return {
    label: f.name,
    detail: `(${ps.join(', ')})`,
    info: 'スクリプトの関数',
    apply: `${f.name}(`,
    type: 'function',
  };
};
/** The script's functions an object can be written before, as the library's (ownMethods). */
const ownFunctionMethods = (assist: ScriptAssist, obj: boolean): ScriptCompletion[] =>
  (assist.functions ?? [])
    .filter((f) => f.params[0]?.kind === 'obj' || (obj && f.params[0]?.kind === 'num'))
    .map((f) => ownFunctionCompletion(f, true));
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
/** What a function does (scriptApiDocs.ts), with its arguments and an example, as the editor shows it; '' if unread. */
export function apiAbout(r: ScriptApiRow): string {
  const d = SCRIPT_API_DOCS[r[2]];
  if (!d) return '';
  const params = [...r[3]].filter((c) => c !== 'm');
  const args = (d.args ?? []).slice(0, params.length).map((a, k) => `${k + 1}. ${a}`);
  return [
    `${d.about}${d.settled ? '' : ' (推定)'}`,
    ...(args.length ? [`引数: ${args.join(' / ')}`] : []),
    ...(d.example ? [`例: ${d.example}`] : []),
  ].join('\n');
}
const methods = (classes: string[]): ScriptCompletion[] =>
  classes.flatMap((c) =>
    (CLASSES.get(c) ?? []).map((r) => ({
      label: r[1],
      detail: apiForm(r).slice(r[1].length),
      info: [`${apiResultLabel(r[5])} ${c}::${r[1]}(${r[4]})`, apiAbout(r)].filter(Boolean).join('\n'),
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
  const member = /(?:([A-Za-z_]\w*)|obj\s*\([^()\n]*\))\s*\.\s*$/u.exec(before);
  if (member) {
    const receiver = member[1];
    const own = SCRIPT_LIBRARY.find((f) => f.name === name);
    if (own && (!receiver || WHO.includes(receiver)))
      return { signatures: [`${libraryForm(own)} — ライブラリの関数 (だれに. の物が 1 つ目の引数)`], about: own.about };
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
            const about = apiAbout(r);
            return `${about ? `${about}\n` : ''}戻り値: ${apiResultLabel(r[5])}。引数の型: ${types || 'なし'}`;
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
  return null;
}

/** One form of the function whose arguments are being written, as the help shows it. */
export interface ScriptSignatureForm {
  /** What comes before the parenthesis ("ScriptSound.Play", "talk"). */
  head: string;
  /** The parameters, each as the help names it. */
  params: string[];
  /** What it does (with an example when there is one). */
  about: string;
}
export interface ScriptSignatureHelp {
  /** The argument being written (0-based). */
  arg: number;
  forms: ScriptSignatureForm[];
}

/** Calls that are a part of an argument, not a function to help with: inside them the outer call's help stays. */
const ARG_CALLS = ['vec', 'obj'];
const NOT_CALLS = ['if', 'switch', 'while', 'for', 'return', 'function'];

/**
 * The call whose arguments the cursor is among: the innermost open parenthesis before it (not vec(…) / obj(…), which
 * are a part of an argument), the name before that parenthesis, the text before the name and the argument's number.
 * Null outside a call, in a comment, and in a function's or a block's head.
 */
export function scriptCallAt(before: string): { name: string; beforeName: string; arg: number } | null {
  if (before.lastIndexOf('/*') > before.lastIndexOf('*/')) return null;
  if (before.slice(before.lastIndexOf('\n') + 1).includes('//')) return null;
  const code = before.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, (c) => c.replace(/[^\n]/gu, ' '));
  let depth = 0;
  let commas = 0;
  for (let k = code.length - 1; k >= 0; k--) {
    const ch = code[k];
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '[') depth--;
    else if (ch === ',' && depth === 0) commas++;
    else if ((ch === '{' || ch === '}' || ch === ';') && depth === 0) return null;
    else if (ch === '(') {
      if (depth > 0) {
        depth--;
        continue;
      }
      const m = /([A-Za-z_]\w*)\s*$/u.exec(code.slice(0, k));
      if (!m) return null;
      const name = m[1]!;
      const beforeName = before.slice(0, m.index);
      if (ARG_CALLS.includes(name) && !/\.\s*$/u.test(beforeName)) {
        // the outer call counts this argument as one: start over outside it
        commas = 0;
        continue;
      }
      if (NOT_CALLS.includes(name) || /\bfunction\s+$/u.test(beforeName)) return null;
      return { name, beforeName, arg: commas };
    }
  }
  return null;
}

/** The parameters of `name(a: num, b: obj)` / `name(だれに, [音])`. */
const formParams = (form: string): string[] => {
  const inner = form.slice(form.indexOf('(') + 1, form.lastIndexOf(')')).trim();
  return inner ? inner.split(',').map((p) => p.trim()) : [];
};

/**
 * The help for the arguments being written: every form of the call around the cursor (the Script API's overloads, the
 * library's and the language's functions and the script's own, whose `function name(…)` is looked for in `source`),
 * with the argument the cursor is in. Null outside a call or for a name that is none of them.
 */
export function scriptSignatureAt(before: string, source = before): ScriptSignatureHelp | null {
  const at = scriptCallAt(before);
  if (!at) return null;
  const { name, beforeName, arg } = at;
  const member = /(?:([A-Za-z_]\w*)|obj\s*\([^()\n]*\))\s*\.\s*$/u.exec(beforeName);
  const library = SCRIPT_LIBRARY.find((f) => f.name === name);
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, (c) => c.replace(/[^\n]/gu, ' '));
  const own = new RegExp(`\\bfunction\\s+${name}\\s*\\(([^)]*)\\)`, 'u').exec(code);
  const ownForm = (rest: boolean): ScriptSignatureForm[] => {
    if (own) {
      const params = formParams(`(${own[1]})`);
      return [{ head: name, params: rest ? params.slice(1) : params, about: 'スクリプトの関数' }];
    }
    if (library) {
      const params = formParams(libraryForm(library));
      return [
        {
          head: name,
          params: rest ? params.slice(1) : params,
          about: rest ? `${library.about}\n(だれに. の物が 1 つ目の引数)` : library.about,
        },
      ];
    }
    return [];
  };
  if (member) {
    const receiver = member[1];
    if (!receiver || WHO.includes(receiver)) {
      const forms = ownForm(true);
      if (forms.length) return { arg, forms };
    }
    const classes =
      receiver === 'hero'
        ? ['ScriptPlayer', 'ScriptChara']
        : receiver === 'self' || !receiver
          ? ['ScriptChara']
          : [receiver];
    const rows = classes.flatMap((cls) => (CLASSES.get(cls) ?? []).filter((r) => r[1] === name));
    if (!rows.length) return null;
    const seen = new Set<string>();
    const forms: ScriptSignatureForm[] = [];
    for (const r of rows) {
      const d = SCRIPT_API_DOCS[r[2]];
      const kinds = [...r[3]].filter((c) => c !== 'm');
      const params = kinds.map((c, k) => {
        const what = d?.args?.[k];
        return what ? `${what}: ${PARAM[c] ?? c}` : (PARAM[c] ?? c);
      });
      const key = `${r[0]}.${r[1]}(${params.join(', ')})`;
      if (seen.has(key)) continue;
      seen.add(key);
      forms.push({
        head: `${r[0]}.${r[1]}`,
        params,
        about: [
          d ? `${d.about}${d.settled ? '' : ' (推定)'}` : '',
          `戻り値: ${apiResultLabel(r[5])}`,
          ...(d?.example ? [`例: ${d.example}`] : []),
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }
    return { arg, forms };
  }
  const forms = ownForm(false);
  if (forms.length) return { arg, forms };
  const builtin = BUILTINS.get(name);
  if (builtin?.form.startsWith(`${name}(`))
    return { arg, forms: [{ head: name, params: formParams(builtin.form), about: builtin.about }] };
  return null;
}

/** The functions whose first argument is an event's row (the library's and the Script API's). */
const ROW_CALLS = [
  'obj',
  'openDoor',
  'open',
  'vanish',
  'SetDoorOpenFlag',
  'SetDoorCloseFlag',
  'DeleteEventObject',
  'EnableEventCollision',
  'GetScriptState',
  'GetMapChara',
];

/** ScriptMap.EncountBoss calls in code, excluding comments: their first argument, a MonsterGroup row position. */
export function scriptBattleMarks(source: string): { row: number; at: number }[] {
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, (c) => c.replace(/[^\n]/gu, ' '));
  return [...code.matchAll(/\bEncountBoss\s*\(\s*(0[xX][0-9a-fA-F]+|\d+)\s*[,)]/gu)].map((m) => ({
    row: Number(m[1]),
    at: callEnd(code, m.index + m[0].length - 1),
  }));
}

/** What can be written at the end of `before` (a function's text up to the cursor), or null: nothing to offer. */
export function scriptCompletions(before: string, assist: ScriptAssist, explicit = false): ScriptCompletions | null {
  // inside a comment of the line: nothing
  const line = before.slice(before.lastIndexOf('\n') + 1);
  if (/\/\//u.test(line)) return null;

  // after "Class." / "hero." / "self." / "obj(…)."
  const dot = /(?:([A-Za-z_]\w*)|(\)))\s*\.\s*(\w*)$/u.exec(before);
  if (dot) {
    const from = before.length - dot[3]!.length;
    const left = dot[1];
    const own = (obj: boolean): ScriptCompletion[] => [...ownFunctionMethods(assist, obj), ...ownMethods(obj)];
    if (left === 'hero')
      return { from, options: [...own(false), ...methods(['ScriptPlayer', 'ScriptChara'])], filter: true };
    if (left === 'self') return { from, options: [...own(false), ...methods(['ScriptChara'])], filter: true };
    if (dot[2]) return { from, options: [...own(true), ...methods(['ScriptChara'])], filter: true };
    if (left && CLASSES.has(left)) return { from, options: methods([left]), filter: true };
    return null;
  }

  // the line of a talk: the lines of the table, found by their text or their ID
  const call = /\b([A-Za-z_]\w*)\s*\(\s*([^(),\n]*)$/u.exec(before);
  if (call && SCRIPT_LINE_CALLS.includes(call[1]!)) {
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
  // the second argument of SetPopup: the icon
  const second = /\bSetPopup\s*\(\s*[^(),\n]*,\s*(\w*)$/u.exec(before);
  if (second) {
    const typed = second[1]!;
    const options: ScriptCompletion[] = POPUP_ICONS.map((p) => ({
      label: `${p.icon} ${p.label}`,
      apply: String(p.icon),
      type: 'constant' as const,
    })).filter((o) => o.apply.startsWith(typed));
    return options.length ? { from: before.length - typed.length, options, filter: false } : null;
  }
  if (call?.[1] === 'EncountBoss' && /^\d*$/u.test(call[2]!)) {
    const options = (assist.groups ?? [])
      .filter((g) => String(g.row).startsWith(call[2]!))
      .map((g) => ({
        label: `群れ #${g.row} ${g.label}`,
        detail: `行番号 ${g.row} · 行 ID ${lineIdText(g.id)}`,
        info: `ScriptMap.EncountBoss(${g.row}, 0) と書きます。MonsterGroup の行 ${g.row}、行 ID ${lineIdText(g.id)}。${g.label}`,
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
    ...enclosingParams(before).map((p) => ({
      label: p.name,
      detail: p.kind ? ` 引数 (${p.kind})` : ' 引数',
      type: 'variable' as const,
    })),
    ...assist.vars.map((v) => ({ label: v, detail: ' 変数', type: 'variable' as const })),
    ...(assist.functions ?? []).map((f) => ownFunctionCompletion(f, false)),
    ...[...CLASSES.keys()]
      .filter((c) => !MEMBER_CLASSES.includes(c))
      .map((c) => ({ label: c, detail: ' Script API', apply: `${c}.`, type: 'class' as const })),
  ];
  // hero / self / selfRow are words on their own (obj takes a row)
  for (const o of options) if (o.label === 'hero' || o.label === 'self' || o.label === 'selfRow') o.apply = o.label;
  return { from: before.length - word.length, options, filter: true };
}

/**
 * Where a function's text is wrong (the first place), or null. The line is counted in the function's text. `params`:
 * its parameters' text; `others`: the script's other functions, which it can call (their bodies are not read).
 */
export function scriptFunctionProblem(
  vars: ScriptDoc['vars'],
  body: string,
  params = '',
  others: ScriptDoc['functions'] = [],
  name = 'f',
): { line: number; message: string } | null {
  let alone: ReturnType<typeof scriptDocSource>;
  try {
    const rest = others.filter((o) => o.name !== name).map((o) => ({ ...o, body: '' }));
    alone = scriptDocSource({ vars, functions: [{ name, params, body }, ...rest], bindings: [] });
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
