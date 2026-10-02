// The shop list shared by RPG2 (pages/shops.tsx) and RPG3 (oahu/ShopPage.tsx): every shop with what it sells, in the
// shop's order, and the clerk's messages. The stock can be edited: rows move by drag and drop, items are added from a
// <dialog> with their models, × takes one out. Each game gives its rows (an item ID, plus whatever the row carries),
// the item's name and columns, and its picker.
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { hexId } from '../editor/message';
import type { MessageStore } from '../game/gmsg';
import { dropRows, type ShopDrag } from '../game/shops';
import { Count, EditedMark, ListFilter, useActiveRow, useEdits, useScrollTop, useSticky } from './book';
import { MessagePreview } from './message';

export interface ShopBookShop {
  id: number;
  label: string;
  /** Clerk message IDs (0 = none); empty when the shop has no settings row. */
  messages: number[];
  /** Offset of the first clerk message in the settings row (the rest follow every 4 bytes). */
  messageOffset?: number;
}

export interface ShopBookItem {
  name: string;
  href: string;
  /** Changed in the item book. */
  changed?: boolean;
}

/** A column of the stock after the item's name. */
export interface ShopColumn<T> {
  head: string;
  className?: string;
  cell: (row: T, index: number) => ReactNode;
}

export interface ShopBookProps<T extends { item: number }> {
  shops: ShopBookShop[];
  arg: string | undefined;
  href: (id: number) => string;
  texts: MessageStore;
  messageHref: (id: number) => string;
  /** The current rows of a shop. */
  rows: (shop: ShopBookShop) => T[];
  /** The rows as they are in the game's data. */
  original: (shop: ShopBookShop) => T[];
  item: (id: number) => ShopBookItem | undefined;
  /** The columns of a shop's stock. */
  columns: (shop: ShopBookShop) => ShopColumn<T>[];
  /** Writes a shop's rows; absent when the stock cannot be edited. */
  setRows?: (shop: ShopBookShop, rows: T[]) => void;
  /** The row for an item added to a shop. */
  newRow: (shop: ShopBookShop, item: number) => T;
  /** Whether two rows are the same (for the edited marks). */
  same: (a: T, b: T) => boolean;
  /** The item picker: `unavailable` greys out what the shop sells already. */
  picker: (props: { title: string; unavailable: (id: number) => string | null; onPick: (id: number) => void; onClose: () => void }) => ReactNode;
  /** What is shown next to the name, under it in the list and below the stock. */
  info?: (shop: ShopBookShop) => ReactNode;
  sub?: (shop: ShopBookShop) => string;
  footer?: (shop: ShopBookShop) => ReactNode;
  /** Warnings about a shop's rows (shown under the stock while editing). */
  warnings?: (shop: ShopBookShop, rows: T[]) => string[];
  /** Where the edits are written ("ShopItem として … に書き出されます"). */
  exportNote?: string;
  stockNote?: ReactNode;
}

const sameList = <T,>(a: T[], b: T[], same: (x: T, y: T) => boolean): boolean => a.length === b.length && a.every((r, i) => same(r, b[i]!));

