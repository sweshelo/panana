// The field definitions of 初代 (honolulu/tables.ts), the raw fields over what they leave out (tabledef.rowDef) and the
// master read through them (honolulu/master.ts). The tests with the ROM read roms/honolulu-base.cia.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { findByName, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { field, fieldSize, rawFields, rawTableDef, readField, rowDef, withRawFields, type TableDef } from '../src/game/tabledef';
import { HonoluluMaster, HONOLULU_MASTER } from '../src/honolulu/master';
import { HONOLULU_ITEM_DATA, HONOLULU_TABLES } from '../src/honolulu/tables';
import { openImage, type Dump } from '../src/rom/dump';
import { GsTableView } from '../src/romfs/formats';
import { honoluluRomfsProfile } from '../src/romfs/honolulu';
import { RowFields } from '../src/ui/RowFields';
import { HonoluluSession } from '../src/honolulu/session';
import { equalBytes } from '../src/util/bytes';
import { hasHonolulu, HONOLULU_BASE } from './env';

/** Every byte of a row is in exactly one field that is not an alias or a bit field after the first. */
function coverage(def: TableDef): number[] {
  const n = new Array<number>(def.rowSize).fill(0);
  const seen = new Set<number>();
  for (const f of def.fields) {
    if (f.alias || (f.bits && seen.has(f.offset))) continue;
    seen.add(f.offset);
    for (let i = f.offset; i < f.offset + fieldSize(f); i++) n[i]!++;
  }
  return n;
}

describe('raw fields', () => {
  test('u32 where aligned, u16 / u8 at the odd ends', () => {
    expect(rawFields(0, 0x16).map((f) => [f.offset, f.type])).toEqual([[0, 'u32'], [4, 'u32'], [8, 'u32'], [0xc, 'u32'], [0x10, 'u32'], [0x14, 'u16']]);
    expect(rawFields(1, 8).map((f) => [f.offset, f.type])).toEqual([[1, 'u8'], [2, 'u16'], [4, 'u32']]);
    expect(rawFields(0, 3).map((f) => f.type)).toEqual(['u16', 'u8']);
    expect(rawFields(0, 4).every((f) => f.unsure && f.hex)).toBe(true);
  });

  test('a table with no definition is raw fields over its whole row', () => {
    const d = rawTableDef('monsterGroup.bin', 0x2e);
    expect(coverage(d).every((n) => n === 1)).toBe(true);
    expect(d.fields.at(-1)).toMatchObject({ offset: 0x2c, type: 'u16', label: '+0x2C' });
  });

  test('a definition keeps its fields in place and gets raw fields over the bytes it leaves out', () => {
    const d = withRawFields(HONOLULU_ITEM_DATA);
    expect(coverage(d).every((n) => n === 1)).toBe(true);
    expect(d.fields.map((f) => f.key)).toEqual(['name', 'desc', 'shopDesc', 'price', 'sell', 'kind', 'raw15', 'raw16', 'used', 'sub', 'category', 'raw1b']);
    // a complete definition is left as it is
    const full: TableDef = { file: 'x.bin', rowSize: 4, fields: [{ key: 'a', offset: 0, type: 'u32', label: 'a' }] };
    expect(withRawFields(full)).toBe(full);
  });

  test('rowDef: the definition when its row size matches, else raw fields', () => {
    expect(rowDef(HONOLULU_TABLES, 'itemData.bin', 0x1c).fields.find((f) => f.key === 'price')).toBeDefined();
    // RPG2's itemData.bin has the same name and 0x30-byte rows
    expect(rowDef(HONOLULU_TABLES, 'itemData.bin', 0x30).fields.every((f) => f.key.startsWith('raw'))).toBe(true);
    expect(rowDef(undefined, 'a.bin', 8).fields).toHaveLength(2);
  });

  test('the definitions of 初代 do not overlap and stay inside their rows', () => {
    for (const d of Object.values(HONOLULU_TABLES)) {
      expect(coverage(d).every((n) => n <= 1)).toBe(true);
      for (const f of d.fields) expect(f.offset + fieldSize(f)).toBeLessThanOrEqual(d.rowSize);
    }
  });
});

