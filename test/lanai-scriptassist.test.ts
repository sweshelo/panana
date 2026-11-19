// What the editor of a function's text knows of the language (scriptAssist.ts): the kinds of the words, completion,
// where a text is wrong, the lines of talk it names, folding.
import { describe, expect, test } from 'bun:test';
import { scriptDocFromSource, SCRIPT_RESERVED } from '../src/lanai/eventScript';
import {
  scriptCompletions,
  scriptBattleMarks,
  scriptFoldRange,
  scriptFunctionProblem,
  scriptHoverInfo,
  scriptLineMarks,
  scriptWordKind,
  type ScriptAssist,
} from '../src/lanai/scriptAssist';
import { SCRIPT_SAMPLES, SCRIPT_WORDS } from '../src/lanai/scriptDoc';

const assist: ScriptAssist = {
  vars: ['BOSS', 'VISIT'],
  lines: [
    { id: 0x10, text: 'こんにちは' },
    { id: 0x11, text: 'たたかう?' },
    { id: 0x2a, text: 'さようなら' },
  ],
  records: [
    { row: 3, label: '扉' },
    { row: 12, label: 'キャラ・物 種類 1 (話しかけたとき)' },
  ],
  groups: [
    { row: 0, id: 0x80000000, label: '(空)' },
    { row: 5, id: 0x80000010, label: 'トーチゴースト・いちごおばけ' },
  ],
};
const labels = (before: string, explicit = false): string[] =>
  scriptCompletions(before, assist, explicit)?.options.map((o) => o.label) ?? [];

describe('the kinds of the words', () => {
  test('every word of the help that is a name has a kind', () => {
    for (const w of SCRIPT_WORDS)
      if (/^[A-Za-z_]\w*$/u.test(w.word)) expect([w.word, scriptWordKind(w.word)]).not.toEqual([w.word, null]);
  });
  test('every reserved word has a kind', () => {
    for (const w of SCRIPT_RESERVED) expect([w, scriptWordKind(w)]).not.toEqual([w, null]);
  });
  test('the kinds', () => {
    expect(scriptWordKind('if')).toBe('keyword');
    expect(scriptWordKind('true')).toBe('atom');
    expect(scriptWordKind('hero')).toBe('who');
    expect(scriptWordKind('talk')).toBe('builtin');
    expect(scriptWordKind('vec')).toBe('builtin');
    expect(scriptWordKind('ScriptSound')).toBe('class');
    expect(scriptWordKind('BOSS')).toBeNull();
  });
});

describe('completion', () => {
  test('a word: statements, variables, API classes', () => {
    const r = scriptCompletions('  ta', assist)!;
    expect(r.from).toBe(2);
    expect(r.filter).toBe(true);
    const talk = r.options.find((o) => o.label === 'talk')!;
    expect(talk.apply).toBe('talk(');
    expect(talk.detail).toBe('(行 ID[, 吹き出し])');
    expect(r.options.find((o) => o.label === 'if')!.apply).toBe('if (');
    expect(r.options.find((o) => o.label === 'hero')!.apply).toBe('hero');
    expect(r.options.find((o) => o.label === 'return')!.apply).toBe('return');
    expect(labels('B')).toContain('BOSS');
    expect(r.options.find((o) => o.label === 'ScriptSound')!.apply).toBe('ScriptSound.');
  });
  test('nothing without a word unless asked, nothing in a comment or after a number', () => {
    expect(scriptCompletions('talk(0x10)\n', assist)).toBeNull();
    expect(labels('talk(0x10)\n', true)).toContain('talk');
    expect(scriptCompletions('// ta', assist)).toBeNull();
    expect(scriptCompletions('wait(0.5', assist)).toBeNull();
  });
  test('the second argument: the window of a line, the icon of a popup', () => {
    expect(labels('talk(0x10, ')).toEqual(['bubble', 'window']);
    expect(labels('say(0x10, w')).toEqual(['window']);
    expect(labels('popup(chara(31), ')[0]).toBe('0 ! (びっくり)');
    expect(labels('popup(hero, 1')).toEqual([
      '1 水色のしずく (汗)',
      '10 キラッ (ひらめき)',
      '11 青い線 (青ざめ・焦り)',
      '12 … の吹き出し',
    ]);
    expect(scriptWordKind('window')).toBe('atom');
  });
  test('after a class: its functions', () => {
    const r = scriptCompletions('ScriptSound.Pl', assist)!;
    expect(r.from).toBe('ScriptSound.'.length);
    const play = r.options.find((o) => o.label === 'Play')!;
    expect(play.apply).toBe('Play(');
    expect(r.options.every((o) => o.type === 'method')).toBe(true);
    expect(scriptCompletions('Nothing.', assist)).toBeNull();
  });
  test('after a character: the functions of a character', () => {
    expect(labels('hero.')).toContain('SetVisible');
    expect(labels('self.Set')).toContain('SetVisible');
    expect(labels('chara(3).')).toContain('MoveTo');
    // hero is a ScriptPlayer too
    expect(labels('hero.').length).toBeGreaterThan(labels('self.').length);
  });
  test('after a character: the built-in methods beside the Script API', () => {
    expect(labels('chara(3).')).toEqual(expect.arrayContaining(['open', 'close', 'anim', 'StartAnimation']));
    expect(labels('hero.')).toEqual(expect.arrayContaining(['anim', 'move', 'SetVisible']));
    // the methods of an event are of chara() alone
    expect(labels('hero.')).not.toContain('open');
    expect(labels('self.')).not.toContain('remove');
    expect(scriptHoverInfo('chara(3).', 'open')!.about).toContain('扉');
    expect(scriptHoverInfo('hero.', 'anim')!.signatures[0]).toContain('だれに.anim');
  });
  test('the line of a talk: found by its text or its ID, written as the ID', () => {
    const all = scriptCompletions('talk(', assist)!;
    expect(all.options.map((o) => o.apply)).toEqual(['0x10', '0x11', '0x2A']);
    expect(all.filter).toBe(false);
    const byText = scriptCompletions('if (ask(たた', assist)!;
    expect(byText.options.map((o) => o.apply)).toEqual(['0x11']);
    expect(byText.from).toBe('if (ask('.length);
    expect(scriptCompletions('say(0x2', assist)!.options.map((o) => o.apply)).toEqual(['0x2A']);
    expect(scriptCompletions('talk(ない', assist)).toBeNull();
  });
  test('the row of an event: the records', () => {
    const r = scriptCompletions('openDoor(', assist)!;
    expect(r.options.map((o) => [o.label, o.apply])).toEqual([
      ['3 扉', '3'],
      ['12 キャラ・物 種類 1 (話しかけたとき)', '12'],
    ]);
    expect(scriptCompletions('camera(chara(1', assist)!.options.map((o) => o.apply)).toEqual(['12']);
  });
  test('battle offers MonsterGroup row positions with their different row IDs and members', () => {
    const all = scriptCompletions('battle(', assist)!;
    expect(all.options.map((o) => [o.apply, o.label])).toEqual([
      ['0', '群れ #0 (空)'],
      ['5', '群れ #5 トーチゴースト・いちごおばけ'],
    ]);
    expect(all.options[1]!.detail).toContain('行 ID 0x80000010');
    expect(scriptCompletions('battle(5', assist)!.options.map((o) => o.apply)).toEqual(['5']);
    expect(scriptCompletions('battle(16', assist)).toBeNull();
  });
});

