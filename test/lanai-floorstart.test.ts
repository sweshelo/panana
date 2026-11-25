// The start of one floor of a map group (on start(group, map): ScriptMap::GetCurrentMapID, LanaiMapInfo.hash), run
// after the group's start; the objects of other floors skipped (GetMapChara null); the map inspector's checks of what
// is selected (src/editor/mappage.tsx issueTouches).
import { describe, expect, test } from 'bun:test';
import { issueTouches } from '../src/editor/mappage';
import type { Issue } from '../src/editor/model';
import type { MapDoc } from '../src/game/sections';
import { lanaiContents } from '../src/lanai/contents';
import { buildCro, parseCro } from '../src/lanai/cro';
import {
  compileStageScript,
  nodeCharaRows,
  parseStageScript,
  SCRIPT_API,
  scriptDocFromSource,
  scriptDocSource,
  ScriptError,
} from '../src/lanai/eventScript';
import { docBound, docUnbound, startBinding } from '../src/lanai/scriptDoc';
import { LanaiSession } from '../src/lanai/session';
import { contentScript, LANAI_EMPTY_SCRIPT_CONTENT } from '../src/lanai/stageEdit';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const FLOOR = 0xdef07d44;

describe('RPG FREE! stage script: the start of a floor', () => {
  test('on start(group, map) reads, a floor has one start, the group another', () => {
    const s = parseStageScript(
      'on start(1) { ScriptSystem.FadeInWait(0.3, 2) }\non start(1, 0xDEF07D44) { obj(5).SetVisible(false) }',
    );
    expect(s.events.map((e) => [e.trigger, e.group, e.map])).toEqual([
      ['start', 1, undefined],
      ['start', 1, FLOOR],
    ]);
    expect(() => parseStageScript('on start(1, 0xDEF07D44) {}\non start(1, 0xDEF07D44) {}')).toThrow(ScriptError);
    expect(() => parseStageScript('on start(1) {}\non start(1) {}')).toThrow(ScriptError);
    expect(() => parseStageScript('on intro(1, 2) {}')).toThrow(ScriptError);
  });

  test("the document keeps the floor's binding apart from the group's", () => {
    const doc = scriptDocFromSource('function a() {}\nfunction b() {}\non start(1) a\non start(1, 0xDEF07D44) b');
    expect(startBinding(doc, 1)?.fn).toBe('a');
    expect(startBinding(doc, 1, FLOOR)?.fn).toBe('b');
    expect(scriptDocSource(doc).text).toContain('on start(1, 0xDEF07D44) b');
    const moved = docBound(doc, { trigger: 'start', group: 1, row: 0, map: FLOOR, fn: 'a' });
    expect(startBinding(moved, 1)?.fn).toBe('a');
    expect(startBinding(moved, 1, FLOOR)?.fn).toBe('a');
    const off = docUnbound(moved, { trigger: 'start', group: 1, row: 0, map: FLOOR });
    expect(startBinding(off, 1, FLOOR)).toBeUndefined();
    expect(startBinding(off, 1)?.fn).toBe('a');
    // written in place: named after the floor
    const inPlace = scriptDocFromSource('on start(2, 0xDEF07D44) { ScriptSystem.FadeInWait(0.3, 2) }');
    expect(inPlace.bindings[0]).toMatchObject({ trigger: 'start', group: 2, map: FLOOR, fn: 'start_2_DEF07D44' });
  });

  test('the objects a statement acts on (outside its branches)', () => {
    const [e] = parseStageScript(
      'on start(1) { obj(5).SetVisible(false); if (state(3) == 0) { obj(6).SetVisible(false) } }',
    ).events;
    expect(e!.body.map(nodeCharaRows)).toEqual([[5], []]);
  });
});

describe("the map inspector's checks of the selection", () => {
  const issue = (target?: Issue['target']): Issue => ({ level: 'warn', msg: '', key: '', target });
  const doc = { recs: { 5: [{ x: 3, y: 4 }] } } as unknown as MapDoc;
  test('a record, cells, a range', () => {
    const rec = issue({ type: 'rec', section: 5, index: 0 });
    const cell = issue({ type: 'tiles', cells: [[1, 1]] });
    expect(issueTouches(rec, { type: 'none' }, doc)).toBe(false);
    expect(issueTouches(rec, { type: 'rec', section: 5, index: 0 }, doc)).toBe(true);
    expect(issueTouches(rec, { type: 'rec', section: 5, index: 1 }, doc)).toBe(false);
    expect(issueTouches(cell, { type: 'tiles', cells: [[1, 1]] }, doc)).toBe(true);
    expect(issueTouches(cell, { type: 'tiles', cells: [[1, 2]] }, doc)).toBe(false);
    expect(issueTouches(rec, { type: 'rect', x0: 5, y0: 5, x1: 2, y1: 2 }, doc)).toBe(true);
    expect(issueTouches(cell, { type: 'rect', x0: 2, y0: 2, x1: 5, y1: 5 }, doc)).toBe(false);
    expect(issueTouches(issue(), { type: 'rec', section: 5, index: 0 }, doc)).toBe(false);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! stage script: the start of a floor (ROM)', () => {
  test("a floor's start builds after the group's, and an object is looked for before it is used", async () => {
    const s = await LanaiSession.open(
      await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name),
      { fresh: true },
    );
    const empty = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT]!;
    const base = parseCro((await contentScript(s, empty, await s.archive(empty.archive))).body);
    const script = parseStageScript(
      'on start(1) { ScriptSystem.FadeInWait(0.3, 2); if (state(3) != 0) { return } obj(5).SetVisible(false) }\non start(1, 0xDEF07D44) { obj(6).SetVisible(false) }',
    );
    const built = compileStageScript(base, script);
    // the floor's class runs the group's part first, which ends at its own label
    const ends = [...built.labels.keys()].filter((k) => /_group_end_\d+$/u.test(k));
    expect(ends.length).toBe(1);
    expect(ends[0]!.startsWith('PnEvent1_')).toBe(true);
    // obj(5) and obj(6) are looked for: the skip labels of their statements
    expect([...built.labels.keys()].filter((k) => /_absent_\d+$/u.test(k)).length).toBeGreaterThanOrEqual(3);
    const cro = buildCro(built.cro);
    expect(new TextDecoder('latin1').decode(cro)).toContain(SCRIPT_API.mapId);
  }, 120000);
});
