// RPG FREE!'s shops (src/lanai/shops.ts, ShopPage.tsx; naauao lanai/shops.md): laying the ShopItem rows out again when a
// shop's stock changes (no ROM), and the ROM's shops, clerks and the page.
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { lanaiContents } from '../src/lanai/contents';
import { lanaiMaps } from '../src/lanai/maps';
import { LanaiSession } from '../src/lanai/session';
import { LanaiShopPage } from '../src/lanai/ShopPage';
import { LanaiContentShops, lanaiClerks, lanaiShopRowBytes, lanaiShops, SHOP_HEAD, SHOP_LIMIT } from '../src/lanai/shops';
import { LanaiTable } from '../src/lanai/table';
import { openImages } from '../src/rom/dump';
import { u32, w32 } from '../src/util/bytes';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

/** A table without strings: the name in the pool, the rows, the row IDs, no relocations (as Shop / ShopItem). */
function plainTable(name: string, size: number, rows: Uint8Array[], ids: number[]): Uint8Array {
  const pool = new TextEncoder().encode(`${name}\0`.padEnd(16, '\0'));
  const data = 0x40 + pool.length;
  const idsAt = Math.ceil((data + rows.length * size) / 16) * 16;
  const relocAt = Math.ceil((idsAt + ids.length * 4) / 16) * 16;
  const b = new Uint8Array(relocAt);
  [rows.length, size, 0x40, pool.length, data, rows.length * size, idsAt, ids.length * 4, 0, 0, relocAt, 0, 0, 0, name.length + 1].forEach((v, i) => w32(b, i * 4, v));
  b.set(pool, 0x40);
  rows.forEach((r, i) => b.set(r, data + i * size));
  ids.forEach((id, i) => w32(b, idsAt + i * 4, id));
  return b;
}

const head = (): Uint8Array => {
  const b = lanaiShopRowBytes(undefined, 0);
  b[SHOP_HEAD] = 1;
  return b;
};
const item = (id: number, limit = 0): Uint8Array => {
  const b = lanaiShopRowBytes(undefined, id);
  b[SHOP_LIMIT] = limit;
  return b;
};
const id = (n: number): number => (0x80000000 | n) >>> 0;

/** Two shops: shop 0 = head row 0 + two items, shop 1 = head row 3 + one item (Shop +0x00 = their head rows' IDs). */
function twoShops(): LanaiContentShops {
  const items = new LanaiTable(plainTable('ShopItem', 0x2c, [head(), item(id(1), 5), item(id(2)), head(), item(id(7))], [0, 1, 2, 3, 4].map((n) => id(n + 10))));
  const shopRow = (ref: number): Uint8Array => { const b = new Uint8Array(0x1c); w32(b, 0, ref); return b; };
  const shop = new LanaiTable(plainTable('Shop', 0x1c, [shopRow(id(10)), shopRow(id(13))], [id(0), id(1)]));
  return new LanaiContentShops(null as unknown as LanaiSession, { index: 1, archive: 'X', tableResource: 0, stages: [] }, shop, items);
}

const itemsOf = (s: LanaiContentShops, shop: number): number[] => s.rows(shop).map((r) => r.item & 0xffff);

describe('RPG FREE! shop stock edits', () => {
  test('reads the stock of each shop up to the next head row', () => {
    const s = twoShops();
    expect(itemsOf(s, 0)).toEqual([1, 2]);
    expect(itemsOf(s, 1)).toEqual([7]);
    expect(s.rows(0)[0]!.bytes[SHOP_LIMIT]).toBe(5);
    expect(s.originalMax).toBe(2);
  });

  test('a longer stock moves the next shop, whose Shop +0x00 follows its head row', () => {
    const s = twoShops();
    s.set(0, [...s.rows(0), s.newRow(0, id(3))]);
    expect(itemsOf(s, 0)).toEqual([1, 2, 3]);
    expect(itemsOf(s, 1)).toEqual([7]);
    expect(s.items.rows).toBe(6);
    // the head row of shop 1 is now row 4 (row ID 0x8000000E): Shop +0x00 names it
    expect(s.shopTable.u32(1, 0)).toBe(id(14));
    expect(s.changed(0)).toBe(true);
    expect(s.changed(1)).toBe(false);
    // the copy of the shop's first row has no limit
    expect(s.rows(0)[2]!.bytes[SHOP_LIMIT]).toBe(0);
  });

  test('a shorter stock keeps the rows of the table (the rest are head rows of no shop) and goes back to the ROM', () => {
    const s = twoShops();
    const before = s.items.data.slice();
    const shopBefore = s.shopTable.data.slice();
    s.set(0, []);
    expect(itemsOf(s, 0)).toEqual([]);
    expect(itemsOf(s, 1)).toEqual([7]);
    expect(s.items.rows).toBe(5);
    expect(s.shopTable.u32(1, 0)).toBe(id(11));
    expect([3, 4].map((r) => s.items.u8(r, SHOP_HEAD))).toEqual([1, 1]);
    s.set(0, s.originalRows(0));
    expect(s.items.data).toEqual(before);
    expect(s.shopTable.data).toEqual(shopBefore);
    expect(s.items.changed || s.shopTable.changed).toBe(false);
  });

  test('rows added by an edit are removed again when the stock shrinks', () => {
    const s = twoShops();
    s.set(1, [...s.rows(1), s.newRow(1, id(8)), s.newRow(1, id(9))]);
    expect(s.items.rows).toBe(7);
    s.set(1, s.originalRows(1));
    expect(s.items.rows).toBe(5);
    expect(s.items.changed).toBe(false);
  });
});

