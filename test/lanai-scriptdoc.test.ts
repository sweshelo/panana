// The editor's side of an RPG FREE! stage script (src/lanai/scriptDoc.ts): giving functions to rows, the words the
// help lists, and the samples. What the built code does is checked in lanai-custom-stages (3ds/research).
import { describe, expect, test } from 'bun:test';
import {
  emptyScriptDoc,
  expandParts,
  type ScriptNode,
  parseStageScript,
  scriptDocFromSource,
  scriptDocSource,
  scriptOfDoc,
  type ScriptDoc,
} from '../src/lanai/eventScript';
import {
  docBound,
  docUnbound,
  rowBinding,
  SCRIPT_METHOD_CALLS,
  SCRIPT_METHOD_WORDS,
  SCRIPT_SAMPLES,
  scriptLineRefs,
  SCRIPT_WORD_CALLS,
  SCRIPT_WORDS,
  STAGE_SCRIPT_EXAMPLE,
  startBinding,
} from '../src/lanai/scriptDoc';
import { scriptCompletions, scriptFunctionProblem, scriptHoverInfo } from '../src/lanai/scriptAssist';
import { SCRIPT_API_DOCS } from '../src/lanai/scriptApiDocs';
import { SCRIPT_API_ROWS } from '../src/lanai/scriptApiTable';
import { SCRIPT_LIBRARY } from '../src/lanai/scriptLibrary';

