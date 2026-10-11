// The RPG FREE! (lanai) map editor: the edit state (facings, copies, checks), saving the map database with the
// session's edits and the MOD export (an unedited database builds byte for byte; one tile changed changes only its
// record in the content's archive).
import { beforeAll, describe, expect, test } from 'bun:test';
import { entryBlob, parseArchive, rebuildArchive, unpackEntry } from '../src/archive/gsarc';
import { Controller } from '../src/editor/controller';
import { MapDb } from '../src/game/mapdb';
import { buildTiles, LANAI_ROT_CODEC, type Rec } from '../src/game/sections';
import { lanaiContents, type LanaiContent } from '../src/lanai/contents';
import { LanaiEditState, lanaiEditState, lanaiValidate, lanaiValidateAll } from '../src/lanai/mapedit';
import { LANAI_LAYOUTS, LANAI_MAPDB_ENTRY, LANAI_MAP_FORMAT, lanaiMaps, type LanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { openImages, type Dump } from '../src/rom/dump';
import { equalBytes, u32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe('map database changes', () => {
  // two entries, the second one sharing the first one's block
  const db = (): MapDb => {
    const b = new Uint8Array(4 + 2 * 12 + 4);
    const v = new DataView(b.buffer);
    v.setUint32(0, 2, true);
    v.setUint32(4, 1, true); v.setUint32(8, 0, true); v.setUint32(12, 4, true);
    v.setUint32(16, 2, true); v.setUint32(20, 0, true); v.setUint32(24, 4, true);
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
    for (const [k, o] of [[2, 0x10], [3, 0x14], [4, 0x14], [5, 0x1c]] as const) {
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
    dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump, { fresh: true });
    content = lanaiContents(s)[38]!;
    maps = await lanaiMaps(s, content);
  }, 300000);

  test('every content: the map database builds as the ROM\'s, and nothing goes to the MOD unedited', async () => {
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
      const db = new MapDb(a), odb = new MapDb(o);
      const tiles = info.sections[0]!;
      // the bytes that differ lie in one 20-byte run (the record), the index and the other blocks are the same
      const diff = [...a.keys()].filter((k) => a[k] !== o[k]);
      expect(diff.length).toBeGreaterThan(0);
      expect(diff[diff.length - 1]! - diff[0]!).toBeLessThan(20);
      const nb = db.get(tiles), ob = odb.get(tiles);
      const d2 = [...nb.keys()].filter((k) => nb[k] !== ob[k]);
      expect(d2.every((k) => Math.floor(k / 20) === i)).toBe(true);
      expect(u32(nb, i * 20)).toBe(14);
      expect(nb[i * 20 + 0x10]).toBe(LANAI_ROT_CODEC.encode(1));
      for (const h of info.sections) if (h && h !== tiles && odb.has(h)) expect(equalBytes(db.get(h), odb.get(h))).toBe(true);
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
    expect(equalBytes(buildTiles(st.current!.tiles, LANAI_MAP_FORMAT.tile), maps.db.original(info.sections[0]!))).toBe(true);
  });

  test('records: moving, turning, copying an exit (new point ID, the same EventObject row) and deleting', () => {
    const info = maps.mapByName('D01001B01')!;
    const st = lanaiEditState(maps);
    st.open(info);
    const ctl = new Controller(st);
    const exits = st.current!.recs[3]!;
    expect(exits.length).toBeGreaterThan(0);
    const n = exits.length;
    st.select({ type: 'rec', section: 3, index: 0 });
    const facing = exits[0]!.raw[0x14]!;
    ctl.rotate(1);
    expect(st.current!.recs[3]![0]!.raw[0x14]).toBe(LANAI_ROT_CODEC.encode((LANAI_ROT_CODEC.decode(facing) + 1) & 3));
    ctl.duplicateRec();
    const list = st.current!.recs[3]!;
    expect(list.length).toBe(n + 1);
    const [a, b] = [list[0]!, list[n]!];
    expect(u32(b.raw, 0)).not.toBe(u32(a.raw, 0));
    expect(u32(b.raw, 4)).toBe(u32(a.raw, 4));
    expect(lanaiValidate(maps, info, st.current!).some((x) => x.key.startsWith('evshare/'))).toBe(true);
    const y = b.y;
    ctl.shiftSelection(0, 1);
    expect(st.current!.recs[3]![n]!.y).toBe(y + 1);
    ctl.deleteSelection();
    expect(st.current!.recs[3]!.length).toBe(n);
    st.revert();
    expect(maps.isChanged(info)).toBe(false);
    expect(lanaiValidate(maps, info, st.current!)).toEqual([]);
  });

  test('indoor tiles switch the MapData of a group that has an indoor row, and the checks say so', async () => {
    let found = false;
    for (const c of lanaiContents(s)) {
      const m = await lanaiMaps(s, c).catch(() => null);
      if (!m) continue;
      const info = m.maps.find((x) => !x.world && (!x.mapDataId || x.mapDataId === 0x80000000) && m.group(x)?.mapDataIndoor && !m.doc(x).tiles.some((t) => t.kind >= 15 && t.kind <= 27));
      if (!info) continue;
      const st = lanaiEditState(m);
      st.open(info);
      const before = st.source!;
      const t = st.current!.tiles[0]!;
      st.edit(() => { t.kind = 20; });
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
