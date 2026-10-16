// RPG FREE!'s item book (#/items/<row>): every valid item of ItemData with its kind, rarity, prices, description and
// model (ItemDataCore, items.ts), and giving an item the model of another game's item (#100).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Count, EditedMark, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { ModelView } from '../ui/ModelView';
import { Photo } from '../ui/Photo';
import { PortItemButton } from '../ui/PortLook';
import { hex8 } from '../util/bytes';
import { LANAI_ITEM_KINDS, lanaiItemDescription, lanaiItemRef, lanaiItems, textureOnlyKind } from './items';
import { useLanaiRevision } from './MonsterEditor';
import type { LanaiSession } from './session';

export const lanaiItemHref = (row: number): string => `#/items/${row}`;
const PAGE = 300;
const kindName = (k: number): string => LANAI_ITEM_KINDS[k] ?? `種類 0x${k.toString(16).toUpperCase()}`;

export function LanaiItemPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const items = useMemo(() => lanaiItems(session), [session, revision]);
  const byRow = useMemo(() => new Map(items.map((it) => [it.row, it])), [items]);
  const selected = useSticky(arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined, (r) => byRow.has(r), () => items[0]?.row ?? 0);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const core = session.need('ItemDataCore');
  const q = query.trim();
  const groups = [...new Set(items.map((it) => it.kind & 0xf0))].sort((a, b) => a - b);
  const rows = useMemo(() => items.filter((it) => {
    if (q && !it.name.includes(q) && String(it.row) !== q && hex8(it.id) !== q.toUpperCase()) return false;
    if (filter.startsWith('g')) return (it.kind & 0xf0) === Number(filter.slice(1));
    if (filter === 'changed') return core.rowChanged(it.core);
    return true;
  }), [items, q, filter, core, revision]);
  const it = byRow.get(selected);
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="名前・行・ID で検索" filter={filter} setFilter={(v) => { setFilter(v); setLimit(PAGE); }}
          options={[['all', 'すべて'], ...groups.map((g): [string, string] => [`g${g}`, kindName(items.find((x) => (x.kind & 0xf0) === g)!.kind).split(':')[0]!]), ['changed', '変更したもの']]} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={items.length} />
          <table className="book-table">
            <thead><tr><th></th><th>行</th><th>名前</th><th>種類</th><th>☆</th></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((x) => (
                <tr key={x.row} className={x.row === selected ? 'active' : ''} onClick={() => (location.hash = lanaiItemHref(x.row))}>
                  <td className="photo-cell"><Photo model={lanaiItemRef(session, x)} /></td>
                  <td className="num muted">{x.row}</td>
                  <td>{x.name}{core.rowChanged(x.core) && <EditedMark text=" ●" />}</td>
                  <td className="muted nowrap">{kindName(x.kind)}</td>
                  <td className="num">{x.rarity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && <div className="row"><button onClick={() => setLimit(limit + PAGE * 5)}>{`続きを表示 (${rows.length - limit} 件)`}</button></div>}
        </div>
      </div>
      <div className="book-detail" ref={detail}>
        {it && (
          <>
            <div className="book-head">
              <h2>{it.name}</h2>
              <span className="muted">{`ItemData 行 ${it.row}  ID ${hex8(it.id)}  ItemDataCore 行 ${it.core}`}</span>
            </div>
            <div className="book-top">
              <table className="book-stats">
                <tbody>
                  <tr><th>種類</th><td>{`${kindName(it.kind)} (0x${it.kind.toString(16).toUpperCase()})`}</td></tr>
                  <tr><th>☆</th><td>{it.rarity}</td></tr>
                  <tr><th title="ItemDataCore +0x04 / +0x08 (推定)">買値 / 売値</th><td>{`${it.buy} / ${it.sell}`}</td></tr>
                  <tr><th>説明</th><td className="book-desc">{lanaiItemDescription(session, it)}</td></tr>
                  <tr><th title="ItemDataCore +0x18 / +0x1C">モデル</th><td className="muted">{it.model ? `${hex8(it.archive)} / ${hex8(it.model)}` : 'なし'}</td></tr>
                </tbody>
              </table>
              <ModelView model={lanaiItemRef(session, it)} name={it.name} />
            </div>
            <div className="row">
              {core.rowChanged(it.core) && <button onClick={() => { core.setRow(it.core, core.originalRow(it.core)!); session.edited(); }}>このアイテムの変更を元に戻す</button>}
              {it.model !== 0 && !textureOnlyKind(it.kind) && <PortItemButton target="lanai" id={it.row} onDone={() => session.edited()} />}
              {textureOnlyKind(it.kind) && <span className="muted small">ふく・床・壁はテクスチャだけの品なので、ほかの作品のモデルにはできません。</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
