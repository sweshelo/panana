// RPG3 (oahu) pieces that need no ROM: message tags, the Update's patch list, the message store over several
// archives, the message page (test/oahu.test.tsx reads a real dump).
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { parseArchive, unpackEntry } from '../src/archive/gsarc';
import { Gmsg, toUnits } from '../src/game/gmsg';
import { KAHARA_SYNTAX, OAHU_SYNTAX, plainText, textToUnits, unitsToText } from '../src/game/msgtext';
import { OahuMessagePage, parseMessageArg } from '../src/oahu/MessagePage';
import { OahuMessages } from '../src/oahu/messages';
import { OahuSession } from '../src/oahu/session';
import { parsePatchList, withUpdate, type Dump, type UpdateImage } from '../src/rom/dump';
import { OAHU } from '../src/rom/titles';
import { u32, w16, w32 } from '../src/util/bytes';
import { GsTable } from '../src/archive/gstable';
import { MessageStore } from '../src/game/gmsg';
import { fieldPlace, fieldText, readField, writeField, type FieldDef } from '../src/game/tabledef';
import { OahuMaster } from '../src/oahu/master';
import { OahuItemPage } from '../src/oahu/ItemPage';
import { oahuEffectText } from '../src/oahu/items';
import { OAHU_ITEM_DATA } from '../src/oahu/tables';

/** A text GMSG with messages from `first` (type code 9, then the units). */
function gmsg(first: number, bodies: number[][]): Uint8Array {
  const us = bodies.map((b) => [9, ...b, 0]);
  const tbl = 0x20, base = tbl + us.length * 4;
  const size = base + us.reduce((a, u) => a + u.length * 2, 0);
  const b = new Uint8Array(size);
  b.set([0x47, 0x4d, 0x53, 0x47]);
  w32(b, 4, size);
  w32(b, 8, first);
  w32(b, 12, us.length ? first + us.length - 1 : 0xffffffff);
  w32(b, 0x14, 1);
  w32(b, 0x18, tbl);
  w32(b, 0x1c, base);
  let o = 0;
  us.forEach((u, i) => {
    w32(b, tbl + i * 4, o);
    u.forEach((c, k) => w16(b, base + o + k * 2, c));
    o += u.length * 2;
  });
  return b;
}

/** A root archive (version 7) of stored (uncompressed) entries. */
function archive(hash: number, entries: { hash: number; type: number; body: Uint8Array; comp?: number }[]): Uint8Array {
  const head = 12 + entries.length * 28;
  const out = new Uint8Array(head + entries.reduce((a, e) => a + e.body.length, 0));
  w32(out, 0, 7);
  w32(out, 4, hash);
  w32(out, 8, entries.length);
  let pos = head;
  entries.forEach((e, i) => {
    const o = 12 + i * 28;
    w32(out, o, e.hash);
    w32(out, o + 4, e.type);
    w32(out, o + 8, e.body.length);
    w32(out, o + 12, pos);
    w32(out, o + 16, e.comp ?? 0);
    w32(out, o + 20, 1);
    w32(out, o + 24, e.body.length);
    out.set(e.body, pos);
    pos += e.body.length;
  });
  return out;
}

const units = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const RUBY = [1, 0x2b, ...units('電波'), 1, 0x2c, ...units('でんぱ'), 1, 0x2d];

function fakeDump(files: Record<string, Uint8Array>): Dump {
  return {
    label: 'base', title: OAHU, code: new Uint8Array(), names: () => Object.keys(files),
    readRomfs: async (n) => files[n]!.slice(),
  };
}

