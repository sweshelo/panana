// Placing records that start an event on an RPG FREE! map (src/lanai/eventParts.ts), the hit shape of a range
// (rangeShape.ts), and the MonsterGroup value of battle() (stageScript.ts battleRow): with the ROM, a stage added from
// content 1, whose MonsterGroup row IDs are not its row numbers.
import { beforeAll, describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { findEntry, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { parseCro } from '../src/lanai/cro';
import { SCRIPT_API } from '../src/lanai/eventScript';
import { CELL, buildRecs, recCellPos, setRecCellPos, type Rec } from '../src/game/sections';
import { LANAI_ACTION_SCRIPT } from '../src/lanai/actions';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { recordTriggers } from '../src/lanai/EventScriptBinding';
import {
  LANAI_ACTION_EXTERNAL_DOOR,
  LANAI_ACTION_SHOP,
  LANAI_ACTION_SIGN,
  LANAI_ACTION_TALK,
  LANAI_DOOR_KIND,
  LANAI_SIGN_KIND,
  LANAI_SPEAKER_NONE,
  LANAI_SPEAKER_NPC,
  lanaiEventParts,
  lanaiFloorParts,
  lanaiLookKind,
  lanaiRangeRecord,
} from '../src/lanai/eventParts';
import { LANAI_FLOOR_ROWS, lanaiCharaRowBytes, lanaiLevelDoorNumber, lanaiRecordLook } from '../src/lanai/mapObjects';
import { lanaiMapHref } from '../src/lanai/hrefs';
import { lanaiArrivals, lanaiDestinationPlace } from '../src/lanai/mapLinks';
import { LANAI_EXISTING_CATEGORY, lanaiEditState, lanaiRecEventRow, lanaiRecLabel } from '../src/lanai/mapedit';
import {
  LANAI_EVENT_LEVEL,
  LANAI_FLOOR_POISON,
  LANAI_LEVEL_DOOR_KIND,
  lanaiEventSlot,
  lanaiExitCategory,
  lanaiExitLabel,
  lanaiExitNote,
  lanaiFloorKindLabel,
  LANAI_LAYOUTS,
  lanaiMaps,
  type LanaiMaps,
} from '../src/lanai/maps';
import { talkColumns, TALK_SPEAKER } from '../src/lanai/talk';
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
const place = (raw: Uint8Array, x: number, y: number, ev = 1): Rec => {
  const r = raw.slice();
  new DataView(r.buffer).setUint32(4, ev, true);
  new DataView(r.buffer).setInt16(8, x, true);
  new DataView(r.buffer).setInt16(10, y, true);
  return { raw: r, x, y };
};

describe('RPG FREE! range: the shape the game hits', () => {
  test('a circle: centred at 50 + 100 × position, radius 100 × the event row +0x5A', () => {
    const r = lanaiRange(place(lanaiRangeRecord('circle'), 10, 20), events(2));
    expect(r.shape).toEqual({ type: 'circle', cx: 1050 / CELL, cy: 2050 / CELL, r: 200 / CELL });
    expect(r.pressToStart).toBe(true);
    expect(lanaiRange(place(lanaiRangeRecord('circle'), 10, 20), events(0)).note).toContain('何にも当たりません');
  });

  test('a rectangle: from its corner (no +50), full width and depth × 100, not turned by the facing', () => {
    const raw = place(lanaiRangeRecord('rect', 5, 1), 10, 20);
    const r = lanaiRange(raw, events(0));
    expect(r.shape).toEqual({ type: 'rect', x: 1000 / CELL, y: 2000 / CELL, w: 500 / CELL, h: 100 / CELL });
    raw.raw[0x1c] = 8;
    expect(lanaiRange(raw, events(0)).shape).toEqual(r.shape);
    // any shape byte but 0 is the rectangle
    raw.raw[0x1d] = 2;
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

  test('no range: a prop (kind ≥ 100) or no event row; bit 15 of +0x5C starts on entry', () => {
    const prop = place(lanaiRangeRecord('rect'), 1, 1);
    new DataView(prop.raw.buffer).setUint32(0, 101, true);
    expect(lanaiRange(prop, events(0)).shape).toBeNull();
    expect(lanaiRange(place(lanaiRangeRecord('rect'), 1, 1, 0), events(0)).shape).toBeNull();
    const walk = lanaiRange(place(lanaiRangeRecord('rect'), 1, 1), events(0, 1));
    expect(walk.pressToStart).toBe(false);
    expect(walk.note).toContain('歩いて入ると起きます');
  });

  test('a newly placed or moved range uses the live coordinates; saved bytes match the game shape', () => {
    const layout = LANAI_LAYOUTS[8]!;
    for (const shape of ['rect', 'circle'] as const) {
      const rec = place(lanaiRangeRecord(shape), 0, 0);
      setRecCellPos(rec, layout, 12, 7);
      const live = lanaiRange(rec, events(2)).shape!;
      expect(recCellPos(rec, layout)[0]).toBeCloseTo(12.1);
      expect(live.type === 'circle' ? live.cx : live.x).toBeCloseTo(shape === 'circle' ? 12.1 : 12);
      expect(live.type === 'circle' ? live.cy : live.y).toBeCloseTo(shape === 'circle' ? 7.1 : 7);
      const saved = buildRecs([rec], layout);
      const loaded = place(
        saved,
        new DataView(saved.buffer).getInt16(8, true),
        new DataView(saved.buffer).getInt16(10, true),
      );
      expect(lanaiRange(loaded, events(2)).shape).toEqual(live);
      setRecCellPos(rec, layout, 18, 9);
      const moved = lanaiRange(rec, events(2)).shape!;
      expect(moved.type === 'circle' ? moved.cx : moved.x).toBeCloseTo(shape === 'circle' ? 18.1 : 18);
    }
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

  test('new parts cover a switch, characters, doors, stairs, messages, a clerk, chests and ranges', () => {
    const parts = lanaiEventParts(undefined, undefined, { npcModel: 0x1a2, monsterDesign: 7 });
    expect(parts.map((p) => [p.section, p.section === 3 ? p.raw[0x15] : u32(p.raw, 0)])).toEqual([
      [5, 4],
      [5, 4],
      [5, 0],
      [5, 1],
      [3, LANAI_DOOR_KIND],
      [3, LANAI_DOOR_KIND],
      [3, 4],
      [3, 2],
      [3, 5],
      [3, 6],
      [5, LANAI_SIGN_KIND],
      [5, 0],
      [5, 0],
      [4, 0],
      [4, 3],
      [8, 1],
      [8, 0],
    ]);
    // no MapChara row of the kind: one is made when placed
    expect(parts[0]!.event.switchTrigger).toBe('switch');
    expect(parts[1]!.event.switchTrigger).toBe('button');
    expect(parts[2]!.event.chara).toEqual({ kind: 0, model: 0x1a2 });
    expect(parts[3]!.event.chara).toEqual({ kind: 1, model: 7 });
    expect(parts[4]!.event.action).toBe(LANAI_ACTION_EXTERNAL_DOOR);
    expect(parts[6]!.event.action).toBe(0x80000012);
    expect(parts[7]!.event.action).toBe(0x80000014);
    // a sign, an NPC with a line and a clerk: each adds a line to the talk table when placed
    expect(parts.slice(10, 13).map((x) => [x.event.action, x.event.talk?.speaker, !!x.event.shop])).toEqual([
      [LANAI_ACTION_SIGN, LANAI_SPEAKER_NONE, false],
      [LANAI_ACTION_TALK, LANAI_SPEAKER_NPC, false],
      [LANAI_ACTION_SHOP, LANAI_SPEAKER_NPC, true],
    ]);
    expect(parts.slice(10, 13).every((x) => x.category === 'メッセージ・店')).toBe(true);
  });

  test('the poison floor: a section 1 record of kind 1, as the records of the ROM are', () => {
    const [poison] = lanaiFloorParts();
    expect(poison!.section).toBe(1);
    expect([...poison!.raw]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, LANAI_FLOOR_POISON, 0, 0]);
    expect(lanaiRecLabel(1, poison!.raw)).toBe('毒床');
    expect(lanaiFloorKindLabel(2)).toBe('床のギミック 2');
    expect(lanaiFloorKindLabel(3)).toBe('凍った床');
    expect(lanaiFloorParts().map((p) => p.raw[0x0d])).toEqual([1, 3]);
    // the models the game places for the floors (FUN_0021C534), shown as their thumbnails
    expect(lanaiFloorParts().map((p) => p.model)).toEqual([
      { type: 'object', row: 89 },
      { type: 'object', row: 113 },
    ]);
    expect([0, 1, 2, 3].map((k) => LANAI_FLOOR_ROWS[k])).toEqual([90, 89, 113, 113]);
  });

  test('the number a level door shows (FUN_00448444)', () => {
    expect([5, 6, 10, 30, 50, 55, 60, 90, 99, 100, 0x105].map(lanaiLevelDoorNumber)).toEqual([
      '010_',
      '025_',
      '011_',
      '015_',
      '019_',
      '024_',
      '020_',
      '023_',
      '024_',
      '024_',
      '010_',
    ]);
    expect(lanaiLevelDoorNumber(0)).toBeUndefined();
    // in the look of a level door, from its event row's +0x5C
    const exit = new Uint8Array(0x18);
    exit[0x15] = LANAI_LEVEL_DOOR_KIND;
    w32(exit, 4, 1);
    const row = new Uint8Array(100);
    row[0x5c] = 30;
    const mapObject = { rows: 100, u32: (r: number) => (r === 49 ? 1 : 0), row: () => new Uint8Array(0x30) };
    const look = lanaiRecordLook(3, exit, {
      mapObject: mapObject as never,
      mapChara: undefined,
      events: { rows: 2, row: () => row } as never,
      indoor: false,
    });
    expect(look?.model).toEqual({ type: 'object', row: 49, material: '015_' });
    expect(lanaiExitLabel(LANAI_LEVEL_DOOR_KIND)).toBe('レベルの扉');
  });

  test('the exit kinds the ROM survey names and groups (Issue #219)', () => {
    expect(lanaiExitLabel(0)).toBe('マップの門');
    expect(lanaiExitLabel(11)).toBe('到着点');
    expect(lanaiExitLabel(40)).toBe('建物の入口 40');
    expect(lanaiExitLabel(68)).toBe('崖の降下点');
    // not settled: keep the number
    expect(lanaiExitLabel(17)).toBe('種類 17');
    expect(lanaiExitLabel(9)).toBe('種類 9');
    expect(lanaiExitNote(17)).toContain('未確認');
    expect(lanaiExitCategory(8)).toBe('到着点');
    expect(lanaiExitCategory(13)).toBe('扉');
    expect(lanaiExitCategory(2)).toBe('出入口・移動');
    expect(lanaiRecLabel(3, Object.assign(new Uint8Array(0x18), { [0x15]: 18 }))).toBe('出入口 #18');
  });

  test('the anchor of a record in the link to a map', () => {
    expect(lanaiMapHref(3)).toBe('#/maps/3');
    expect(lanaiMapHref(3, 'D01001B01')).toBe('#/maps/3.D01001B01');
    expect(lanaiMapHref(3, 'D01001B01', { section: 5, index: 12 })).toBe('#/maps/3.D01001B01@5.12');
    // a record needs its map
    expect(lanaiMapHref(3, undefined, { section: 5, index: 12 })).toBe('#/maps/3');
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

  test('the records copied from the stage are one category; the warps show their models', () => {
    const st = lanaiEditState(maps);
    st.open(maps.mapByName('D01001B01')!);
    const all = st.templates();
    const copied = all.filter((t) => !t.event && !t.source.startsWith('新規'));
    expect(copied.length).toBeGreaterThan(0);
    expect(copied.every((t) => t.category === LANAI_EXISTING_CATEGORY)).toBe(true);
    // no badge in place of the model: the picker draws the 3D model of the look
    expect(all.filter((t) => t.section === 3 && [2, 4].includes(t.raw[0x15]!)).every((t) => !t.iconLabel)).toBe(true);
    expect(all.find((t) => t.source === '新規毒床')?.category).toBe('新規・設定付き');
  });

  test('a sign, a talking NPC and a clerk add a line to the talk table; undo and redo keep it', () => {
    const st = lanaiEditState(maps);
    const info = maps.mapByName('D01001B01')!;
    st.open(info);
    const events = maps.eventTable(info.dungeon)!;
    const talk = maps.talkTable(info.dungeon)!;
    const cols = talkColumns({ table: talk })!;
    const text = (row: number): string => s.plainAt(talk, talk.u32(row, cols.message));
    for (const [source, action, speaker, line] of [
      ['新規看板', LANAI_ACTION_SIGN, LANAI_SPEAKER_NONE, 'この先 きけん'],
      ['新規話す NPC', LANAI_ACTION_TALK, LANAI_SPEAKER_NPC, 'こんにちは。\nいい天気ですね。'],
      ['新規店の人', LANAI_ACTION_SHOP, LANAI_SPEAKER_NPC, 'いらっしゃいませ。'],
    ] as const) {
      const template = st.templates().find((t) => t.source === source)!;
      const rows = talk.rows;
      const eventRows = events.rows;
      st.edit((doc) =>
        st.placeStamp(
          doc,
          { type: 'template', t: { ...template, event: { ...template.event!, talk: { text: line, speaker } } } },
          6.5,
          6.5,
        ),
      );
      const rec = st.current!.recs[5]!.at(-1)!;
      const row = lanaiRecEventRow(5, rec.raw);
      expect(row).toBe(eventRows);
      // the action names the new line (its row number), the other arguments are 0 as the ROM's clerks' are
      expect([events.u32(row, 0x10), events.u32(row, 0x14), events.u32(row, 0x18)]).toEqual([action, rows, 0]);
      expect(talk.rows).toBe(rows + 1);
      expect(text(rows)).toBe(line);
      expect(talk.u8(rows, TALK_SPEAKER)).toBe(speaker);
      // no voice: an empty string, as the ROM's NPC lines have
      expect(talk.data[talk.u32(rows, cols.voice)]).toBe(0);
      st.undo();
      expect([talk.rows, events.rows]).toEqual([rows, eventRows]);
      st.redo();
      expect([talk.rows, events.rows]).toEqual([rows + 1, eventRows + 1]);
      expect(text(rows)).toBe(line);
      st.undo();
      expect(talk.rows).toBe(rows);
    }
  });

  test('a new poison floor has no event row and is undone with the map', () => {
    const st = lanaiEditState(maps);
    const info = maps.mapByName('D01001B01')!;
    st.open(info);
    const events = maps.eventTable(info.dungeon)!;
    const rows = events.rows;
    const before = st.current!.recs[1]?.length ?? 0;
    const template = st.templates().find((t) => t.source === '新規毒床')!;
    st.edit((doc) => st.placeStamp(doc, { type: 'template', t: template }, 6, 7));
    const rec = st.current!.recs[1]!.at(-1)!;
    expect([rec.x, rec.y, rec.raw[0x0c], rec.raw[0x0d]]).toEqual([6, 7, 1, LANAI_FLOOR_POISON]);
    expect(events.rows).toBe(rows);
    st.undo();
    expect(st.current!.recs[1]?.length ?? 0).toBe(before);
  });

  test('where an exit leads and what leads to it', () => {
    const st = lanaiEditState(maps);
    const info = maps.mapByName('D01001B01')!;
    st.open(info);
    const events = maps.eventTable(info.dungeon)!;
    const template = st.templates().find((t) => t.source === '新規ワープホール')!;
    const target = st.current!.recs[3]!.findIndex((r) => r.raw[0x15] !== 100);
    const point = u32(st.current!.recs[3]![target]!.raw, 0);
    expect(lanaiDestinationPlace(maps, info.hash, point)).toEqual({ map: info.name, section: 3, index: target });
    expect(lanaiDestinationPlace(maps, info.hash, 0x12345678)).toBeNull();
    const had = lanaiArrivals(maps, info.hash, point).length;
    st.edit((doc) =>
      st.placeStamp(
        doc,
        {
          type: 'template',
          t: { ...template, event: { ...template.event!, destination: { map: info.hash, point } } },
        },
        5.5,
        5.5,
      ),
    );
    const index = st.current!.recs[3]!.length - 1;
    expect(lanaiArrivals(maps, info.hash, point)).toContainEqual({ map: info.name, section: 3, index });
    expect(lanaiArrivals(maps, info.hash, point).length).toBe(had + 1);
    // the level of a level door is the event row's +0x5C
    const row = u32(st.current!.recs[3]![index]!.raw, 4);
    st.setEventField(row, (t) => t.setU16(row, LANAI_EVENT_LEVEL, 30));
    expect(events.u16(row, LANAI_EVENT_LEVEL)).toBe(30);
    st.undo();
    st.undo();
    expect(lanaiArrivals(maps, info.hash, point).length).toBe(had);
  });

  test('the add panel offers a button, characters and ranges made from nothing', () => {
    const st = lanaiEditState(maps);
    st.open(maps.mapByName('D01001B01')!);
    const fresh = st.templates().filter((t) => t.event);
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
    const fresh = st.templates().filter((x) => x.event);
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
    expect(t.u16(rows + 1, 0x5c) & 0x8000).toBe(0x8000);
    expect(lanaiRange(area, t).shape).toMatchObject({ type: 'rect', x: 12, y: 12 });
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
    const fresh = st.templates().filter((x) => x.event);
    const door = fresh.find((x) => x.source === '新規扉')!;
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
    const button = st.templates().find((x) => x.source === '新規保持スイッチ')!;
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