describe.skipIf(!hasLanai)('RPG FREE! shops (ROM)', () => {
  let session: LanaiSession;
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    session = await LanaiSession.open(dump, { fresh: true });
  }, 300000);
  afterEach(() => session.revertAll());

  test('every content has a Shop and a ShopItem; 193 shops, three contents with more than one', async () => {
    let total = 0;
    const multi: number[] = [];
    for (const c of lanaiContents(session)) {
      const s = (await lanaiShops(session, c))!;
      expect(s).not.toBeNull();
      total += s.shops.length;
      if (s.shops.length > 1) multi.push(c.index);
      for (const sh of s.shops) expect(s.editable(sh.row)).toBe(true);
    }
    expect(total).toBe(193);
    expect(multi).toEqual([0, 24, 97]);
  }, 300000);

  test('content 2: the clerk of D01001F01 and the shop it opens', async () => {
    const c = lanaiContents(session)[2]!;
    const shops = (await lanaiShops(session, c))!;
    const names = new Map(session.need('ItemData').rowIds.map((rid, r) => [rid, session.plain(session.need('ItemData'), r, 'name')]));
    expect(shops.rows(0).map((r) => names.get(r.item))).toEqual(['キズぐすり', 'ふっかつのくすり', 'アンテナパワー', 'マヒよけのスカーフ', 'つちのおまもり', 'かぜのグラブ']);
    expect(shops.rows(0).map((r) => r.bytes[SHOP_LIMIT])).toEqual([5, 3, 1, 0, 0, 0]);
    const clerks = lanaiClerks(await lanaiMaps(session, c));
    expect(clerks.map((k) => [k.group, k.event, k.places.map((p) => `${p.map}/${p.section}#${p.index}`)])).toEqual([[1, 10, ['D01001F01/5#0']]]);
    const html = renderToString(<LanaiShopPage session={session} arg="2.0" />);
    expect(html).toContain('店の表を読むコンテンツ');
  }, 300000);

  test('content 0, shop 2: some rows name ItemData by row number (ペイント…), and every row is an item', async () => {
    const shops = (await lanaiShops(session, lanaiContents(session)[0]!))!;
    const data = session.need('ItemData');
    const rows = shops.rows(2);
    const small = rows.filter((r) => r.item && r.item < 0x80000000);
    expect(small.length).toBeGreaterThan(0);
    expect(new Set(small.map((r) => session.plain(data, data.find(r.item), 'name')))).toContain('ペイントしろ');
    for (const s of shops.shops) for (const r of shops.rows(s.row)) if (r.item) expect(data.find(r.item)).toBeGreaterThanOrEqual(0);
  }, 300000);

  test('content 24: a longer stock keeps the other 24 shops, is saved and put back', async () => {
    const c = lanaiContents(session)[24]!;
    const shops = (await lanaiShops(session, c))!;
    const before = shops.shops.map((s) => shops.rows(s.row).map((r) => r.item));
    shops.set(0, [shops.newRow(0, before[0]![0]!), ...shops.rows(0)]);
    expect(shops.rows(0).length).toBe(before[0]!.length + 1);
    for (const s of shops.shops.slice(1)) expect(shops.rows(s.row).map((r) => r.item)).toEqual(before[s.row]!);
    const saved = session.saved();
    expect(saved.rows.length).toBeGreaterThan(0);
    const other = await LanaiSession.open(session.dump, { fresh: true });
    await other.restore(saved);
    const again = (await lanaiShops(other, lanaiContents(other)[24]!))!;
    expect(again.shops.map((s) => again.rows(s.row).map((r) => r.item))).toEqual(shops.shops.map((s) => shops.rows(s.row).map((r) => r.item)));
    shops.set(0, shops.originalRows(0));
    expect(shops.items.changed || shops.shopTable.changed).toBe(false);
    expect(u32(shops.shopTable.row(1), 0)).toBe(u32(shops.shopTable.originalRow(1)!, 0));
  }, 300000);
});