describe('RPG3 messages', () => {
  test('ruby is 0x2B-0x2D and the page break 0x14; RPG2 keeps its tags', () => {
    const u = Uint16Array.from([9, ...RUBY, ...units('人間'), 1, 0x14, 0x0a, ...units('つぎ'), 0]);
    const t = unitsToText(u, OAHU_SYNTAX);
    expect(t.text).toBe('{ruby:電波|でんぱ}人間{page}\nつぎ');
    expect([...textToUnits(t, OAHU_SYNTAX)]).toEqual([...u]);
    expect(plainText(u, OAHU_SYNTAX)).toBe('電波人間 つぎ');
    // read as RPG2, the same units are plain tags
    expect(unitsToText(u, KAHARA_SYNTAX).text).toContain('{tag:002B}');
    expect([...textToUnits({ kind: 9, text: '{ruby:祠|ほこら}{page}', tail: new Uint16Array([0]) })]).toEqual([9, 1, 0x27, ...units('祠'), 1, 0x28, ...units('ほこら'), 1, 0x29, 1, 0x10, 0]);
  });

  test('an empty file (last ID 0xFFFFFFFF, MessageEvent_JP) has no messages', () => {
    const g = new Gmsg(gmsg(0, []));
    expect(g.raw.length).toBe(0);
    expect(g.has(0)).toBe(false);
    expect(g.roundTrips()).toBe(true);
  });

  test('patch list: count, then the root names', () => {
    const b = new Uint8Array(12);
    w32(b, 0, 2);
    w32(b, 4, 0x21350000);
    w32(b, 8, 0x00910000);
    expect(parsePatchList(b)).toEqual(['21350000', '00910000']);
    expect(() => parsePatchList(b.subarray(0, 8))).toThrow();
  });

  test('the Update: its code, and the patched files from it', async () => {
    const base = fakeDump({ '21350000': Uint8Array.of(1), A4070000: Uint8Array.of(2) });
    const update: UpdateImage = { label: 'update', title: OAHU, titleVersion: 4096, patched: ['21350000'], code: Uint8Array.of(9), readRomfs: async () => Uint8Array.of(3) };
    const d = withUpdate(base, update);
    expect(d.update?.titleVersion).toBe(4096);
    expect([...d.code]).toEqual([9]);
    expect([...(await d.readRomfs('21350000'))]).toEqual([3]);
    expect([...(await d.readRomfs('A4070000'))]).toEqual([2]);
  });

  test('one store over the archives; an edit goes to every copy of MessageCommand; export needs the Update', async () => {
    const cmd = gmsg(80000, [units('たたかう'), units('にげる')]);
    const files = {
      '21350000': archive(0x21350000, [{ hash: 0x49607c00, type: 6, body: gmsg(0, [[...RUBY, ...units('人間')]]) }]),
      '3B630000': archive(0x3b630000, [{ hash: 0x11, type: 2, body: Uint8Array.of(7, 7) }, { hash: 0x22, type: 6, body: cmd }]),
      '58190000': archive(0x58190000, [{ hash: 0x11, type: 2, body: Uint8Array.of(8) }, { hash: 0x22, type: 6, body: cmd }]), // a copy (same name)
    };
    const m = await OahuMessages.load(fakeDump(files));
    expect(m.files.map((f) => f.name)).toEqual(['エントリ 0', 'エントリ 1']);
    expect(m.texts.text(0)!.text).toBe('{ruby:電波|でんぱ}人間');
    m.texts.setText(80001, 'にげだす');
    const out = m.changedArchives();
    expect([...out.keys()].sort()).toEqual(['3B630000', '58190000']);
    for (const [name, bytes] of out) {
      const a = parseArchive(bytes);
      const e = a.entries.find((x) => x.type === 6)!;
      expect(unitsToText(toUnits(new Gmsg(unpackEntry(a, e).body).raw[1]!), OAHU_SYNTAX).text).toBe('にげだす');
      if (name === '3B630000') expect([...unpackEntry(a, a.entries[0]!).body]).toEqual([7, 7]);
    }

    const page = renderToString(<OahuMessagePage session={{ messages: m } as OahuSession} arg="80001" />);
    expect(page).toContain('メッセージ 80001');
    expect(page).toContain('2 つのアーカイブに同じもの');
    expect(page).toContain('にげだす');
    expect(page).toContain('電波人間');
  });

  test('route: decimal or 0x IDs', () => {
    expect(parseMessageArg('40000')).toBe(40000);
    expect(parseMessageArg('0x9C40')).toBe(40000);
    expect(parseMessageArg('x')).toBeUndefined();
  });
});

