// 電波人間のRPG (honolulu, the first game): telling its dumps and extracted folders apart from RPG2's (both name the master
// 56562135), and its RomFS in the viewer (naauao roms/honolulu.md, honolulu/analysis.md §2-3). The tests with the dump
// need the decrypted Base CIA (test/env.ts HONOLULU_BASE) and are skipped when it is missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { parseArchive, unpackEntry } from '../src/archive/gsarc';
import { HonoluluSession } from '../src/honolulu/session';
import { blzDecompress, isBlz } from '../src/rom/blz';
import { exheaderProgramId, openDumps, openFolder, openImage, type Dump } from '../src/rom/dump';
import { HONOLULU, identifyTitle, KAHARA, OAHU, titleByRootFiles } from '../src/rom/titles';
import { GsTableView } from '../src/romfs/formats';
import { honoluluRomfsProfile } from '../src/romfs/honolulu';
import { entryTypeLabel } from '../src/romfs/profile';
import { RomfsPage } from '../src/romfs/RomfsPage';
import { asArchive, isGsTable } from '../src/romfs/sniff';
import { HONOLULU_PAGES } from '../src/ui/HonoluluShell';
import { hex8, w32 } from '../src/util/bytes';
import { hasHonolulu, HONOLULU_BASE } from './env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** An ExHeader (0x800 bytes) named `name` with the program ID `id`. */
function exheader(name: string, id: string): Uint8Array {
  const b = new Uint8Array(0x800);
  b.set([...name].map((c) => c.charCodeAt(0)));
  w32(b, 0x200, parseInt(id.slice(8), 16));
  w32(b, 0x204, parseInt(id.slice(0, 8), 16));
  return b;
}

const file = (name: string, bytes: Uint8Array = new Uint8Array(16)): File => new File([new Uint8Array(bytes)], name);

describe('telling the first game apart (no ROM)', () => {
  test('by title ID', () => {
    expect(identifyTitle('0004000000077e00')).toBe(HONOLULU);
    expect(identifyTitle('00040000000A7900')).toBe(KAHARA);
    expect(() => identifyTitle('0004000000055D00')).toThrow('0004000000077E00');
  });

  test('an extracted folder: the master name is shared with RPG2, the other root files tell them apart', () => {
    expect(titleByRootFiles(['56562135', 'A90C8038', '49A43B63', '302996EB', '1D37838B'])).toBe(KAHARA);
    expect(titleByRootFiles(['56562135', 'A90C8038', 'B50A5EA9', 'FB50F315', '1D37838B'])).toBe(HONOLULU);
    // with neither set, no game (openFolder falls back to RPG2, as before)
    expect(titleByRootFiles(['56562135'])).toBeUndefined();
    expect(titleByRootFiles(['21350000'])).toBe(OAHU);
  });

  test('the program ID of an ExHeader', () => {
    expect(exheaderProgramId(exheader('honolulu', '0004000000077E00'))).toBe('0004000000077E00');
  });

  test('a folder with exheader.bin is told by its title ID, before the root files', async () => {
    // RPG2's root files, the first game's ExHeader
    const files = [file('code.bin', new Uint8Array(0x100)), file('56562135'), file('49A43B63'), file('302996EB'), file('exheader.bin', exheader('honolulu', HONOLULU.titleId))];
    expect((await openFolder(files, 'f')).title).toBe(HONOLULU);
    // an Update's ExHeader (a folder merged with its Update) names its Base's game
    expect((await openFolder([file('code.bin', new Uint8Array(0x100)), file('56562135'), file('exheader.bin', exheader('oahu', '0004000E000EF000'))], 'f')).title).toBe(OAHU);
    expect((await openFolder(files.slice(0, 4), 'f')).title).toBe(KAHARA);
  });

  test('a decompressed code.bin smaller than RPG2s is kept as it is (it has no BLZ footer)', async () => {
    const code = new Uint8Array(0x1000);
    code[0] = 0x5a;
    expect(isBlz(code)).toBe(false);
    expect(() => blzDecompress(code)).toThrow('BLZ');
    const d = await openFolder([file('code.bin', code), file('56562135'), file('B50A5EA9'), file('FB50F315')], 'f');
    expect(d.title).toBe(HONOLULU);
    expect(d.code).toEqual(code);
  });

  test('the shell pages have a CSS rule that shows them', () => {
    const css = readFileSync(join(import.meta.dir, '..', 'src', 'style.css'), 'utf8');
    for (const [id] of HONOLULU_PAGES) expect(css).toContain(`.shell[data-page='${id}'] .page-${id}`);
  });

  test('the profile: version 5 archives, entry types of its own, no RPG2 table definitions', () => {
    expect(honoluluRomfsProfile.archiveVersion).toBe(5);
    expect(entryTypeLabel(honoluluRomfsProfile, 8)).toContain('マップのパーツ');
    expect(honoluluRomfsProfile.files['56562135']).toContain('master');
  });
});

