// Shop list: every shop (ShopItem / Shop) with what it sells, in the shop's order, at the item's current prices,
// and the clerk's messages. The item lists can be edited: rows move by drag and drop, items are added from a
// <dialog> with their models.
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { hexId } from '../editor/message';
import { itemRef } from './items';
import type { ItemData, Session } from '../session';
import { Count, EditedMark, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky, type PageProps } from '../ui/book';
import { Dialog } from '../ui/Dialog';
import { MessagePreview } from '../ui/message';
import { Photo } from '../ui/Photo';
import { ITEM_CATEGORY, type ItemBook } from '../game/items';
import { DESCRIPTION_VARIANT, dropInto, shopLabel, type Shop, type ShopDrag, type ShopStock } from '../game/shops';
import { hex8, u32 } from '../util/bytes';

export const shopHref = (id: number): string => `#/shops/${id}`;

const VARIANT_LABEL: Record<number, string> = { 0: '片言 (Ď)', 1: '片言 (ď)', 2: '自然な口調' };

export function ShopPage({ session, arg, data, shops }: PageProps & { data: ItemData; shops: Shop[] }): ReactNode {
  const { game } = session;
  const { items, stock } = data;
  const [, edited] = useEdits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'changed'>('all');
  const selected = useSticky(arg !== undefined && arg !== '' ? Number(arg) : undefined, (id) => shops.some((s) => s.id === id), () => shops[0]?.id ?? -1);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  // Drag and drop of the rows
  const drag = useRef<ShopDrag | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const [dragging, setDragging] = useState(-1);
  /** Gap the dragged row would drop into (0..length), or -1. */
  const [dropAt, setDropAt] = useState(-1);

  const itemsOf = (s: Shop): number[] => (stock ? stock.items(s.id) : s.items);
  const changed = (s: Shop): boolean => stock?.changedShop(s.id) ?? false;
  /** First clerk message on one line (to tell the shops apart in the list). */
  const greeting = (s: Shop): string => {
    const id = s.messages.find((m) => m) ?? 0;
    return id ? game.master.texts.preview(id, true) ?? '' : '';
  };
  const matches = (s: Shop): boolean => {
    if (filter === 'changed' && !changed(s)) return false;
    const q = query.trim();
    if (!q) return true;
    if (shopLabel(s.id).includes(q) || greeting(s).includes(q)) return true;
    return itemsOf(s).some((id) => items.item(id)?.name.includes(q));
  };
  const edit = (s: Shop, next: number[]): void => {
    stock!.set(s.id, next);
    items.setShops(stock!.lists);
    session.scheduleSave();
    edited();
  };

  const rows = shops.filter(matches);
  const shop = shops.find((s) => s.id === selected);
  const shopItems = shop ? itemsOf(shop) : [];
  const endDrag = (): void => {
    drag.current = null;
    setDragging(-1);
    setDropAt(-1);
  };
  /** Before or after the row under the pointer (below the last row: at the end). */
  const gap = (e: DragEvent): number => {
    const rs = [...(table.current?.querySelectorAll('tbody tr') ?? [])];
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i]!.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return rs.length;
  };
  const dropZone = stock && shop ? {
    onDragOver: (e: DragEvent) => {
      if (!drag.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropAt(gap(e));
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(-1);
    },
    onDrop: (e: DragEvent) => {
      const d = drag.current;
      if (!d) return;
      e.preventDefault();
      const at = gap(e);
      endDrag();
      const next = dropInto(shopItems, d, at);
      if (next.some((id, i) => id !== shopItems[i]) || next.length !== shopItems.length) edit(shop, next);
    },
  } : {};

  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="アイテム名・店員の台詞で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['changed', '変更した']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={shops.length} unit="店" />
          <table className="book-table">
            <thead><tr><th>ID</th><th>店</th><th>品数</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.id === selected ? 'active' : ''} onClick={() => (location.hash = shopHref(s.id))}>
                  <td className="num muted">{s.id}</td>
                  <td>{shopLabel(s.id)}{changed(s) && <EditedMark text=" ●" />}<div className="muted small">{greeting(s)}</div></td>
                  <td className="num">{itemsOf(s).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="book-detail" ref={detail} {...dropZone}>
        {shop && (
          <>
            <div className="book-head">
              <h2>{shopLabel(shop.id)}</h2>
              <span className="muted">{`${shopItems.length} 品  商品の説明: ${shop.variant < 0 ? '不明' : `${VARIANT_LABEL[shop.variant] ?? `バリアント ${shop.variant}`} (itemData +0x${(DESCRIPTION_VARIANT[shop.variant] ?? 0).toString(16).toUpperCase()})`}`}</span>
            </div>
            <h3>品揃え</h3>
            <table ref={table} className={`enc-table shop-items${stock ? ' editable' : ''}`}>
              <thead>
                <tr>{stock && <th></th>}<th>#</th><th>名前</th><th>分類</th><th>買値</th>{stock && <th></th>}</tr>
              </thead>
              <tbody>
                {shopItems.map((id, i) => {
                  const it = items.item(id);
                  const original = stock?.originalItems(shop.id) ?? shopItems;
                  const cls = [
                    query.trim() && it?.name.includes(query.trim()) ? 'hit' : '',
                    original[i] !== id ? 'edited-row' : '',
                    i === dragging ? 'dragging' : '',
                    i === dropAt ? 'drop-before' : '',
                    dropAt === shopItems.length && i === shopItems.length - 1 ? 'drop-after' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <tr
                      key={`${i}:${id}`}
                      className={cls}
                      draggable={!!stock}
                      onDragStart={stock ? (e) => {
                        drag.current = { kind: 'row', index: i };
                        e.dataTransfer.setData('text/plain', `row ${i}`); // Firefox needs data
                        e.dataTransfer.effectAllowed = 'move';
                        requestAnimationFrame(() => setDragging(i));
                      } : undefined}
                      onDragEnd={stock ? endDrag : undefined}
                    >
                      {stock && <td className="drag-handle" title="ドラッグで並べ替え">⠿</td>}
                      <td className="num muted">{i + 1}</td>
                      <td>
                        {it ? <a href={`#/items/${id}`} draggable={false}>{it.name}</a> : <span className="error">{`#${id} (ないアイテム)`}</span>}
                        {it && items.changed(id) && <EditedMark title="アイテム図鑑で変更した" text=" ●" />}
                      </td>
                      <td className="muted">{it?.category ?? ''}</td>
                      <td className="num">{it ? it.price : ''}</td>
                      {stock && (
                        <td className="shop-ops">
                          <button className="small" title="この店から外す" onClick={() => edit(shop, shopItems.filter((_, j) => j !== i))}>×</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {stock && <StockEditor session={session} items={items} stock={stock} shop={shop} list={shopItems} edit={(next) => edit(shop, next)} />}
            <div className="muted small">並びは店での表示順 (ShopItem)。値段はアイテムごと (アイテム図鑑で編集できます)。</div>
            <h3>店員のメッセージ</h3>
            {shop.messages.length
              ? <table className="enc-table">
                  <tbody>
                    <tr><th>欄</th><th>ID</th><th>本文</th></tr>
                    {shop.messages.map((id, i) => {
                      const units = id ? game.master.texts.units(id) : undefined;
                      return (
                        <tr key={i}>
                          <td className="mono muted">{`+0x${(0x0c + i * 4).toString(16).toUpperCase()}`}</td>
                          <td className="mono">{id ? <a href={`#/messages/${hexId(id)}`}>{hexId(id)}</a> : '0'}</td>
                          <td>{units && <MessagePreview texts={game.master.texts} units={units} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              : <div className="muted">Shop の表 (0xD5CEF800) に行がありません</div>}
            {shop.raw.length > 0 && <div className="muted small mono">{`+0x00〜+0x08 (未解析): ${[0, 4, 8].map((o) => hex8(u32(shop.raw, o))).join(' ')}`}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/** Adding an item, reverting the shop, and warnings about lists the game was not seen with. */
function StockEditor({ session, items, stock, shop, list, edit }: {
  session: Session; items: ItemBook; stock: ShopStock; shop: Shop; list: number[]; edit: (next: number[]) => void;
}): ReactNode {
  const [picking, setPicking] = useState(false);
  const warnings: string[] = [];
  if (!list.length) warnings.push('品物のない店はゲームで確かめていません (開いたときに止まるおそれがあります)。');
  if (list.length > stock.originalMax) warnings.push(`元のデータで一番多い店は ${stock.originalMax} 品です。それを超える数はゲームで確かめていません。`);
  if (list.some((id) => !items.item(id))) warnings.push('ないアイテムが入っています。');
  if (list.some((id) => items.item(id)?.price === 0)) warnings.push('買値 0 のアイテムがあります (タダで買えます)。');
  return (
    <div>
      <div className="row">
        <button onClick={() => setPicking(true)}>＋ 追加</button>
        <span className="muted small">行をドラッグして並べ替え、× で外します。</span>
        {stock.changedShop(shop.id) && <button onClick={() => edit(stock.originalItems(shop.id))}>この店の変更を元に戻す</button>}
      </div>
      <div className="muted small">{`変更は ShopItem として ${stock.archiveNames().join(' と ')} に書き出されます。`}</div>
      {warnings.map((w) => <div key={w} className="issue warn">{`⚠ ${w}`}</div>)}
      {picking && (
        <ItemPicker session={session} items={items} list={list} onClose={() => setPicking(false)}
          onPick={(id) => { setPicking(false); edit([...list, id]); }} />
      )}
    </div>
  );
}

/** Pick an item to add, from the photos (like the monster picker); items the shop sells are marked. */
function ItemPicker({ session, items, list, onPick, onClose }: {
  session: Session; items: ItemBook; list: number[]; onPick: (id: number) => void; onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const q = query.trim();
  const c = cat ? Number(cat) : 0;
  const shown = items.items.filter((it) => (!c || (it.categoryByte & 0xf) === c) && (!q || it.name.includes(q) || String(it.id) === q));
  return (
    <Dialog title="追加するアイテムを選ぶ" onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="名前か ID で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">すべての分類</option>
          {Object.entries(ITEM_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="picker-list">
        <div className="monster-grid">
          {shown.map((it) => {
            const sold = list.includes(it.id);
            return (
              <button
                key={it.id}
                className={`monster-cell${sold ? ' sold' : ''}`}
                disabled={sold}
                title={sold ? 'この店で売っています' : `${it.category}${it.price ? `・${it.price} G` : '・買値 0'}`}
                onClick={() => onPick(it.id)}
              >
                <Photo model={itemRef(session.game, it)} className="photo photo-lg" />
                <span>{it.name}</span>
                <span className="muted small">{it.price ? `${it.price} G` : '0 G'}</span>
              </button>
            );
          })}
          {!shown.length && <div className="muted">見つかりません</div>}
        </div>
      </div>
    </Dialog>
  );
}