/** A GS table (+0x00 rows, +0x04 row size, +0x10 data offset, name at +0x30) with these rows. */
function gsTable(name: string, rowSize: number, rows: Uint8Array[]): Uint8Array {
  const off = 0x40;
  const b = new Uint8Array(off + rows.length * rowSize);
  w32(b, 0, rows.length);
  w32(b, 4, rowSize);
  w32(b, 0x10, off);
  w32(b, 0x14, rows.length * rowSize);
  w32(b, 0x18, b.length);
  b.set([...name].map((c) => c.charCodeAt(0)), 0x30);
  rows.forEach((r, i) => b.set(r, off + i * rowSize));
  return b;
}

/** A stored entry whose body is a one-file ZIP would carry the name; tests name the entries through findByName's ZIP, so build those. */
import { zipSync } from 'fflate';
function named(hash: number, type: number, name: string, body: Uint8Array): { hash: number; type: number; body: Uint8Array; comp: number } {
  return { hash, type, body: zipSync({ [name]: [body, { level: 0 }] }), comp: 1 };
}

describe('table fields', () => {
  const row = new Uint8Array(8);
  const flags: FieldDef = { key: 'rarity', offset: 0, type: 'u32', bits: [15, 3], label: '☆' };
  const signed: FieldDef = { key: 'v', offset: 4, type: 's32', bits: [8, 18], label: 'v' };
  const s16f: FieldDef = { key: 's', offset: 4, type: 's16', label: 's' };

  test('bits are read and written without touching the others', () => {
    w32(row, 0, 0xa010b001);
    expect(readField(row, flags)).toBe(1);
    writeField(row, flags, 5);
    expect(u32(row, 0)).toBe(0xa012b001);
    expect(() => writeField(row, flags, 8)).toThrow();
    expect(fieldPlace(flags)).toBe('+0x00 u32 bit15-17');
  });

  test('signed bit fields and s16 read negatives; unsigned ones do not', () => {
    w32(row, 4, 0x43fffc00);
    expect(readField(row, signed)).toBe(-4);
    expect(readField(row, { ...signed, type: 'u32' })).toBe(0x3fffc);
    writeField(row, signed, 600);
    expect(u32(row, 4)).toBe(0x40025800);
    w16(row, 4, 0xfffc);
    expect(readField(row, s16f)).toBe(-4);
    writeField(row, s16f, -2);
    expect(readField(row, s16f)).toBe(-2);
  });

  test('values as text: messages, enums, rows', () => {
    expect(fieldText({ key: 'n', offset: 0, type: 'u32', label: 'n', ref: { kind: 'message' } }, 5, { message: (id) => `m${id}` })).toBe('m5');
    expect(fieldText({ key: 'c', offset: 0, type: 'u8', label: 'c', ref: { kind: 'enum', values: { 3: '装備' } } }, 3)).toBe('装備');
    expect(fieldText({ key: 'a', offset: 0, type: 'u32', label: 'a', ref: { kind: 'row', table: 't' } }, 9, { rowName: () => 'x' })).toBe('#9 x');
  });

  test('RPG3 equipment effects as text', () => {
    expect(oahuEffectText({ slot: 1, kind: 0x1b, sub: 2, value: 20 })).toBe('能力アップ: こうげき +20');
    expect(oahuEffectText({ slot: 1, kind: 0x31, sub: 0, value: 120 })).toBe('経験値 120%');
    expect(oahuEffectText({ slot: 1, kind: 0x0a, sub: 0, value: 6 })).toBe('打撃の属性: 水');
    expect(oahuEffectText({ slot: 2, kind: 0x07, sub: 0, value: 1 })).toBe('効果 0x07: 1');
  });
});

