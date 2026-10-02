// The games Panana tells apart and the RomFS viewer (no ROM data; test/oahu.test.ts reads an RPG3 dump).
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { zipSingle, zipEntryName } from '../src/archive/zip';
import { identifyTitle, KAHARA, OAHU, titleByRootFiles } from '../src/rom/titles';
import { FormatBody, GmsgView, GsTableView, hexDump, viewsFor } from '../src/romfs/formats';
import { kaharaRomfsProfile } from '../src/romfs/kahara';
import { oahuRomfsProfile } from '../src/romfs/oahu';
import { entryTypeLabel } from '../src/romfs/profile';
import { parseRomfsArg, RomfsPage, romfsHref } from '../src/romfs/RomfsPage';
import { asArchive, formatName, isGsTable } from '../src/romfs/sniff';
import { OAHU_PAGES } from '../src/ui/OahuShell';
import { w16, w32 } from '../src/util/bytes';
import type { Dump } from '../src/rom/dump';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A GS table of `rows` rows of `size` bytes (row r, byte i = r + i), named `name`. */
function gsTable(name: string, rows: number, size: number): Uint8Array {
  const off = 0x40;
  const b = new Uint8Array(off + rows * size);
  w32(b, 0, rows);
  w32(b, 4, size);
  w32(b, 0x10, off);
  w32(b, 0x14, rows * size);
  w32(b, 0x18, b.length);
  b.set([...name].map((c) => c.charCodeAt(0)), 0x30);
  for (let r = 0; r < rows; r++) for (let i = 0; i < size; i++) b[off + r * size + i] = (r + i) & 0xff;
  return b;
}

/** A text GMSG with messages from `first` (type code 1, then the text). */
function gmsg(first: number, texts: string[]): Uint8Array {
  const bodies = texts.map((t) => Uint16Array.from([1, ...[...t].map((c) => c.charCodeAt(0)), 0]));
  const tbl = 0x20, base = tbl + texts.length * 4;
  const size = base + bodies.reduce((a, u) => a + u.length * 2, 0);
  const b = new Uint8Array(size);
  b.set([0x47, 0x4d, 0x53, 0x47]);
  w32(b, 4, size);
  w32(b, 8, first);
  w32(b, 12, first + texts.length - 1);
  w32(b, 0x14, 1);
  w32(b, 0x18, tbl);
  w32(b, 0x1c, base);
  let o = 0;
  bodies.forEach((u, i) => {
    w32(b, tbl + i * 4, o);
    u.forEach((c, k) => w16(b, base + o + k * 2, c));
    o += u.length * 2;
  });
  return b;
}

describe('titles', () => {
  test('a dump is told apart by its title ID; an update is refused with the Base to use', () => {
    expect(identifyTitle('00040000000a7900')).toBe(KAHARA);
    expect(identifyTitle('00040000000EF000')).toBe(OAHU);
    expect(() => identifyTitle('0004000E000EF000')).toThrow('Base (00040000000EF000)');
    expect(() => identifyTitle('0004000000055D00')).toThrow('00040000000A7900');
  });

  test('an extracted folder is told apart by its master archive', () => {
    expect(titleByRootFiles(['A90C8038', '56562135'])).toBe(KAHARA);
    expect(titleByRootFiles(['21350000', 'a4070000'])).toBe(OAHU);
    expect(titleByRootFiles(['12345678'])).toBeUndefined();
  });
});

