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
import { w16, w32 } from '../src/util/bytes';

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
function archive(hash: number, entries: { hash: number; type: number; body: Uint8Array }[]): Uint8Array {
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
