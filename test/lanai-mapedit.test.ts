// The RPG FREE! (lanai) map editor: the edit state (facings, copies, checks), saving the map database with the
// session's edits and the MOD export (an unedited database builds byte for byte; one tile changed changes only its
// record in the content's archive), copies of records with their own EventObject rows, and section 6.
import { beforeAll, describe, expect, test } from 'bun:test';
import { entryBlob, parseArchive, rebuildArchive, unpackEntry } from '../src/archive/gsarc';
import { Controller } from '../src/editor/controller';
import { MapDb } from '../src/game/mapdb';
import { buildTiles, LANAI_ROT_CODEC, type Rec } from '../src/game/sections';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { LANAI_ACTION_GOAL_CHEST, LANAI_ACTION_SCRIPT } from '../src/lanai/actions';
import { LanaiEditState, lanaiEditState, lanaiValidate, lanaiValidateAll } from '../src/lanai/mapedit';
import {
  LANAI_EVENT_SLOT,
  LANAI_LAYOUTS,
  LANAI_MAPDB_ENTRY,
  LANAI_MAP_FORMAT,
  lanaiEventSlot,
  lanaiMaps,
  type LanaiMaps,
} from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { lanaiRecKind, lanaiRomParts, romPartKey } from '../src/lanai/romParts';
import {
  lanaiChestField,
  lanaiChestUsers,
  lanaiTreasureRowBytes,
  lanaiTreasureSlots,
  lanaiWriteTreasure,
  type LanaiChestUser,
} from '../src/lanai/treasure';
import { openImages, type Dump } from '../src/rom/dump';
import { equalBytes, u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe('map database changes', () => {
  // two entries, the second one sharing the first one's block
  const db = (): MapDb => {
    const b = new Uint8Array(4 + 2 * 12 + 4);
    const v = new DataView(b.buffer);
    v.setUint32(0, 2, true);
    v.setUint32(4, 1, true);
    v.setUint32(8, 0, true);
    v.setUint32(12, 4, true);
    v.setUint32(16, 2, true);
    v.setUint32(20, 0, true);
    v.setUint32(24, 4, true);
    b.set([1, 2, 3, 4], 28);
    return new MapDb(b);
  };

  test('a section set back to its bytes and reverted builds as the original (shared blocks stay shared)', () => {
    const d = db();
    const orig = d.build();
    d.set(1, new Uint8Array([9, 9, 9, 9]));
    expect(d.changedHashes()).toEqual([1]);
    expect(d.build().length).toBe(orig.length + 4);
    d.set(1, new Uint8Array([1, 2, 3, 4]));
    expect(d.changedHashes()).toEqual([]);
    d.revert(1);
    expect(equalBytes(d.build(), orig)).toBe(true);
  });
});

describe('lanai record facings', () => {
  const st = new LanaiEditState({ on: () => () => {} } as unknown as LanaiMaps);
  const rec = (section: number, byte: number): Rec => {
    const raw = new Uint8Array(LANAI_LAYOUTS[section]!.size);
    raw[{ 2: 0x10, 3: 0x14, 4: 0x14, 5: 0x1c }[section]!] = byte;
    return { raw, x: 0, y: 0 };
  };

  test('R turns sections 2〜5 through 4 → 2 → 1 → 8 and back', () => {
    for (const [k, o] of [
      [2, 0x10],
      [3, 0x14],
      [4, 0x14],
      [5, 0x1c],
    ] as const) {
      expect(st.canRotate(k)).toBe(true);
      const r = rec(k, 4);
      const seen: number[] = [];
      for (let i = 0; i < 4; i++) {
        st.rotateRecord(r, k, 1);
        seen.push(r.raw[o]!);
      }
      expect(seen).toEqual([2, 1, 8, 4]);
      st.rotateRecord(r, k, -1);
      expect(r.raw[o]).toBe(8);
      expect(LANAI_ROT_CODEC.decode(r.raw[o]!)).toBe(3);
    }
    expect(st.canRotate(1)).toBe(false);
    expect(st.canRotate(8)).toBe(false);
  });

  test('a byte of no mask turns from 0', () => {
    const r = rec(3, 3);
    st.rotateRecord(r, 3, 1);
    expect(r.raw[0x14]).toBe(2);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! map editor', () => {
  let dump: Dump;
  let s: LanaiSession;
  let content: LanaiContent;
  let maps: LanaiMaps;
  beforeAll(async () => {
    dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump, { fresh: true });
    content = lanaiContents(s)[38]!;
    maps = await lanaiMaps(s, content);
  }, 300000);

  test("every content: the map database builds as the ROM's, and nothing goes to the MOD unedited", async () => {
    const archives = new Set<string>();
    for (const c of lanaiContents(s)) {
      const r = await s.mapDb(c.archive).catch(() => null);
      if (!r) continue;
      archives.add(r.archive);
      expect(equalBytes(r.db.build(), unpackEntry(r.arc, r.entry).body)).toBe(true);
    }
    expect(archives.size).toBe(127);
    const raw = await dump.readRomfs(content.archive);
    expect(equalBytes(rebuildArchive(parseArchive(raw), new Map()), raw)).toBe(true);
    expect(s.changedMapDbs()).toEqual([]);
    expect(s.modFiles().size).toBe(0);
  }, 300000);

  test('one tile painted: only its record differs in the rebuilt archive; undo takes it back', async () => {
    const info = maps.mapByName('D01001B01')!;
    const st = lanaiEditState(maps);
    st.open(info);
    expect(st.templates().find((t) => t.source === '新規ワープゲート')).toMatchObject({
      label: 'ワープゲート',
      model: { type: 'object', row: 44 },
      event: { look: 0 },
    });
    expect(st.templates().find((t) => t.source === '新規ワープホール')).toMatchObject({
      label: 'ワープホール',
      model: { type: 'object', row: 105 },
      event: { look: 0 },
    });
    const ctl = new Controller(st);
    const doc = st.current!;
    const i = doc.tiles.findIndex((t) => t.kind === 5);
    const t = doc.tiles[i]!;
    st.brush = { kind: 14, letter: 0x7a, rot: 1 };
    st.setTool('paint');
    ctl.down(t.x + 0.5, t.y + 0.5, { shiftKey: false, button: 0 });
    ctl.up();
    expect(maps.isChanged(info)).toBe(true);
    expect(s.changedMapDbs()).toEqual([{ archive: content.archive, sections: 1 }]);

    const files = s.modFiles();
    expect([...files.keys()]).toEqual([content.archive]);
    const arc = parseArchive(files.get(content.archive)!);
    const orig = parseArchive(await dump.readRomfs(content.archive));
    expect(arc.entries.length).toBe(orig.entries.length);
    for (const e of orig.entries) {
      const ae = arc.entries[e.index]!;
      expect(ae.hash).toBe(e.hash);
      if (e.hash !== LANAI_MAPDB_ENTRY) {
        // copied as they are
        expect(equalBytes(entryBlob(arc, ae), entryBlob(orig, e))).toBe(true);
        continue;
      }
      const a = unpackEntry(arc, ae).body;
      const o = unpackEntry(orig, e).body;
      // same size (a tile changed in place): only the 20 bytes of that record differ
      expect(a.length).toBe(o.length);
      const db = new MapDb(a),
        odb = new MapDb(o);
      const tiles = info.sections[0]!;
      // the bytes that differ lie in one 20-byte run (the record), the index and the other blocks are the same
      const diff = [...a.keys()].filter((k) => a[k] !== o[k]);
      expect(diff.length).toBeGreaterThan(0);
      expect(diff[diff.length - 1]! - diff[0]!).toBeLessThan(20);
      const nb = db.get(tiles),
        ob = odb.get(tiles);
      const d2 = [...nb.keys()].filter((k) => nb[k] !== ob[k]);
      expect(d2.every((k) => Math.floor(k / 20) === i)).toBe(true);
      expect(u32(nb, i * 20)).toBe(14);
      expect(nb[i * 20 + 0x10]).toBe(LANAI_ROT_CODEC.encode(1));
      for (const h of info.sections)
        if (h && h !== tiles && odb.has(h)) expect(equalBytes(db.get(h), odb.get(h))).toBe(true);
    }
    // the edits are saved with the session's and come back on a fresh one
    const saved = s.saved();
    expect(saved.maps?.map(([a, h]) => [a, h])).toEqual([[content.archive, info.sections[0]!]]);
    const other = await LanaiSession.open(dump, { fresh: true });
    await other.restore(saved);
    const om = await lanaiMaps(other, lanaiContents(other)[38]!);
    expect(om.doc(om.mapByName('D01001B01')!).tiles[i]).toMatchObject({ kind: 14, rot: 1 });
    expect(other.modFiles().size).toBe(1);
    other.revertAll();
    expect(om.doc(om.mapByName('D01001B01')!).tiles[i]!.kind).toBe(5);
    expect(other.modFiles().size).toBe(0);

    st.undo();
    expect(st.current!.tiles[i]!.kind).toBe(5);
    expect(maps.isChanged(info)).toBe(false);
    expect(s.modFiles().size).toBe(0);
    expect(equalBytes(buildTiles(st.current!.tiles, LANAI_MAP_FORMAT.tile), maps.db.original(info.sections[0]!))).toBe(
      true,
    );
  });

  test('records: moving, turning, copying an exit (new point ID, its own EventObject row) and deleting', () => {
    const info = maps.mapByName('D01001B01')!;
    const st = lanaiEditState(maps);
    st.open(info);
    const ctl = new Controller(st);
    const table = maps.eventTable(info.dungeon)!;
    const rows = table.rows;
    const exits = st.current!.recs[3]!;
    const e = exits.findIndex((r) => u32(r.raw, 4) > 0);
    expect(e).toBeGreaterThanOrEqual(0);
    const n = exits.length;
    st.select({ type: 'rec', section: 3, index: e });
    const facing = exits[e]!.raw[0x14]!;
    ctl.rotate(1);
    expect(st.current!.recs[3]![e]!.raw[0x14]).toBe(LANAI_ROT_CODEC.encode((LANAI_ROT_CODEC.decode(facing) + 1) & 3));
    ctl.duplicateRec();
    const list = st.current!.recs[3]!;
    expect(list.length).toBe(n + 1);
    const [a, b] = [list[e]!, list[n]!];
    expect(u32(b.raw, 0)).not.toBe(u32(a.raw, 0));
    // the copy names a new row of the group's table: the row's bytes, but a state slot of its own
    expect(table.rows).toBe(rows + 1);
    expect(u32(b.raw, 4)).toBe(rows);
    expect(table.row(rows).subarray(0, LANAI_EVENT_SLOT)).toEqual(
      table.row(u32(a.raw, 4)).subarray(0, LANAI_EVENT_SLOT),
    );
    expect(lanaiEventSlot(table, rows)).not.toBe(lanaiEventSlot(table, u32(a.raw, 4)));
    expect(lanaiValidate(maps, info, st.current!).filter((x) => x.key.startsWith('ev'))).toEqual([]);
    expect([...s.modFiles().keys()]).toEqual([content.archive]);
    const y = b.y;
    ctl.shiftSelection(0, 1);
    expect(st.current!.recs[3]![n]!.y).toBe(y + 1);
    ctl.deleteSelection();
    expect(st.current!.recs[3]!.length).toBe(n);
    // undo the delete, the move and the copy: the added row goes with the copy
    st.undo();
    st.undo();
    expect(table.rows).toBe(rows + 1);
    st.undo();
    expect(st.current!.recs[3]!.length).toBe(n);
    expect(table.rows).toBe(rows);
    st.undo();
    expect(maps.isChanged(info)).toBe(false);
    expect(table.changed).toBe(false);
    expect(s.modFiles().size).toBe(0);
    expect(lanaiValidate(maps, info, st.current!)).toEqual([]);
  });

  test('a copied chest has its own EventObject row (contents and state): exported, saved and put back', async () => {
    let done = false;
    for (const c of lanaiContents(s)) {
      const m = await lanaiMaps(s, c).catch(() => null);
      const info = m?.maps.find((x) => !x.world && (m.doc(x).recs[4] ?? []).some((r) => u32(r.raw, 4) > 0));
      if (!m || !info) continue;
      const st = lanaiEditState(m);
      st.open(info);
      const t = m.eventTable(info.dungeon)!;
      const g = m.group(info)!;
      const i = st.current!.recs[4]!.findIndex((r) => u32(r.raw, 4) > 0);
      const ev = u32(st.current!.recs[4]![i]!.raw, 4);
      const rows = t.rows;
      st.select({ type: 'rec', section: 4, index: i });
      new Controller(st).duplicateRec();
      const copy = st.current!.recs[4]!.at(-1)!;
      expect(u32(copy.raw, 4)).toBe(rows);
      // the treasure (+0x14) is the original's; the slot is a free one of the group's
      expect(t.u32(rows, 0x14)).toBe(t.u32(ev, 0x14));
      const slot = lanaiEventSlot(t, rows);
      expect(slot).toBeLessThan(g.stateCount);
      for (let r = 0; r < rows; r++) expect(lanaiEventSlot(t, r)).not.toBe(slot);
      // a field of the copy edited: the original row keeps its own
      const treasure = t.u32(ev, 0x14);
      st.setEventField(rows, (x) => x.setU32(rows, 0x14, treasure + 1));
      expect(t.u32(rows, 0x14)).toBe(treasure + 1);
      expect(t.u32(ev, 0x14)).toBe(treasure);
      // the content's archive of the MOD has the edited table (and the map database)
      const arc = parseArchive(s.modFiles().get(c.archive)!);
      const e = arc.entries.find((x) => x.hash === g.eventEntry)!;
      expect(equalBytes(unpackEntry(arc, e).body, t.data)).toBe(true);
      // saved and put back on a fresh session
      const other = await LanaiSession.open(dump, { fresh: true });
      await other.restore(s.saved());
      const om = await lanaiMaps(other, lanaiContents(other)[c.index]!);
      const ot = om.eventTable(info.dungeon)!;
      expect(ot.rows).toBe(rows + 1);
      expect(equalBytes(ot.row(rows), t.row(rows))).toBe(true);
      expect(u32(om.doc(om.mapByName(info.name)!).recs[4]!.at(-1)!.raw, 4)).toBe(rows);
      s.revertAll();
      expect(s.modFiles().size).toBe(0);
      done = true;
      break;
    }
    expect(done).toBe(true);
  }, 300000);

  test('new normal and goal chests create private rewards and undo together with placement', () => {
    const info = maps.mapByName('D01001B01')!;
    const st = lanaiEditState(maps);
    st.open(info);
    const events = maps.eventTable(info.dungeon)!;
    const treasure = maps.treasureGroup!;
    const eventRows = events.rows;
    const rewardRows = treasure.rows;
    const chestRows = st.current!.recs[4]?.length ?? 0;
    const tile = st.current!.tiles[0]!;
    for (const [source, count] of [
      ['新規宝箱', 1],
      ['新規クリア宝箱', 3],
    ] as const) {
      const template = st.templates().find((t) => t.source === source)!;
      expect(template).toBeDefined();
      const rewards = Array.from({ length: count }, (_, i) => [{ value: 100 + i, kind: 2, weight: 1 }]);
      st.edit((doc) =>
        st.placeStamp(
          doc,
          { type: 'template', t: { ...template, event: { ...template.event!, rewards } } },
          tile.x + 0.5,
          tile.y + 0.5,
        ),
      );
      const raw = st.current!.recs[4]!.at(-1)!.raw;
      const row = u32(raw, 4);
      expect(row).toBe(events.rows - 1);
      expect(events.u32(row, 0x10)).toBe(count === 3 ? LANAI_ACTION_GOAL_CHEST : 0x8000000e);
      if (count === 3) expect(events.u32(row, 0x18)).toBe(content.index);
      for (let i = 0; i < count; i++) {
        const field = [0x14, 0x2c, 0x44][i]!;
        expect(events.u32(row, field)).toBe(rewardRows + i + (source === '新規クリア宝箱' ? 1 : 0));
        expect(lanaiTreasureSlots(treasure, events.u32(row, field))).toEqual(rewards[i]!);
      }
    }
    expect(events.rows).toBe(eventRows + 2);
    expect(treasure.rows).toBe(rewardRows + 4);
    expect(lanaiValidate(maps, info, st.current!).filter((i) => i.key.startsWith('reward/'))).toHaveLength(0);
    st.undo();
    st.undo();
    expect(st.current!.recs[4]?.length ?? 0).toBe(chestRows);
    expect(events.rows).toBe(eventRows);
    expect(treasure.rows).toBe(rewardRows);
    expect(s.modFiles().size).toBe(0);
  });

  test('the ROM’s kinds are parts of any map: a pit, a recovery point and a sign placed with rows of their own', async () => {
    const parts = await lanaiRomParts(s);
    expect(
      parts
        .filter((p) => p.section === 3 && p.kind === 2 && p.action === 0x80000014)
        .map((p) => p.look)
        .sort((a, b) => a - b),
    ).toEqual([0, 107]);
    expect(
      parts
        .filter((p) => p.section === 3 && p.kind === 4 && p.action === 0x80000012)
        .map((p) => p.look)
        .sort((a, b) => a - b),
    ).toEqual([0, 735]);
    const key = (p: { section: number; kind: number; action: number }): string =>
      romPartKey(p.section, p.kind, p.action);
    const keys = new Set(parts.map(key));
    for (const k of [
      romPartKey(3, 7, 0x8000001d),
      romPartKey(5, 13, 0x80000030),
      romPartKey(5, 11, 0x8000002f),
      romPartKey(1, 0, -1),
    ])
      expect(keys.has(k)).toBe(true);
    // the scripts (the sample's CRO) and the chests (rows of the content's TreasureGroup) are not in it
    expect(parts.some((p) => p.action === LANAI_ACTION_SCRIPT || p.section === 4)).toBe(false);

    const info = maps.mapByName('D01001B01')!;
    const st = lanaiEditState(maps);
    st.open(info);
    const events = maps.eventTable(info.dungeon)!;
    const talk = maps.talkTable(info.dungeon)!;
    const [eventRows, talkRows] = [events.rows, talk.rows];
    const templates = st.romTemplates(parts);
    expect(
      templates
        .filter((t) => t.section === 3 && t.raw[0x15] === 4 && t.event?.action === 0x80000012)
        .map((t) => t.subtitle),
    ).toEqual(['外観 #44', '外観 #735']);
    const of = (section: number, kind: number, action: number) =>
      templates.find(
        (t) => t.section === section && lanaiRecKind(section, t.raw) === kind && t.event?.action === action >>> 0,
      )!;
    const pit = of(3, 7, 0x8000001d);
    expect(pit.label).toContain('落とし穴');
    // a destination is chosen when it is placed (the sample's is a map of its own content)
    expect(pit.event!.destination).toEqual({ map: 0, point: 0 });
    const sign = of(5, 11, 0x8000002f);
    expect(sign.event!.talk!.text.length).toBeGreaterThan(0);
    const tile = st.current!.tiles[0]!;
    for (const t of [pit, of(5, 13, 0x80000030), sign])
      st.edit((doc) => st.placeStamp(doc, { type: 'template', t }, tile.x + 0.5, tile.y + 0.5));
    expect(events.rows).toBe(eventRows + 3);
    const rowOf = (section: number): number => u32(st.current!.recs[section]!.at(-1)!.raw, 4);
    const pitRow = st.current!.recs[3]!.at(-1)!;
    expect(u32(pitRow.raw, 4)).toBe(eventRows);
    expect(events.u32(eventRows, 0x10)).toBe(0x8000001d);
    expect([events.u32(eventRows, 0x14), events.u32(eventRows, 0x18)]).toEqual([0, 0]);
    expect([events.u8(eventRows, 0x5f), events.u8(eventRows, 0x60)]).toEqual([0, 0]);
    expect(events.u32(eventRows + 1, 0x10)).toBe(0x80000030);
    // the sign's line is a new row of this group's talk table
    expect(rowOf(5)).toBe(eventRows + 2);
    expect(talk.rows).toBe(talkRows + 1);
    expect(events.u32(eventRows + 2, 0x14)).toBe(talkRows);
    st.undo();
    st.undo();
    st.undo();
    expect(events.rows).toBe(eventRows);
    expect(talk.rows).toBe(talkRows);
    expect(s.modFiles().size).toBe(0);
  }, 300000);

  test('chest contents: TreasureGroup entries edited, a row of its own, undo, export and saving', async () => {
    let done = false;
    for (const c of lanaiContents(s)) {
      const m = await lanaiMaps(s, c).catch(() => null);
      const tg = m?.treasureGroup;
      if (!m || !tg) continue;
      const users = lanaiChestUsers(m);
      // a chest whose row another chest shares, so "a row of its own" is offered
      const shared = [...users].find(
        ([row, us]) => row < tg.rows && us.length > 1 && lanaiTreasureSlots(tg, row).length,
      );
      if (!shared) continue;
      const [row, [user]] = shared as [number, LanaiChestUser[]];
      const info = m.mapByName(user!.map)!;
      const st = lanaiEditState(m);
      st.open(info);
      const ev = m.eventTable(info.dungeon)!;
      const field = lanaiChestField(ev, user!.event)!;
      expect(ev.u32(user!.event, field)).toBe(row);
      const before = lanaiTreasureSlots(tg, row);
      const bytes = tg.row(row).slice();
      // the row as read builds from its entries byte for byte (empty entries are {0x80000000, 1, 1, 0xD0})
      expect(equalBytes(lanaiTreasureRowBytes(tg, row, before), bytes)).toBe(true);
      // an entry of 500 G added: the table goes to the MOD; undo puts the row back
      st.editTreasure((t) => lanaiWriteTreasure(t, row, [...before, { value: 500, weight: 3, kind: 2 }]));
      expect(lanaiTreasureSlots(tg, row)).toEqual([...before, { value: 500, weight: 3, kind: 2 }].slice(0, 10));
      expect(tg.rowChanged(row)).toBe(true);
      expect(s.modFiles().has(c.archive)).toBe(true);
      st.undo();
      expect(equalBytes(tg.row(row), bytes)).toBe(true);
      expect(tg.rowChanged(row)).toBe(false);
      expect(s.modFiles().size).toBe(0);
      // a row of its own: the chest names a new row with the same entries, the other chests keep the old one
      const rows = tg.rows;
      st.editTables(() => ev.setU32(user!.event, field, tg.addRow(row)));
      expect(tg.rows).toBe(rows + 1);
      expect(ev.u32(user!.event, field)).toBe(rows);
      expect(lanaiTreasureSlots(tg, rows)).toEqual(before);
      expect(lanaiChestUsers(m).get(rows)?.length).toBe(users.get(row)!.filter((u) => u.event === user!.event).length);
      st.editTreasure((t) =>
        lanaiWriteTreasure(t, rows, [{ value: before[0]!.value, weight: 1, kind: before[0]!.kind }]),
      );
      expect(lanaiTreasureSlots(tg, row)).toEqual(before);
      expect(lanaiValidate(m, info, st.current!).filter((i) => i.level === 'error')).toEqual([]);
      // saved and put back on a fresh session
      const other = await LanaiSession.open(dump, { fresh: true });
      await other.restore(s.saved());
      const om = await lanaiMaps(other, lanaiContents(other)[c.index]!);
      expect(om.treasureGroup!.rows).toBe(rows + 1);
      expect(equalBytes(om.treasureGroup!.row(rows), tg.row(rows))).toBe(true);
      expect(om.eventTable(info.dungeon)!.u32(user!.event, field)).toBe(rows);
      // undo both: the table is as read again
      st.undo();
      st.undo();
      expect(tg.rows).toBe(rows);
      expect(ev.u32(user!.event, field)).toBe(row);
      expect(s.modFiles().size).toBe(0);
      done = true;
      break;
    }
    expect(done).toBe(true);
  }, 300000);

  test('section 6: the tool adds cells of the picked MonsterGroup; a value the table does not have is an error', () => {
    const info = maps.maps.find((x) => !x.world && maps.doc(x).sec6Header.length)!;
    expect(info).toBeDefined();
    const st = lanaiEditState(maps);
    st.open(info);
    const groups = maps.monsterGroups();
    expect(groups[0]!.id).toBe(0x80000000);
    const doc = st.current!;
    const free = doc.tiles.find((t) => !doc.cells6.some((c) => c.x === t.x && c.y === t.y))!;
    const n = doc.cells6.length;
    st.cell6Value = groups.at(-1)!.id;
    st.setTool('room');
    const ctl = new Controller(st);
    ctl.down(free.x + 0.5, free.y + 0.5, { shiftKey: false, button: 0 });
    ctl.up();
    expect(st.current!.cells6.length).toBe(n + 1);
    expect(st.current!.cells6.at(-1)).toEqual({ value: groups.at(-1)!.id, x: free.x, y: free.y });
    expect(lanaiValidate(maps, info, st.current!)).toEqual([]);
    st.edit((d) => {
      d.cells6.at(-1)!.value = 0x8000ffff;
    });
    expect(lanaiValidate(maps, info, st.current!).some((x) => x.key.startsWith('s6id/'))).toBe(true);
    st.revert();
    expect(maps.isChanged(info)).toBe(false);
  });

  test('MonsterGroup uses: the header and the cells of the maps, edits included', () => {
    const info = maps.maps.find((x) => !x.world && maps.doc(x).sec6Header.length >= 4)!;
    const st = lanaiEditState(maps);
    st.open(info);
    const header = maps.monsterGroupRow(u32(st.current!.sec6Header, 0));
    expect(header).toBeGreaterThanOrEqual(0);
    expect(maps.monsterGroupUses().get(header)).toContainEqual({ map: info.name, cells: 'map' });
    const last = maps.monsterGroups().at(-1)!;
    const before = (maps.monsterGroupUses().get(last.row) ?? []).filter(
      (u) => u.map === info.name && u.cells !== 'map',
    );
    const free = st.current!.tiles.find((t) => !st.current!.cells6.some((c) => c.x === t.x && c.y === t.y))!;
    st.edit((d) => {
      d.cells6.push({ value: last.id, x: free.x, y: free.y }, { value: last.id, x: free.x, y: free.y });
    });
    const n = before.length ? (before[0]!.cells as number) : 0;
    expect(maps.monsterGroupUses().get(last.row)).toContainEqual({ map: info.name, cells: n + 2 });
    // a value the table does not have is not counted for any row
    const counted = (): number =>
      [...maps.monsterGroupUses().values()]
        .flat()
        .filter((u) => u.map === info.name)
        .reduce((a, u) => a + (u.cells === 'map' ? 0 : u.cells), 0);
    const k = counted();
    st.edit((d) => {
      d.cells6.push({ value: 0x8000ffff, x: free.x, y: free.y });
    });
    expect(counted()).toBe(k);
    st.revert();
    expect(maps.isChanged(info)).toBe(false);
  });

  test('every content: MonsterGroup rows name MonsterParameter rows from +0x04 (the +0x00 value is not a monster)', async () => {
    const mp = s.table('MonsterParameter')!;
    let rows = 0;
    for (const c of lanaiContents(s)) {
      const m = await lanaiMaps(s, c).catch(() => null);
      const t = m?.monsterGroup;
      if (!m || !t) continue;
      expect(t.rowSize).toBe(0x9c);
      for (const g of m.monsterGroups()) {
        rows++;
        expect(g.slots.length).toBe(25);
        expect(g.kind >>> 0).toBeLessThan(0x80000100); // a small row ID (0x80000000, 0x80000001, …), not a monster's
        for (const id of g.monsters) expect(mp.find(id)).toBeGreaterThanOrEqual(0);
        expect(g.tail.length).toBe(0x9c - 0x68);
      }
    }
    expect(rows).toBeGreaterThan(0);
    // content 38, row 1: +0x00 = 0x80000009 is not listed; its monster (レイクタートル) is
    const g = maps.monsterGroups()[1]!;
    expect(g.kind).toBe(0x80000009);
    expect(g.monsters[0]).toBe(maps.monsterGroup!.u32(1, 4));
    expect(g.monsters).not.toContain(0x80000009);
  }, 300000);

  test('indoor tiles switch the MapData of a group that has an indoor row, and the checks say so', async () => {
    let found = false;
    for (const c of lanaiContents(s)) {
      const m = await lanaiMaps(s, c).catch(() => null);
      if (!m) continue;
      const info = m.maps.find(
        (x) =>
          !x.world &&
          (!x.mapDataId || x.mapDataId === 0x80000000) &&
          m.group(x)?.mapDataIndoor &&
          !m.doc(x).tiles.some((t) => t.kind >= 15 && t.kind <= 27),
      );
      if (!info) continue;
      const st = lanaiEditState(m);
      st.open(info);
      const before = st.source!;
      const t = st.current!.tiles[0]!;
      st.edit(() => {
        t.kind = 20;
      });
      expect(st.source!.mapData).not.toBe(before.mapData);
      expect(lanaiValidateAll(m, info, st.current!).some((x) => x.key.startsWith('mapdata/'))).toBe(true);
      st.undo();
      expect(st.source!.mapData).toBe(before.mapData);
      expect(m.isChanged(info)).toBe(false);
      found = true;
      break;
    }
    expect(found).toBe(true);
  }, 300000);
});
