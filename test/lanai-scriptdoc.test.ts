// The editor's side of an RPG FREE! stage script (src/lanai/scriptDoc.ts): giving functions to rows, the words the
// help lists, and the samples. What the built code does is checked in lanai-custom-stages (3ds/research).
import { describe, expect, test } from 'bun:test';
import {
  emptyScriptDoc,
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
  SCRIPT_SAMPLES,
  scriptLineRefs,
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
      { name: 'a', body: 'ScriptSystem.WaitTime(1)' },
      { name: 'b', body: 'ScriptSystem.WaitTime(2)' },
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
    expect(SCRIPT_SAMPLES.length).toBe(4);
    for (const s of SCRIPT_SAMPLES) {
      const d = scriptDocFromSource(s.source);
      expect(d.bindings).toEqual([]);
      expect(d.functions.length).toBe(s.give.length);
      for (const g of s.give) expect(d.functions.map((f) => f.name)).toContain(g.split(' ')[0]!);
    }
    const [door, boss, look, level] = SCRIPT_SAMPLES.map((s) => scriptDocFromSource(s.source));
    // the camera samples build for any event (no self)
    expect(scriptOfDoc(docBound(look!, { trigger: 'area', group: 1, row: 4, fn: 'look_at' })).events.length).toBe(1);
    expect(scriptOfDoc(docBound(level!, { trigger: 'area', group: 1, row: 4, fn: 'look_level' })).events.length).toBe(
      1,
    );
    expect(
      scriptOfDoc(docBound(door!, { trigger: 'button', group: 1, row: 7, fn: 'open_door' })).events[0]!.trigger,
    ).toBe('button');
    let b = docBound(boss!, { trigger: 'talk', group: 1, row: 9, fn: 'boss_talk' });
    b = docBound(b, { trigger: 'start', group: 1, row: 0, fn: 'after_battle' });
    const s = scriptOfDoc(b);
    expect(s.vars).toMatchObject([{ name: 'BOSS', kind: 'byte', reset: true }]);
    expect(s.events.map((e) => e.trigger)).toEqual(['talk', 'start']);
    // talk / self.SetPopup of the boss sample need an event that has an owner
    expect(() => scriptOfDoc(docBound(boss!, { trigger: 'area', group: 1, row: 9, fn: 'boss_talk' }))).toThrow('self');
    expect(parseStageScript(STAGE_SCRIPT_EXAMPLE).events.length).toBe(1);
  });

  test('the lines a text names: talk and the Script API messages, each once, comments left out', () => {
    expect(
      scriptLineRefs(
        'talk(0x80000060)\nif (ScriptMenu.SystemMessageYesNo( 99 )) { ScriptMenu.StartMessageAuto(0x80000060, 0, 0, 0.2); talk(0X1a) } // talk(5)\n/* talk(6) */ stalk(7)',
      ),
    ).toEqual([0x80000060, 99, 0x1a]);
    expect(scriptLineRefs('ScriptSystem.WaitTime(1)')).toEqual([]);
  });

  test('the words of the help: each word of the language reads', () => {
    const body = (text: string): unknown => parseStageScript(`var V: byte\non talk(1, 1) { ${text} }`);
    const example: Record<string, string> = {
      vanishEffect: 'vanishEffect(obj(2))',
      vec: 'ScriptMap.SetPartyPosition(vec(1, 0, -2 * 3), 4, 1, 100)',
      selfRow: 'ScriptMap.EnableEventCollision(selfRow, 0)',
      obj: 'obj(2).SetVisible(0)',
      hero: 'hero.SetVisible(0)',
      self: 'self.SetVisible(0)',
      return: 'return',
      if: 'if (V) {} else {}',
      switch: 'switch (V) { case 1: talk(1) default: talk(2) }',
    };
    const words = SCRIPT_WORDS.map((x) => x.word).filter((x) => /^[a-z]\w*$/iu.test(x));
    expect(words.filter((x) => !(x in example))).toEqual([]);
    for (const x of Object.values(example)) expect(() => body(x)).not.toThrow();
  });

  test('the function editor accepts the library vanish and offers the rows', () => {
    expect(scriptFunctionProblem([], 'vanish(9)')).toBeNull();
    expect(
      scriptCompletions('vanish(', { vars: [], lines: [], records: [{ row: 9, label: 'ボス' }] })?.options,
    ).toEqual([{ label: '9 ボス', apply: '9', type: 'constant' }]);
  });
});

