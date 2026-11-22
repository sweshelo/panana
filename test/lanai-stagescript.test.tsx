// The event script of an added RPG FREE! stage (src/lanai/eventScript.ts, stageScript.ts): reading the script, and with
// the ROM, building it into the stage's CRO in the MOD. What the built code does when it runs is checked on an ARM
// machine in lanai-custom-stages (3ds/research/stage-script.test.ts).
import { describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { renderToString } from 'react-dom/server';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { LANAI_ACTION_NONE, LANAI_ACTION_SCRIPT } from '../src/lanai/actions';
import { croHooks, lanaiContents } from '../src/lanai/contents';
import { parseCro } from '../src/lanai/cro';
import { assembleLine } from '../src/game/asm';
import {
  compileStageScript,
  CRO_TEXT,
  docWithCode,
  mergeScriptCode,
  parseStageScript,
  scriptDocCode,
  ScriptDocError,
  scriptDocFromSource,
  scriptDocSource,
  SCRIPT_API,
  type ScriptArg,
  type ScriptNode,
  ScriptError,
  SLOT_AREA,
  SLOT_LEAVE,
  SLOT_TALK,
  STAGE_BIT_FLAGS,
  STAGE_BYTE_FLAGS,
} from '../src/lanai/eventScript';
import { sha256 } from '../src/lanai/codes';
import { lanaiMaps } from '../src/lanai/maps';
import { crsExports } from '../src/lanai/scriptApi';
import { lanaiPopupIcon, POPUP_ICONS, POPUP_TABLE } from '../src/lanai/popupIcons';
import { LanaiSession } from '../src/lanai/session';
import { cloneLanaiContent, contentScript, lanaiCrrName, LANAI_EMPTY_SCRIPT_CONTENT } from '../src/lanai/stageEdit';
import { checkStageScript, eventRecords, LANAI_STAGE_MANIFEST, recordTrigger } from '../src/lanai/stageScript';
import { LanaiStageScriptEditor, STAGE_SCRIPT_EXAMPLE } from '../src/lanai/StageScriptEditor';
import { LanaiStageSourcePage } from '../src/lanai/StageSourcePage';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const B0 = STAGE_BYTE_FLAGS.first,
  T0 = STAGE_BIT_FLAGS.first;

describe('RPG FREE! stage script: the editor text', () => {
  const doc = scriptDocFromSource(
    'var A: byte\nfunction a() {\n  A = 1\n}\nfunction b() {\n  A = 2\n}\non talk(1, 5) a\non start(1) b\non intro(1) {}\n',
  );
  test('the text has the variables and functions, not what they are given to', () => {
    expect(scriptDocCode(doc)).toBe('var A: byte\nfunction a() {\n  A = 1\n}\nfunction b() {\n  A = 2\n}\n');
    expect(scriptDocCode(undefined)).toBe('');
  });
  test('saving the text keeps what the functions are given to; a renamed function loses it', () => {
    const kept = docWithCode(doc, 'var A: byte\nfunction a() { A = 3 }\nfunction b() {}');
    expect(kept.dropped).toEqual([]);
    expect(kept.doc.bindings).toEqual(doc.bindings);
    expect(kept.doc.functions[0]!.body).toBe('A = 3');
    const renamed = docWithCode(doc, 'var A: byte\nfunction a() {}\nfunction c() {}');
    expect(renamed.dropped).toEqual([{ trigger: 'start', group: 1, row: 0, fn: 'b' }]);
    // the game's opening alone names no function and stays
    expect(renamed.doc.bindings.map((b) => b.fn)).toEqual(['a', '']);
    expect(docWithCode(doc, 'function a(n: num) {}\nfunction b() {}').dropped.map((b) => b.fn)).toEqual(['a']);
  });
  test('the text cannot give a function to an event', () => {
    expect(() => docWithCode(doc, 'function a() {}\non talk(1, 5) a')).toThrow(ScriptDocError);
  });
  test('a change made elsewhere comes into the functions the text left as they were', () => {
    const base = scriptDocCode(doc);
    const mine = base.replace('A = 2', 'A = 9');
    const theirs = base.replace('A = 1', 'A = 7');
    const m = mergeScriptCode(base, mine, theirs);
    expect(m).toMatchObject({ conflicts: [], readable: true });
    expect(m.text).toContain('A = 7');
    expect(m.text).toContain('A = 9');
    const both = mergeScriptCode(base, base.replace('A = 1', 'A = 5'), theirs);
    expect(both.conflicts).toEqual(['関数 a']);
    expect(both.text).toContain('A = 5');
    const broken = mergeScriptCode(base, 'function a( {', theirs);
    expect(broken).toEqual({ text: 'function a( {', conflicts: [], readable: false });
  });
});

describe('RPG FREE! stage script: reading', () => {
  test('full source indents function bodies and preserves nested indentation after editing', () => {
    const source = `function scene() {\n  if (ScriptFlag.GetScriptState(1) == 0) {\n    talk(0x80000060)\n  }\n}\non talk(1, 5) scene\n`;
    const doc = scriptDocFromSource(source);
    expect(doc.functions[0]!.body).toBe('if (ScriptFlag.GetScriptState(1) == 0) {\n  talk(0x80000060)\n}');
    expect(scriptDocSource(doc).text).toBe(source);
  });
  test('the example of the editor reads: a variable, an event of a character, its calls', () => {
    const s = parseStageScript(STAGE_SCRIPT_EXAMPLE);
    expect(s.vars).toEqual([{ name: 'STATE_A', kind: 'byte', reset: false, flag: B0 }]);
    expect(s.events.length).toBe(1);
    const e = s.events[0]!;
    expect([e.trigger, e.group, e.row]).toEqual(['talk', 1, 5]);
    expect(e.body.map((n) => n.op)).toEqual(['switch', 'if']);
    const sw = e.body[0]!;
    if (sw.op !== 'switch') throw new Error('switch');
    // talk (the library's) is three calls: the mouth, the line, the mouth
    expect(sw.cases.map((c) => [c.value, c.body.map((n) => n.op)])).toEqual([
      [0, ['call', 'call', 'call']],
      [1, ['call', 'call', 'call']],
      [2, ['call', 'call', 'call', 'return']],
    ]);
    const cond = e.body[1]!;
    if (cond.op !== 'if') throw new Error('if');
    expect(cond.cond).toMatchObject({ value: { kind: 'call', call: { name: 'ScriptMenu::SystemMessageYesNo' } } });
    expect(cond.then.map((n) => (n.op === 'call' ? n.call.name : n.op))).toEqual([
      'ScriptChara::SetPopup',
      'ScriptSound::Play',
      'ScriptChara::StartAnimation',
      'ScriptMenu::StartMessage',
      'ScriptChara::StartAnimation',
      'set',
    ]);
    expect(cond.else[0]).toEqual({ op: 'set', name: 'STATE_A', value: 1 });
  });

  test('variables take flag numbers in the order they are declared; reset marks those of one visit', () => {
    const s = parseStageScript('var A: byte\nvar B: bit reset\nvar C: byte reset');
    expect(s.vars.map((v) => [v.name, v.flag, v.reset])).toEqual([
      ['A', B0, false],
      ['B', T0, true],
      ['C', B0 + 1, true],
    ]);
  });

  test('assignments read when the event runs: a = a + 1, a += 1, a++, b = !c', () => {
    const s = parseStageScript(`
      var N: byte
      var M: byte
      var B: bit
      var C: bit
      on area(1, 1) { N = N + 1; N += 3; N++; N = M * 2 - 1; N -= M; N--; N = M; N = 7; B = C; B = !C; B = true }`);
    const N = { k: 'var', name: 'N' } as const,
      M = { k: 'var', name: 'M' } as const,
      C = { k: 'var', name: 'C' } as const;
    const one = { k: 'n', v: 1 } as const;
    expect(s.events[0]!.body).toEqual([
      { op: 'set', name: 'N', expr: { k: '+', l: N, r: one } },
      { op: 'set', name: 'N', expr: { k: '+', l: N, r: { k: 'n', v: 3 } } },
      { op: 'set', name: 'N', expr: { k: '+', l: N, r: one } },
      { op: 'set', name: 'N', expr: { k: '-', l: { k: '*', l: M, r: { k: 'n', v: 2 } }, r: one } },
      { op: 'set', name: 'N', expr: { k: '-', l: N, r: M } },
      { op: 'set', name: 'N', expr: { k: '-', l: N, r: one } },
      { op: 'set', name: 'N', expr: M },
      { op: 'set', name: 'N', value: 7 },
      { op: 'set', name: 'B', expr: C },
      { op: 'set', name: 'B', expr: { k: 'not', e: C } },
      { op: 'set', name: 'B', value: 1 },
    ]);
    const err = (src: string): string => {
      try {
        parseStageScript(src);
      } catch (e) {
        return (e as ScriptError).message;
      }
      return '';
    };
    const vars = 'var N: byte\nvar B: bit\n';
    expect(err(`${vars}on area(1, 1) { N = 256 }`)).toContain('0〜255');
    expect(err(`${vars}on area(1, 1) { X++ }`)).toContain('変数「X」はありません');
    expect(err(`${vars}on area(1, 1) { N = X + 1 }`)).toContain('数・変数・位置 (vec) で書きます');
    // a bit is true / false: not a number
    expect(err(`${vars}on area(1, 1) { B++ }`)).toContain('B = !B');
    expect(err(`${vars}on area(1, 1) { N = B }`)).toContain('true / false');
    expect(err(`${vars}on area(1, 1) { N = N + B }`)).toContain('計算には使えません');
    expect(err(`${vars}on area(1, 1) { B = N }`)).toContain('bit には true / false か');
  });

  test('a byte variable is a number of a Script API call, a bit one is a bool', () => {
    const s = parseStageScript(`
      var X: byte
      var B: bit
      function face(d: num) { obj(26).RotateTo(d * 90 * 3.14159265 / 180, 0.5, 0, 0, 0, 1) }
      on area(1, 1) {
        obj(26).RotateTo(X * 90 * 3.14159265 / 180, 0.5, 0, 0, 0, 1)
        face(X + 1)
        ScriptSound.Play(0x70 + X, 0)
        hero.SetVisible(B)
      }`);
    const [rotate, viaFn, play, visible] = s.events[0]!.body;
    const args = (n: ScriptNode | undefined): ScriptArg[] => (n?.op === 'call' ? n.call.args : []);
    expect(args(rotate)[0]).toMatchObject({ k: 'x', as: 'f' });
    expect(args(viaFn)[0]).toMatchObject({ k: 'x', as: 'f' });
    expect(args(play)[0]).toEqual({
      k: 'x',
      as: 'i',
      e: { k: '+', l: { k: 'n', v: 0x70 }, r: { k: 'var', name: 'X' } },
    });
    expect(args(visible)[0]).toEqual({ k: 'x', as: 'b', e: { k: 'var', name: 'B' } });
    const err = (body: string): string => {
      try {
        parseStageScript(`var X: byte\nvar B: bit\non area(1, 1) { ${body} }`);
      } catch (e) {
        return (e as ScriptError).message;
      }
      return '';
    };
    // a bit only where a bool is taken; a variable not where the number is needed when the script is built
    expect(err('ScriptSound.Play(B, 0)')).toContain('bool の引数にだけ');
    expect(err('obj(X).SetVisible(1)')).toContain('変数を使えません');
    // a position of variables is worked out when the event runs (a vec of numbers is laid when the script is built)
    expect(err('obj(3).SetPos(vec(X, 0, 0))')).toBe('');
  });

  test('conditions: variables and the values of Script API calls', () => {
    const s = parseStageScript(`
      var N: byte
      var B: bit
      on area(2, 0x10) {
        if (!B) { B = true } else if (N >= 3) { N = 0 } else { ScriptMenu.StartMessageAuto(0x80000007, 0, 0, 0.2) }
        if (ScriptFlag.GetItemNum(0x800000C9, 1) < 2) { ScriptMenu.ItemGet(0x800000C9, 1, 1); ScriptFlag.AddGold(-30) }
      }`);
    const [a, b] = s.events[0]!.body;
    if (a?.op !== 'if' || b?.op !== 'if') throw new Error('if');
    expect(a.cond).toEqual({ value: { kind: 'var', name: 'B' }, cmp: '==', than: 0 });
    expect(a.then).toEqual([{ op: 'set', name: 'B', value: 1 }]);
    expect(a.else[0]).toMatchObject({ op: 'if', cond: { cmp: '>=', than: 3 } });
    expect(b.cond).toMatchObject({
      value: { kind: 'call', call: { name: 'ScriptFlag::GetItemNum' } },
      cmp: '<',
      than: 2,
    });
    expect(b.then.map((n) => n.op === 'call' && n.call.args.filter((x) => x.k !== 'm'))).toEqual([
      [
        { k: 'i', v: 0x800000c9 },
        { k: 'i', v: 1 },
        { k: 'i', v: 1 },
      ],
      [{ k: 'i', v: -30 }],
    ]);
  });

  test('and binds before or, parentheses override it, and missing operands fail', () => {
    const script = parseStageScript(`
      var A: bit
      var B: bit
      var C: bit
      on start(1) {
        if (A || B && C) { ScriptSystem.WaitTime(1) }
        if ((A || B) && !C) { ScriptSystem.WaitTime(2) }
      }`);
    const [first, second] = script.events[0]!.body;
    if (first?.op !== 'if' || second?.op !== 'if') throw new Error('if');
    const leaf = (name: string, cmp: '==' | '!=') => ({ value: { kind: 'var' as const, name }, cmp, than: 0 });
    expect(first.cond).toEqual({
      op: 'or',
      left: leaf('A', '!='),
      right: { op: 'and', left: leaf('B', '!='), right: leaf('C', '!=') },
    });
    expect(second.cond).toEqual({
      op: 'and',
      left: { op: 'or', left: leaf('A', '!='), right: leaf('B', '!=') },
      right: leaf('C', '=='),
    });
    expect(() => parseStageScript('var A: bit; on start(1) { if (A &&) {} }')).toThrow();
  });

  test('a defeated map monster has its own effect statement', () => {
    const event = parseStageScript(
      'on start(1) { if (ScriptMap.GetMonsterLimitCount() == 0) { vanishEffect(obj(9)) } }',
    ).events[0]!;
    const branch = event.body[0]!;
    if (branch.op !== 'if') throw new Error('if');
    expect(branch.then).toEqual([{ op: 'vanishEffect', who: { kind: 'chara', row: 9 } }]);
    expect(() => parseStageScript('on start(1) { vanishEffect(obj(-1)) }')).toThrow();
  });

  test('a mistake is told with its line', () => {
    const err = (src: string): string => {
      try {
        parseStageScript(src);
      } catch (e) {
        expect(e).toBeInstanceOf(ScriptError);
        return (e as Error).message;
      }
      return '';
    };
    expect(err('var A: byte\non talk(1, 5) {\n  X = 1\n}')).toBe('3 行目: 変数「X」はありません');
    expect(err('on start(1) { ScriptMap.EnableEventCollision(selfRow, 0) }')).toContain('selfRow');
    expect(err('on area(1, 1) { self.SetVisible(0) }')).toContain('obj(イベント番号) で指してください');
    expect(err('on talk(1, 5) { break }')).toContain('switch と for の中でだけ');
    expect(err('var A: bit\non area(1, 1) { A = 2 }')).toContain('true / false');
    expect(err('on talk(1, 5) {}\non area(1, 5) {}')).toContain('もうイベントが割り当てられています');
    expect(err('on talk(1, 5) { talk(1)')).toContain('「}」が足りません');
    expect(err('on talk(1, 5) { fight(1) }')).toContain('関数「fight」はありません');
    expect(err('on talk(1, 5) { fight }')).toContain('「fight」という文はありません');
    expect(err('on talk(1, 5) { talk(1) } @')).toContain('使えない文字');
  });

  test('the result of an API function: an integer is compared as a byte, a float as a float, void is not a value', () => {
    // read from the game's code (scriptApiTable.ts; lanai-custom-stages 3ds/research/script-returns.md)
    const body = (cond: string): string => `on talk(1, 5) { if (${cond}) { ScriptSystem.WaitTime(1) } }`;
    expect(() => parseStageScript(body('ScriptCamera.IsAnimation() == 1'))).not.toThrow();
    expect(() => parseStageScript(body('ScriptMap.GetCurrentMapGroupID() == 1'))).not.toThrow();
    expect(() => parseStageScript(body('ScriptMap.ChangeMap(1, 2) == 1'))).toThrow('void');
    expect(() => parseStageScript(body('ScriptCamera.GetTargetDistance() == 1'))).not.toThrow();
    const far = parseStageScript(body('ScriptCamera.GetTargetDistance() > 1')).events[0]!.body[0]!;
    expect(far.op === 'if' && 'l' in far.cond).toBe(true);
    expect(() => parseStageScript(body('ScriptCamera.GetTargetDistance()'))).toThrow('比べて');
    // as statements they are called as before
    expect(() => parseStageScript('on talk(1, 5) { ScriptMap.ChangeMap(1, 2) }')).not.toThrow();
  });
});

describe.skipIf(!hasLanai)('RPG FREE! stage script: into the MOD (ROM)', () => {
  const open = async (): Promise<LanaiSession> =>
    LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name),
      { fresh: true },
    );
  // content 28: EventObject row 5 of MapGroup 1 is a character whose first action is a script
  const SCRIPT = `
    var STATE: byte
    var SEEN: bit reset
    on talk(1, 5) {
      if (STATE == 0) { talk(0x80000001); STATE = 1 } else { talk(0x80000002) }
      SEEN = 1
    }
    on start(1) { vanish(5) }`;

  test('compound conditions compile into the stage CRO', async () => {
    const s = await open();
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const script = parseStageScript(
      'var A: bit; var B: bit; on start(1) { if (A || (B && ScriptFlag.GetItemNum(0x80000001, 1) >= 1)) { ScriptSystem.WaitTime(1) } }',
    );
    const built = compileStageScript(base, script).cro.segments[CRO_TEXT]!.bytes!;
    expect(built.length).toBeGreaterThan(base.segments[CRO_TEXT]!.bytes!.length);
  });

  test('expressions of variables: read when the event runs, worked out and passed', async () => {
    const s = await open();
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const words = (src: string): number[] => {
      const intro = { map: 1, flag: STAGE_BIT_FLAGS.first, gate: null };
      const t = compileStageScript(base, parseStageScript(src), [], { 1: intro }).cro.segments[CRO_TEXT]!.bytes!;
      const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
      return Array.from({ length: t.length >> 2 }, (_, k) => v.getUint32(4 * k, true));
    };
    const has = (src: string, ...lines: string[]): boolean => {
      const w = words(src);
      return lines.every((l) => w.includes(assembleLine(l, 0).words[0]!));
    };
    const vars = 'var N: byte\nvar B: bit\nvar C: bit\n';
    // the frame grows by the scratch; the variable is kept at its first word (0xB0)
    expect(has(`${vars}on start(1) { N++ }`, 'sub sp, sp, #0x1f0', 'str r0, [sp, #0xb0]', 'add r0, r0, r1')).toBe(true);
    expect(has(`${vars}on start(1) { N++ }`, 'and r0, r0, #0xff')).toBe(true);
    expect(words(`${vars}on start(1) { N++ }`)).toEqual(words(`${vars}on start(1) { N = N + 1 }`));
    expect(words(`${vars}on start(1) { N += 1 }`)).toEqual(words(`${vars}on start(1) { N = N + 1 }`));
    expect(has(`${vars}on start(1) { N = N * 3 }`, 'mul r0, r0, r1')).toBe(true);
    expect(has(`${vars}on start(1) { B = !C }`, 'moveq r0, #1', 'movne r0, #0')).toBe(true);
    // a float argument: worked out in s0, kept in the scratch's first word (the variable it reads above it), then
    // passed in s0
    const rotate = `${vars}on area(1, 1) { obj(26).RotateTo(N * 90 * 3.14159265 / 180, 0.5, 0, 0, 0, 1) }`;
    expect(has(rotate, 'vcvt.f32.s32 s0, s0', 'vmul.f32 s0, s0, s1', 'vdiv.f32 s0, s0, s1')).toBe(true);
    expect(has(rotate, 'str r0, [sp, #0xb4]', 'vstr s0, [sp, #0xb0]', 'vldr s0, [sp, #0xb0]')).toBe(true);
    // an integer argument through r0
    expect(has(`${vars}on start(1) { ScriptSound.Play(0x70 + N, 0) }`, 'ldr r0, [sp, #0xb0]')).toBe(true);
    // the intro's frame keeps the party: the slots go above it
    expect(has('var N: byte\non intro(1) { N++ }', 'str r0, [sp, #0x348]')).toBe(true);
  });

  test('locals and positions: let, GetPos, vec sums, .x, results in expressions, float comparisons', async () => {
    const s = await open();
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const build = (src: string) => {
      const intro = { map: 1, flag: STAGE_BIT_FLAGS.first, gate: null };
      return compileStageScript(base, parseStageScript(src), [], { 1: intro });
    };
    const words = (src: string): number[] => {
      const t = build(src).cro.segments[CRO_TEXT]!.bytes!;
      const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
      return Array.from({ length: t.length >> 2 }, (_, k) => v.getUint32(4 * k, true));
    };
    const has = (src: string, ...lines: string[]): boolean => {
      const w = words(src);
      return lines.every((l) => w.includes(assembleLine(l, 0).words[0]!));
    };
    const imports = (src: string): string[] => build(src).cro.namedImports.map((x) => x.name);
    // CRO 108 D01001F01Static001: face the hero (VECSubtract → GetDirectionRotY → GetRotateTime → RotateTo)
    const look = `on area(1, 1) {
  let p = obj(2).GetPos()
  let a = ScriptMath.GetDirectionRotY(hero.GetPos() - p)
  obj(2).RotateTo(a, ScriptMath.GetRotateTime(obj(2).GetRotateY(), a, 0.5), 0, 0, 0, 1)
}`;
    expect(imports(look)).toEqual(
      expect.arrayContaining([
        '_ZNK11ScriptChara6GetPosEv',
        '_ZN10ScriptMath16GetDirectionRotYERK5GSvec',
        '_ZN10ScriptMath13GetRotateTimeEfff',
        '_ZN11ScriptChara10GetRotateYEv',
      ]),
    );
    // locals sit above the frame (p at 0xB0, a at 0xC0), GetPos's x, y, z copied from the pointer it returns
    expect(has(look, 'vldr s0, [r0]', 'vldr s1, [r0, #4]', 'vldr s2, [r0, #8]', 'vstr s0, [sp, #0xc0]')).toBe(true);
    expect(has(look, 'vsub.f32 s0, s0, s3', 'vsub.f32 s2, s2, s5')).toBe(true);
    // a float comparison: vcmp, the flags moved, the branch of the opposite
    const near =
      'var N: byte\non area(1, 1) { let d = hero.GetPos() - obj(2).GetPos()\n if (d.x * d.x + d.z * d.z < 90000) { N = 1 } }';
    expect(has(near, 'vcmp.f32 s0, s1', 'vmrs APSR_nzcv, fpscr', 'vmul.f32 s0, s0, s1')).toBe(true);
    // a byte variable compared with a number stays an integer comparison (as before)
    expect(words('var N: byte\non start(1) { if (N > 2) { N = 0 } }')).not.toContain(
      assembleLine('vmrs APSR_nzcv, fpscr', 0).words[0]!,
    );
    // a local counted, a position moved, one times a number
    expect(() =>
      build(
        'on area(1, 1) { let t = 0\n t++\n t += 2 * t\n let q = obj(2).GetPos() + vec(0, 100, t)\n q -= vec(1, 0, 0)\n obj(3).SetPos(q * 0.5) }',
      ),
    ).not.toThrow();
    // the intro's locals go above its frame (0x348): beyond vldr's reach from sp (0x3FC) they are reached through ip
    const many = Array.from({ length: 12 }, (_, k) => `let p${k} = hero.GetPos()`).join('\n');
    const intro = `on intro(1) {\n${many}\n hero.SetPos(p11) }`;
    expect(has(intro, 'str r0, [sp, #0x348]')).toBe(false);
    expect(has(intro, 'add ip, sp, ip')).toBe(true);
    // what the language refuses
    const err = (src: string): string => {
      try {
        parseStageScript(src);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(err('on area(1, 1) { let a = 1\n let a = 2 }')).toContain('2 つあります');
    expect(err('on area(1, 1) { if (hero.GetRotateY()) {} }')).toContain('比べて');
    expect(err('on area(1, 1) { let p = hero.GetPos() * hero.GetPos() }')).toContain('位置');
    expect(err('on area(1, 1) { let p = ScriptMap.SetDoorOpenFlag(1) }')).toContain('値を返しません');
    // the party walked as the CROs do (GetPlayerNum each time, GetPlayer(i) as a ScriptPlayer); break leaves it
    const party =
      'on area(1, 1) { for p in party { p.StartAnimation(0x80000001, 0, 1, 0)\n p.SetVisible(0)\n break } }';
    expect(imports(party)).toEqual(
      expect.arrayContaining([
        '_ZN9ScriptMap12GetPlayerNumEv',
        '_ZN9ScriptMap9GetPlayerEi',
        '_ZN12ScriptPlayerC1EP9ChrObject',
      ]),
    );
    expect(has(party, 'cmp r1, r0', 'str r5, [sp, #0xb0]', 'add r0, r0, #1')).toBe(true);
    expect(() => build('on area(1, 1) { for p in party { p.walk(250, 0, 750)\n turn(p, 90) } }')).not.toThrow();
    expect(err('on area(1, 1) { for p in hero {} }')).toContain('party');
    expect(err('on area(1, 1) { break }')).toContain('for');
    // the talk event's own object
    expect(imports('on talk(1, 5) { event.TurnNpcRecover()\n event.ZoomHeroCamera() }')).toEqual(
      expect.arrayContaining(['_ZN13NpcCommonTurn14TurnNpcRecoverEv', '_ZN9NpcCommon14ZoomHeroCameraEv']),
    );
    expect(err('on area(1, 1) { event.TurnNpcRecover() }')).toContain('話しかけた');
    expect(err('on talk(1, 5) { event.Nothing() }')).toContain('TurnNpcRecover');
    // ScriptMonsterCtrl: the monster's size and level from its object
    expect(err('var N: byte\non area(1, 1) { N = ScriptMonsterCtrl.GetMonsterSize(obj(9)) }')).toBe('');
    // a function's locals are its own
    expect(err('function f() { let a = 1 }\non area(1, 1) { f()\n ScriptSystem.WaitTime(a) }')).not.toBe('');
  });

  test("an intro with a gate closes the gate's door again when its flag is set (D01Intro's CtrlFlag)", async () => {
    const s = await open();
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const imports = (door: number): string[] => {
      const intro = { map: 1, flag: STAGE_BIT_FLAGS.first, gate: { x: 5, z: 11, dir: 4 as const, door } };
      const cro = compileStageScript(base, parseStageScript('on intro(1) {}'), [], { 1: intro }).cro;
      return cro.namedImports.map((x) => x.name);
    };
    expect(imports(1)).toContain(SCRIPT_API.doorClose);
    expect(imports(0)).not.toContain(SCRIPT_API.doorClose);
  });

  test('a library function builds the same code as its text written out in the script', async () => {
    const s = await open();
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const text = (body: string): Uint8Array =>
      compileStageScript(base, parseStageScript(`on button(1, 2) { ${body} }`)).cro.segments[CRO_TEXT]!.bytes!;
    const parts =
      'camera(obj(3), 1); ScriptSystem.WaitTime(0.5); ScriptSound.Play(0x79, 0); ScriptSystem.WaitTime(1.5); ScriptSound.Play(0x7A, 0); obj(3).open(); jingle(0x41); ScriptSystem.WaitTime(0.3); cameraBack(1)';
    expect(text(parts)).toEqual(text('openDoor(3)'));
    // without the jingle the code is shorter
    expect(text('ScriptSound.Play(0x50, 0); obj(3).open()').length).toBeLessThan(text('openDoor(3)').length);
    // the library's camera, party and monster functions build
    for (const call of [
      'cameraLook(3500, 254, 4738, 3500, 323, 2896, 1.5); cameraBack(1.1)',
      'partyLineUp(3750, 4150, 4); ScriptMap.SetUpdateFormation(1)',
      'partyColumn(3750, 3030, 8); ScriptMap.SetUpdateFormation(1)',
      'walk(hero, 250, 0, 750); turn(hero, 90); face(hero, obj(3))',
      'vanish(9)',
    ])
      expect(text(call).length).toBeGreaterThan(text('').length);
  });

  test('the calls made as the game makes them: the popup kept, the camera held once, the window of a line', async () => {
    const s = await open();
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    /** How many words of the built code (the template's and the script's) are the instruction `line`. */
    const count = (src: string, line: string): number => {
      const text = compileStageScript(base, parseStageScript(src)).cro.segments[CRO_TEXT]!.bytes!;
      const v = new DataView(text.buffer, text.byteOffset, text.byteLength);
      const w = assembleLine(line, 0).words[0]!;
      return Array.from({ length: text.length >> 2 }, (_, k) => v.getUint32(4 * k, true)).filter((x) => x === w).length;
    };
    // ~ScriptChara takes the icon down unless its +0xB (the kind it showed) is 0xFF: the stack object's is set so
    const forget = 'strb r0, [sp, #0x2b]';
    const popup = '.SetPopup(2, 6, 1, 1, 0, vec(0, 0, 0))';
    expect(count(`on area(1, 1) { obj(5)${popup} }`, forget)).toBe(count('on area(1, 1) {}', forget) + 1);
    // the NPC's own ScriptChara (self) lives as long as the event, as the ROM's do
    expect(count(`on talk(1, 5) { self${popup} }`, forget)).toBe(count('on talk(1, 5) {}', forget));
    // the camera is paused once an event (r8), however many times the script asks
    const held = 'mov r8, #1';
    expect(count('on area(1, 1) { camera(obj(3), 1); camera(hero, 1) }', held)).toBe(
      count('on area(1, 1) {}', held) + 2,
    );
    expect(count('on area(1, 1) { cameraBack(1) }', 'mov r8, #0')).toBe(count('on area(1, 1) {}', 'mov r8, #0') + 1);
    // the window of a line: StartMessageAuto's AppDialogType (r3)
    for (const [arg, line] of [
      [2, 'mov r3, #2'],
      [1, 'mov r3, #1'],
    ] as const)
      expect(count(`on area(1, 1) { ScriptMenu.StartMessageAuto(0x80000001, ${arg}, 0, 0.2) }`, line)).toBe(
        count('on area(1, 1) { ScriptMenu.StartMessageAuto(0x80000001, 0, 0, 0.2) }', line) + 1,
      );
  });

  test('the icons of SetPopup are the 13 entries code.bin names (kind 2 of the popup object), each a BCH', async () => {
    const s = await open();
    const code = s.dump.code;
    expect(POPUP_ICONS.map((p) => p.hash)).toEqual(
      POPUP_ICONS.map((_, k) =>
        new DataView(code.buffer, code.byteOffset).getUint32(POPUP_TABLE - 0x100000 + 4 * k, true),
      ),
    );
    for (const p of POPUP_ICONS) {
      const { file } = await lanaiPopupIcon(s, p.icon);
      expect(file.models.length).toBe(1);
      expect(file.textures.length).toBe(1);
    }
  });

  test('every function the code can call is exported by lanai.crs', async () => {
    const s = await open();
    const names = new Set(crsExports(await s.dump.readUpdateRomfs!('app/lanai.crs')).map((e) => e.symbol));
    expect(Object.values(SCRIPT_API).filter((n) => !names.has(n))).toEqual([]);
  });

  test('the script is built into the stage: its CRO, the CRR that registers it, lanai-stage.json', async () => {
    const s = await open();
    const index = await cloneLanaiContent(s, lanaiContents(s)[28]!, 'スクリプトの島', { script: 'empty' });
    const c = lanaiContents(s)[index]!;
    const maps = await lanaiMaps(s, c);
    const eo = maps.eventTable(1)!;
    expect(eo.u32(5, 0x10)).toBe(LANAI_ACTION_SCRIPT);
    s.setStageScript(c.archive, SCRIPT);
    const key = s.stageScripts.get(c.archive)!.key;
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const check = await checkStageScript(s, c, SCRIPT);
    expect(check.problems).toEqual([]);
    const group = maps.groups[1]!;
    expect(check.owned).toContainEqual({ field: 'byte', first: B0, count: 1 });
    expect(check.owned).toContainEqual({ field: 'bit', first: T0, count: 1 });
    expect(check.owned.some((r) => r.field === 'state' && r.first <= group.stateFirst)).toBe(true);
    expect(check.owned.length).toBeLessThanOrEqual(4);

    const zip = unzipSync(await s.modZip());
    const root = '0004000000125D00';
    const arc = parseArchive(zip[`${root}/romfs/${c.archive}`]!);
    const def = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'ContentsDef')!.table;
    const cro = unpackEntry(arc, findEntry(arc, def.u32(2, 0))!).body;
    const m = parseCro(cro);
    expect(m.indexedExports.length).toBe(41);
    // the events are in: the exports of a character's event and of leaving do something now, the area's does not
    const hooks = croHooks(cro);
    expect(hooks).toContain(SLOT_TALK);
    expect(hooks).toContain(SLOT_LEAVE);
    expect(hooks).not.toContain(SLOT_AREA);
    expect(m.namedImports.map((x) => x.name)).toContain(SCRIPT_API.npcCtor);
    expect(m.namedImports.map((x) => x.name)).toContain(SCRIPT_API.setBit);
    for (const symbol of [
      SCRIPT_API.monsterSize,
      SCRIPT_API.effectCtor,
      SCRIPT_API.effectCreate,
      SCRIPT_API.effectStart,
      SCRIPT_API.shadowPos,
      SCRIPT_API.alphaTo,
    ])
      expect(m.namedImports.map((x) => x.name)).toContain(symbol);
    // the CRR holds the SHA-256 of the CRO's first 0x80 bytes
    const crr = zip[`${root}/romfs/${lanaiCrrName(index)}`]!;
    const digest = Buffer.from(sha256(cro.subarray(0, 0x80))).toString('hex');
    expect(Buffer.from(crr).toString('hex')).toContain(digest);
    const manifest = JSON.parse(new TextDecoder().decode(zip[`${root}/${LANAI_STAGE_MANIFEST}`]!));
    expect(manifest).toEqual({ format: 1, stages: { [index]: { stageKey: key, owned: check.owned } } });

    // saved and restored: the same script, the same key, the same CRO
    const restored = await open();
    await restored.restore(s.saved());
    const doc = scriptDocFromSource(SCRIPT);
    expect(restored.stageScripts.get(c.archive)).toEqual({ key, doc, source: scriptDocSource(doc).text });
    // a session saved before the document (the script's text in its place) reads as the same document
    const old = await open();
    await old.restore({ ...s.saved(), stageScripts: [[c.archive, key, SCRIPT]] });
    expect(old.stageScripts.get(c.archive)).toEqual(restored.stageScripts.get(c.archive));
    const again = unzipSync(await restored.modZip());
    expect(
      Buffer.from(again[`${root}/romfs/${c.archive}`]!).equals(Buffer.from(zip[`${root}/romfs/${c.archive}`]!)),
    ).toBe(true);
    // an edit keeps the key; an empty script takes the stage's script away
    s.setStageScript(c.archive, `${SCRIPT}\n// 追記`);
    expect(s.stageScripts.get(c.archive)!.key).toBe(key);
    s.setStageScript(c.archive, '  ');
    expect(s.stageScripts.has(c.archive)).toBe(false);
    expect(Object.keys(unzipSync(await s.modZip()))).not.toContain(`${root}/${LANAI_STAGE_MANIFEST}`);
  });

  test('a row that is not a script, a row or a group that is not there: told, and the MOD is not written', async () => {
    const s = await open();
    const index = await cloneLanaiContent(s, lanaiContents(s)[28]!, 'スクリプトの島', { script: 'empty' });
    const c = lanaiContents(s)[index]!;
    const maps = await lanaiMaps(s, c);
    const eo = maps.eventTable(1)!;
    const plain = Array.from({ length: eo.rows }, (_, r) => r).find((r) => eo.u32(r, 0x10) !== LANAI_ACTION_SCRIPT)!;
    const src = `on talk(1, ${plain}) {}\non area(1, 99999) {}\non area(77, 1) {}`;
    const check = await checkStageScript(s, c, src);
    expect(check.problems.length).toBe(3);
    expect(check.problems[0]).toContain('「スクリプト (CRO)」ではありません');
    expect(check.problems[1]).toContain('イベント 99999 がありません');
    expect(check.problems[2]).toContain('MapGroup 77 がこのステージにありません');
    s.setStageScript(c.archive, src);
    await expect(s.modZip()).rejects.toThrow('イベントのスクリプト');
    // a second action of another type is used from the second run on: noted
    eo.setU32(5, 0x28, 0x80000001);
    const noted = await checkStageScript(s, c, 'on talk(1, 5) {}');
    expect(noted.problems).toEqual([]);
    expect(noted.notes.join()).toContain('2 回目からは');
    eo.setU32(5, 0x28, LANAI_ACTION_NONE);
    // what a function is given to is held against the row's record: row 5 is a character, not a button or a range
    expect(noted.notes.join()).not.toContain('の種類ではありません');
    const records = eventRecords(maps, 1);
    expect(records.get(5)!.map(recordTrigger)).toContain('talk');
    const wrong = await checkStageScript(
      s,
      c,
      'function f() { obj(5).SetVisible(1); obj(9999).SetVisible(0) }\non button(1, 5) f',
    );
    expect(wrong.notes.join('\n')).toContain('「ボタンを踏んだとき (降りると戻る)」の種類ではありません');
    expect(wrong.notes.join('\n')).toContain('obj(9999)');
    expect(wrong.notes.join('\n')).not.toContain('obj(5) の');
    // scripts are for added stages
    expect(() => s.setStageScript(lanaiContents(s)[28]!.archive, 'on talk(1, 5) {}')).toThrow('追加したステージ');
  });

  test('the boss of the data: its flag is reset on leaving when it is one of the stage', async () => {
    const s = await open();
    const index = await cloneLanaiContent(s, lanaiContents(s)[28]!, 'ボスの島', { script: 'empty' });
    const c = lanaiContents(s)[index]!;
    const eo = (await lanaiMaps(s, c)).eventTable(1)!;
    eo.setU32(0, 0x28, 0x8000000c);
    eo.setU32(0, 0x28 + 8, B0 + 3);
    const check = await checkStageScript(s, c, 'var A: byte\non talk(1, 5) {}');
    expect(check.resets).toEqual([{ kind: 'byte', flag: B0 + 3 }]);
    expect(check.owned).toContainEqual({ field: 'byte', first: B0, count: 4 });
    eo.setU32(0, 0x28 + 8, 0x69);
    const other = await checkStageScript(s, c, 'on talk(1, 5) {}');
    expect(other.resets).toEqual([]);
    expect(other.notes.join()).toContain('数値フラグ 105');
  });

  test('the editor on the stage page shows the script of an added stage', async () => {
    const s = await open();
    const index = await cloneLanaiContent(s, lanaiContents(s)[28]!, 'スクリプトの島', { script: 'empty' });
    const c = lanaiContents(s)[index]!;
    s.setStageScript(c.archive, SCRIPT);
    const html = renderToString(<LanaiStageScriptEditor session={s} content={c} />);
    expect(html).toContain('イベントのスクリプト');
    expect(html).toContain('スクリプトを編集');
    // the stage's page no longer edits the text (no editor, and no link that opens another instance of the app)
    expect(html).not.toContain(`#/stages/${index}/script`);
    expect(html).not.toContain('スクリプトを反映');
    expect(html).toContain('stageKey');
    expect(html).toContain('STATE');
    const source = renderToString(<LanaiStageSourcePage session={s} content={c} />);
    expect(source).toContain('aria-label="スクリプト全文"');
    expect(source).toContain('var STATE: byte');
    // what the functions are given to is shown beside the text, not in it
    expect(source).not.toContain('on talk(1, 5)');
    expect(source).toContain('保存済み');
    expect(source).toContain('関数ドキュメント');
  });
});