describe('RPG FREE! stage script: the document of the editor', () => {
  const doc: ScriptDoc = {
    ...emptyScriptDoc(),
    functions: [
      { name: 'a', body: 'say(1)' },
      { name: 'b', body: 'say(2)' },
    ],
  };

  test('a row has one function whatever starts it; a group has one start', () => {
    let d = docBound(doc, { trigger: 'talk', group: 1, row: 5, fn: 'a' });
    d = docBound(d, { trigger: 'area', group: 1, row: 6, fn: 'a' });
    d = docBound(d, { trigger: 'start', group: 1, row: 9, fn: 'b' });
    expect(d.bindings).toEqual([
      { trigger: 'talk', group: 1, row: 5, fn: 'a' },
      { trigger: 'area', group: 1, row: 6, fn: 'a' },
      { trigger: 'start', group: 1, row: 0, fn: 'b' },
    ]);
    // giving again replaces: the row's trigger changes with the function, the start's function changes
    d = docBound(d, { trigger: 'defeat', group: 1, row: 6, fn: 'b' });
    d = docBound(d, { trigger: 'start', group: 1, row: 0, fn: 'a' });
    expect(rowBinding(d, 1, 6)).toEqual({ trigger: 'defeat', group: 1, row: 6, fn: 'b' });
    expect(rowBinding(d, 1, 5)?.fn).toBe('a');
    expect(rowBinding(d, 2, 5)).toBeUndefined();
    expect(startBinding(d, 1)?.fn).toBe('a');
    expect(d.bindings.length).toBe(3);
    // the start of a group is not the row 0 of the group
    d = docBound(d, { trigger: 'area', group: 1, row: 0, fn: 'b' });
    expect(d.bindings.length).toBe(4);
    expect(scriptOfDoc(d).events.length).toBe(4);
    d = docUnbound(d, { trigger: 'talk', group: 1, row: 6 });
    expect(rowBinding(d, 1, 6)).toBeUndefined();
    d = docUnbound(d, { trigger: 'start', group: 1, row: 0 });
    expect(startBinding(d, 1)).toBeUndefined();
    expect(rowBinding(d, 1, 0)?.fn).toBe('b');
  });

  test('the samples read, and their functions can be given as the sample says', () => {
    expect(SCRIPT_SAMPLES.length).toBe(2);
    for (const s of SCRIPT_SAMPLES) {
      const d = scriptDocFromSource(s.source);
      expect(d.bindings).toEqual([]);
      expect(d.functions.length).toBe(s.give.length);
      for (const g of s.give) expect(d.functions.map((f) => f.name)).toContain(g.split(' ')[0]!);
    }
    const [door, boss] = SCRIPT_SAMPLES.map((s) => scriptDocFromSource(s.source));
    expect(
      scriptOfDoc(docBound(door!, { trigger: 'button', group: 1, row: 7, fn: 'open_door' })).events[0]!.trigger,
    ).toBe('button');
    let b = docBound(boss!, { trigger: 'talk', group: 1, row: 9, fn: 'boss_talk' });
    b = docBound(b, { trigger: 'start', group: 1, row: 0, fn: 'after_battle' });
    const s = scriptOfDoc(b);
    expect(s.vars).toMatchObject([{ name: 'BOSS', kind: 'byte', reset: true }]);
    expect(s.events.map((e) => e.trigger)).toEqual(['talk', 'start']);
    // popup(self, …) of the boss sample needs an event that has an owner
    expect(() => scriptOfDoc(docBound(boss!, { trigger: 'area', group: 1, row: 9, fn: 'boss_talk' }))).toThrow('self');
    expect(parseStageScript(STAGE_SCRIPT_EXAMPLE).events.length).toBe(1);
  });

  test('the lines a text names: talk / say / ask, each once, comments left out', () => {
    expect(
      scriptLineRefs('talk(0x60)\nif (ask( 99 )) { say(0x60); talk(0X1a) } // talk(5)\n/* say(6) */ stalk(7)'),
    ).toEqual([0x60, 99, 0x1a]);
    expect(scriptLineRefs('wait(1)')).toEqual([]);
  });

  test('the words of the help: each statement word is one the reader knows', () => {
    const body = (text: string): unknown => parseStageScript(`var V: byte\non talk(1, 1) { ${text} }`);
    const example: Record<string, string> = {
      talk: 'talk(1)',
      say: 'say(1)',
      popup: 'popup(self, 1)',
      popupEnd: 'popupEnd(hero)',
      emotion: 'emotion(1)',
      emotionEnd: 'emotionEnd()',
      anim: 'anim(hero, 1, 2)',
      waitAnim: 'waitAnim(chara(2))',
      move: 'move(hero, 1, 2.5, -3)',
      turn: 'turn(self, 90)',
      face: 'face(self, hero)',
      show: 'show(self)',
      hide: 'hide(self)',
      camera: 'camera(self, 1)',
      cameraBack: 'cameraBack(1)',
      fadeOut: 'fadeOut(0.5)',
      fadeIn: 'fadeIn(0.5)',
      follow: 'follow(0)',
      se: 'se(1)',
      wait: 'wait(1)',
      addItem: 'addItem(1, 1)',
      getItem: 'getItem(1, 1)',
      addGold: 'addGold(-5)',
      openDoor: 'openDoor(1)',
      openDoorNow: 'openDoorNow(1)',
      closeDoor: 'closeDoor(1)',
      jingle: 'jingle()',
      bgmPause: 'bgmPause(0.3)',
      bgmResume: 'bgmResume(0.3)',
      collision: 'collision(1, 0)',
      remove: 'remove(1)',
      vanishMonster: 'vanishMonster(1)',
      battle: 'battle(1)',
      stageName: 'stageName()',
      return: 'return',
      if: 'if (V) {} else {}',
      switch: 'switch (V) { case 1: say(1) default: say(2) }',
      ask: 'if (ask(1)) {}',
      item: 'if (item(1) >= 2) {}',
      state: 'if (state(1) >= 2) {}',
      monsters: 'if (monsters() == 0) {}',
    };
    const words = SCRIPT_WORDS.map((x) => x.word).filter(
      (x) => /^[a-z]/u.test(x) && !['hero', 'self', 'chara'].includes(x),
    );
    expect(words.filter((x) => x !== 'disable' && !(x in example))).toEqual([]);
    for (const x of Object.values(example)) expect(() => body(x)).not.toThrow();
    expect(() => parseStageScript('on area(1, 1) { disable() }')).not.toThrow();
  });

  test('the function editor accepts the monster effect statement', () => {
    expect(scriptFunctionProblem([], 'vanishMonster(9)')).toBeNull();
    expect(
      scriptCompletions('vanishMonster(', { vars: [], lines: [], records: [{ row: 9, label: 'ボス' }] })?.options,
    ).toEqual([{ label: '9 ボス', apply: '9', type: 'constant' }]);
  });
});

