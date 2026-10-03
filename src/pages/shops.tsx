// Shop list: every shop (ShopItem / Shop) with what it sells, in the shop's order, at the item's current prices,
// and the clerk's messages, in the shop book shared with RPG3 (ui/ShopBook). The item lists can be edited.
import type { ReactNode } from 'react';
import { hexId } from '../editor/message';
import type { ItemData } from '../session';
import type { PageProps } from '../ui/book';
import { ItemPicker } from '../ui/ItemPicker';
import { ShopBook, type ShopBookShop } from '../ui/ShopBook';
import { DESCRIPTION_VARIANT, shopLabel, type Shop } from '../game/shops';
import { hex8, u32 } from '../util/bytes';

export const shopHref = (id: number): string => `#/shops/${id}`;

const VARIANT_LABEL: Record<number, string> = { 0: '片言 (Ď)', 1: '片言 (ď)', 2: '自然な口調' };

/** An RPG2 ShopItem row: just the item. */
interface Row {
  item: number;
}

export function ShopPage({ session, arg, data, shops }: PageProps & { data: ItemData; shops: Shop[] }): ReactNode {
  const { game } = session;
  const { items, stock } = data;
  const byId = new Map(shops.map((s) => [s.id, s]));
  const book: ShopBookShop[] = shops.map((s) => ({ id: s.id, label: shopLabel(s.id), messages: s.messages }));
  const toRows = (ids: number[]): Row[] => ids.map((item) => ({ item }));
  return (
    <ShopBook<Row>
      shops={book}
      arg={arg}
      href={shopHref}
      texts={game.master.texts}
      messageHref={(id) => `#/messages/${hexId(id)}`}
      rows={(s) => toRows(stock ? stock.items(s.id) : byId.get(s.id)!.items)}
      original={(s) => toRows(stock ? stock.originalItems(s.id) : byId.get(s.id)!.items)}
      same={(a, b) => a.item === b.item}
      newRow={(_, item) => ({ item })}
      item={(id) => {
        const it = items.item(id);
        return it && { name: it.name, href: `#/items/${id}`, changed: items.changed(id) };
      }}
      columns={() => [
        { head: '分類', className: 'muted', cell: (r) => items.item(r.item)?.category ?? '' },
        { head: '買値', className: 'num', cell: (r) => items.item(r.item)?.price ?? '' },
      ]}
      setRows={stock ? (s, next) => {
        stock.set(s.id, next.map((r) => r.item));
        items.setShops(stock.lists);
        session.scheduleSave();
      } : undefined}
      picker={(p) => <ItemPicker game={game} items={items} title={p.title} onClose={p.onClose} onPick={p.onPick} />}
      warnings={(_, rows) => {
        const w: string[] = [];
        if (!rows.length) w.push('品物のない店はゲームで確かめていません (開いたときに止まるおそれがあります)。');
        if (stock && rows.length > stock.originalMax) w.push(`元のデータで一番多い店は ${stock.originalMax} 品です。それを超える数はゲームで確かめていません。`);
        if (rows.some((r) => items.item(r.item)?.price === 0)) w.push('買値 0 のアイテムがあります (タダで買えます)。');
        return w;
      }}
      exportNote={stock ? `変更は ShopItem として ${stock.archiveNames().join(' と ')} に書き出されます。` : undefined}
      stockNote="並びは店での表示順 (ShopItem)。値段はアイテムごと (アイテム図鑑で編集できます)。"
      info={(s) => {
        const v = byId.get(s.id)!.variant;
        return <span className="muted">{`商品の説明: ${v < 0 ? '不明' : `${VARIANT_LABEL[v] ?? `バリアント ${v}`} (itemData +0x${(DESCRIPTION_VARIANT[v] ?? 0).toString(16).toUpperCase()})`}`}</span>;
      }}
      footer={(s) => {
        const raw = byId.get(s.id)!.raw;
        return raw.length > 0 && <div className="muted small mono">{`+0x00〜+0x08 (未解析): ${[0, 4, 8].map((o) => hex8(u32(raw, o))).join(' ')}`}</div>;
      }}
    />
  );
}
