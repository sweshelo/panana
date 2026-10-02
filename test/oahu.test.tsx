// 電波人間のRPG3 (oahu) dump: opening the Base and what the RomFS viewer shows (naauao oahu/analysis.md).
// Needs the decrypted Base CIA (test/env.ts OAHU_BASE); skipped when it is missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { unzipSync } from 'fflate';
import { findByName, parseArchive, unpackEntry } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { equalUnits, Gmsg, toUnits } from '../src/game/gmsg';
import { OAHU_SYNTAX, textToUnits, unitsToText } from '../src/game/msgtext';
import { OAHU_MESSAGE_ARCHIVES, OahuMessages } from '../src/oahu/messages';
import { OahuSession } from '../src/oahu/session';
import { openImage, openImages, openUpdate, type Dump } from '../src/rom/dump';
import { equalBytes } from '../src/util/bytes';
import { GmsgView, GsTableView, viewsFor } from '../src/romfs/formats';
import { oahuRomfsProfile } from '../src/romfs/oahu';
import { asArchive } from '../src/romfs/sniff';
import { hasOahuBase, hasOahuUpdate, OAHU_BASE, OAHU_UPDATE } from './env';

describe.skipIf(!hasOahuBase)('RPG3 Base', () => {
  let dump: Dump;
  beforeAll(async () => {
    dump = await openImage(Bun.file(OAHU_BASE), 'base');
  });

  test('is told apart as oahu, v0, with 269 RomFS files (176 at the root)', () => {
    expect(dump.title.key).toBe('oahu');
    expect(dump.titleVersion).toBe(0);
    expect(dump.code.length).toBe(5021696);
    expect(dump.files!().length).toBe(269);
    expect(dump.names().length).toBe(176);
    expect(dump.files!().some((f) => f.path === 'sound/sound.bcsar')).toBe(true);
  });

  test('every root archive is version 7', async () => {
    let archives = 0;
    for (const n of dump.names()) {
      const a = asArchive(await dump.readRomfs(n), n);
      if (!a) continue;
      archives++;
      expect(a.version).toBe(oahuRomfsProfile.archiveVersion);
    }
    expect(archives).toBe(176);
  });

  test('master 21350000: itemData and the system messages show in their views', async () => {
    const m = parseArchive(await dump.readRomfs('21350000'));
    expect(m.entries.length).toBe(288);
    const item = findByName(m, 'itemData.bin')!;
    const t = new GsTable(item.body);
    expect([t.rows, t.rowSize]).toEqual([1191, 0x40]);
    expect(viewsFor(item.body, 'itemData.bin')[0]!.id).toBe('gstable');
    expect(renderToString(<GsTableView body={item.body} name="itemData.bin" profile={oahuRomfsProfile} />)).toContain('1191 行 × 0x40 バイト');

    const msg = findByName(m, 'MessageSystemCommon_JP.gsmb')!;
    const g = new Gmsg(msg.body);
    expect(g.first).toBe(0);
    // itemData +0x14 of row 1 is the name of the item
    const name = new DataView(t.row(1).buffer, t.row(1).byteOffset).getUint32(0x14, true);
    expect(g.has(name)).toBe(true);
    const text = String.fromCharCode(...toUnits(g.raw[name]!).subarray(1)).replace(/\0.*$/s, '');
    expect(renderToString(<GmsgView body={msg.body} name={null} profile={oahuRomfsProfile} />)).toContain(`ID 0〜${g.last}`);
    expect(text.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasOahuUpdate)('RPG3 Update', () => {
  test('is refused with the Base to choose', async () => {
    await expect(openImage(Bun.file(OAHU_UPDATE), 'update')).rejects.toThrow('Base (00040000000EF000) の CIA を選んでください');
  });
});

describe.skipIf(!hasOahuBase || !hasOahuUpdate)('RPG3 messages and the MOD (Base + Update)', () => {
  let base: Dump;
  let merged: Dump;
  beforeAll(async () => {
    base = await openImage(Bun.file(OAHU_BASE), 'base');
    merged = await openImages([Bun.file(OAHU_UPDATE), Bun.file(OAHU_BASE)], () => 'cia');
  });

  test('the Update: v4096, its code.bin, 11 archives from patch:', async () => {
    expect(merged.update?.titleVersion).toBe(4096);
    expect(merged.code.length).toBe(5029888);
    expect(merged.update!.patched).toEqual(['21350000', '3B630000', 'A9DF0000', '296B0000', '97CF0000', '7BF70000', '619D0000', '838B0000', '58190000', '00910000', '6E380000']);
    const b = await base.readRomfs('21350000'), m = await merged.readRomfs('21350000');
    expect(equalBytes(b, m)).toBe(false);
    expect(equalBytes(await base.readRomfs('A4070000'), await merged.readRomfs('A4070000'))).toBe(true);
    await expect(openUpdate(Bun.file(OAHU_BASE), 'x')).rejects.toThrow('Base です');
  });

  test('every GMSG of the RomFS is in OAHU_MESSAGE_ARCHIVES; every message reads back the same as text', async () => {
    const holders: string[] = [];
    for (const n of base.names()) {
      const a = asArchive(await base.readRomfs(n), n);
      if (a?.entries.some((e) => e.type === 6)) holders.push(n);
    }
    expect(holders.sort()).toEqual([...OAHU_MESSAGE_ARCHIVES].sort());
    const m = await OahuMessages.load(base);
    let n = 0;
    for (const f of m.texts.files) {
      expect(f.editable).toBe(true);
      for (let id = f.gmsg.first; id <= f.gmsg.last; id++, n++) {
        const u = f.gmsg.units(id)!;
        expect(equalUnits(textToUnits(unitsToText(u, OAHU_SYNTAX), OAHU_SYNTAX), u)).toBe(true);
      }
    }
    expect(n).toBe(16889);
    expect(m.texts.text(40000)?.text).toBeDefined();
  });

  test('an edit made on the Base is exported on the Update\'s archives; the zip is in 00040000000EF000/romfs', async () => {
    const s = await OahuSession.open(base);
    expect(s.canExport).toBe(false);
    expect(() => s.modFiles()).toThrow('Update');
    s.messages.texts.setText(80000, 'ＭＯＤ');
    const u = await s.withUpdate(await openUpdate(Bun.file(OAHU_UPDATE), 'update'));
    expect(u.canExport).toBe(true);
    expect(u.messages.texts.isEdited(80000)).toBe(true);
    const files = u.modFiles();
    // MessageCommand_JP: 4 copies
    expect([...files.keys()].sort()).toEqual(['3B630000', '58190000', '619D0000', '838B0000']);
    const upd = parseArchive(await merged.readRomfs('838B0000'));
    const out = parseArchive(files.get('838B0000')!);
    expect(out.entries.length).toBe(upd.entries.length);
    for (const e of out.entries) {
      const before = unpackEntry(upd, upd.entries[e.index]!).body;
      const after = unpackEntry(out, e).body;
      if (e.type !== 6) expect(equalBytes(before, after)).toBe(true);
    }
    const cmd = out.entries.find((e) => unpackEntry(out, e).name === 'MessageCommand_JP.gsmb')!;
    expect(unitsToText(new Gmsg(unpackEntry(out, cmd).body).units(80000)!, OAHU_SYNTAX).text).toBe('ＭＯＤ');
    const zip = unzipSync(u.modZip());
    expect(Object.keys(zip).sort()).toEqual(['00040000000EF000/romfs/3B630000', '00040000000EF000/romfs/58190000', '00040000000EF000/romfs/619D0000', '00040000000EF000/romfs/838B0000']);
  });
});