describe.skipIf(!hasHonolulu)('電波人間のRPG (honolulu) dump', () => {
  let dump: Dump;
  let session: HonoluluSession;
  beforeAll(async () => {
    dump = await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia');
    session = await HonoluluSession.open(dump);
  });

  test('the CIA is the first game Base v1024 (with its decompressed code.bin)', () => {
    expect(dump.title).toBe(HONOLULU);
    expect(dump.titleVersion).toBe(1024);
    expect(dump.code.length).toBe(2293760);
    expect(session.dump).toBe(dump);
  });

  test('opened with the other games, it is its own and not RPG2', async () => {
    const dumps = await openDumps([Bun.file(HONOLULU_BASE)], () => 'honolulu-base.cia');
    expect(dumps.map((d) => d.title.key)).toEqual(['honolulu']);
  });

  test('45 root archives, all version 5; every known file is there', async () => {
    const roots = dump.names();
    expect(roots.length).toBe(45);
    for (const n of roots) expect(asArchive(await dump.readRomfs(n), n)?.version).toBe(5);
    const paths = new Set(dump.files!().map((f) => f.path.toUpperCase()));
    for (const k of Object.keys(honoluluRomfsProfile.files)) expect(paths.has(k)).toBe(true);
    // the folder rule of titles.ts holds for the real root files
    expect(titleByRootFiles(roots)).toBe(HONOLULU);
  });

  test('the master holds 113 entries, 53 of them GS tables that the viewer shows', async () => {
    const master = parseArchive(await dump.readRomfs(HONOLULU.master));
    expect(master.entries.length).toBe(113);
    const tables = master.entries.map((e) => ({ e, u: unpackEntry(master, e) })).filter(({ u }) => isGsTable(u.body));
    expect(tables.length).toBe(53);
    const item = tables.find(({ u }) => u.name === 'itemData.bin')!;
    expect(item).toBeDefined();
    expect(renderToString(<GsTableView body={item.u.body} name={item.u.name} profile={honoluluRomfsProfile} />)).toContain('298 行 × 0x1C バイト');
    const shop = tables.find(({ u }) => u.name === 'shopItemGroup.bin')!;
    expect(renderToString(<GsTableView body={shop.u.body} name={shop.u.name} profile={honoluluRomfsProfile} />)).toContain('12 行 × 0xC バイト');
  });

  test('pages: the RomFS viewer opens on the master', () => {
    const html = renderToString(<RomfsPage dump={dump} profile={honoluluRomfsProfile} arg={undefined} />);
    expect(html).toContain('64 / 64');
    expect(html).toMatch(/<h2 class="mono">56562135<\/h2>/);
    expect(html).toContain('master (GS テーブル 53');
  });

  test('an extracted folder of it (code.bin, the root files) is the first game, with or without exheader.bin', async () => {
    const names = dump.names();
    const roots = await Promise.all(names.map(async (n) => file(n, await dump.readRomfs(n))));
    const code = file('code.bin', dump.code);
    const d = await openFolder([code, ...roots], 'f');
    expect(d.title).toBe(HONOLULU);
    expect(d.code).toEqual(dump.code);
    expect(hex8(parseArchive(await d.readRomfs(HONOLULU.master)).hash)).toBe(HONOLULU.master);
    expect((await openFolder([code, ...roots, file('exheader.bin', exheader('honolulu', HONOLULU.titleId))], 'f')).title).toBe(HONOLULU);
  });
});
