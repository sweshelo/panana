// Editing RPG FREE! (lanai) tables and the MOD export: writing the numbers of a row (bits kept, padding kept), adding
// rows (the regions after the rows move), the saved edits, and rebuilding the archives. The round trips on the real
// tables need the decrypted CIAs (test/env.ts LANAI_BASE / LANAI_UPDATE) and are skipped without them.
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { parseArchive, rebuildArchive, unpackEntry } from '../src/archive/gsarc';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LanaiMonsterPage } from '../src/lanai/MonsterPage';
import { lanaiSetSkillSlots, lanaiSkillSlots } from '../src/lanai/monsterBook';
import { moveTo } from '../src/ui/MonsterSlots';
import { isTransform, lanaiAction, lanaiActionMonsters, lanaiCopyActionInto, lanaiCopyStats, lanaiRevertMonster, lanaiSetTransformTarget, lanaiStatsOf, lanaiStatsSharers } from '../src/lanai/monsterStats';
import { LanaiSession, lanaiTableKey } from '../src/lanai/session';
import { LanaiTable } from '../src/lanai/table';
import { encodeLanaiMessage, lanaiMessageBytes, parseLanaiMessage } from '../src/lanai/message';
import { openImages, type Dump } from '../src/rom/dump';
import { equalBytes, u32, w32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

/** A small table: 3 rows of 8 bytes (+0 a string, +4 packed), row IDs, a field-name table, relocations. */
function smallTable(): Uint8Array {
  const pool = new TextEncoder().encode('Tbl\0name\0abc\0\0\0\0'); // 16 bytes
  const rows = 3, size = 8;
  const data = 0x40 + pool.length; // 0x50
  const ids = 0x70; // the rows end at 0x68; each region on 16 bytes
  const namesAt = 0x80; // on 16 bytes, up to 0x88
  const relocAt = 0x90;
  const relocs = [data, data + 8, data + 16, namesAt];
  const b = new Uint8Array(relocAt + relocs.length * 4);
  const h = [rows, size, 0x40, pool.length, data, rows * size, ids, rows * 4, namesAt, 8, relocAt, relocs.length, 0, 0, 4];
  h.forEach((v, i) => w32(b, i * 4, v));
  b.set(pool, 0x40);
  for (let r = 0; r < rows; r++) {
    w32(b, data + r * size, 0x40 + 9); // "abc"
    w32(b, data + r * size + 4, (0xd0 << 22) | (r + 1));
    w32(b, ids + r * 4, (0x80000000 | (r * 2)) >>> 0);
  }
  w32(b, namesAt, 0x40 + 4); // "name"
  w32(b, namesAt + 4, 0);
  relocs.forEach((p, i) => w32(b, relocAt + i * 4, p));
  return b;
}

describe('LanaiTable edits', () => {
  test('lays a table out again byte for byte', () => {
    const b = smallTable();
    const t = new LanaiTable(b);
    expect(t.name).toBe('Tbl');
    expect(t.fields).toEqual([{ name: 'name', offset: 0 }]);
    expect(equalBytes(t.relaidOut(), b)).toBe(true);
  });

  test('writes bits and keeps the padding and the other rows; reverts', () => {
    const b = smallTable();
    const t = new LanaiTable(b);
    t.setBits(1, 4, 0, 10, 999);
    expect(t.u32(1, 4)).toBe(((0xd0 << 22) | 999) >>> 0);
    t.setBits(1, 4, 10, 5, -3, true);
    expect(t.bits(1, 4, 10, 5, true)).toBe(-3);
    expect(t.bits(1, 4, 0, 10)).toBe(999);
    expect(t.u32(1, 4) >>> 22).toBe(0xd0);
    expect(t.changedRows()).toEqual([1]);
    expect(equalBytes(t.row(0), new LanaiTable(b).row(0))).toBe(true);
    // the bytes read are not written
    expect(equalBytes(t.original, smallTable())).toBe(true);
    expect(() => t.setU32(0, 0, 5)).toThrow(); // a string field
    expect(() => t.setBits(0, 4, 0, 10, 1024)).toThrow();
    t.revertRow(1);
    expect(t.changedRows()).toEqual([]);
    expect(t.changed).toBe(false);
  });

  test('adds a row (copy with its string and a new row ID) and removes it', () => {
    const t = new LanaiTable(smallTable());
    const i = t.addRow(2);
    expect(i).toBe(3);
    const again = new LanaiTable(t.data);
    expect(again.rows).toBe(4);
    expect(again.rowIds).toEqual([0x80000000, 0x80000002, 0x80000004, 0x80000005]);
    expect(again.isString(3, 0)).toBe(true);
    expect(again.fields).toEqual([{ name: 'name', offset: 0 }]);
    expect(again.bits(3, 4, 0, 10)).toBe(3);
    expect(t.changedRows()).toEqual([3]);
    t.removeLastRow();
    expect(equalBytes(t.data, smallTable())).toBe(true);
    expect(() => t.removeLastRow()).toThrow();
  });
});

describe('LanaiTable strings', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);
  const str = (t: LanaiTable, i: number): string => new TextDecoder().decode(t.data.subarray(t.u32(i, 0), t.data.indexOf(0, t.u32(i, 0))));

  test('writes a string after the pool as read; the other rows keep their bytes; the regions move', () => {
    const b = smallTable();
    const t = new LanaiTable(b);
    t.setString(1, 0, enc('hello'));
    const again = new LanaiTable(t.data);
    expect(again.dataOffset).toBe(0x60); // pool 0x10 + "hello\0" on 4 -> 0x56, rows on 16
    expect(u32(t.data, 0x0c)).toBe(0x20);
    expect(equalBytes(t.data.subarray(0x40, 0x50), b.subarray(0x40, 0x50))).toBe(true);
    expect(str(again, 1)).toBe('hello');
    expect(str(again, 0)).toBe('abc');
    expect(str(again, 2)).toBe('abc');
    expect(again.isString(1, 0)).toBe(true);
    expect(again.fields).toEqual([{ name: 'name', offset: 0 }]);
    expect(again.rowIds).toEqual([0x80000000, 0x80000002, 0x80000004]);
    expect(t.changedRows()).toEqual([1]);
    expect(t.stringChanged(1, 0)).toBe(true);
    expect(t.stringChanged(0, 0)).toBe(false);
    expect(t.changedStrings().map(([r, o]) => [r, o])).toEqual([[1, 0]]);
    // a number of the same row is still written
    t.setBits(1, 4, 0, 10, 5);
    expect(str(t, 1)).toBe('hello');
    // a longer string, then a second one
    t.setString(1, 0, enc('a longer string'));
    t.setString(0, 0, enc('x'));
    expect(str(t, 0)).toBe('x');
    expect(str(t, 1)).toBe('a longer string');
    expect(str(t, 2)).toBe('abc');
    expect(t.u32(0, 0)).toBeLessThan(t.u32(1, 0)); // in the order of the fields
    expect(t.u32(0, 0) % 4).toBe(0);
    expect(t.u32(1, 0) % 4).toBe(0);
  });

  test('the string as read points the field back; undone edits give the bytes as read', () => {
    const b = smallTable();
    const t = new LanaiTable(b);
    t.setString(1, 0, enc('hello'));
    t.setString(1, 0, enc('abc'));
    expect(equalBytes(t.data, b)).toBe(true);
    expect(t.changed).toBe(false);
    t.setString(2, 0, enc('zz'));
    t.revertRow(2);
    expect(equalBytes(t.data, b)).toBe(true);
    t.setString(0, 0, enc('zz'));
    t.setBits(0, 4, 0, 10, 9);
    // setRow with the row as read undoes the string too
    t.setRow(0, new LanaiTable(b).row(0).slice());
    expect(equalBytes(t.data, b)).toBe(true);
    expect(() => t.setRow(0, (() => { const r = t.row(0).slice(); w32(r, 0, 0x44); return r; })())).toThrow();
    expect(() => t.setString(0, 4, enc('no'))).toThrow(); // not a string field
    t.setString(0, 0, enc('zz'));
    t.revert();
    expect(equalBytes(t.data, b)).toBe(true);
    expect(t.changedStrings()).toEqual([]);
  });

  test('added rows copy the written string and drop it when removed', () => {
    const b = smallTable();
    const t = new LanaiTable(b);
    t.setString(2, 0, enc('copy me'));
    const i = t.addRow(2);
    expect(str(t, i)).toBe('copy me');
    expect(t.u32(i, 0)).not.toBe(t.u32(2, 0));
    t.setString(i, 0, enc('mine'));
    expect(str(t, 2)).toBe('copy me');
    expect(str(t, i)).toBe('mine');
    t.removeLastRow();
    expect(t.changedStrings().map(([r]) => r)).toEqual([2]);
    t.revertRow(2);
    expect(equalBytes(t.data, b)).toBe(true);
  });

  test('a table whose rows do not follow the pool keeps its pool size without the padding', () => {
    // the same table with the pool size 13 ("Tbl\0name\0abc\0"): the rows still on 0x50
    const b = smallTable();
    w32(b, 0x0c, 13);
    const t = new LanaiTable(b);
    expect(equalBytes(t.relaidOut(), b)).toBe(true);
    t.setString(0, 0, enc('hey'));
    expect(u32(t.data, 0x0c)).toBe(20); // 13, on 4 (16), + "hey\0"
    expect(t.dataOffset).toBe(0x60);
    t.revertRow(0);
    expect(equalBytes(t.data, b)).toBe(true);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! edits and MOD export', () => {
  let dump: Dump;
  let s: LanaiSession;
  beforeAll(async () => {
    dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump, { fresh: true });
  });
  // a failed test leaves no edits for the next ones
  afterEach(() => s.revertAll());

  test('every table of the master and the language archives lays out again byte for byte', () => {
    expect(s.tables.length).toBeGreaterThan(100);
    expect(s.tables.filter((t) => !equalBytes(t.table.relaidOut(), t.table.data)).map((t) => t.table.name)).toEqual([]);
  });

  test('every string field of every table: written to another string and back gives the bytes as read', () => {
    const tried: string[] = [];
    try {
      for (const { table: t } of s.tables) {
        const at = t.stringOffsets();
        if (!at.length || !t.rows) continue;
        const [r, o] = [t.rows - 1, at[at.length - 1]!];
        if (!t.isString(r, o)) continue;
        const read = t.data.slice();
        const pool = 0x40 + u32(read, 0x0c);
        // every other string field keeps its offset (into the pool as read, which stays as it is)
        const pointers = (x: LanaiTable): number[] => Array.from({ length: x.rows }, (_, i) => at.map((f) => (x.isString(i, f) ? x.u32(i, f) : -1))).flat();
        const before = pointers(t);
        const was = lanaiMessageBytes(t.data, t.u32(r, o)).slice();
        s.setText(t, r, o, 'テスト{page}です');
        const again = new LanaiTable(t.data);
        expect(s.field(again, r, o)!.text).toBe('テスト{page}です');
        const after = pointers(again);
        after[r * at.length + at.length - 1] = before[r * at.length + at.length - 1]!;
        expect(after).toEqual(before);
        expect(equalBytes(again.data.subarray(0x40, pool), read.subarray(0x40, pool))).toBe(true);
        expect(again.rowIds).toEqual(new LanaiTable(read).rowIds);
        expect(again.fields).toEqual(new LanaiTable(read).fields);
        expect(t.changedRows()).toEqual([r]);
        t.setString(r, o, was);
        if (!equalBytes(t.data, read)) throw new Error(`${t.name}: 書き戻しても元のバイトになりません`);
        tried.push(t.name);
      }
      expect(tried.length).toBeGreaterThan(10);
      expect(s.changedTables()).toEqual([]);
    } finally {
      s.revertAll();
    }
  });

  test('every message string written from its tokens is the bytes as read', () => {
    const bad: string[] = [];
    for (const { table: t } of s.tables) {
      for (const o of t.stringOffsets()) {
        if (t.fieldName(o) === 'voice') continue;
        for (let r = 0; r < t.rows; r++) {
          if (!t.isString(r, o)) continue;
          const b = lanaiMessageBytes(t.data, t.u32(r, o));
          if (!equalBytes(encodeLanaiMessage(parseLanaiMessage(t.data, t.u32(r, o)).tokens), b)) bad.push(`${t.name} ${r} +${o}`);
        }
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  test('a written string is exported, saved and put back, and undone', async () => {
    const t = s.need('MonsterParameter');
    const before = s.field(t, 1, 4)!.text;
    s.setText(t, 1, 4, 'あたらしいなまえ');
    s.edited();
    const files = s.modFiles();
    expect([...files.keys()]).toEqual(['2135000A']);
    const arc = parseArchive(files.get('2135000A')!);
    const ref = s.refOf(t)!;
    const back = new LanaiTable(unpackEntry(arc, arc.entries[ref.index]!).body);
    expect(s.field(back, 1, 4)!.text).toBe('あたらしいなまえ');
    expect(s.field(back, 2, 4)!.text).toBe(s.field(t, 2, 4)!.text);
    const saved = s.saved();
    expect(saved.strings?.map(([k, r, o]) => [k, r, o])).toEqual([[lanaiTableKey(ref), 1, 4]]);
    const other = await LanaiSession.open(dump, { fresh: true });
    await other.restore(saved);
    expect(other.field(other.need('MonsterParameter'), 1, 4)!.text).toBe('あたらしいなまえ');
    expect(s.originalField(t, 1, 4)!.text).toBe(before);
    s.setText(t, 1, 4, before);
    expect(t.changed).toBe(false);
    expect(s.modFiles().size).toBe(0);
  });

  test('the master rebuilt with nothing changed is the same bytes', async () => {
    const raw = await dump.readRomfs('2135000A');
    expect(equalBytes(rebuildArchive(parseArchive(raw), new Map()), raw)).toBe(true);
    expect(s.modFiles().size).toBe(0);
  });

  test('one field changed: only that word differs in the rebuilt archive', async () => {
    const t = s.need('MonsterParameterMain');
    const before = t.bits(1, 0, 12, 10);
    t.setBits(1, 0, 12, 10, 777);
    s.edited();
    const files = s.modFiles();
    expect([...files.keys()]).toEqual(['2135000A']);
    const arc = parseArchive(files.get('2135000A')!);
    const orig = parseArchive(await dump.readRomfs('2135000A'));
    expect(arc.version).toBe(10);
    expect(equalBytes(arc.data.subarray(8, 0x10), orig.data.subarray(8, 0x10))).toBe(true);
    const ref = s.changedTables()[0]!;
    expect(ref.table.name).toBe('MonsterParameterMain');
    for (const e of orig.entries) {
      const a = unpackEntry(arc, arc.entries[e.index]!).body;
      const o = unpackEntry(orig, e).body;
      if (e.index !== ref.index) {
        expect(equalBytes(a, o)).toBe(true);
        continue;
      }
      const diff = [...a.keys()].filter((i) => a[i] !== o[i]);
      expect(diff.every((i) => i >= t.at(1, 0) && i < t.at(1, 4))).toBe(true);
      expect(new LanaiTable(a).bits(1, 0, 12, 10)).toBe(777);
      expect(new LanaiTable(a).u32(1, 0) >>> 22).toBe(0xd0);
    }
    // the zip holds the archive under the title's romfs
    expect(Object.keys(unzipSync(s.modZip()))).toEqual(['0004000000125D00/romfs/2135000A']);
    // saved and put back on a fresh session
    const saved = s.saved();
    expect(saved.rows.map(([k, r]) => [k, r])).toEqual([[lanaiTableKey(ref), 1]]);
    const other = await LanaiSession.open(dump, { fresh: true });
    other.restore(saved);
    expect(other.need('MonsterParameterMain').bits(1, 0, 12, 10)).toBe(777);
    t.setBits(1, 0, 12, 10, before);
    expect(t.changed).toBe(false);
    expect(s.modFiles().size).toBe(0);
  });

  test('ability rows: the fields of monsters.md, sharing', async () => {
    const m = await LanaiSession.open(dump, { fresh: true });
    const ichigo = lanaiStatsOf(m, 1)!;
    const rows = m.rows(ichigo.table);
    expect(rows.get(ichigo.row, 'level')).toBeGreaterThan(0);
    expect(rows.get(ichigo.row, 'hpHi')).toBeGreaterThanOrEqual(rows.get(ichigo.row, 'hpLo'));
    // 1231 monsters name 1188 rows; 34 rows are shared
    const p = m.need('MonsterParameter');
    const uses = new Map<string, number>();
    for (let r = 0; r < p.rows; r++) {
      const s = lanaiStatsOf(m, r);
      if (s) uses.set(`${s.kind}:${s.row}`, (uses.get(`${s.kind}:${s.row}`) ?? 0) + 1);
    }
    expect(uses.size).toBe(1188);
    expect([...uses.values()].filter((n) => n > 1).length).toBe(34);
    // the padding of w0 stays when the level is written
    rows.set(ichigo.row, 'level', 99);
    expect(m.need(ichigo.table).u32(ichigo.row, 0) >>> 22).toBe(0xd0);
    rows.set(ichigo.row, 'fire', -9);
    expect(rows.get(ichigo.row, 'fire')).toBe(-9);
    expect(m.need(ichigo.table).changedRows()).toEqual([ichigo.row]);
  });

  test('copying a shared ability row links only that monster', async () => {
    const m = await LanaiSession.open(dump, { fresh: true });
    const p = m.need('MonsterParameter');
    const shared = Array.from({ length: p.rows }, (_, r) => r).find((r) => lanaiStatsOf(m, r) && lanaiStatsSharers(m, lanaiStatsOf(m, r)!).length > 1)!;
    const ref = lanaiStatsOf(m, shared)!;
    const others = lanaiStatsSharers(m, ref).filter((x) => x !== shared);
    const t = m.need(ref.table);
    const n = t.rows;
    const row = lanaiCopyStats(m, shared);
    expect(row).toBe(n);
    expect(lanaiStatsOf(m, shared)).toEqual({ ...ref, row: n });
    expect(lanaiStatsSharers(m, ref)).toEqual(others);
    expect(equalBytes(t.row(n), t.row(ref.row))).toBe(true);
    m.rows(ref.table).set(n, 'hpHi', 4321);
    expect(m.rows(ref.table).get(ref.row, 'hpHi')).not.toBe(4321);
    // the MOD carries both tables in the master
    const arc = parseArchive(m.modFiles().get('2135000A')!);
    const ent = m.tables.find((x) => x.table === t)!;
    expect(new LanaiTable(unpackEntry(arc, arc.entries[ent.index]!).body).rows).toBe(n + 1);
    // undo removes the added row
    lanaiRevertMonster(m, shared);
    expect(t.rows).toBe(n);
    expect(m.changedTables()).toEqual([]);
  });

  test('transformations: たからばこぞう hides in its box (action 1112 → row 42); copying the action', async () => {
    const m = await LanaiSession.open(dump, { fresh: true });
    const ref = lanaiStatsOf(m, 41)!;
    const id = m.rows(ref.table).get(ref.row, 'skill2');
    const a = lanaiAction(m, id)!;
    expect(a.row).toBe(1112);
    expect(isTransform(a)).toBe(true);
    expect(m.need('MonsterParameter').find(a.target)).toBe(42);
    expect(a.message).toContain('箱に隠れてしまった');
    expect(lanaiActionMonsters(m, id)).toEqual(expect.arrayContaining([41, 188]));
    const nid = lanaiCopyActionInto(m, id, ref, 0x58);
    expect(nid).not.toBe(id);
    lanaiSetTransformTarget(m, nid, 45, ref);
    expect(m.need('MonsterParameter').find(lanaiAction(m, nid)!.target)).toBe(45);
    expect(m.need('MonsterParameter').find(lanaiAction(m, id)!.target)).toBe(42);
    lanaiRevertMonster(m, 41);
    expect(m.changedTables()).toEqual([]);
  });

  test('skill slots move with their target and level, and the fallback slot follows its skill', async () => {
    const m = await LanaiSession.open(dump, { fresh: true });
    const ref = lanaiStatsOf(m, 41)!;
    const f = m.rows(ref.table).access(ref.row);
    const before = lanaiSkillSlots(m, f);
    expect(before.length).toBe(3);
    const fb = f.get('fallback');
    lanaiSetSkillSlots(f, moveTo(before, 0, before.length));
    const after = lanaiSkillSlots(m, f);
    expect(after.map((s) => [s.id, s.target, s.lv])).toEqual([...before.slice(1), before[0]!].map((s) => [s.id, s.target, s.lv]));
    expect(after[f.get('fallback')]!.id).toBe(before[fb]!.id);
    lanaiSetSkillSlots(f, after.slice(0, 1));
    expect(lanaiSkillSlots(m, f).length).toBe(1);
    expect([f.get('skill2'), f.get('target2'), f.get('slotLv2')]).toEqual([0, 1, 0]);
    lanaiRevertMonster(m, 41);
    expect(m.changedTables()).toEqual([]);
  });

  test('the monster page has the editor', async () => {
    const m = await LanaiSession.open(dump, { fresh: true });
    const html = renderToString(createElement(LanaiMonsterPage, { session: m, arg: '41' }));
    // the sections of RPG2's / RPG3's monster pages, in the same parts
    for (const t of ['能力 Main', '経験値', 'たいせい', 'ドロップ', 'ワザと行動', 'ほかのアクション', '変身', '箱に隠れてしまった', 'アクションを複製してこの枠に付け替え', 'この形態になる', '出現する場所', 'radar'])
      expect(html).toContain(t);
    const p = m.need('MonsterParameter');
    const shared = Array.from({ length: p.rows }, (_, r) => r).find((r) => lanaiStatsOf(m, r) && lanaiStatsSharers(m, lanaiStatsOf(m, r)!).length > 1)!;
    const html2 = renderToString(createElement(LanaiMonsterPage, { session: m, arg: String(shared) }));
    expect(html2).toContain('体が共有しています');
    expect(html2).toContain('複製して付け替え');
  });

  test('an added ability row is saved and put back', async () => {
    const t = s.need('MonsterParameterExtra');
    const n = t.rows;
    const i = t.addRow(3);
    t.setU16(i, 0x76, 1234);
    const other = await LanaiSession.open(dump, { fresh: true });
    other.restore(s.saved());
    const o = other.need('MonsterParameterExtra');
    expect(o.rows).toBe(n + 1);
    expect(o.u16(i, 0x76)).toBe(1234);
    expect(u32(o.data, 0)).toBe(n + 1);
    t.revert();
    expect(t.rows).toBe(n);
  });
});
