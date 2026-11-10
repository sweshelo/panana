import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ArmMachine } from '../src/game/arm';
import { openImages, openUpdate } from '../src/rom/dump';
import { u32, w32 } from '../src/util/bytes';
import { LANAI_CONDITIONS } from '../src/lanai/conditions';
import { lanaiContents } from '../src/lanai/contents';
import { DestinationFields, lanaiDestinationPoints } from '../src/lanai/DestinationFields';
import { EventConditionFields } from '../src/lanai/EventConditionFields';
import { lanaiEventChoices, LanaiEventSelect } from '../src/lanai/EventSelect';
import { LanaiEditState } from '../src/lanai/mapedit';
import { lanaiMaps, type LanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';
import { parseArchive, unpackEntry } from '../src/archive/gsarc';

describe.skipIf(!hasLanai)('FREE! event predicates from the local Update ROM', () => {
  let code: Uint8Array;
  beforeAll(async () => {
    code = (await openUpdate(Bun.file(LANAI_UPDATE), 'update')).code;
  });
  const run = (kind: number, value: number, result: number, v2 = 0): { result: number; reads: number[][] } => {
    const reads: number[][] = [];
    const m = new ArmMachine(code, {
      maxDepth: 4,
      stubs: new Map([
        [
          0x31c464,
          (cpu: ArmMachine) => {
            reads.push([cpu.r[1]!, cpu.r[2]!]);
            return result;
          },
        ],
        [0x43d998, () => 65536],
        [
          0x2c7028,
          (cpu: ArmMachine) => {
            reads.push([3, cpu.r[0]!]);
            return result;
          },
        ],
      ]),
    });
    m.write(0x4eae3c, 0x30000000, 4);
    m.wb(0x3000002c, 1); // loaded field: required by predicates 0x0C / 0x0D
    return { result: m.run(0x2fcd38, [kind, value, v2, 0]) & 255, reads };
  };
  test('clear bits (0x53), flags (0x51), values (0x52) use distinct save keys; indices are u16', () => {
    for (const [kind, key] of [
      [1, 0x53],
      [2, 0x53],
      [3, 0x51],
      [4, 0x51],
      [5, 0x52],
      [6, 0x52],
      [7, 0x52],
    ]) {
      expect(run(kind!, 0x10023, 1, 3).reads).toEqual([[key!, 0x23]]);
    }
  });
  test('the actual branches implement set / clear and unsigned = / >= / <= comparisons', () => {
    for (const result of [0, 1]) {
      for (const kind of [1, 3]) expect(run(kind, 2, result).result).toBe(result);
      for (const kind of [2, 4]) expect(run(kind, 2, result).result).toBe(1 - result);
    }
    for (const result of [0, 2, 3, 4, 255]) {
      expect(run(5, 9, result, 3).result).toBe(Number(result === 3));
      expect(run(6, 9, result, 3).result).toBe(Number(result >= 3));
      expect(run(7, 9, result, 3).result).toBe(Number(result <= 3));
      expect(run(12, 9, result, 3)).toEqual({ result: Number(result >= 3), reads: [[3, 9]] });
      expect(run(13, 9, result, 3)).toEqual({ result: Number(result <= 3), reads: [[3, 9]] });
    }
  });
  test('zero returns the caller default: appear=true, disappear=false; constant predicates ignore values', () => {
    for (const def of [0, 1]) expect(new ArmMachine(code).run(0x2fcd38, [0, 99, 99, def])).toBe(def);
    for (const kind of [8, 10, 29]) expect(run(kind, 123, 0).result).toBe(0);
    for (const kind of [9, 11]) expect(run(kind, 123, 0).result).toBe(1);
    expect(LANAI_CONDITIONS[42]).toBeUndefined(); // not given a guessed generic meaning
  });
  test('timer predicates read start time and duration from keys 0x17 / 0x18 and compare remaining time to zero', () => {
    for (const [now, expected] of [
      [100, 1],
      [102, 1],
      [105, 0],
      [106, 0],
    ]) {
      for (const kind of [22, 23]) {
        const reads: number[][] = [];
        const m = new ArmMachine(code, {
          maxDepth: 8,
          stubs: new Map([
            [
              0x3107a8,
              (cpu: ArmMachine) => {
                reads.push([cpu.r[1]!, cpu.r[2]!]);
                cpu.write(cpu.r[3]!, cpu.r[1] === 0x17 ? 100 : 5000000, 4);
                cpu.write(cpu.r[3]! + 4, 0, 4);
                return 1;
              },
            ],
            [
              0x3258c8,
              (cpu: ArmMachine) => {
                cpu.write(cpu.r[0]!, now!, 4);
                cpu.write(cpu.r[0]! + 4, 0, 4);
                return 0;
              },
            ],
          ]),
        });
        expect(m.run(0x2fcd38, [kind, 0x10066, 123, 0])).toBe(kind === 22 ? expected! : 1 - expected!);
        expect(reads).toEqual([
          [0x17, 102],
          [0x18, 102],
        ]);
      }
    }
  });
});

describe.skipIf(!hasLanai)('FREE! event and destination selectors', () => {
  let maps: LanaiMaps;
  let st: LanaiEditState;
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as File).name);
    const session = await LanaiSession.open(dump, { fresh: true });
    maps = await lanaiMaps(session, lanaiContents(session)[38]!);
    st = new LanaiEditState(maps);
    st.open(maps.mapByName('D01001B01')!);
  }, 300000);
  test('event choices include placements, other maps, action names and unplaced events', () => {
    const choices = lanaiEventChoices(maps, st.info!.dungeon);
    expect(choices.length).toBe(maps.eventTable(st.info!.dungeon)!.rows - 1);
    expect(choices.some((c) => c.where && c.sub?.includes(st.info!.name))).toBe(true);
    const html = renderToString(<LanaiEventSelect st={st} value={choices[0]!.value} allowNone onChange={() => {}} />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('loot-item');
    expect(html).toContain('イベント #');
    expect(html).not.toContain('EventObject の行');
  });
  test('destinations use IDs, retain unknown values and omit wall doors', () => {
    const points = lanaiDestinationPoints(maps, st.info!.hash);
    const exits = maps.doc(st.info!).recs[3]!.filter((r) => r.raw[0x15] !== 100);
    expect(points.map((p) => p.value)).toEqual(exits.map((r) => u32(r.raw, 0)));
    expect(points.every((p) => p.where?.doc.hash === st.info!.hash)).toBe(true);
    const html = renderToString(
      <DestinationFields maps={maps} map={st.info!.hash} point={0xabcdef01} onChange={() => {}} />,
    );
    expect(html).toContain('行き先のマップ');
    expect(html).toContain('ABCDEF01');
    expect(html).toContain('行き先にない');
  });
  test('unknown condition keeps its type and values; condition edits and event assignment can be undone', () => {
    const table = maps.eventTable(st.info!.dungeon)!;
    const rec = st.current!.recs[3]!.find((r) => u32(r.raw, 4) > 0)!;
    const oldEvent = u32(rec.raw, 4);
    const original = table.row(oldEvent).slice();
    st.setEventField(oldEvent, (t) => {
      t.setU8(oldEvent, 0x5f, 42);
      t.setU32(oldEvent, 0, 0x12345678);
    });
    const before = table.row(oldEvent).slice();
    const html = renderToString(<EventConditionFields st={st} event={oldEvent} field={0x5f} />);
    expect(html).toContain('未解析の条件 0x2A');
    expect(table.row(oldEvent)).toEqual(before);
    st.undo();
    expect(table.row(oldEvent)).toEqual(original);
    const other = oldEvent === 1 ? 2 : 1;
    const currentRec = st.current!.recs[3]!.find((r) => u32(r.raw, 0) === u32(rec.raw, 0))!;
    st.edit(() => w32(currentRec.raw, 4, other));
    expect(u32(st.current!.recs[3]!.find((r) => u32(r.raw, 0) === u32(rec.raw, 0))!.raw, 4)).toBe(other);
    st.undo();
    expect(st.current!.recs[3]!.some((r) => u32(r.raw, 4) === oldEvent)).toBe(true);
  });
  test('generic conditions and destination IDs survive MOD export, save/restore, and undo', async () => {
    const table = maps.eventTable(st.info!.dungeon)!;
    const event = u32(st.current!.recs[3]!.find((r) => u32(r.raw, 4) > 0)!.raw, 4);
    const original = table.row(event).slice();
    const point = lanaiDestinationPoints(maps, st.info!.hash)[0]!.value;
    st.setEventField(event, (t) => {
      t.setU8(event, 0x5f, 6);
      t.setU32(event, 0, 27);
      t.setU32(event, 4, 3);
      t.setU32(event, 0x10, 0x80000013);
      t.setU32(event, 0x14, st.info!.hash);
      t.setU32(event, 0x18, point);
    });
    const html = renderToString(<EventConditionFields st={st} event={event} field={0x5f} />);
    expect(html).toContain('数値が指定値以上');
    expect(html).toContain('value="27"');
    expect(html).toContain('value="3"');
    const archive = parseArchive(maps.session.modFiles().get(maps.content.archive)!);
    const entry = archive.entries.find((e) => e.hash === maps.groups[st.info!.dungeon]!.eventEntry)!;
    expect(unpackEntry(archive, entry).body).toEqual(table.data);
    const restored = await LanaiSession.open(maps.session.dump, { fresh: true });
    await restored.restore(maps.session.saved());
    const next = await lanaiMaps(restored, lanaiContents(restored)[38]!);
    expect(next.eventTable(st.info!.dungeon)!.row(event)).toEqual(table.row(event));
    st.undo();
    expect(table.row(event)).toEqual(original);
    expect(maps.session.modFiles().size).toBe(0);
  });
});