test('hover explains built-in calls and API argument counts', () => {
  expect(scriptHoverInfo('', 'talk')).toMatchObject({
    signatures: ['talk(行 ID[, 吹き出し]) — 引数 1〜2 個'],
  });
  expect(scriptHoverInfo('', 'talk')!.about).toContain('吹き出し');
  expect(scriptHoverInfo('ScriptSound.', 'Play')!.signatures.some((x) => x.includes('引数'))).toBe(true);
  expect(scriptHoverInfo('hero.', 'SetVisible')!.signatures.some((x) => x.includes('引数 1 個'))).toBe(true);
  expect(scriptHoverInfo('// talk ', 'talk')).toBeNull();
  expect(scriptHoverInfo('', 'UNKNOWN')).toBeNull();
});

test('battle annotations name only calls in code, not comments', () => {
  const source = 'battle(5)\n// battle(8)\n/* battle(9) */ battle(0)';
  expect(scriptBattleMarks(source).map((m) => m.row)).toEqual([5, 0]);
  expect(source.slice(0, scriptBattleMarks(source)[0]!.at)).toBe('battle(5)');
});

describe('where a text is wrong', () => {
  const vars = [{ name: 'BOSS', kind: 'byte' as const, reset: true }];
  test('the samples are right', () => {
    for (const s of SCRIPT_SAMPLES) {
      const doc = scriptDocFromSource(s.source);
      for (const f of doc.functions) expect([f.name, scriptFunctionProblem(doc.vars, f.body)]).toEqual([f.name, null]);
    }
  });
  test('the line is counted in the text', () => {
    const p = scriptFunctionProblem(vars, 'talk(0x10)\nnothing(1)\n')!;
    expect(p.line).toBe(2);
    expect(p.message).not.toMatch(/行目/u);
    expect(scriptFunctionProblem(vars, 'if (BOSS == 1) {\n  talk(1)\n')!.line).toBeGreaterThanOrEqual(1);
    expect(scriptFunctionProblem(vars, 'BOSS = 2')).toBeNull();
  });
});

test('the lines of talk a text names, with the place after each call', () => {
  const body = 'talk(0x10)\n// talk(0x99)\nif (ask( 17 )) { say(0x2A) }';
  const marks = scriptLineMarks(body);
  expect(marks.map((m) => m.id)).toEqual([0x10, 17, 0x2a]);
  expect(body.slice(0, marks[0]!.at)).toBe('talk(0x10)');
  expect(body.slice(0, marks[1]!.at).endsWith('ask( 17 )')).toBe(true);
});

test('folding: the block a line opens and a later line closes', () => {
  const text = 'if (A) {\n  talk(1)\n} else {\n  talk(2)\n}\nif (B) { talk(3) }\n';
  const line = (n: number): [number, number] => {
    const lines = text.split('\n');
    const from = lines.slice(0, n).join('\n').length + (n ? 1 : 0);
    return [from, from + lines[n]!.length];
  };
  const first = scriptFoldRange(text, ...line(0))!;
  expect(text.slice(first.from, first.to)).toBe('\n  talk(1)\n');
  const second = scriptFoldRange(text, ...line(2))!;
  expect(text.slice(second.from, second.to)).toBe('\n  talk(2)\n');
  expect(scriptFoldRange(text, ...line(1))).toBeNull();
  expect(scriptFoldRange(text, ...line(5))).toBeNull();
  // a brace in a comment does not open a block
  expect(scriptFoldRange('// {\ntalk(1)\n}', 0, 4)).toBeNull();
});
