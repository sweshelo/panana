// 初代's item book (honolulu/items.ts, ItemPage.tsx) and the shared item list without photos (ui/book BookList,
// ui/ItemSources). The tests with the ROM read roms/honolulu-base.cia.
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { parseArchive } from '../src/archive/gsarc';
import { HonoluluItemPage } from '../src/honolulu/ItemPage';
import { CLOTH_CATEGORY, HonoluluClothTextures, honoluluItemRows, honoluluItems, itemChanged, itemStages, itemSubRow, itemTextIds, revertItem } from '../src/honolulu/items';
import { HonoluluSession } from '../src/honolulu/session';
import { openImage } from '../src/rom/dump';
import { HONOLULU } from '../src/rom/titles';
import { BookList } from '../src/ui/book';
import { ItemListControls, ItemSources, PLAIN_ITEM_SORTS, sortItems } from '../src/ui/ItemSources';
import { equalBytes } from '../src/util/bytes';
import { hasHonolulu, HONOLULU_BASE } from './env';

describe('the item list without photos (no ROM)', () => {
  const rows = [{ id: 3, name: 'b', price: 0, sell: 0, kind: 4 }, { id: 1, name: 'a', price: 50, sell: 5, kind: 4 }, { id: 2, name: 'c', price: 20, sell: 2, kind: 1 }];

  test('the category order keeps the ID order within a category; no ☆ in the orders', () => {
    expect(sortItems(rows, 'kind', (x) => x).map((x) => x.id)).toEqual([2, 1, 3]);
    expect(sortItems(rows, 'price-asc', (x) => x).map((x) => x.id)).toEqual([2, 1, 3]);
    expect(PLAIN_ITEM_SORTS.some(([s]) => s.startsWith('rarity'))).toBe(false);
  });

  test('no photo column, no ☆ select, the shops alone', () => {
    const list = renderToString(<BookList rows={rows} total={3} id={(x) => x.id} selected={1} href={(id) => `#/items/${id}`} listRef={{ current: null }}
      columns={[{ head: '名前', cell: (x) => x.name }]} changed={(x) => x.id === 2} />);
    expect(list).not.toContain('photo-cell');
    expect(list).toContain('<th>行</th><th>名前</th>');
    expect(list).toContain('3 / 3 件');
    expect(list.match(/edited-mark/g)).toHaveLength(1);
    const controls = renderToString(<ItemListControls sort="id" setSort={() => {}} sorts={PLAIN_ITEM_SORTS} />);
    expect(controls).not.toContain('☆');
    expect(controls).toContain('分類順');
    const sources = renderToString(<ItemSources shops={[{ label: '段階 1', href: '#/shops/1' }]} note="未解析" />);
    expect(sources).toContain('お店 (1)');
    expect(sources).not.toContain('落とすモンスター');
    expect(sources).not.toContain('宝箱');
    expect(sources).toContain('未解析');
  });

  test('a photo column when the game gives photos (the other games)', () => {
    const list = renderToString(<BookList rows={rows} total={3} id={(x) => x.id} selected={1} href={() => ''} listRef={{ current: null }} photo={() => 'P'} columns={[]} />);
    expect(list.match(/photo-cell/g)).toHaveLength(3);
  });
});

describe.skipIf(!hasHonolulu)('初代の item book (ROM)', () => {
  let session: HonoluluSession;
  beforeAll(async () => {
    session = await HonoluluSession.open(await openImage(Bun.file(HONOLULU_BASE), 'honolulu-base.cia'));
  });

  test('235 items: the rows with +0x18 = 1, by category', () => {
    const items = honoluluItems(session);
    expect(items).toHaveLength(235);
    const by = (c: number): number => items.filter((x) => x.category === c).length;
    expect([by(1), by(3), by(CLOTH_CATEGORY)]).toEqual([51, 83, 101]);
    expect(items[0]).toMatchObject({ row: 1, name: 'キズぐすり', price: 20, sell: 2 });
    // names with ruby read as the reader sees them
    expect(items.every((x) => x.name && !/[%&]/.test(x.name))).toBe(true);
  });

  test('clothes: the name is the description; their texture from B50A5EA9', async () => {
    const cloth = honoluluItems(session).find((x) => x.category === CLOTH_CATEGORY)!;
    const texts = itemTextIds(session, cloth.row);
    expect(texts[1]).toMatchObject({ key: 'desc', same: '名前' });
    const sub = itemSubRow(session, cloth.row)!;
    expect(sub.rows.def.file).toBe('clothData.bin');
    const t = await new HonoluluClothTextures(session.dump).texture(sub.rows.get(sub.row, 'texture'));
    expect(t).toMatchObject({ width: 64, height: 64 });
    expect(t!.rgba.length).toBe(64 * 64 * 4);
  });

  test('the shop stages of an item, linked to the shop page', () => {
    const stages = itemStages(session);
    expect(stages.size).toBe(144);
    expect(stages.get(1)?.[0]).toMatchObject({ stage: 0 });
  });

  test('the page: no photos, the 235 rows, the entry with its texts and prices', () => {
    const html = renderToString(<HonoluluItemPage session={session} arg="1" />);
    expect(html).not.toContain('photo-cell');
    expect(html).toContain('235 / 235 件');
    expect(html).toContain('キズぐすり');
    expect(html).toContain('店員の説明');
    expect(html).toContain('href="#/shops/0"');
  });

  test('editing a name and the prices, then the export; an unedited export is byte for byte the archive', async () => {
    expect(session.modFiles().size).toBe(0);
    const rows = honoluluItemRows(session);
    const texts = session.messages.texts;
    const name = rows.get(2, 'name');
    texts.setText(name, 'キズぐすりプラス');
    rows.set(2, 'price', 99);
    rows.set(2, 'sell', 9);
    session.edited();
    expect(itemChanged(session, 2)).toBe(true);
    expect(honoluluItems(session).find((x) => x.row === 2)).toMatchObject({ name: 'キズぐすりプラス', price: 99, sell: 9 });
    const master = session.modFiles().get(HONOLULU.master)!;
    const reopened = parseArchive(master);
    expect(reopened.entries).toHaveLength(parseArchive(await session.dump.readRomfs(HONOLULU.master)).entries.length);
    revertItem(session, 2);
    expect(itemChanged(session, 2)).toBe(false);
    expect(session.modFiles().size).toBe(0);
    // the master rebuilt after the revert is the archive as it is
    expect(equalBytes(session.master.export(), await session.dump.readRomfs(HONOLULU.master))).toBe(true);
  });
});
