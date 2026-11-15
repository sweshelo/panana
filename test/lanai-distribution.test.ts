// The custom-stage distribution zip (LanaiSession.distributionZip): the master keeps only the changes of the tables the
// distribution can lay over the game's master (LANAI_DELIVERABLE_TABLES); the others go back to the ROM, no code.ips.
import { beforeAll, describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { parseArchive } from '../src/archive/gsarc';
import { openImages } from '../src/rom/dump';
import { LANAI } from '../src/rom/titles';
import { archiveTables, LanaiSession } from '../src/lanai/session';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

describe.skipIf(!hasLanai)('RPG FREE! custom-stage distribution zip (ROM)', () => {
  let s: LanaiSession;
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    s = await LanaiSession.open(dump, { fresh: true });
  }, 300_000);

  test('a BattleField change is discarded, an ItemData change is kept, no exefs/code.ips', async () => {
    const field = s.need('BattleField');
    const items = s.need('ItemData');
    const romField = field.u32(0, 8);
    const romItem = items.u32(0, 8);
    field.setU32(0, 8, romField ^ 1);
    items.setU32(0, 8, romItem ^ 1);
    s.edited();

    expect(await s.distributionDiscards()).toEqual([{ table: 'BattleField', rows: 1 }]);

    const zip = unzipSync(await s.distributionZip());
    expect(zip[`${LANAI.titleId}/exefs/code.ips`]).toBeUndefined();
    const master = zip[`${LANAI.titleId}/romfs/${LANAI.master}`]!;
    const tables = archiveTables(LANAI.master, parseArchive(master));
    const out = (name: string) => tables.find((t) => t.table.name === name)!.table;
    expect(out('BattleField').u32(0, 8)).toBe(romField);
    expect(out('ItemData').u32(0, 8)).toBe(romItem ^ 1);

    // the plain MOD zip still carries both
    const mod = unzipSync(await s.modZip());
    const modTables = archiveTables(LANAI.master, parseArchive(mod[`${LANAI.titleId}/romfs/${LANAI.master}`]!));
    expect(modTables.find((t) => t.table.name === 'BattleField')!.table.u32(0, 8)).toBe(romField ^ 1);
  }, 300_000);
});