const body = (src: string): ScriptNode[] => parseStageScript(`on button(1, 2) {\n${src}\n}`).events[0]!.body;
/** The Script API calls of a body, as `Class::Name(arguments)`. */
const calls = (nodes: ScriptNode[]): string[] =>
  nodes.map((n) =>
    n.op === 'call'
      ? `${n.call.name}(${n.call.args
          .filter((a) => a.k !== 'm')
          .map((a) =>
            a.k === 'i' || a.k === 'f'
              ? String(Math.round(a.v * 1e6) / 1e6)
              : a.k === 'c' || a.k === 'p'
                ? a.who.kind === 'chara'
                  ? `obj(${a.who.row})`
                  : a.who.kind
                : a.k === 'v'
                  ? `vec(${a.x}, ${a.y}, ${a.z})`
                  : a.k,
          )
          .join(
            ', ',
          )})${n.call.self ? ` on ${n.call.self.kind === 'chara' ? `obj(${n.call.self.row})` : n.call.self.kind}` : ''}`
      : n.op,
  );

describe('the language calls the Script API: no statements of its own but the flow and vanishEffect', () => {
  test('openDoor is a library function of Script API calls (CRO 117 D01BossWin)', () => {
    expect(calls(body('openDoor(3)'))).toEqual([
      'ScriptCamera::PauseCameraUpdater()',
      'ScriptCamera::MoveEyeAndTarget(obj(3), 1, vec(0, 0, 0), vec(0, 0, 0), 2)',
      'ScriptCamera::WaitAnimation()',
      'ScriptSystem::WaitTime(0.5)',
      `ScriptSound::Play(${0x79}, 0)`,
      'ScriptSystem::WaitTime(1.5)',
      `ScriptSound::Play(${0x7a}, 0)`,
      `ScriptChara::StartAnimation(${0x80000073}, 0, 1, 0) on obj(3)`,
      'ScriptChara::WaitAnimation(62) on obj(3)',
      'ScriptMap::SetDoorOpenFlag(3)',
      'ScriptSound::PauseBGM(0.3)',
      `ScriptSound::Play(${0x41}, 0)`,
      'ScriptSystem::WaitTime(1)',
      'ScriptSound::ReplayBGM(0.3)',
      'ScriptSystem::WaitTime(0.3)',
      'ScriptCamera::MoveFieldCamera(1, 2)',
      'ScriptCamera::WaitAnimation()',
      'ScriptCamera::ResumeCameraUpdater()',
    ]);
    // the door as obj(3), or the object before the dot
    expect(body('openDoor(obj(3))')).toEqual(body('openDoor(3)'));
    expect(body('obj(3).openDoor()')).toEqual(body('openDoor(3)'));
  });
  test('a function of the script takes the place of the library one of the same name', () => {
    const s = parseStageScript(
      'function openDoor(door: num) {\n  obj(door).open()\n}\non button(1, 2) { openDoor(3) }',
    );
    expect(calls(s.events[0]!.body)).toEqual([
      `ScriptChara::StartAnimation(${0x80000073}, 0, 1, 0) on obj(3)`,
      'ScriptChara::WaitAnimation(62) on obj(3)',
      'ScriptMap::SetDoorOpenFlag(3)',
    ]);
  });
  test('who.f(…) is f(who, …) for the functions whose first argument is an object or an event number', () => {
    const same: [string, string][] = [
      ['obj(3).open()', 'open(3)'],
      ['hero.move(1, 2.5, -3)', 'move(hero, 1, 2.5, -3)'],
      ['hero.walk(1, 2, 3)', 'walk(hero, 1, 2, 3)'],
      ['self.turn(90)', 'turn(self, 90)'],
      ['self.face(hero)', 'face(self, hero)'],
      ['obj(4).camera(1)', 'camera(obj(4), 1)'],
      ['obj(9).vanish()', 'vanish(9)'],
    ];
    for (const [method, fn] of same) expect([method, body(method)]).toEqual([method, body(fn)]);
    expect(() => body('hero.open()')).toThrow('obj(イベント番号).open');
    expect(() => body('hero.nothing()')).toThrow('関数「nothing」はありません');
    expect(() => body('hero.cameraBack()')).toThrow();
    expect(() => body('if (hero.move(1, 2, 3)) {}')).toThrow('値を返しません');
    expect(body('obj(3).StartAnimation(0x80000079, 0, 1, 0)')[0]!.op).toBe('call');
  });
  test('the words of the old language are gone', () => {
    for (const old of ['say(1)', 'wait(1)', 'se(1)', 'popup(hero, 1)', 'anim(hero, 1)', 'battle(1)', 'disable()'])
      expect(() => body(old)).toThrow('はありません');
    expect(() => body('chara(3).SetVisible(0)')).toThrow();
    expect(() => body('if (ask(1)) {}')).toThrow('値として使えません');
  });
  test('the hero calls the function of the party member first, others that of the character', () => {
    expect(calls(body('hero.StartAnimation(0x80000003, 0, 1, 0)'))[0]).toStartWith('ScriptPlayer::StartAnimation');
    expect(calls(body('obj(1).StartAnimation(0x80000003, 0, 1, 0)'))[0]).toStartWith('ScriptChara::StartAnimation');
    expect(calls(body('hero.MoveTo(vec(1, 2, 3), 0, 0, 0, 0, 0)'))[0]).toStartWith('ScriptChara::MoveTo');
  });
  test('arguments are worked out when the script is built', () => {
    expect(calls(body('ScriptSystem.WaitTime(1 + 2 * (3 - 1) / 4)'))).toEqual(['ScriptSystem::WaitTime(2)']);
    expect(calls(body('turn(hero, 90)'))[0]).toBe(
      `ScriptChara::RotateTo(${Math.round((Math.PI / 2) * 1e6) / 1e6}, 0.25, 0, 0, 0, 1) on hero`,
    );
    expect(calls(body('ScriptMap.SetPartyPosition(vec(-1, 0, 2 - 5), 4, 1, 100)'))[0]).toBe(
      'ScriptMap::SetPartyPosition(vec(-1, 0, -3), 4, 1, 100)',
    );
    // a whole number fits an integer parameter, one with a point a float
    expect(calls(body('ScriptSound.Play(0x7A, 0)'))).toEqual([`ScriptSound::Play(${0x7a}, 0)`]);
    expect(() => body('ScriptSystem.WaitTime(1 / 0)')).toThrow('0 では割れません');
    const s = parseStageScript('function at(x: num) { ScriptSystem.WaitTime(x * 2 + 0.5) }\non start(1) { at(3) }');
    expect(calls(s.events[0]!.body)).toEqual(['ScriptSystem::WaitTime(6.5)']);
  });
  test('selfRow: the own number of the event, given by the game', () => {
    const n = body('ScriptMap.EnableEventCollision(selfRow, 0)')[0]!;
    expect(n.op === 'call' && n.call.args[0]).toEqual({ k: 'own' });
    expect(() => parseStageScript('on start(1) { ScriptMap.EnableEventCollision(selfRow, 0) }')).toThrow('selfRow');
    expect(() => body('ScriptMap.EnableEventCollision(selfRow + 1, 0)')).toThrow('selfRow');
  });
  test('vanishEffect: the one statement of the language', () => {
    expect(body('vanishEffect(obj(9))')).toEqual([{ op: 'vanishEffect', who: { kind: 'chara', row: 9 } }]);
    expect(calls(body('vanish(9)'))).toEqual(['if']);
    const v = body('vanish(9)')[0]!;
    expect(v.op === 'if' && calls(v.then)).toEqual([
      'ScriptChara::CancelAutoAnimation() on obj(9)',
      `ScriptChara::StartAnimation(${0x80000066}, 0, 1, 0) on obj(9)`,
      'ScriptChara::SetBlendAnim(0) on obj(9)',
      'ScriptChara::WaitAnimation(62) on obj(9)',
      'ScriptChara::AlphaTo(0, 1, 2, 0, 0, 0) on obj(9)',
      `ScriptSound::Play(${0xb8}, 0)`,
      'vanishEffect',
      'ScriptChara::WaitNodeAnimation() on obj(9)',
      'ScriptMap::DeleteEventObject(9)',
    ]);
  });
});

