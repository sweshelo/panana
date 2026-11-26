// The custom-stage distribution zip (LanaiSession.distributionZip): the master keeps only the changes of the tables the
// distribution can lay over the game's master (LANAI_DELIVERABLE_TABLES); the others go back to the ROM, no code.ips.
import { beforeAll, describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { parseArchive } from '../src/archive/gsarc';
import { openImages } from '../src/rom/dump';
import { LANAI } from '../src/rom/titles';
import { archiveTables, LanaiSession } from '../src/lanai/session';
import { LanaiLockedError } from '../src/lanai/table';
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

    expect(await s.distributionDiscards()).toEqual([{ table: 'BattleField', rows: 1, edited: true }]);

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

  test('revertUndeliverable undoes the BattleField edit and the code MOD, keeps the ItemData edit', async () => {
    s.revertAll();
    const field = s.need('BattleField');
    const items = s.need('ItemData');
    const romField = field.u32(0, 8);
    field.setU32(0, 8, romField ^ 2);
    const item = items.u32(0, 8) ^ 2;
    items.setU32(0, 8, item);
    s.dropCap = true;
    s.edited();

    s.revertUndeliverable();
    expect(field.u32(0, 8)).toBe(romField);
    expect(field.changed).toBe(false);
    expect(items.u32(0, 8)).toBe(item);
    expect(s.dropCap).toBe(false);
    expect(await s.distributionDiscards()).toEqual([]);
  }, 300_000);

  test('the distribution mode refuses the BattleField and a new condition script, keeps reverts, survives a reload', async () => {
    s.revertAll();
    const field = s.need('BattleField');
    const items = s.need('ItemData');
    const romField = field.u32(0, 8);
    field.setU32(0, 8, romField ^ 4); // made before the mode: stays, can be put back
    s.distributionMode = true;
    expect(() => field.setU32(0, 8, romField)).toThrow(LanaiLockedError);
    expect(() => s.setConditionScript(1, '')).toThrow(LanaiLockedError);
    items.setU32(0, 8, items.u32(0, 8) ^ 4);
    field.revertRow(0);
    expect(field.u32(0, 8)).toBe(romField);

    const s2 = await LanaiSession.open(s.raw, { fresh: true });
    await s2.restore(s.saved());
    expect(s2.distributionMode).toBe(true);
    expect(() => s2.need('BattleField').setU32(0, 8, 1)).toThrow(LanaiLockedError);

    s.distributionMode = false;
    field.setU32(0, 8, romField ^ 4);
    expect(field.u32(0, 8)).toBe(romField ^ 4);
    s.revertAll();
  }, 300_000);

  test('the 3DS MOD zip puts code.ips in the title folder, the Azahar one in exefs/', async () => {
    s.revertAll();
    s.dropCap = true;
    s.edited();
    expect(s.dropCapProblem()).toBeNull();
    const azahar = unzipSync(await s.modZip());
    expect(azahar[`${LANAI.titleId}/exefs/code.ips`]).toBeDefined();
    expect(azahar[`${LANAI.titleId}/code.ips`]).toBeUndefined();
    const luma = unzipSync(await s.modZip({ target: '3ds' }));
    expect(luma[`${LANAI.titleId}/code.ips`]).toEqual(azahar[`${LANAI.titleId}/exefs/code.ips`]!);
    expect(luma[`${LANAI.titleId}/exefs/code.ips`]).toBeUndefined();
    s.dropCap = false;
    s.revertAll();
  }, 300_000);
});
