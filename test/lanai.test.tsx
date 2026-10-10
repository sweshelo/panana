// 電波人間のRPG FREE! (lanai) dump: opening the Base + Update, the version 10 archives, the tables and their strings, the
// contents, and the pages (naauao lanai/analysis.md, lanai/contents.md). Needs the decrypted CIAs (test/env.ts
// LANAI_BASE / LANAI_UPDATE); skipped when they are missing.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { parseArchive, rebuildArchive, unpackEntry } from '../src/archive/gsarc';
import { croInfo, demangleName, lanaiContents, readContent } from '../src/lanai/contents';
import { lanaiText, parseLanaiMessage } from '../src/lanai/message';
import { LanaiMessagePage } from '../src/lanai/MessagePage';
import { LanaiSession } from '../src/lanai/session';
import { LanaiStagePage } from '../src/lanai/StagePage';
import { LanaiTable } from '../src/lanai/table';
import { openImages, type Dump } from '../src/rom/dump';
import { RomfsPage } from '../src/romfs/RomfsPage';
import { viewsFor } from '../src/romfs/formats';
import { lanaiRomfsProfile } from '../src/romfs/lanai';
import { asArchive, formatName, isGsTable } from '../src/romfs/sniff';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

test('demangles the nested names of the imports of a CRO', () => {
  expect(demangleName('_ZN11ScriptChara6MoveToEP5GSvec')).toBe('ScriptChara::MoveTo');
  expect(demangleName('_ZNK3Foo3BarEv')).toBe('Foo::Bar');
  expect(demangleName('_ZdlPv')).toBe('_ZdlPv');
});

test('reads a string with ruby and an insertion tag', () => {
  // 「{大|だい}[ItemData:0x800000C7:name]」 as UTF-16 with tags
  const units: number[] = [0x1, 0x38, 0, ...'大'.split('').map((c) => c.charCodeAt(0)), 0x1, 0x39, 0, ...[...'だい'].map((c) => c.charCodeAt(0)), 0x1, 0x3a, 0];
  const str = (s: string): number[] => {
    const n = Math.ceil((s.length + 1) / 2);
    const bytes = [...s].map((c) => c.charCodeAt(0));
    while (bytes.length < n * 2) bytes.push(0);
    return [3, n, ...Array.from({ length: n }, (_, i) => bytes[i * 2]! | (bytes[i * 2 + 1]! << 8))];
  };
  units.push(0x1, 0x37, 3, ...str('ItemData'), 2, 0xc7, 0x8000, ...str('name'), 0x41, 0);
  const b = new Uint8Array(new Uint16Array(units).buffer);
  const { tokens, end } = parseLanaiMessage(b, 0);
  expect(lanaiText(tokens)).toBe('{ruby:大|だい}{ins:ItemData:0x800000C7:name}A');
  expect(end).toBe(b.length);
});