describe('openDoor: opened as the game shows it (CRO 117 D01BossWin)', () => {
  const body = (src: string): ScriptNode[] => parseStageScript(`on button(1, 2) {\n${src}\n}`).events[0]!.body;
  test('openDoor is a library function: the camera, the sounds, the motion, the jingle and the camera back', () => {
    const ops = expandParts(body('openDoor(3)\nse(1)')).map((n) =>
      n.op === 'se'
        ? `se ${n.id}`
        : n.op === 'door'
          ? `door ${n.row}`
          : n.op === 'camera'
            ? `camera ${n.who ? 'door' : 'back'}`
            : n.op,
    );
    expect(ops).toEqual([
      'camera door',
      'wait',
      `se ${0x79}`,
      'wait',
      `se ${0x7a}`,
      'anim',
      'waitAnim',
      'door 3',
      'bgm',
      `se ${0x41}`,
      'wait',
      'bgm',
      'wait',
      'camera back',
      'se 1',
    ]);
    // its text, written in the script, does the same; the door can be written as chara(3)
    const lib = SCRIPT_LIBRARY.find((f) => f.name === 'openDoor')!;
    const inner = lib.source
      .slice(lib.source.indexOf('{') + 1, lib.source.lastIndexOf('}'))
      .replaceAll('door.', 'chara(3).');
    expect(body(inner)).toEqual(body('openDoor(3)'));
    expect(body('openDoor(chara(3))')).toEqual(body('openDoor(3)'));
  });
  test('a function of the script takes the place of the library one of the same name', () => {
    const s = parseStageScript('function openDoor(door: chara) {\n  door.open()\n}\non button(1, 2) { openDoor(3) }');
    expect(s.events[0]!.body).toEqual([{ op: 'doorMotion', row: 3 }]);
  });
  test('the parts: open() without camera or sound, jingle with its sound, the BGM', () => {
    expect(expandParts(body('chara(3).open()'))).toEqual([
      { op: 'anim', who: { kind: 'chara', row: 3 }, id: 0x73, type: 0 },
      { op: 'waitAnim', who: { kind: 'chara', row: 3 } },
      { op: 'door', row: 3, open: true },
    ]);
    expect(expandParts(body('jingle(0x50)')).map((n) => (n.op === 'se' ? n.id : n.op))).toEqual([
      'bgm',
      0x50,
      'wait',
      'bgm',
    ]);
    expect(body('jingle()')).toEqual([{ op: 'jingle', id: 0x41 }]);
    expect(body('bgmPause(0.3)\nbgmResume(1)')).toEqual([
      { op: 'bgm', pause: true, seconds: 0.3 },
      { op: 'bgm', pause: false, seconds: 1 },
    ]);
  });
  test('the methods of a character are the statements of the same name', () => {
    const same: [string, string][] = [
      ['hero.anim(0x79)', 'anim(hero, 0x79)'],
      ['chara(2).anim(5, 1)', 'anim(chara(2), 5, 1)'],
      ['self.waitAnim()', 'waitAnim(self)'],
      ['hero.move(1, 2.5, -3)', 'move(hero, 1, 2.5, -3)'],
      ['self.turn(90)', 'turn(self, 90)'],
      ['self.face(hero)', 'face(self, hero)'],
      ['chara(4).show()', 'show(chara(4))'],
      ['chara(4).hide()', 'hide(chara(4))'],
      ['chara(4).camera(1)', 'camera(chara(4), 1)'],
      ['hero.popup(2)', 'popup(hero, 2)'],
      ['hero.popupEnd()', 'popupEnd(hero)'],
      ['chara(3).close()', 'closeDoor(3)'],
      ['chara(3).remove()', 'remove(3)'],
      ['chara(3).vanishMonster()', 'vanishMonster(3)'],
    ];
    for (const [method, fn] of same) expect([method, body(method)]).toEqual([method, body(fn)]);
  });
  test('a method of an event needs chara(), a method is no value, and Script API calls stay', () => {
    expect(() => body('hero.open()')).toThrow('chara(イベント番号) にだけ');
    expect(() => body('self.remove()')).toThrow('chara(イベント番号) にだけ');
    expect(() => body('if (hero.anim(1)) {}')).toThrow('文として');
    expect(body('chara(3).StartAnimation(0x80000079, 0, 1, 0)')[0]!.op).toBe('call');
    expect(body('hero.SetVisible(0)')[0]!.op).toBe('call');
  });
  test('openDoorNow and closeDoor stay as they are', () => {
    const nodes = body('openDoorNow(3)\ncloseDoor(3)');
    expect(expandParts(nodes)).toEqual(nodes);
    expect(nodes).toEqual([
      { op: 'door', row: 3, open: true },
      { op: 'door', row: 3, open: false },
    ]);
  });
});

const body = (src: string): ScriptNode[] => parseStageScript(`on button(1, 2) {\n${src}\n}`).events[0]!.body;

