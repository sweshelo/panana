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
import {
  parseStageScript,
  scriptDocFromSource,
  scriptDocSource,
  SCRIPT_API,
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
import { LanaiSession } from '../src/lanai/session';
import { cloneLanaiContent, lanaiCrrName } from '../src/lanai/stageEdit';
import { checkStageScript, eventRecords, LANAI_STAGE_MANIFEST, recordTrigger } from '../src/lanai/stageScript';
import { LanaiStageScriptEditor, STAGE_SCRIPT_EXAMPLE } from '../src/lanai/StageScriptEditor';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const B0 = STAGE_BYTE_FLAGS.first,
  T0 = STAGE_BIT_FLAGS.first;

describe('RPG FREE! stage script: reading', () => {
  test('the example of the editor reads: a variable, an event of a character, its statements', () => {
    const s = parseStageScript(STAGE_SCRIPT_EXAMPLE);
    expect(s.vars).toEqual([{ name: 'STATE_A', kind: 'byte', reset: false, flag: B0 }]);
    expect(s.events.length).toBe(1);
    const e = s.events[0]!;
    expect([e.trigger, e.group, e.row]).toEqual(['talk', 1, 5]);
    expect(e.body.map((n) => n.op)).toEqual(['switch', 'if']);
    const sw = e.body[0]!;
    if (sw.op !== 'switch') throw new Error('switch');
    expect(sw.cases.map((c) => [c.value, c.body.map((n) => n.op)])).toEqual([
      [0, ['talk']],
      [1, ['talk']],
      [2, ['talk', 'return']],
    ]);
    const cond = e.body[1]!;
    if (cond.op !== 'if') throw new Error('if');
    expect(cond.cond).toEqual({ value: { kind: 'ask', msg: 0x63 }, cmp: '!=', than: 0 });
    expect(cond.then.map((n) => n.op)).toEqual(['popup', 'se', 'talk', 'set']);
    expect(cond.else).toEqual([
      { op: 'set', name: 'STATE_A', value: 1 },
      { op: 'talk', msg: 0x65, auto: false },
    ]);
  });

  test('variables take flag numbers in the order they are declared; reset marks those of one visit', () => {
    const s = parseStageScript('var A: byte\nvar B: bit reset\nvar C: byte reset');
    expect(s.vars.map((v) => [v.name, v.flag, v.reset])).toEqual([
      ['A', B0, false],
      ['B', T0, true],
      ['C', B0 + 1, true],
    ]);
  });

  test('conditions and the other statements', () => {
    const s = parseStageScript(`
      var N: byte
      var B: bit
      on area(2, 0x10) {
        if (!B) { B = true } else if (N >= 3) { N = 0 } else { say(7) }
        if (item(0xC9) < 2) { getItem(0xC9, 1); addItem(5, -1); addGold(-30) }
        if (state(4) == 1) { openDoor(3); closeDoor(4); wait(0.5); disable(); collision(9, 1) }
      }`);
    const [a, b, c] = s.events[0]!.body;
    if (a?.op !== 'if' || b?.op !== 'if' || c?.op !== 'if') throw new Error('if');
    expect(a.cond).toEqual({ value: { kind: 'var', name: 'B' }, cmp: '==', than: 0 });
    expect(a.then).toEqual([{ op: 'set', name: 'B', value: 1 }]);
    expect(a.else[0]).toMatchObject({ op: 'if', cond: { cmp: '>=', than: 3 } });
    expect(b.cond).toEqual({ value: { kind: 'item', item: 0xc9 }, cmp: '<', than: 2 });
    expect(b.then).toEqual([
      { op: 'addItem', item: 0xc9, count: 1, show: true },
      { op: 'addItem', item: 5, count: -1, show: false },
      { op: 'addGold', amount: -30 },
    ]);
    expect(c.then).toEqual([
      { op: 'door', row: 3, open: true, show: true },
      { op: 'door', row: 4, open: false },
      { op: 'wait', seconds: 0.5 },
      { op: 'collision', row: null, on: false },
      { op: 'collision', row: 9, on: true },
    ]);
  });

  test('a defeated map monster has its own effect statement', () => {
    const event = parseStageScript('on start(1) { if (monsters() == 0) { vanishMonster(9) } }').events[0]!;
    const branch = event.body[0]!;
    if (branch.op !== 'if') throw new Error('if');
    expect(branch.then).toEqual([{ op: 'vanishMonster', row: 9 }]);
    expect(() => parseStageScript('on start(1) { vanishMonster(-1) }')).toThrow();
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
    expect(err('on talk(1, 5) { disable() }')).toContain('範囲のイベントの中でだけ');
    expect(err('on talk(1, 5) { break }')).toContain('switch の中でだけ');
    expect(err('var A: bit\non area(1, 1) { A = 2 }')).toContain('0〜1');
    expect(err('on talk(1, 5) {}\non area(1, 5) {}')).toContain('もうイベントが割り当てられています');
    expect(err('on talk(1, 5) { talk(1)')).toContain('「}」が足りません');
    expect(err('on talk(1, 5) { fight(1) }')).toContain('「fight」という文はありません');
    expect(err('on talk(1, 5) { talk(1) } @')).toContain('使えない文字');
  });

  test('the result of an API function: an integer is compared, void and float are not values', () => {
    // read from the game's code (scriptApiTable.ts; lanai-custom-stages 3ds/research/script-returns.md)
    const body = (cond: string): string => `on talk(1, 5) { if (${cond}) { wait(1) } }`;
    expect(() => parseStageScript(body('ScriptCamera.IsAnimation() == 1'))).not.toThrow();
    expect(() => parseStageScript(body('ScriptMap.GetCurrentMapGroupID() == 1'))).not.toThrow();
    expect(() => parseStageScript(body('ScriptMap.ChangeMap(1, 2) == 1'))).toThrow('void');
    expect(() => parseStageScript(body('ScriptCamera.GetTargetDistance() == 1'))).toThrow('float');
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
      if (STATE == 0) { talk(1); STATE = 1 } else { talk(2) }
      SEEN = 1
    }
    on start(1) { vanishMonster(5) }`;

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
    const wrong = await checkStageScript(s, c, 'function f() { show(chara(5)); hide(chara(9999)) }\non button(1, 5) f');
    expect(wrong.notes.join('\n')).toContain('「ボタンを踏んだとき (降りると戻る)」の種類ではありません');
    expect(wrong.notes.join('\n')).toContain('chara(9999)');
    expect(wrong.notes.join('\n')).not.toContain('chara(5) の');
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
    expect(html).toContain('var STATE: byte');
    expect(html).toContain('stageKey');
  });
});
