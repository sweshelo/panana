// 電波人間のRPG FREE! (lanai): where the exits of a map stand (src/lanai/mapObjects.ts: the record's own offset, no
// step towards the direction; the code's default models), the offset of new and turned doors (mapedit.ts), and the
// connections of the records of a map (mapLinks.ts), with the dumps.
import { beforeAll, describe, expect, test } from 'bun:test';
import { isIndoor } from '../src/game/objects';
import { CELL, recCellPos } from '../src/game/sections';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { LANAI_DOOR_KIND } from '../src/lanai/eventParts';
import { lanaiEditState } from '../src/lanai/mapedit';
import { lanaiMapLinks } from '../src/lanai/mapLinks';
import { lanaiDoorOffset, lanaiExitDefaultRow, lanaiRecordLook } from '../src/lanai/mapObjects';
import { LANAI_EVENT_ACTIONS, LANAI_LAYOUTS, LanaiMaps, lanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { cloneLanaiContent } from '../src/lanai/stageEdit';
import { openImages } from '../src/rom/dump';
import { f32, u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe('RPG FREE! exits: defaults read from the code', () => {
  test('the default model rows by kind (FUN_004334F8)', () => {
    expect([0, 1, 2, 4, 7, 9, 12, 18].map(lanaiExitDefaultRow)).toEqual([44, 44, 105, 44, 84, 104, 45, 51]);
    expect([21, 34, 39, 65, 66, 67, 69].map(lanaiExitDefaultRow)).toEqual([206, 219, 227, 253, 220, 254, 753]);
    // stairs, the invisible kinds and the clear warp are not in the table
    expect([3, 5, 6, 8, 10, 11, 19, 68, 100].map(lanaiExitDefaultRow)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('the offset of a door towards the edge of its cell, by facing and model', () => {
    expect(lanaiDoorOffset(1, 0)).toEqual([0, 1]);
    expect(lanaiDoorOffset(4, 0)).toEqual([0, -1]);
    expect(lanaiDoorOffset(2, 0)).toEqual([1, 0]);
    expect(lanaiDoorOffset(8, 53)).toEqual([-1.46, 0]);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! exits and links (ROM)', () => {
  let s: LanaiSession;
  let all: LanaiMaps[];
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump);
    all = [];
    for (const c of lanaiContents(s)) {
      try {
        all.push(await LanaiMaps.load(s, c));
      } catch {
        /* a content without maps */
      }
    }
  }, 300000);

  test('doors, gates and warp holes have a model and stand at the record (no step towards the direction)', () => {
    const mapObject = s.table('MapObject');
    const count: Record<number, number> = {};
    for (const maps of all)
      for (const info of maps.maps) {
        if (info.world) continue;
        const doc = maps.doc(info);
        const ctx = {
          mapObject,
          mapChara: maps.contentTable('MapChara'),
          events: maps.eventTable(info.dungeon),
          indoor: isIndoor(doc),
        };
        for (const r of doc.recs[3] ?? []) {
          const kind = r.raw[0x15]!;
          if (kind !== 2 && kind !== 4 && kind !== LANAI_DOOR_KIND) continue;
          const look = lanaiRecordLook(3, r.raw, ctx);
          expect(look?.model?.type).toBe('object');
          expect(look?.offset).toBeUndefined();
          count[kind] = (count[kind] ?? 0) + 1;
        }
      }
    expect(count).toEqual({ 2: 91, 4: 75, 12: 191 });
  });

  test('warps of a map: pairs that lead to each other are one line, the others arrows to their destination', () => {
    let both = 0,
      oneWay = 0;
    for (const maps of all)
      for (const info of maps.maps) {
        if (info.world) continue;
        const doc = maps.doc(info);
        const exits = doc.recs[3] ?? [];
        const events = maps.eventTable(info.dungeon)!;
        for (const l of lanaiMapLinks(maps, info, doc)) {
          expect(l.type).toBe('warp');
          const [from, to] = [exits[l.from[1]]!, exits[l.to[1]]!];
          // the link is the event's destination: this map, the other record's point ID
          const row = u32(from.raw, 4);
          expect(events.u32(row, LANAI_EVENT_ACTIONS[0] + 4)).toBe(info.hash);
          expect(events.u32(row, LANAI_EVENT_ACTIONS[0] + 8)).toBe(u32(to.raw, 0));
          expect(l.a).toEqual(recCellPos(from, LANAI_LAYOUTS[3]!));
          const back = u32(to.raw, 4);
          const leadsBack =
            events.u32(back, LANAI_EVENT_ACTIONS[0] + 4) === info.hash &&
            events.u32(back, LANAI_EVENT_ACTIONS[0] + 8) === u32(from.raw, 0);
          if (!l.oneWay) expect(leadsBack).toBe(true);
          if (l.oneWay) oneWay++;
          else both++;
        }
      }
    expect([both, oneWay]).toEqual([19, 39]);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! new doors (ROM)', () => {
  let c: LanaiContent;
  let maps: LanaiMaps;
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    const s = await LanaiSession.open(dump, { fresh: true });
    const index = await cloneLanaiContent(s, lanaiContents(s)[1]!, '扉の島', { script: 'empty' });
    c = lanaiContents(s)[index]!;
    maps = await lanaiMaps(s, c);
  }, 300000);

  test("a new door takes the offset of the data's doors, and turning it turns the offset", () => {
    const st = lanaiEditState(maps);
    const info = maps.mapByName('D01001B01')!;
    st.open(info);
    const door = st.templates().find((t) => t.source === '新規扉')!;
    const tile = st.current!.tiles.find((t) => t.kind !== 6)!;
    let at: [number, number] = [0, 0];
    st.edit((d) => {
      at = st.placeStamp(d, { type: 'template', t: door }, tile.x + 0.5, tile.y + 0.5);
    });
    const rec = st.current!.recs[at[0]]![at[1]]!;
    const L = LANAI_LAYOUTS[3]!;
    const offset = (): [number, number] => [f32(rec.raw, L.fxo!), f32(rec.raw, L.fyo!)];
    const expected = lanaiDoorOffset(rec.raw[0x14]!, door.event!.look ?? 0);
    expect(expected[0] || expected[1]).not.toBe(0);
    expect(offset()[0]).toBeCloseTo(expected[0], 5);
    expect(offset()[1]).toBeCloseTo(expected[1], 5);
    // the preview stands the model there (cell centre + offset × 100)
    const [px, py] = recCellPos(rec, L);
    expect(px * CELL).toBeCloseTo((tile.x + 0.5) * CELL + expected[0] * 100, 2);
    expect(py * CELL).toBeCloseTo((tile.y + 0.5) * CELL + expected[1] * 100, 2);
    for (let i = 0; i < 4; i++) {
      st.rotateRecord(rec, 3, 1);
      const want = lanaiDoorOffset(rec.raw[0x14]!, door.event!.look ?? 0);
      expect(offset()[0]).toBeCloseTo(want[0], 5);
      expect(offset()[1]).toBeCloseTo(want[1], 5);
    }
  });
});
