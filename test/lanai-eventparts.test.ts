// Placing records that start an event on an RPG FREE! map (src/lanai/eventParts.ts), the hit shape of a range
// (rangeShape.ts), and the MonsterGroup value of battle() (stageScript.ts battleRow): with the ROM, a stage added from
// content 1, whose MonsterGroup row IDs are not its row numbers.
import { beforeAll, describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { parseCro } from '../src/lanai/cro';
import { SCRIPT_API } from '../src/lanai/eventScript';
import { CELL } from '../src/game/sections';
import { LANAI_ACTION_SCRIPT } from '../src/lanai/actions';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { recordTriggers } from '../src/lanai/EventScriptBinding';
import {
  LANAI_ACTION_EXTERNAL_DOOR,
  LANAI_DOOR_KIND,
  LANAI_NEW_EVENT_CATEGORY,
  lanaiEventParts,
  lanaiLookKind,
  lanaiRangeRecord,
} from '../src/lanai/eventParts';
import { lanaiCharaRowBytes } from '../src/lanai/mapObjects';
import { lanaiEditState, lanaiRecEventRow } from '../src/lanai/mapedit';
import { lanaiEventSlot, lanaiMaps, type LanaiMaps } from '../src/lanai/maps';
import { rangeWalls } from '../src/lanai/mapview';
import { lanaiRange } from '../src/lanai/rangeShape';
import { LanaiSession } from '../src/lanai/session';
import { cloneLanaiContent, lanaiContentRemoveBlock, lanaiCrrName, removeLanaiContent } from '../src/lanai/stageEdit';
import { battleRow, checkStageScript } from '../src/lanai/stageScript';
import { openImages } from '../src/rom/dump';
import { u32, w32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

/** An EventObject table stand-in: rows of 100 bytes, +0x5A the look, +0x5C the channel bit. */
const events = (look: number, channel = 0): Parameters<typeof lanaiRange>[1] => {
  const row = new Uint8Array(100);
  row[0x5a] = look & 0xff;
  row[0x5b] = look >> 8;
  row[0x5d] = channel ? 0x80 : 0;
  return { rows: 2, row: () => row } as unknown as Parameters<typeof lanaiRange>[1];
};
const place = (raw: Uint8Array, x: number, y: number, ev = 1): Uint8Array => {
  const r = raw.slice();
  new DataView(r.buffer).setUint32(4, ev, true);
  new DataView(r.buffer).setInt16(8, x, true);
  new DataView(r.buffer).setInt16(10, y, true);
  return r;
};

describe('RPG FREE! range: the shape the game hits', () => {
  test('a circle: centred at 50 + 100 × position, radius 100 × the event row +0x5A', () => {
    const r = lanaiRange(place(lanaiRangeRecord('circle'), 10, 20), events(2));
    expect(r.shape).toEqual({ type: 'circle', cx: 1050 / CELL, cy: 2050 / CELL, r: 200 / CELL });
    expect(r.otherChannel).toBe(false);
    expect(lanaiRange(place(lanaiRangeRecord('circle'), 10, 20), events(0)).note).toContain('何にも当たりません');
  });

  test('a rectangle: from its corner (no +50), full width and depth × 100, not turned by the facing', () => {
    const raw = place(lanaiRangeRecord('rect', 5, 1), 10, 20);
    const r = lanaiRange(raw, events(0));
    expect(r.shape).toEqual({ type: 'rect', x: 1000 / CELL, y: 2000 / CELL, w: 500 / CELL, h: 100 / CELL });
    raw[0x1c] = 8;
    expect(lanaiRange(raw, events(0)).shape).toEqual(r.shape);
    // any shape byte but 0 is the rectangle
    raw[0x1d] = 2;
    expect(lanaiRange(raw, events(0)).shape).toEqual(r.shape);
  });

  test('the 3D walls stand on the shape: four walls of a rectangle, an open cylinder of a circle', () => {
    const rect = rangeWalls({ type: 'rect', x: 2, y: 3, w: 1, h: 0.2 })!;
    rect.computeBoundingBox();
    const b = rect.boundingBox!;
    expect(rect.getAttribute('position').count).toBe(4 * 6);
    expect([b.min.x, b.min.z, b.max.x, b.max.z]).toEqual([2 * CELL, 3 * CELL, 3 * CELL, 3.2 * CELL]);
    expect(b.min.y).toBe(0);
    expect(b.max.y).toBeGreaterThan(0);
    const circle = rangeWalls({ type: 'circle', cx: 1, cy: 1, r: 0.4 })!;
    circle.computeBoundingBox();
    expect(circle.boundingBox!.max.x).toBeCloseTo(1.4 * CELL);
    expect(circle.boundingBox!.min.z).toBeCloseTo(0.6 * CELL);
    expect(rangeWalls({ type: 'circle', cx: 1, cy: 1, r: 0 })).toBeNull();
    expect(rangeWalls(null)).toBeNull();
  });

  test('no range: a prop (kind ≥ 100) or no event row; bit 15 of +0x5C is not walked into', () => {
    const prop = place(lanaiRangeRecord('rect'), 1, 1);
    new DataView(prop.buffer).setUint32(0, 101, true);
    expect(lanaiRange(prop, events(0)).shape).toBeNull();
    expect(lanaiRange(place(lanaiRangeRecord('rect'), 1, 1, 0), events(0)).shape).toBeNull();
    const other = lanaiRange(place(lanaiRangeRecord('rect'), 1, 1), events(0, 1));
    expect(other.otherChannel).toBe(true);
    expect(other.note).toContain('歩いて入っても起きません');
  });
});

describe('RPG FREE! new event parts: by what starts them, the look picked afterwards', () => {
  test('a new MapChara row: an NPC or a monster of the data pattern, the motions of a donor of its kind', () => {
    const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    // content 1's monster row 5 (MonsterDesign 0x1CB)
    expect(hex(lanaiCharaRowBytes(1, 0x1cb))).toBe(
      '010d00005c0000805e000080004003000000000000000080000000800040030000000080000000800040030' + '0cb010000',
    );
    const npc = lanaiCharaRowBytes(0, 0x1a2);
    expect(u32(npc, 0)).toBe(0x0d08);
    expect(u32(npc, 4)).toBe(0x80000075);
    // a donor of the same kind gives its first 16 bytes (the motions, +0x0C), not its other looks
    const donor = lanaiCharaRowBytes(0, 0x199);
    donor[0x0c] = 0xfa;
    donor[4] = 0x7f;
    w32(donor, 0x10, 0x8000017a);
    const made = lanaiCharaRowBytes(0, 0x1b0, donor);
    expect([made[0x0c], made[4], u32(made, 0x10), u32(made, 0x2c)]).toEqual([0xfa, 0x7f, 0, 0x1b0]);
    // a donor of another kind is not used
    expect(u32(lanaiCharaRowBytes(1, 5, donor), 4)).toBe(0x8000005c);
  });

  test('the parts are kinds, not looks: two buttons, an NPC, a monster, a door, two ranges', () => {
    const parts = lanaiEventParts(undefined, undefined, { npcModel: 0x1a2, monsterDesign: 7 });
    expect(parts.map((p) => [p.section, p.section === 3 ? p.raw[0x15] : u32(p.raw, 0)])).toEqual([
      [5, 4],
      [5, 6],
      [5, 0],
      [5, 1],
      [3, LANAI_DOOR_KIND],
      [8, 1],
      [8, 0],
    ]);
    // no MapChara row of the kind: one is made when placed
    expect(parts[2]!.event.chara).toEqual({ kind: 0, model: 0x1a2 });
    expect(parts[3]!.event.chara).toEqual({ kind: 1, model: 7 });
    expect(parts[4]!.event.action).toBe(LANAI_ACTION_EXTERNAL_DOOR);
  });

  test('what the look is a row of', () => {
    expect(lanaiLookKind(5, lanaiRangeRecord('rect').fill(0))).toBe('chara');
    const button = new Uint8Array(0x20);
    w32(button, 0, 4);
    expect(lanaiLookKind(5, button)).toBe('object');
    w32(button, 0, 13);
    expect(lanaiLookKind(5, button)).toBe('effect');
    const exit = new Uint8Array(0x18);
    exit[0x15] = 3;
    expect(lanaiLookKind(3, exit)).toBe('effect');
    exit[0x15] = LANAI_DOOR_KIND;
    expect(lanaiLookKind(3, exit)).toBe('object');
    expect(lanaiLookKind(8, lanaiRangeRecord('circle'))).toBe('radius');
  });
});

describe.skipIf(!hasLanai)('RPG FREE! new event records and battle()', () => {
  let s: LanaiSession;
  let c: LanaiContent;
  let maps: LanaiMaps;
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump, { fresh: true });
    const index = await cloneLanaiContent(s, lanaiContents(s)[1]!, 'イベントの島', { script: 'empty' });
    c = lanaiContents(s)[index]!;
    maps = await lanaiMaps(s, c);
  }, 300000);

  test('the add panel offers a button, characters and ranges made from nothing', () => {
    const st = lanaiEditState(maps);
    st.open(maps.mapByName('D01001B01')!);
    const fresh = st.templates().filter((t) => t.category === LANAI_NEW_EVENT_CATEGORY);
    expect(fresh.some((t) => t.section === 5 && u32(t.raw, 0) === 4)).toBe(true);
    expect(fresh.some((t) => t.section === 5 && u32(t.raw, 0) <= 2)).toBe(true);
    expect(fresh.filter((t) => t.section === 8).length).toBe(2);
    // the parts differ by their keys (the characters have the same record)
    expect(new Set(fresh.map((t) => t.source)).size).toBe(fresh.length);
  });

  test('placed: a new EventObject row (a script, the look, a slot of its own) and the trigger of its kind', () => {
    const st = lanaiEditState(maps);
    const info = maps.mapByName('D01001B01')!;
    st.open(info);
    const t = maps.eventTable(info.dungeon)!;
    const fresh = st.templates().filter((x) => x.category === LANAI_NEW_EVENT_CATEGORY);
    const button = fresh.find((x) => x.section === 5 && u32(x.raw, 0) === 4)!;
    const range = fresh.find((x) => x.section === 8)!;
    const rows = t.rows;
    let placed: [number, number] = [0, 0];
    st.edit((d) => {
      placed = st.placeStamp(d, { type: 'template', t: button }, 10, 10);
    });
    const rec = st.current!.recs[placed[0]]![placed[1]]!;
    const row = lanaiRecEventRow(5, rec.raw);
    expect(row).toBe(rows);
    expect(t.u32(row, 0x10)).toBe(LANAI_ACTION_SCRIPT);
    expect(t.u16(row, 0x5a)).toBe(button.event!.look);
    // a state slot no other row uses (or the row number)
    const slots = Array.from({ length: row }, (_, r) => lanaiEventSlot(t, r));
    expect(slots).not.toContain(lanaiEventSlot(t, row));
    // the end of the row is row 0's (the padding)
    expect([...t.row(row).slice(0x61)]).toEqual([...t.row(0).slice(0x61)]);
    expect(recordTriggers(5, rec.raw)).toEqual(['button', 'switch']);
    st.edit((d) => {
      placed = st.placeStamp(d, { type: 'template', t: range }, 12, 12);
    });
    const area = st.current!.recs[8]![placed[1]]!;
    expect(lanaiRecEventRow(8, area.raw)).toBe(rows + 1);
    expect(recordTriggers(8, area.raw)).toEqual(['area', 'defeat']);
    expect(lanaiRange(area.raw, t).shape?.type).toBe('rect');
    st.undo();
    st.undo();
    expect(t.rows).toBe(rows);
  });

  test('a door: a new point ID and an event of action 17; a character with no row of its kind makes a MapChara row', () => {
    const st = lanaiEditState(maps);
    const info = maps.mapByName('D01001B01')!;
    st.open(info);
    const t = maps.eventTable(info.dungeon)!;
    const mc = maps.contentTable('MapChara')!;
    const fresh = st.templates().filter((x) => x.category === LANAI_NEW_EVENT_CATEGORY);
    const door = fresh.find((x) => x.section === 3)!;
    const others = new Set((st.current!.recs[3] ?? []).map((r) => u32(r.raw, 0)));
    let placed: [number, number] = [0, 0];
    st.edit((d) => {
      placed = st.placeStamp(d, { type: 'template', t: door }, 3, 3);
    });
    const rec = st.current!.recs[3]![placed[1]]!;
    expect(rec.raw[0x15]).toBe(LANAI_DOOR_KIND);
    expect(others.has(u32(rec.raw, 0))).toBe(false);
    expect(t.u32(lanaiRecEventRow(3, rec.raw), 0x10)).toBe(LANAI_ACTION_EXTERNAL_DOOR);
    // content 1 has an NPC and a monster row: the parts take them
    const npc = fresh.find((x) => x.section === 5 && u32(x.raw, 0) === 0)!;
    expect(npc.event!.chara).toBeUndefined();
    expect(npc.event!.look).toBeGreaterThan(0);
    // a part that makes its character (as for a content without one)
    const rows = mc.rows;
    const made = { ...npc, event: { ...npc.event!, look: 0, chara: { kind: 1, model: 0x1cb } } };
    st.edit((d) => {
      placed = st.placeStamp(d, { type: 'template', t: made }, 4, 4);
    });
    const ch = st.current!.recs[5]![placed[1]]!;
    expect(mc.rows).toBe(rows + 1);
    expect(t.u16(lanaiRecEventRow(5, ch.raw), 0x5a)).toBe(rows);
    expect(mc.u32(rows, 0) & 7).toBe(1);
    expect(mc.u16(rows, 0x2c)).toBe(0x1cb);
    expect(mc.rowId(rows)).toBe((0x80000000 | rows) >>> 0);
    // undo takes the MapChara row back with the record
    st.undo();
    expect(mc.rows).toBe(rows);
    st.undo();
  });

  test('a button that stays down (switch) is made as GimmickKeepPushButtonCommon, the other as GimmickPushButtonCommon', async () => {
    const st = lanaiEditState(maps);
    const info = maps.mapByName('D01001B01')!;
    st.open(info);
    const button = st
      .templates()
      .find((x) => x.category === LANAI_NEW_EVENT_CATEGORY && x.section === 5 && u32(x.raw, 0) === 4)!;
    const rows: number[] = [];
    for (const x of [2, 3])
      st.edit((d) => {
        const [k, i] = st.placeStamp(d, { type: 'template', t: button }, x, 8);
        rows.push(lanaiRecEventRow(k, st.current!.recs[k]![i]!.raw));
      });
    const g = info.dungeon;
    const src = `function a() { se(0x8D) }\nfunction b() { se(0x8E) }\non switch(${g}, ${rows[0]}) a\non button(${g}, ${rows[1]}) b`;
    expect((await checkStageScript(s, c, src)).problems).toEqual([]);
    s.setStageScript(c.archive, src);
    const zip = unzipSync(await s.modZip());
    const arc = parseArchive(zip[`0004000000125D00/romfs/${c.archive}`]!);
    const def = (await s.tablesIn(c.archive)).find((t) => t.table.name === 'ContentsDef')!.table;
    const names = parseCro(unpackEntry(arc, findEntry(arc, def.u32(2, 0))!).body).namedImports.map((x) => x.name);
    for (const n of [
      SCRIPT_API.keepCtor,
      SCRIPT_API.keepMenu,
      SCRIPT_API.keepExec,
      SCRIPT_API.tiKeep,
      SCRIPT_API.buttonCtor,
      SCRIPT_API.buttonExec,
    ])
      expect(names).toContain(n);
    s.setStageScript(c.archive, '');
    st.undo();
    st.undo();
  });

  test('battle() takes a MonsterGroup row number: content 1 has row IDs 0x80000000, 0x80000010 …', async () => {
    const mg = maps.monsterGroup!;
    expect(mg.rowId(1)).not.toBe(0x80000001);
    expect(battleRow(mg, 5)).toBe(5);
    expect(battleRow(mg, mg.rowId(1))).toBe(1);
    // the value the old build gave the game for battle(5): a row ID the table does not have → the empty row 0
    expect(battleRow(mg, 0x80000005)).toBe(-1);
    expect(battleRow(mg, mg.rows)).toBe(-1);
    const ok = await checkStageScript(s, c, `function f() { battle(5) }\non start(1) f`);
    expect(ok.problems).toEqual([]);
    const bad = await checkStageScript(s, c, `function f() { battle(${mg.rows}) }\non start(1) f`);
    expect(bad.problems.join()).toContain(`battle(${mg.rows}) の群れがありません`);
  });

  test('an added stage is removed, the newest first: its rows, archive, CRR and script', async () => {
    const rows = (n: string): number => s.need(n).rows;
    const before = { contents: rows('Contents'), msi: rows('MapStageIntegration'), msg: rows('MessageMapStage') };
    const index = await cloneLanaiContent(s, lanaiContents(s)[1]!, '消す島', { script: 'empty' });
    const added = lanaiContents(s)[index]!;
    s.setStageScript(added.archive, 'function f() { wait(1) }\non start(1) f');
    // the stage added before it is not the last any more
    expect(lanaiContentRemoveBlock(s, c)).toContain('最後に追加した');
    expect(lanaiContentRemoveBlock(s, lanaiContents(s)[1]!)).toContain('元からある');
    expect(lanaiContentRemoveBlock(s, added)).toBeNull();
    removeLanaiContent(s, added);
    expect({ contents: rows('Contents'), msi: rows('MapStageIntegration'), msg: rows('MessageMapStage') }).toEqual(
      before,
    );
    expect(s.createdFiles.has(added.archive)).toBe(false);
    expect(s.createdFiles.has(lanaiCrrName(index))).toBe(false);
    expect(s.stageScripts.has(added.archive)).toBe(false);
    expect(lanaiContentRemoveBlock(s, c)).toBeNull();
    const zip = unzipSync(await s.modZip());
    expect(Object.keys(zip).some((k) => k.endsWith(added.archive) || k.endsWith(lanaiCrrName(index)))).toBe(false);
  });
});
