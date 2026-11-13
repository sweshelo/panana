// The editor's side of an RPG FREE! stage script (src/lanai/scriptDoc.ts): giving functions to rows, the words the
// help lists, and the samples. What the built code does is checked in lanai-custom-stages (3ds/research).
import { describe, expect, test } from 'bun:test';
import {
  emptyScriptDoc,
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
  SCRIPT_WORDS,
  STAGE_SCRIPT_EXAMPLE,
  startBinding,
} from '../src/lanai/scriptDoc';

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
      closeDoor: 'closeDoor(1)',
      collision: 'collision(1, 0)',
      remove: 'remove(1)',
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
});
