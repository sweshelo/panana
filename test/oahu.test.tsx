// 電波人間のRPG3 (oahu) dump: opening the Base and what the RomFS viewer shows (naauao oahu/analysis.md).
// Needs the decrypted Base CIA (test/env.ts OAHU_BASE); skipped when it is missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { findByName, parseArchive } from '../src/archive/gsarc';
import { GsTable } from '../src/archive/gstable';
import { Gmsg, toUnits } from '../src/game/gmsg';
import { openImage, type Dump } from '../src/rom/dump';
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
