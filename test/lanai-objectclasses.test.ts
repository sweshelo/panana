// The props' categories and marks (objectClasses.ts) read from the ROM's MapObject table.
import { beforeAll, describe, expect, test } from 'bun:test';
import { lanaiObjectCategory, lanaiObjectInfo, type LanaiObjectInfo } from '../src/lanai/objectClasses';
import { LanaiSession } from '../src/lanai/session';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

test('a model file name gives the prop its category', () => {
  expect(lanaiObjectCategory('gimk_02_door_01.bch')).toBe('置物・ドア');
  expect(lanaiObjectCategory('gimk_01_stair_03.bch')).toBe('置物・移動');
  expect(lanaiObjectCategory('gimk_09_lamp_09.bch')).toBe('置物・ギミック');
  expect(lanaiObjectCategory('twn_flower_12.bch')).toBe('置物・植物');
  expect(lanaiObjectCategory('inside_obj08_a.bch')).toBe('置物・インテリア');
  expect(lanaiObjectCategory('twn_bill_03.bch')).toBe('置物・エクステリア');
  expect(lanaiObjectCategory('npc_22a.bch')).toBe('置物・人物');
  expect(lanaiObjectCategory('wld_fairy.bch')).toBe('置物・妖精');
  expect(lanaiObjectCategory('obj_invisible.bch')).toBe('置物・その他');
  expect(lanaiObjectCategory('')).toBe('置物・その他');
});

describe.skipIf(!hasLanai)('RPG FREE! props by purpose', () => {
  let info: Map<number, LanaiObjectInfo>;
  beforeAll(async () => {
    const dump = await openImages(
      [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
      (f) => (f as unknown as { name: string }).name,
    );
    info = await lanaiObjectInfo(await LanaiSession.open(dump, { fresh: true }));
  }, 300000);

  test('the ghost NPCs, the torch flame and the file names', () => {
    expect(info.size).toBe(783);
    // the same lamp with and without its flame
    expect(info.get(520)!.file).toBe(info.get(530)!.file);
    expect(info.get(520)!.marks).toEqual(['松明の炎']);
    expect(info.get(530)!.marks).toEqual([]);
    // rows 447〜480 are 409〜442's models at 0.4
    for (let i = 0; i < 34; i++) {
      expect(info.get(447 + i)!.file).toBe(info.get(409 + i)!.file);
      expect(info.get(409 + i)!.marks.some((m) => m.startsWith('半透明'))).toBe(false);
      expect(info.get(447 + i)!.marks).toContain('半透明 (40%)');
    }
    // the fairies' village entrance is a warp hole
    expect(info.get(540)!.category).toBe('置物・移動');
    for (const row of [379, 380, 381]) expect(info.get(row)!.marks).toContain('透明');
    expect([...info.values()].filter((i) => !i.file).length).toBe(0);
    expect([...info.values()].filter((i) => i.category === '置物・宝箱').length).toBeGreaterThan(0);
  });
});