describe('RomFS viewer', () => {
  test('route: path and entry round trip, folders kept in one segment', () => {
    expect(romfsHref('sound/sound.bcsar')).toBe('#/romfs/sound%2Fsound.bcsar');
    expect(parseRomfsArg(romfsHref('sound/sound.bcsar').split('/')[2])).toEqual({ path: 'sound/sound.bcsar' });
    expect(parseRomfsArg(romfsHref('21350000', 0x4b2a1c00).split('/')[2])).toEqual({ path: '21350000', entry: 0x4b2a1c00 });
    expect(parseRomfsArg('%E0%A4%A')).toBeUndefined();
  });

  test('formats: GS tables, magic numbers, the 0x180 header of map parts, archives', () => {
    const t = gsTable('itemData', 3, 0x10);
    expect(isGsTable(t)).toBe(true);
    expect(formatName(t)).toBe('GS テーブル');
    expect(isGsTable(t.subarray(0, t.length - 1))).toBe(false);
    expect(formatName(Uint8Array.from([0x42, 0x43, 0x48, 0, 1, 2]))).toBe('BCH (H3D モデル)');
    const part = new Uint8Array(0x200);
    part.set([0x42, 0x43, 0x48, 0], 0x180);
    expect(formatName(part)).toBe('0x180 バイトのヘッダー + BCH');
    expect(formatName(new Uint8Array(16))).toBeNull();

    const arc = new Uint8Array(12 + 28);
    w32(arc, 0, 7);
    w32(arc, 4, 0x21350000);
    w32(arc, 8, 1);
    expect(asArchive(arc, '21350000')?.entries.length).toBe(1);
    expect(asArchive(arc, '56562135')).toBeNull();
    expect(asArchive(arc, 'sound/sound.bcsar')).toBeNull();
  });

  test('the file name of a ZIP entry is read without inflating it', () => {
    expect(zipEntryName(zipSingle('itemData.bin', new Uint8Array(100)))).toBe('itemData.bin');
    expect(zipEntryName(new Uint8Array(40))).toBeNull();
  });

  test('profiles: entry types differ by game', () => {
    expect(entryTypeLabel(kaharaRomfsProfile, 2)).toContain('CGFX');
    expect(entryTypeLabel(oahuRomfsProfile, 2)).toContain('BCH');
    expect(entryTypeLabel(oahuRomfsProfile, 99)).toBe('種類 99');
  });

  test('views: a table, messages, and the hex dump for anything', () => {
    const t = gsTable('itemData', 3, 0x0e);
    expect(viewsFor(t, 'itemData.bin').map((v) => v.id)).toEqual(['gstable', 'hex']);
    const html = renderToString(<GsTableView body={t} name="itemData.bin" profile={oahuRomfsProfile} />);
    expect(html).toContain('itemData');
    expect(html).toContain('3 行 × 0xE バイト');
    expect(html).toContain('03020100'); // row 0, +0x00 as a u32
    expect(html).toContain('0e 0f'); // row 2, the 2 bytes after the last u32

    const m = gmsg(40000, ['はなもぐら', 'キズぐすり']);
    expect(viewsFor(m, null).map((v) => v.id)).toEqual(['gmsg', 'hex']);
    const mh = renderToString(<GmsgView body={m} name={null} profile={oahuRomfsProfile} />);
    expect(mh).toContain('ID 40000〜40001 (2 件)');
    expect(mh).toContain('キズぐすり');

    expect(hexDump(Uint8Array.from([0x41, 0x42, 0, 0xff]))).toBe('00000000  41 42 00 ff' + ' '.repeat(36) + '  AB..');
    expect(renderToString(<FormatBody body={new Uint8Array(4)} name={null} profile={kaharaRomfsProfile} />)).toContain('形式は不明');
  });

  test('page: every file with what is known of it; the master is shown first', () => {
    const files = [{ path: '21350000', size: 2 << 20 }, { path: 'sound/sound.bcsar', size: 2048 }, { path: '80790000', size: 100 }];
    const dump: Dump = {
      label: 'test', title: OAHU, code: new Uint8Array(), names: () => ['21350000', '80790000'], files: () => files,
      readRomfs: () => new Promise(() => {}),
    };
    const html = renderToString(<RomfsPage dump={dump} profile={oahuRomfsProfile} arg={undefined} />);
    expect(html).toContain('3 / 3');
    expect(html).toContain('sound/sound.bcsar');
    expect(html).toContain('master (GS テーブル');
    expect(html).toContain('2.0 MB');
    expect(html).toMatch(/<h2 class="mono">21350000<\/h2>/);
  });

  test('the RPG3 shell pages have a CSS rule that shows them', () => {
    const css = readFileSync(join(import.meta.dir, '..', 'src', 'style.css'), 'utf8');
    for (const [id] of OAHU_PAGES) expect(css).toContain(`.shell[data-page='${id}'] .page-${id}`);
  });
});
