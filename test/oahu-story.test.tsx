// 電波人間のRPG3's story (#87; naauao oahu/story.md): the navi table, the save values and the dungeons' ranges, the
// write sites found in the Update's code.bin, the conditions run on a preview state, the code edits in code.ips and
// the story pages. Needs the Base and Update CIAs (test/env.ts).
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { unzipSync } from 'fflate';
import { OahuFlagPage } from '../src/oahu/FlagPage';
import { OahuSession } from '../src/oahu/session';
import { OahuStoryPage } from '../src/oahu/StoryPage';
import { codeWordAt, conditionReads, editWord, emptyStoryState, OAHU_KEY, OAHU_STORY_CODE, OahuConditions, oahuNamedReads, single, storyRecords, type OahuWriteSite } from '../src/oahu/story';
import { applyIps } from '../src/rom/ips';
import { openImage, openImages } from '../src/rom/dump';
import { u32 } from '../src/util/bytes';
import { hasOahuBase, hasOahuUpdate, OAHU_BASE, OAHU_UPDATE } from './env';

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 story (#87)', () => {
  let base: OahuSession;
  let s: OahuSession;
  let steps: OahuWriteSite[];
  beforeAll(async () => {
    base = await OahuSession.open(await openImage(Bun.file(OAHU_BASE), 'base'));
    s = await OahuSession.open(await openImages([Bun.file(OAHU_UPDATE), Bun.file(OAHU_BASE)], () => 'cia'));
    steps = s.story().writes.filter((w) => w.kind === 'step');
  });

  test('mapNavi.bin: 135 rows of 0x30; row 1 heads to the antenna tower of デンパ島', () => {
    const t = s.master.table('mapNavi.bin');
    expect(t.rows).toBe(135);
    expect(t.rowSize).toBe(0x30);
    const row = t.row(1);
    expect(s.messages.texts.preview(u32(row, 0x0c), true)).toBe('アンテナ塔へ行こう！');
    const dest = s.story().ranges.find((g) => g.place === u32(row, 4))!;
    expect(s.messages.texts.preview(dest.nameId, true)).toBe('デンパ島');
    // every row: +0x08 is the same screen part
    for (let r = 0; r < t.rows; r++) expect(u32(t.row(r), 8)).toBe(0x01100010);
  });

  test('flagData.bin: the step is 16 bits, 0xF9 540 bytes, 0xFA 596 bits, split by the dungeons of mapGroup', () => {
    const { keys, ranges } = s.story();
    expect(keys.length).toBe(259);
    expect(keys[OAHU_KEY.step]).toMatchObject({ bits: 16, count: 1 });
    expect(keys[OAHU_KEY.values]).toMatchObject({ bits: 8, count: 540 });
    expect(keys[OAHU_KEY.flags]).toMatchObject({ bits: 1, count: 596 });
    expect(ranges[0]!.values).toEqual([0, 46]);
    expect(ranges[0]!.flags).toEqual([0, 20]);
    expect(ranges[1]!.values).toEqual([46, 5]);
    expect(ranges.reduce((n, g) => n + g.values[1], 0)).toBe(540);
    expect(ranges.reduce((n, g) => n + g.flags[1], 0)).toBe(596);
    // the Base has the tables but no code.bin to scan
    expect(base.story().keys.length).toBe(259);
    expect(base.story().writes).toEqual([]);
  });

  test('the step writes: every call to FUN_00213010 but the step action\'s own run, with the steps as immediates', () => {
    expect(steps.length).toBe(92);
    const values = new Set(steps.flatMap((w) => w.value.imms.map((i) => i.value)));
    for (let n = 2; n < 100; n++) if (n !== 73 && n !== 96) expect(values.has(n) || s.story().writes.some((w) => w.kind === 'stepAction' && single(w.value) === n)).toBe(true);
    expect(values.has(73)).toBe(false);
    expect(values.has(96)).toBe(false);
    // FUN_001E8458: step 1 (FUN_001EDC14() = 1) or 2
    const first = steps.find((w) => w.at === 0x1e846c)!;
    expect(first.value.imms.map((i) => i.value)).toEqual([2]);
    expect(first.value.open).toBe(true);
    // FUN_00244118: 34 / 35 / 36 by the leaders met
    expect(steps.filter((w) => w.fn === 0x244118).flatMap((w) => w.value.imms.map((i) => i.value)).sort()).toEqual([34, 35, 36]);
    // FUN_001F0EF8 picks a collection hint (rows 101〜123) once the story is over
    expect(steps.find((w) => w.at === 0x1f13b8)!.value.imms.every((i) => i.value > 100 && i.value < 124)).toBe(true);
    // "if the step < N, set N": the cmp before goes with the mov
    const guarded = steps.find((w) => w.at === 0x1d19b8)!;
    expect(single(guarded.value)).toBe(0x2b);
    expect(guarded.guard?.value).toBe(0x2b);
    // the map-entry actions: 16 steps
    expect(s.story().writes.filter((w) => w.kind === 'stepAction').map((w) => single(w.value)).every((v) => v !== undefined)).toBe(true);
  });

  test('50 of the step writes are run by an EventObject row\'s script class (d10 row 17 sets step 4)', async () => {
    const entries = await s.eventEntries();
    const runs = entries.flatMap((e) => e.scripts.flatMap((sc) => sc.cls.ranges.map(([a, b]) => ({ a, b, e }))));
    const owned = steps.filter((w) => runs.some((r) => w.at >= r.a && w.at < r.b));
    expect(owned.length).toBe(50);
    const d10 = s.maps.dungeons.findIndex((d) => d.code === 'D10');
    const four = steps.filter((w) => single(w.value) === 4);
    expect(four.some((w) => runs.some((r) => r.e.dungeon === d10 && r.e.row === 17 && w.at >= r.a && w.at < r.b))).toBe(true);
  });

  test('the named conditions read the bosses\' values (1 -> 0xF9[4]); the preview runs FUN_004B62BC on a state', async () => {
    const code = s.code!.code;
    const { ranges } = s.story();
    expect(oahuNamedReads(code, ranges, 1)).toEqual([{ kind: 'values', index: 4 }]);
    expect(oahuNamedReads(code, ranges, 12)).toEqual([{ kind: 'values', index: 28 }]);
    expect(oahuNamedReads(code, ranges, 13).map((r) => r.kind)).toEqual(['flags', 'flags']);
    expect(conditionReads(code, ranges, 0x15, 4, 1, 1)).toEqual([{ kind: 'values', index: 4 }]);
    // dungeon 1's flag 2 = 0xFA[20 + 2]
    expect(conditionReads(code, ranges, 0x02, 1, 2, 0)).toEqual([{ kind: 'flags', index: 22 }]);
    const state = emptyStoryState();
    let c = new OahuConditions(code, ranges, state);
    expect(c.test(0x01, 1, 0, 1)).toBe(false);
    expect(c.test(0x15, 4, 1, 1)).toBe(false);
    expect(c.test(0x1b, 0x65, 0, 1)).toBeNull();
    state.values[4] = 3;
    c = new OahuConditions(code, ranges, state);
    expect(c.test(0x01, 1, 0, 1)).toBe(true);
    expect(c.test(0x15, 4, 1, 1)).toBe(true);
    // d10's rows that go once the drone is beaten
    const entries = await s.eventEntries();
    const d10 = entries.filter((e) => e.dungeon === 1 && e.kind);
    const before = new OahuConditions(code, ranges, emptyStoryState());
    const gone = d10.filter((e) => before.placed(e.raw, 1) === 'shown' && c.placed(e.raw, 1) === 'gone');
    expect(gone.length).toBeGreaterThan(0);
  });

  test('a write\'s immediate (and its guard) and a script\'s message are changed in exefs/code.ips', () => {
    const code = s.code!.code;
    const site = steps.find((w) => w.at === 0x1d19b8)!;
    const mov = site.value.imms[0]!.at, cmp = site.guard!.at;
    // 257 has no ARM immediate
    expect(editWord(code, { at: mov, kind: 'imm', value: 257, before: codeWordAt(code, mov) })).toContain('即値にできません');
    s.storyEdits = [
      { at: mov, kind: 'imm', value: 0x2c, before: codeWordAt(code, mov) },
      { at: cmp, kind: 'imm', value: 0x2c, before: codeWordAt(code, cmp) },
    ];
    // a message literal of the first script class with one
    const lit = (async () => (await s.eventEntries()).flatMap((e) => e.scripts).find((sc) => sc.cls.messageAt.length)!.cls.messageAt[0]!)();
    return lit.then(([at]) => {
      s.storyEdits.push({ at, kind: 'word', value: 42359, before: codeWordAt(code, at) });
      expect(storyRecords(code, s.storyEdits).errors).toEqual([]);
      const zip = unzipSync(s.modZip());
      const patched = applyIps(code, zip['00040000000EF000/exefs/code.ips']!);
      expect(codeWordAt(patched, mov)).toBe(0xe3a0002c); // mov r0, #0x2c
      expect(codeWordAt(patched, cmp)).toBe(0xe350002c); // cmp r0, #0x2c
      expect(codeWordAt(patched, at)).toBe(42359);
      // a word that is not the game's any more is refused
      expect(storyRecords(patched, s.storyEdits).errors.length).toBe(3);
      s.storyEdits = [];
      expect(s.codeIps()).toBeNull();
    });
  });

  test('the story and save value pages render; the Base asks for the Update for the code', () => {
    const html = renderToString(<OahuStoryPage session={s} arg="1" onAddUpdate={() => {}} />);
    expect(html).toContain('アンテナ塔へ行こう！');
    expect(html).toContain('この段階を書く所');
    expect(renderToString(<OahuStoryPage session={base} arg="1" onAddUpdate={() => {}} />)).toContain('Update');
    const flags = renderToString(<OahuFlagPage session={s} arg="values.4" onAddUpdate={() => {}} />);
    expect(flags).toContain('0xF9[4]');
    expect(flags).toContain('プレビューの状態を作る');
    expect(OAHU_STORY_CODE.setStep).toBe(0x213010);
  });
});