export function ShopBook<T extends { item: number }>(props: ShopBookProps<T>): ReactNode {
  const { shops, arg, texts, rows: rowsOf, original, item, columns, setRows, same } = props;
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

  const changed = (s: ShopBookShop): boolean => !!setRows && !sameList(rowsOf(s), original(s), same);
  /** First clerk message on one line (to tell the shops apart in the list). */
  const greeting = (s: ShopBookShop): string => {
    const id = s.messages.find((m) => m) ?? 0;
    return id ? texts.preview(id, true) ?? '' : '';
  };
  const matches = (s: ShopBookShop): boolean => {
    if (filter === 'changed' && !changed(s)) return false;
    const q = query.trim();
    if (!q) return true;
    if (s.label.includes(q) || greeting(s).includes(q)) return true;
    return rowsOf(s).some((r) => item(r.item)?.name.includes(q));
  };
  const edit = (s: ShopBookShop, next: T[]): void => {
    setRows!(s, next);
    edited();
  };

  const shown = shops.filter(matches);
  const shop = shops.find((s) => s.id === selected);
  const stock = shop ? rowsOf(shop) : [];
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
  const dropZone = setRows && shop ? {
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
      const next = dropRows(stock, d, at, (r) => r.item, (id) => props.newRow(shop, id));
      if (!sameList(next, stock, same)) edit(shop, next);
    },
  } : {};

  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="アイテム名・店員の台詞で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ['changed', '変更した']]} />
        <div className="book-list" ref={list}>
          <Count shown={shown.length} total={shops.length} unit="店" />
          <table className="book-table">
            <thead><tr><th>ID</th><th>店</th><th>品数</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className={s.id === selected ? 'active' : ''} onClick={() => (location.hash = props.href(s.id))}>
                  <td className="num muted">{s.id}</td>
                  <td>{s.label}{changed(s) && <EditedMark text=" ●" />}<div className="muted small">{props.sub?.(s) ?? greeting(s)}</div></td>
                  <td className="num">{rowsOf(s).length}</td>
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
              <h2>{shop.label}</h2>
              <span className="muted">{`${stock.length} 品`}</span>
              {props.info?.(shop)}
            </div>
            <h3>品揃え</h3>
            <table ref={table} className={`enc-table shop-items${setRows ? ' editable' : ''}`}>
              <thead>
                <tr>{setRows && <th></th>}<th>#</th><th>名前</th>{columns(shop).map((c) => <th key={c.head}>{c.head}</th>)}{setRows && <th></th>}</tr>
              </thead>
              <tbody>
                {stock.map((r, i) => {
                  const it = item(r.item);
                  const before = original(shop);
                  const cls = [
                    query.trim() && it?.name.includes(query.trim()) ? 'hit' : '',
                    setRows && (!before[i] || !same(before[i]!, r)) ? 'edited-row' : '',
                    i === dragging ? 'dragging' : '',
                    i === dropAt ? 'drop-before' : '',
                    dropAt === stock.length && i === stock.length - 1 ? 'drop-after' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <tr
                      key={`${i}:${r.item}`}
                      className={cls}
                      draggable={!!setRows}
                      onDragStart={setRows ? (e) => {
                        drag.current = { kind: 'row', index: i };
                        e.dataTransfer.setData('text/plain', `row ${i}`); // Firefox needs data
                        e.dataTransfer.effectAllowed = 'move';
                        requestAnimationFrame(() => setDragging(i));
                      } : undefined}
                      onDragEnd={setRows ? endDrag : undefined}
                    >
                      {setRows && <td className="drag-handle" title="ドラッグで並べ替え">⠿</td>}
                      <td className="num muted">{i + 1}</td>
                      <td>
                        {it ? <a href={it.href} draggable={false}>{it.name}</a> : <span className="error">{`#${r.item} (ないアイテム)`}</span>}
                        {it?.changed && <EditedMark title="アイテム図鑑で変更した" text=" ●" />}
                      </td>
                      {columns(shop).map((c) => <td key={c.head} className={c.className}>{c.cell(r, i)}</td>)}
                      {setRows && (
                        <td className="shop-ops">
                          <button className="small" title="この店から外す" onClick={() => edit(shop, stock.filter((_, j) => j !== i))}>×</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {setRows && <StockEditor {...props} shop={shop} stock={stock} changed={changed(shop)} edit={(next) => edit(shop, next)} />}
            {props.stockNote && <div className="muted small">{props.stockNote}</div>}
            <h3>店員のメッセージ</h3>
            {shop.messages.length
              ? <table className="enc-table">
                  <tbody>
                    <tr><th>欄</th><th>ID</th><th>本文</th></tr>
                    {shop.messages.map((id, i) => {
                      const units = id ? texts.units(id) : undefined;
                      return (
                        <tr key={i}>
                          <td className="mono muted">{`+0x${((shop.messageOffset ?? 0x0c) + i * 4).toString(16).toUpperCase()}`}</td>
                          <td className="mono">{id ? <a href={props.messageHref(id)}>{hexId(id)}</a> : '0'}</td>
                          <td>{units && <MessagePreview texts={texts} units={units} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              : <div className="muted">Shop の表 (0xD5CEF800) に行がありません</div>}
            {props.footer?.(shop)}
          </>
        )}
      </div>
    </div>
  );
}

/** Adding an item, reverting the shop, and warnings about lists the game was not seen with. */
function StockEditor<T extends { item: number }>({ shop, stock, changed, edit, item, original, picker, newRow, warnings, exportNote }: ShopBookProps<T> & {
  shop: ShopBookShop; stock: T[]; changed: boolean; edit: (next: T[]) => void;
}): ReactNode {
  const [picking, setPicking] = useState(false);
  const notes = [...(warnings?.(shop, stock) ?? [])];
  if (stock.some((r) => !item(r.item))) notes.push('ないアイテムが入っています。');
  return (
    <div>
      <div className="row">
        <button onClick={() => setPicking(true)}>＋ 追加</button>
        <span className="muted small">行をドラッグして並べ替え、× で外します。</span>
        {changed && <button onClick={() => edit(original(shop))}>この店の変更を元に戻す</button>}
      </div>
      {exportNote && <div className="muted small">{exportNote}</div>}
      {notes.map((w) => <div key={w} className="issue warn">{`⚠ ${w}`}</div>)}
      {picking && picker({
        title: '追加するアイテムを選ぶ',
        unavailable: (id) => (stock.some((r) => r.item === id) ? 'この店で売っています' : null),
        onClose: () => setPicking(false),
        onPick: (id) => { setPicking(false); edit([...stock, newRow(shop, id)]); },
      })}
    </div>
  );
}
