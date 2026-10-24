// 電波人間のRPG (初代)'s shop (src/honolulu/shops.ts, naauao honolulu/shops.md): the 12 stages of shopItemGroup and their
// runs of shopItemData, laid out again when a stock grows or shrinks. Needs the decrypted Base CIA (test/env.ts).
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { HonoluluMaster } from '../src/honolulu/master';
import { HONOLULU_SHOP_STAGES, HonoluluShop, honoluluShopProblems, honoluluShopRowBytes } from '../src/honolulu/shops';
import { HONOLULU } from '../src/rom/titles';
import { openImage } from '../src/rom/dump';
import { equalBytes, u16 } from '../src/util/bytes';
import { hasHonolulu, HONOLULU_BASE } from './env';

/** The ROM's stages: [first, last] and the number of featured items (naauao honolulu/shops.md §4). */
const ROM_STAGES: [number, number][] = [[0, 5], [6, 18], [19, 37], [38, 75], [76, 116], [117, 167], [168, 224], [225, 301], [302, 398], [399, 502], [503, 615], [616, 752]];

describe.skipIf(!hasHonolulu)('初代のショップ (ROM)', () => {
  let bytes: Uint8Array;
  beforeAll(async () => {
    const dump = await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia');
    bytes = await dump.readRomfs(HONOLULU.master);
  });
  const groupRow = (m: HonoluluMaster, i: number): number[] => {
    const g = m.table('shopItemGroup.bin').row(i);
    return [0, 2, 4, 6, 8, 10].map((o) => u16(g, o));
  };

  test('the 12 stages as the ROM has them', () => {
    const shop = new HonoluluShop(new HonoluluMaster(bytes));
    expect(shop.stages).toBe(HONOLULU_SHOP_STAGES);
    expect(Array.from({ length: 12 }, (_, i) => shop.range(i))).toEqual(ROM_STAGES);
    expect(shop.rows(0).length).toBe(6);
    expect(shop.rows(11).length).toBe(137);
    expect(shop.rows(1).filter((r) => r.featured).length).toBe(6);
    expect(shop.originalMax).toBe(137);
    expect(shop.condition(5)).toEqual({ dungeon: 6, progress: 4 });
    // the shop's stage: the last whose dungeon has reached its value (stage 5 = しゃくねつ火山 before stage 6)
    expect(shop.stageAt(() => 0)).toBe(0);
    expect(shop.stageAt((d) => (d === 6 ? 4 : 0))).toBe(5);
    expect(shop.stageAt((d) => (d === 6 ? 4 : d === 1 ? 5 : 0))).toBe(5);
    expect(shop.changedStages()).toEqual([]);
  });

  test('an unedited master comes out as it was, also after laying the stocks out again', () => {
    const m = new HonoluluMaster(bytes);
    const shop = new HonoluluShop(m);
    shop.set(3, shop.rows(3));
    expect(m.changedEntries().size).toBe(0);
    expect(equalBytes(m.export(), bytes)).toBe(true);
    expect(shop.saved()).toEqual([]);
  });

  test('adding an item moves the ranges of the stages after it; removing it puts them back', () => {
    const m = new HonoluluMaster(bytes);
    const shop = new HonoluluShop(m);
    const before = Array.from({ length: 12 }, (_, i) => groupRow(m, i));
    const stock = shop.rows(2);
    shop.set(2, [...stock, { item: 1, featured: true, bytes: honoluluShopRowBytes(1, true) }]);
    expect(m.table('shopItemData.bin').rows).toBe(754);
    expect(shop.rows(2).length).toBe(20);
    expect(shop.rows(2).at(-1)).toMatchObject({ item: 1, featured: true });
    // stage 2 ends one row later, every later stage starts one row later and names the stage before it
    expect(groupRow(m, 2)).toEqual([19, 38, 2, 5, 6, 18]);
    expect(groupRow(m, 3)).toEqual([39, 76, 3, 5, 19, 38]);
    expect(groupRow(m, 11)).toEqual([617, 753, 11, 15, 504, 616]);
    expect(groupRow(m, 1)).toEqual(before[1]!);
    // the other stocks are the same
    for (const i of [0, 1, 3, 11]) expect(shop.rows(i).map((r) => r.bytes)).toEqual(shop.originalRows(i).map((r) => r.bytes));
    expect(shop.changedStages()).toEqual([2]);
    // and in the exported master
    const out = new HonoluluShop(new HonoluluMaster(m.export()));
    expect(out.rows(2).length).toBe(20);
    expect(out.range(11)).toEqual([617, 753]);

    shop.set(2, stock);
    expect(Array.from({ length: 12 }, (_, i) => groupRow(m, i))).toEqual(before);
    expect(m.changedEntries().size).toBe(0);
    expect(equalBytes(m.export(), bytes)).toBe(true);
  });

  test('a shorter stock, the first stage, and a stage left empty', () => {
    const m = new HonoluluMaster(bytes);
    const shop = new HonoluluShop(m);
    shop.set(0, shop.rows(0).slice(0, 4));
    expect(groupRow(m, 0)).toEqual([0, 3, 0, 0, 0, 3]);
    expect(groupRow(m, 1)).toEqual([4, 16, 1, 5, 0, 3]);
    expect(m.table('shopItemData.bin').rows).toBe(751);
    shop.set(1, []);
    expect(shop.rows(1)).toEqual([]);
    expect(groupRow(m, 1).slice(0, 2)).toEqual([4, 3]);
    expect(groupRow(m, 2)).toEqual([4, 22, 2, 5, 4, 3]);
    expect(shop.rows(2).map((r) => r.bytes)).toEqual(shop.originalRows(2).map((r) => r.bytes));
    // the first stage empty: [1, 0], not [0, 0xFFFF] (the code would list 65536 rows)
    shop.set(0, []);
    expect(groupRow(m, 0)).toEqual([1, 0, 0, 0, 1, 0]);
    expect(shop.rows(0)).toEqual([]);
    expect(groupRow(m, 2).slice(0, 2)).toEqual([0, 18]);
  });

  test('the new marks and what a stage would overrun', () => {
    const m = new HonoluluMaster(bytes);
    const shop = new HonoluluShop(m);
    const items = m.rows('itemData.bin');
    // stage 0's items are not new in stage 1; the ones stage 1 adds are
    expect(shop.rows(1).filter((r) => !shop.isNew(1, r.item)).length).toBe(6);
    expect(shop.rows(0).some((r) => shop.isNew(0, r.item))).toBe(false);
    const category = (id: number): number => items.get(id, 'category');
    for (let i = 0; i < 12; i++) expect(honoluluShopProblems(shop.rows(i), category)).toEqual([]);
    const many = Array.from({ length: 299 }, () => ({ item: 1, featured: true, bytes: honoluluShopRowBytes(1, true) }));
    expect(honoluluShopProblems(many, category)).toHaveLength(2);
  });

  test('the stocks are saved and put back onto a fresh master; revert goes back to the ROM', () => {
    const m = new HonoluluMaster(bytes);
    const shop = new HonoluluShop(m);
    shop.set(4, shop.rows(4).slice(1));
    shop.set(7, [...shop.rows(7), { item: 2, featured: false, bytes: honoluluShopRowBytes(2) }]);
    shop.setCondition(5, { dungeon: 6, progress: 5 });
    const saved = shop.saved();
    const rows = m.saved();

    const m2 = new HonoluluMaster(bytes);
    m2.restore(rows);
    const shop2 = new HonoluluShop(m2);
    shop2.restore(saved);
    expect(equalBytes(m2.export(), m.export())).toBe(true);
    expect(shop2.changedStages()).toEqual([4, 5, 7]);

    shop2.revert();
    expect(m2.changedEntries().size).toBe(0);
    expect(equalBytes(m2.export(), bytes)).toBe(true);
  });
});
