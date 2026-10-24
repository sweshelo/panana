// 初代's session: the edits of the master's tables and messages, their row counts (MasterTables), and the MOD export
// (honolulu/session.ts). The tests with the ROM read roms/honolulu-base.cia.
import { beforeAll, describe, expect, test } from 'bun:test';
import { findByName, parseArchive } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { HonoluluSession } from '../src/honolulu/session';
import { openImage } from '../src/rom/dump';
import { HONOLULU } from '../src/rom/titles';
import { hasHonolulu, HONOLULU_BASE } from './env';

describe.skipIf(!hasHonolulu)('初代の session (ROM)', () => {
  let session: HonoluluSession;
  beforeAll(async () => {
    session = await HonoluluSession.open(await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia'));
  });

  test('nothing edited: nothing to export', () => {
    expect(session.changed()).toBe(false);
    expect(session.modFiles().size).toBe(0);
  });

  test('an edited price and name go into the master; reverted, nothing is left', () => {
    const items = session.master.rows('itemData.bin');
    const texts = session.messages.texts;
    const name = items.get(1, 'name');
    items.set(1, 'price', 12345);
    texts.setText(name, 'キズぐすりX');
    expect(session.changed()).toBe(true);
    const files = session.modFiles();
    expect([...files.keys()]).toEqual([HONOLULU.master]);
    const arc = parseArchive(files.get(HONOLULU.master)!);
    expect(new GsTable(findByName(arc, 'itemData.bin')!.body).row(1)).toEqual(items.row(1));
    expect(session.modZip().length).toBeGreaterThan(0);
    items.revert(1);
    texts.revert(name);
    expect(session.changed()).toBe(false);
  });

  test('a table with rows taken out comes back with as many rows', () => {
    const m = session.master;
    const t = m.table('shopItemData.bin');
    const n = t.rows;
    t.data = t.withRows(Array.from({ length: n - 2 }, (_, i) => t.row(i).slice()));
    const counts = m.savedRowCounts();
    expect(counts).toEqual([['shopItemData.bin', n - 2]]);
    t.data = t.withRows(Array.from({ length: n }, (_, i) => (i < n - 2 ? t.row(i).slice() : m.originalRow('shopItemData.bin', i))));
    expect(m.savedRowCounts()).toEqual([]);
    m.restoreRowCounts(counts);
    expect(t.rows).toBe(n - 2);
    m.restoreRowCounts([['shopItemData.bin', n]]);
    m.restore([['shopItemData.bin', n - 2, new Uint8Array(4), m.originalRow('shopItemData.bin', n - 2)], ['shopItemData.bin', n - 1, new Uint8Array(4), m.originalRow('shopItemData.bin', n - 1)]]);
    expect(m.changedEntries().size).toBe(0);
  });
});
