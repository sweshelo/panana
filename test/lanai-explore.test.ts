// TEMPORARY: prints the ShopItem rows of RPG FREE! whose +0x00 is not an item. Removed before the merge.
import { beforeAll, describe, test } from 'bun:test';
import { lanaiContents } from '../src/lanai/contents';
import { LanaiSession } from '../src/lanai/session';
import { lanaiShops } from '../src/lanai/shops';
import { openImages } from '../src/rom/dump';
import { hasLanai, LANAI_BASE, LANAI_UPDATE } from './env';

const log = (...a: unknown[]): void => console.log('EXPLORE', ...a);
const h = (v: number): string => (v >>> 0).toString(16);
const hexRow = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').replace(/(.{8})/g, '$1 ');

describe.skipIf(!hasLanai)('explore', () => {
  let s: LanaiSession;
  beforeAll(async () => {
    const dump = await openImages([Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)], (f) => (f as unknown as { name: string }).name);
    s = await LanaiSession.open(dump, { fresh: true });
  }, 300000);

  test('round 4', async () => {
    const data = s.need('ItemData');
    const name = (id: number): string => { const r = data.find(id); return r >= 0 ? s.plain(data, r, 'name') : '?'; };
    const tables = s.tables.map((t) => `${t.table.name}:${t.table.rows}:${h(t.table.rowIds[0] ?? 0)}`);
    log('MASTERTABLES', tables.join(' '));
    for (const c of lanaiContents(s)) {
      const shops = await lanaiShops(s, c);
      if (!shops) continue;
      for (const sh of shops.shops) {
        const rows = shops.rows(sh.row);
        const bad = rows.filter((r) => r.item && data.find(r.item) < 0);
        if (!bad.length && c.index !== 0) continue;
        log('SHOP', c.index, sh.row, h(sh.id), 'head', h(shops.headRef(sh.row)), 'rows', rows.length, 'bad', bad.length, 'shoprow', hexRow(shops.shopTable.row(sh.row)));
        if (c.index === 0 || bad.length) rows.forEach((r, i) => log('ROW', c.index, sh.row, i, hexRow(r.bytes), name(r.item)));
      }
    }
    // item IDs outside ItemData: which master tables have them as row IDs
    const bad = new Set<number>();
    for (const c of lanaiContents(s)) { const sh = await lanaiShops(s, c); for (const x of sh?.shops ?? []) for (const r of sh!.rows(x.row)) if (r.item && data.find(r.item) < 0) bad.add(r.item); }
    for (const id of [...bad].slice(0, 20)) {
      const hits = s.tables.filter((t) => t.table.rowIds.includes(id)).map((t) => `${t.table.name}#${t.table.find(id)}`);
      log('BADID', h(id), hits.slice(0, 12).join(' '));
    }
  }, 600000);
});