describe('functions with parameters: written out where they are called', () => {
  test('an object and a number put in; an object written as its event number', () => {
    const s = parseStageScript(
      'function show_off(who: obj, motion: num) {\n  who.StartAnimation(motion, 0, 1, 0)\n  who.WaitAnimation(0x3E)\n}\n' +
        'on talk(1, 5) { show_off(self, 0x80000079); show_off(4, 0x80000002) }',
    );
    expect(s.functions[0]!.params).toEqual([
      { name: 'who', kind: 'obj' },
      { name: 'motion', kind: 'num' },
    ]);
    expect(s.functions[0]!.body).toEqual([]);
    expect(calls(s.events[0]!.body)).toEqual([
      `ScriptChara::StartAnimation(${0x80000079}, 0, 1, 0) on self`,
      'ScriptChara::WaitAnimation(62) on self',
      `ScriptChara::StartAnimation(${0x80000002}, 0, 1, 0) on obj(4)`,
      'ScriptChara::WaitAnimation(62) on obj(4)',
    ]);
  });
  test('a function without parameters can be called too, and a number goes into Script API calls and vec()', () => {
    const s = parseStageScript(
      'function at(x: num) { ScriptMap.SetPartyPosition(vec(x, 0, 30), 4, 1, 100) }\n' +
        'function both() { at(10); ScriptSystem.WaitTime(1) }\non start(1) { both() }',
    );
    const [call, wait] = s.events[0]!.body;
    expect(call?.op === 'call' && call.call.args[0]).toEqual({ k: 'v', x: 10, y: 0, z: 30 });
    expect(calls([wait!])).toEqual(['ScriptSystem::WaitTime(1)']);
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
    expect(bad('function f(a: num) { ScriptSystem.WaitTime(a) }\non start(1) f')).toContain(
      'イベントには割り当てられません',
    );
    expect(bad('function vanishEffect() {}')).toContain('組み込みの文');
    expect(bad('function f(a: num) {}\non start(1) { f() }')).toContain('引数は 1 個');
    expect(bad('function f(a: thing) {}')).toContain('obj');
    expect(bad('function f(a: num, a: num) {}')).toContain('2 つ');
    // a number where an object is wanted, and the other way
    expect(bad('function f(a: num) { a.SetVisible(0) }')).not.toBe('');
    expect(bad('function f(a: obj) { ScriptSystem.WaitTime(a) }')).toContain('数');
    expect(bad('on start(1) { openDoor(hero) }')).toContain('obj(イベント番号)');
    // a mistake inside a library function is told at the call
    expect(bad('on start(1) {\n  ScriptSystem.WaitTime(1)\n  jingle(1.5)\n}')).toMatch(
      /^3 行目: jingle \(ライブラリ\) の中/u,
    );
  });
  test('the document keeps the parameters; a function can call another of the script', () => {
    const doc: ScriptDoc = {
      vars: [],
      functions: [
        { name: 'helper', params: 'd: obj', body: 'd.SetVisible(1)' },
        { name: 'ev', body: 'helper(3)' },
      ],
      bindings: [{ trigger: 'talk', group: 1, row: 5, fn: 'ev' }],
    };
    expect(scriptDocFromSource(scriptDocSource(doc).text).functions).toEqual(doc.functions);
    expect(calls(scriptOfDoc(doc).events[0]!.body)).toEqual(['ScriptChara::SetVisible(1) on obj(3)']);
    expect(scriptFunctionProblem([], 'helper(3)', '', doc.functions, 'ev')).toBeNull();
    expect(scriptFunctionProblem([], 'd.SetVisible(1)', 'd: obj', doc.functions, 'helper')).toBeNull();
    expect(scriptFunctionProblem([], 'nothing(3)', '', doc.functions, 'ev')).not.toBeNull();
  });
  test('every library function reads when called', () => {
    const library: Record<string, string> = {
      talk: 'talk(0x80000010)',
      move: 'move(hero, 250, 0, 750)',
      walk: 'walk(hero, 250, 0, 750)',
      turn: 'turn(self, 90)',
      face: 'face(self, hero)',
      camera: 'camera(obj(4), 1.3)',
      cameraBack: 'cameraBack(1)',
      cameraLook: 'cameraLook(3500, 254, 4738, 3500, 323, 2896, 1.5)',
      open: 'open(3)',
      jingle: 'jingle(0x41)',
      openDoor: 'openDoor(3)',
      vanish: 'vanish(9)',
      partyLineUp: 'partyLineUp(3750, 4150, 4)',
      partyColumn: 'partyColumn(3750, 3030, 8)',
    };
    expect(SCRIPT_LIBRARY.map((f) => f.name).sort()).toEqual(Object.keys(library).sort());
    for (const [name, text] of Object.entries(library))
      expect([name, parseStageScript(`on talk(1, 2) { ${text} }`).events[0]!.body.length > 0]).toEqual([name, true]);
  });
});

describe('the API descriptions', () => {
  test('every description is of a function of the table, and the hover shows it', () => {
    const syms = new Set(SCRIPT_API_ROWS.map((r) => r[2]));
    expect(Object.keys(SCRIPT_API_DOCS).filter((k) => !syms.has(k))).toEqual([]);
    expect(scriptHoverInfo('ScriptCamera.', 'MoveFieldCamera')!.about).toContain('フィールド');
    expect(scriptHoverInfo('', 'vanishEffect')!.about).toContain('エフェクト');
    expect(scriptHoverInfo('', 'cameraLook')!.about).toContain('ライブラリ');
    expect(scriptHoverInfo('obj(3).', 'open')!.about).toContain('扉');
  });
});