describe.skipIf(!hasLanai)('RPG FREE! Base + Update', () => {
  let dump: Dump;
  let session: LanaiSession;
  beforeAll(async () => {
    dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    session = await LanaiSession.open(dump);
  });

  test('is told apart as lanai, Base v0 + Update v17408 (184 archives from the Update)', () => {
    expect(dump.title.key).toBe('lanai');
    expect(dump.titleVersion).toBe(0);
    expect(dump.update?.titleVersion).toBe(17408);
    expect(dump.update?.patched.length).toBe(184);
    expect(dump.code.length).toBe(4182016);
    // the root files of the Base and the archives only the Update has
    expect(dump.names().length).toBe(224);
    expect(dump.files!().some((f) => f.path === '719F0000' && f.size > 0)).toBe(true);
  });

  test('every root archive is version 10 and rebuilds to the same bytes', async () => {
    let archives = 0;
    for (const n of ['2135000A', '7BF7000A', 'A9DF0000', '59B00000']) {
      const b = await dump.readRomfs(n);
      const a = asArchive(b, n)!;
      expect(a.version).toBe(lanaiRomfsProfile.archiveVersion);
      expect(rebuildArchive(a, new Map())).toEqual(b);
      archives++;
    }
    for (const n of dump.names()) {
      const b = await dump.readRomfs(n);
      if (b.length >= 4 && (b[0]! | (b[1]! << 8)) === 10) expect(asArchive(b, n)?.entries.length).toBeGreaterThan(0);
    }
    expect(archives).toBe(4);
  });

  test('the master holds 114 entries; its tables are lanai tables, not RPG2 / RPG3 ones', async () => {
    const master = parseArchive(await dump.readRomfs('2135000A'));
    expect(master.entries.length).toBe(114);
    const tables = session.tables.filter((t) => t.archive === '2135000A');
    expect(tables.length).toBe(79);
    for (const t of tables) {
      expect(isGsTable(t.table.data)).toBe(false);
      expect(viewsFor(t.table.data, t.file)[0]!.id).toBe('lanai-table');
    }
    const sizes = Object.fromEntries(['MonsterParameter', 'MonsterDesign', 'ItemData', 'ItemDataCore', 'ActionData', 'Contents', 'MapStageIntegration', 'MessageMapStage'].map((n) => {
      const t = session.need(n);
      return [n, [t.rows, t.rowSize]];
    }));
    expect(sizes).toEqual({
      MonsterParameter: [1231, 0x24], MonsterDesign: [570, 0xa0], ItemData: [3854, 0x10], ItemDataCore: [3232, 0x3c],
      ActionData: [5017, 0x2c], Contents: [127, 8], MapStageIntegration: [132, 0x4c], MessageMapStage: [135, 0x14],
    });
    expect(formatName(session.need('ItemData').data)).toBe('GS テーブル (RPG FREE! の形式)');
  });

  test('strings: names, the field-name table, row IDs and the insertion tag', () => {
    const mp = session.need('MonsterParameter');
    expect(mp.fields.map((f) => [f.name, f.offset])).toEqual([['name', 4], ['voice', 8], ['group_name', 12]]);
    expect(session.plain(mp, 1, 'name')).toBe('いちごおばけ');
    expect(session.plain(mp, 1, 'group_name')).toBe('いちごおばけたち');
    expect(session.plain(mp, 600, 'name')).toBe('だいまおう');
    const ms = session.need('MessageMapStage');
    const r = ms.find(0x80000015);
    expect(r).toBe(7);
    expect(session.field(ms, r, 0x10)!.text).toContain('{ins:MonsterParameter:0x80000092:name}たちに困っている');
    expect(session.plain(ms, r, 'stage_exp')).toContain('ウッキーたちに困っている');
    expect(session.plain(ms, r, 'stage_name')).toContain('4.ウッキー');
    // a row number below 0x80000000 is a row number
    expect(ms.find(3)).toBe(3);
    expect(ms.find(0x8fffffff)).toBe(-1);
  });

  test('the contents: archives, stages and their stamina (naauao lanai/contents.md §3.1)', async () => {
    const cs = lanaiContents(session);
    expect(cs.length).toBe(127);
    expect(cs[38]!.archive).toBe('59B00000');
    const stamina = (i: number): number[] => cs[i]!.stages.map((s) => s.stamina);
    expect(stamina(1)).toEqual([5]);
    expect(stamina(4)).toEqual([20]);
    expect(stamina(10)).toEqual([50]);
    expect(cs[4]!.stages[0]!.name).toBe('4.ウッキー大騒動');
    const c38 = await readContent(session, cs[38]!);
    expect(c38.def.slice(0, 4)).toEqual([38, 38, 0x2917f400, 1]);
    expect(c38.cro?.name).toBe('contents0038.cro');
    expect(c38.cro?.info.module).toBe('contents0038');
    expect(c38.cro?.info.classes).toEqual(['D01BossEvent', 'D01BossWin', 'D01Intro']);
    expect(c38.cro?.info.imports).toContain('ScriptMenu::StartMessage');
    expect(c38.tables.map((t) => t.table.name)).toContain('MapStage');
    // every content has its CRO named after its number
    for (const c of [cs[0]!, cs[75]!, cs[126]!]) expect((await readContent(session, c)).cro?.name).toBe(`contents${String(c.index).padStart(4, '0')}.cro`);
  });

  test('a CRO is named by the RomFS viewer', async () => {
    const a = await session.archive('59B00000');
    const e = a.entries.find((x) => x.hash === 0x2917f400)!;
    const body = unpackEntry(a, e).body;
    expect(formatName(body)).toBe('CRO (モジュール)');
    expect(croInfo(body).module).toBe('contents0038');
  });

  test('every table of the master parses, with its strings inside the file', () => {
    for (const { table: t } of session.tables) {
      expect(new LanaiTable(t.data).rows).toBe(t.rows);
      for (const o of t.stringOffsets()) for (let r = 0; r < Math.min(t.rows, 20); r++) {
        const at = t.stringOffset(r, o);
        if (at >= 0) expect(at).toBeLessThan(t.data.length);
      }
    }
  });

  test('the pages render', () => {
    const stages = renderToString(<LanaiStagePage session={session} arg="4" />);
    expect(stages).toContain('ウッキー大騒動');
    expect(stages).toContain('村長の頼みを聞こう！');
    const messages = renderToString(<LanaiMessagePage session={session} arg={undefined} />);
    expect(messages).toContain('MessageCommon');
    expect(messages).toContain('MonsterParameter');
    const romfs = renderToString(<RomfsPage dump={dump} profile={lanaiRomfsProfile} arg="2135000A" />);
    expect(romfs).toContain('2135000A');
  });
});