describe('RPG3 new messages and rows', () => {
  test('new messages go past the end of a file of the archive, never into the next file', () => {
    const files = [
      { name: 'MessageSystemCommon_JP.gsmb', entryIndex: 0, gmsg: new Gmsg(gmsg(0, [units('a'), units('b')])), editable: true },
      { name: 'MessageBattle_JP.gsmb', entryIndex: 1, gmsg: new Gmsg(gmsg(4, [units('c')])), editable: true },
    ];
    const store = new MessageStore(files, OAHU_SYNTAX, 'MessageSystemCommon_JP.gsmb');
    expect(store.addedBase).toBe(2);
    expect(store.canAdd(2)).toBe(true);
    expect(store.canAdd(3)).toBe(false);
    const id = store.add(Uint16Array.from([9, ...units('new'), 0]));
    expect(id).toBe(2);
    expect(store.file(id)!.name).toBe('MessageSystemCommon_JP.gsmb');
    store.setText(4, 'C');
    // a saved edit of another file's ID past the base is an edit, not an added message
    const saved = store.saved();
    store.restore(saved);
    expect(store.addedIds()).toEqual([2]);
    expect(store.isEdited(4)).toBe(true);
    const [[f, bytes]] = store.rebuilt().filter(([x]) => x.name === 'MessageSystemCommon_JP.gsmb') as [[(typeof files)[0], Uint8Array]];
    expect(f.entryIndex).toBe(0);
    const g = new Gmsg(bytes);
    expect([g.first, g.last]).toEqual([0, 2]);
    expect(store.newFile()).toBeNull();
  });

  test('saved rows put back only the bytes they changed', async () => {
    const rows = [new Uint8Array(4), Uint8Array.of(1, 2, 3, 4)];
    const dump = fakeDump({ '21350000': archive(0x21350000, [named(0x100, 9, 'itemData.bin', gsTable('ItemData', 4, rows))]) });
    const m = await OahuMaster.load(dump);
    m.table('itemData.bin').row(1)[0] = 9;
    const saved = m.saved();
    expect(saved.map(([t, r]) => [t, r])).toEqual([['itemData.bin', 1]]);
    expect(m.changedEntries().size).toBe(1);
    // the same row with another byte changed (an Update): the edit lands, the other byte stays
    const dump2 = fakeDump({ '21350000': archive(0x21350000, [named(0x100, 9, 'itemData.bin', gsTable('ItemData', 4, [rows[0]!, Uint8Array.of(1, 2, 7, 4)]))]) });
    const m2 = await OahuMaster.load(dump2);
    m2.restore(saved);
    expect([...m2.table('itemData.bin').row(1)]).toEqual([9, 2, 7, 4]);
  });
});

describe('RPG3 item book', () => {
  test('the book lists the items and shows the fields of the selected one', async () => {
    const row = (name: number, price: number, cat: number): Uint8Array => {
      const r = new Uint8Array(0x40);
      w32(r, 0, price);
      w32(r, 0x10, 0xa010b001);
      w32(r, 0x14, name);
      w32(r, 0x34, 1);
      r[0x3a] = cat;
      return r;
    };
    const item = gsTable('ItemData', 0x40, [new Uint8Array(0x40), row(1, 20, 0x11), new Uint8Array(0x40)]);
    const action = gsTable('ActionData', 0x30, [new Uint8Array(0x30), new Uint8Array(0x30)]);
    const files = {
      '21350000': archive(0x21350000, [
        named(0x49607c00, 6, 'MessageSystemCommon_JP.gsmb', gmsg(0, [units('なし'), units('キズぐすり')])),
        named(0x100, 9, 'itemData.bin', item),
        named(0x200, 9, 'actionData.bin', action),
      ]),
    };
    const s = await OahuSession.open(fakeDump(files));
    expect(s.items.items.map((it) => [it.id, it.name, it.price, it.category, it.rarity])).toEqual([[1, 'キズぐすり', 20, '道具 (回復など)', 1]]);
    expect(s.items.canCopy(1)).toBe(true);
    const n = s.items.copyItem(1);
    expect(n).toBe(2);
    expect(s.items.messageId(2, 'name')).toBe(2);
    const html = renderToString(<OahuItemPage session={s} arg="2" />);
    expect(html).toContain('キズぐすり');
    expect(html).toContain('このアイテムを消す');
    expect(html).toContain('itemData の行 2 のすべての欄');
    expect(html).toContain(OAHU_ITEM_DATA.fields.find((f) => f.key === 'limit')!.label);
    expect(() => s.modFiles()).toThrow('Update'); // the export needs the Update
  });
});