describe.skipIf(!hasHonolulu)('初代 master (ROM)', () => {
  let dump: Dump;
  let bytes: Uint8Array;
  /** Root RomFS files by name. */
  const roots = new Map<string, Uint8Array>();

  beforeAll(async () => {
    dump = await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia');
    for (const name of [HONOLULU_MASTER, '2713402F', 'A90C8038']) roots.set(name, await dump.readRomfs(name));
    bytes = roots.get(HONOLULU_MASTER)!;
  });

  /** GS tables of a root archive: file name -> table. */
  const tables = (name: string): Map<string, GsTable> => {
    const arc = parseArchive(roots.get(name)!);
    const out = new Map<string, GsTable>();
    for (const e of arc.entries) {
      const { name: file, body } = unpackEntry(arc, e);
      if (file?.endsWith('.bin') && body.length >= 0x40 && body.subarray(0, 4).some((b) => b)) {
        const t = new GsTable(body);
        if (t.rowSize && t.offset + t.rows * t.rowSize <= body.length) out.set(file, t);
      }
    }
    return out;
  };

  test('every definition has the row size of its table in the ROM', () => {
    const all = new Map([...tables(HONOLULU_MASTER), ...tables('2713402F'), ...tables('A90C8038')]);
    for (const d of Object.values(HONOLULU_TABLES)) expect([d.file, all.get(d.file)?.rowSize]).toEqual([d.file, d.rowSize]);
  });

  test('every table of the master is shown by RowFields: by its fields, or as raw fields', () => {
    const m = new HonoluluMaster(bytes);
    const ctx = m.context();
    const files = [...tables(HONOLULU_MASTER).keys()];
    expect(files.length).toBeGreaterThanOrEqual(45);
    for (const file of files) {
      const rows = m.rows(file);
      const html = renderToString(<RowFields def={rows.def} row={rows.row(Math.min(1, rows.rows - 1))} context={ctx} />);
      expect(html).toContain('+0x00');
      expect(coverage(rows.def).every((n) => n === 1)).toBe(true);
    }
    // a table without a definition: hex only
    const group = renderToString(<RowFields def={m.rows('monsterGroup.bin').def} row={m.rows('monsterGroup.bin').row(1)} />);
    expect(group).toContain('+0x2C');
  });

  test('the known fields read the values of naauao honolulu/', () => {
    const m = new HonoluluMaster(bytes);
    const items = m.rows('itemData.bin');
    expect(items.rows).toBe(298);
    expect([items.get(1, 'name'), m.message(items.get(1, 'name')), items.get(1, 'price'), items.get(1, 'category')]).toEqual([661, 'キズぐすり', 20, 1]);
    let used = 0;
    for (let r = 0; r < items.rows; r++) used += items.get(r, 'used');
    expect(used).toBe(235);
    // equipData +0x08 and itemData +0x19 name each other
    const equip = m.rows('equipData.bin');
    for (let r = 0; r < items.rows; r++) if (items.get(r, 'category') === 3) expect(equip.get(items.get(r, 'sub'), 'item')).toBe(r);

    const stages = m.rows('shopItemGroup.bin');
    expect(stages.rows).toBe(12);
    expect([0, 1, 11].map((s) => [stages.get(s, 'first'), stages.get(s, 'last'), stages.get(s, 'dungeon'), stages.get(s, 'progress')])).toEqual([[0, 5, 0, 0], [6, 18, 1, 5], [616, 752, 11, 15]]);
    const ctx = m.context();
    expect(ctx.rowName!('dungeonData.bin', stages.get(1, 'dungeon'))).toBe('デンパ島のどうくつ');
    const stock = m.rows('shopItemData.bin');
    expect(ctx.rowName!('itemData.bin', stock.get(1, 'item'))).toBe('キズぐすり');
    expect(m.message(m.rows('skillData.bin').get(0, 'name'))).toBe('アンテナなし');

    const monsters = new GsTable(findByName(parseArchive(roots.get('2713402F')!), 'monsterData.bin')!.body);
    expect(m.message(readField(monsters.row(1), field(HONOLULU_TABLES['monsterData.bin']!, 'name')))).toBe('きばコウモリ');
  });

  test('the master comes out as it was when nothing is edited, and an edit is exported and reverted', () => {
    const m = new HonoluluMaster(bytes);
    for (const file of tables(HONOLULU_MASTER).keys()) m.rows(file);
    expect(m.changedEntries().size).toBe(0);
    expect(equalBytes(m.export(), bytes)).toBe(true);

    const items = m.rows('itemData.bin');
    items.set(1, 'price', 99);
    expect(items.changed(1)).toBe(true);
    expect(items.original(1, 'price')).toBe(20);
    const edited = new HonoluluMaster(m.export());
    expect(edited.rows('itemData.bin').get(1, 'price')).toBe(99);
    expect(equalBytes(edited.rows('itemData.bin').row(2), items.row(2))).toBe(true);

    items.revert(1);
    expect(m.changedEntries().size).toBe(0);
    expect(equalBytes(m.export(), bytes)).toBe(true);
  });

  test('the RomFS viewer shows the tables by their fields, with the names of messages and rows', async () => {
    const session = await HonoluluSession.open(dump);
    const ctx = session.master.context();
    const arc = parseArchive(bytes);
    const body = (file: string) => findByName(arc, file)!.body;
    const items = renderToString(<GsTableView body={body('itemData.bin')} name="itemData.bin" profile={honoluluRomfsProfile} context={ctx} />);
    expect(items).toContain('欄ごと');
    expect(items).toContain('キズぐすり');
    expect(items).toContain('店員の説明');
    const stock = renderToString(<GsTableView body={body('shopItemData.bin')} name="shopItemData.bin" profile={honoluluRomfsProfile} context={ctx} />);
    expect(stock).toContain('#1 キズぐすり');
    // no definition: hex columns only
    expect(renderToString(<GsTableView body={body('monsterGroup.bin')} name="monsterGroup.bin" profile={honoluluRomfsProfile} context={ctx} />)).not.toContain('欄ごと');
  });
});
