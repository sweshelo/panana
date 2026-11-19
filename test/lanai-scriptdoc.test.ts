// The editor's side of an RPG FREE! stage script (src/lanai/scriptDoc.ts): giving functions to rows, the words the
// help lists, and the samples. What the built code does is checked in lanai-custom-stages (3ds/research).
import { describe, expect, test } from 'bun:test';
import {
  emptyScriptDoc,
  expandDoors,
  type ScriptNode,
  parseStageScript,
  scriptDocFromSource,
  scriptOfDoc,
  type ScriptDoc,
} from '../src/lanai/eventScript';
import {
  docBound,
  docUnbound,
  rowBinding,
  SCRIPT_SAMPLES,
  scriptLineRefs,
  SCRIPT_WORDS,
  STAGE_SCRIPT_EXAMPLE,
  startBinding,
} from '../src/lanai/scriptDoc';
import { scriptCompletions, scriptFunctionProblem } from '../src/lanai/scriptAssist';

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
    expect(SCRIPT_SAMPLES.length).toBe(3);
    for (const s of SCRIPT_SAMPLES) {
      const d = scriptDocFromSource(s.source);
      expect(d.bindings).toEqual([]);
      expect(d.functions.length).toBe(s.give.length);
      for (const g of s.give) expect(d.functions.map((f) => f.name)).toContain(g.split(' ')[0]!);
    }
    const [door, , boss] = SCRIPT_SAMPLES.map((s) => scriptDocFromSource(s.source));
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
  test('each door: the camera, the unlocking sound, the opening sound and motion; after the run: the jingle and the camera back', () => {
    const ops = expandDoors(body('openDoor(3)\nopenDoor(4)\nse(1)')).map((n) =>
      n.op === 'se'
        ? `se ${n.id}`
        : n.op === 'door'
          ? `door ${n.row}`
          : n.op === 'camera'
            ? `camera ${n.who ? 'door' : 'back'}`
            : n.op,
    );
    const door = (r: number): string[] => [
      'camera door',
      'wait',
      `se ${0x79}`,
      'wait',
      `se ${0x7a}`,
      'anim',
      'waitAnim',
      `door ${r}`,
    ];
    expect(ops).toEqual([...door(3), ...door(4), 'bgm', `se ${0x41}`, 'wait', 'bgm', 'wait', 'camera back', 'se 1']);
  });
  test('openDoor is the same as its parts written out (the sample builds it from them)', () => {
    const parts = [
      'chara(3).camera(1)',
      'wait(0.5)',
      'se(0x79)',
      'wait(1.5)',
      'se(0x7A)',
      'chara(3).open()',
      'jingle()',
      'wait(0.3)',
      'cameraBack(1)',
    ].join('\n');
    expect(expandDoors(body(parts))).toEqual(expandDoors(body('openDoor(3)')));
    const sample = SCRIPT_SAMPLES.find((s) => s.source.includes('chara(3).open()'))!;
    const fn = parseStageScript(sample.source.replace('function open_door_custom()', 'on button(1, 2)')).events[0]!;
    expect(expandDoors(fn.body).slice(1, -1)).toEqual(expandDoors(body('openDoor(3)')));
  });
  test('the parts: open() without camera or sound, jingle with its sound, the BGM', () => {
    expect(expandDoors(body('chara(3).open()'))).toEqual([
      { op: 'anim', who: { kind: 'chara', row: 3 }, id: 0x73, type: 0 },
      { op: 'waitAnim', who: { kind: 'chara', row: 3 } },
      { op: 'door', row: 3, open: true },
    ]);
    expect(expandDoors(body('jingle(0x50)')).map((n) => (n.op === 'se' ? n.id : n.op))).toEqual([
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
    expect(expandDoors(nodes)).toEqual(nodes);
    expect(nodes.map((n) => n.op === 'door' && [n.open, !!n.show])).toEqual([
      [true, false],
      [false, false],
    ]);
  });
});