describe('functions with parameters: written out where they are called', () => {
  test('a character and a number put in; a door written as its event number', () => {
    const s = parseStageScript(
      'function show_off(who: chara, motion: num) {\n  who.anim(motion)\n  waitAnim(who)\n}\n' +
        'on talk(1, 5) { show_off(self, 0x79); show_off(4, 2) }',
    );
    expect(s.functions[0]!.params).toEqual([
      { name: 'who', kind: 'chara' },
      { name: 'motion', kind: 'num' },
    ]);
    expect(s.functions[0]!.body).toEqual([]);
    expect(s.events[0]!.body).toEqual([
      { op: 'anim', who: { kind: 'self' }, id: 0x79, type: 0 },
      { op: 'waitAnim', who: { kind: 'self' } },
      { op: 'anim', who: { kind: 'chara', row: 4 }, id: 2, type: 0 },
      { op: 'waitAnim', who: { kind: 'chara', row: 4 } },
    ]);
  });
  test('a function without parameters can be called too, and a number goes into Script API calls and vec()', () => {
    const s = parseStageScript(
      'function at(x: num) { ScriptMap.SetPartyPosition(vec(x, 0, 30), 4, 1, 100) }\n' +
        'function both() { at(10); wait(1) }\non start(1) { both() }',
    );
    const [call, wait] = s.events[0]!.body;
    expect(call?.op === 'call' && call.call.args[0]).toEqual({ k: 'v', x: 10, y: 0, z: 30 });
    expect(wait).toEqual({ op: 'wait', seconds: 1 });
  });
  test('the mistakes', () => {
    const bad = (src: string): string => {
      try {
        parseStageScript(src);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(bad('function f(a: num) { f(a) }')).toContain('自分を');
    expect(bad('function f(a: num) { wait(a) }\non start(1) f')).toContain('イベントには割り当てられません');
    expect(bad('function wait() {}')).toContain('組み込みの文');
    expect(bad('function f(a: num) {}\non start(1) { f() }')).toContain('引数は 1 個');
    expect(bad('function f(a: thing) {}')).toContain('chara');
    expect(bad('function f(a: num, a: num) {}')).toContain('2 つ');
    // a number where a character is wanted, and the other way
    expect(bad('function f(a: num) { a.show() }')).not.toBe('');
    expect(bad('function f(a: chara) { wait(a) }')).toContain('数');
    // a mistake inside a library function is told at the call
    expect(bad('on start(1) {\n  wait(1)\n  openDoor(hero)\n}')).toMatch(/^3 行目: openDoor \(ライブラリ\) の中/u);
  });
  test('the document keeps the parameters; a function can call another of the script', () => {
    const doc: ScriptDoc = {
      vars: [],
      functions: [
        { name: 'helper', params: 'd: chara', body: 'd.show()' },
        { name: 'ev', body: 'helper(3)' },
      ],
      bindings: [{ trigger: 'talk', group: 1, row: 5, fn: 'ev' }],
    };
    expect(scriptDocFromSource(scriptDocSource(doc).text).functions).toEqual(doc.functions);
    expect(scriptOfDoc(doc).events[0]!.body).toEqual([{ op: 'show', who: { kind: 'chara', row: 3 }, on: true }]);
    expect(scriptFunctionProblem([], 'helper(3)', '', doc.functions, 'ev')).toBeNull();
    expect(scriptFunctionProblem([], 'd.show()', 'd: chara', doc.functions, 'helper')).toBeNull();
    expect(scriptFunctionProblem([], 'nothing(3)', '', doc.functions, 'ev')).not.toBeNull();
  });
  test('every library function reads when called', () => {
    const calls: Record<string, string> = {
      openDoor: 'openDoor(3)',
      cameraLook: 'cameraLook(3500, 254, 4738, 3500, 323, 2896, 1.5)',
      cameraNormal: 'cameraNormal(1.1)',
      partyLineUp: 'partyLineUp(3750, 4150, 4)',
      partyColumn: 'partyColumn(3750, 3030, 8)',
    };
    expect(SCRIPT_LIBRARY.map((f) => f.name).sort()).toEqual(Object.keys(calls).sort());
    for (const [name, text] of Object.entries(calls)) expect([name, body(text).length > 0]).toEqual([name, true]);
  });
});

describe('what the words do: the Script API under each, and the API descriptions', () => {
  test('every word of the help and every method names the calls under it', () => {
    const words = SCRIPT_WORDS.filter((x) => x.kind !== 'flow' && x.kind !== 'who' && /^[a-z]/u.test(x.word)).map(
      (x) => x.word,
    );
    expect(words.filter((x) => !SCRIPT_WORD_CALLS[x])).toEqual([]);
    expect(SCRIPT_METHOD_WORDS.map((x) => x.word).filter((x) => !SCRIPT_METHOD_CALLS[x])).toEqual([]);
  });
  test('every description is of a function of the table, and the hover shows it', () => {
    const syms = new Set(SCRIPT_API_ROWS.map((r) => r[2]));
    expect(Object.keys(SCRIPT_API_DOCS).filter((k) => !syms.has(k))).toEqual([]);
    expect(scriptHoverInfo('ScriptCamera.', 'MoveFieldCamera')!.about).toContain('フィールド');
    expect(scriptHoverInfo('', 'wait')!.about).toContain('中身: ScriptSystem::WaitTime');
    expect(scriptHoverInfo('', 'cameraLook')!.about).toContain('ライブラリ');
  });
});
