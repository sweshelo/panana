// 初代's item book (#/items/<row>): the 235 rows of itemData that hold an item, with their category, prices and texts
// (naauao honolulu/items.md). The items have no model, so the list has no photo column and the entry no 3D view;
// clothes show their texture (clothData → B50A5EA9). The name, the descriptions and the prices are edited; the other
// fields (and an equipment's equipData / clothes' clothData row) are shown by their definitions.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { field, fieldRange } from '../game/tabledef';
import { BookList, ListFilter, NumberInput, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { ItemListControls, ItemSources, PLAIN_ITEM_SORTS, sortItems, type ItemSort, type SourceLink } from '../ui/ItemSources';
import { MessageEditor } from '../ui/message';
import { RowFields } from '../ui/RowFields';
import { TextureThumb } from '../ui/TextureThumb';
import { useAsync } from '../ui/useAsync';
import { hex8 } from '../util/bytes';
import {
  CLOTH_CATEGORY, categoryName, HonoluluClothTextures, honoluluItemRows, honoluluItems, itemChanged, itemStages, itemSubRow,
  itemTextIds, revertItem, type HonoluluItem, type ItemStage,
} from './items';
import type { HonoluluSession } from './session';
import { honoluluShopHref } from './ShopPage';
import { HONOLULU_ITEM_DATA } from './tables';

export const honoluluItemHref = (row: number): string => `#/items/${row}`;

/** Redraws on every edit of the session (this page's and the other pages'). */
export function useHonoluluRevision(session: HonoluluSession): number {
  const [, set] = useState(0);
  useEffect(() => session.onEdit(() => set((x) => x + 1)), [session]);
  return session.revision;
}

const textures = new WeakMap<HonoluluSession, HonoluluClothTextures>();
const clothTextures = (session: HonoluluSession): HonoluluClothTextures => {
  let t = textures.get(session);
  if (!t) textures.set(session, (t = new HonoluluClothTextures(session.dump)));
  return t;
};

const stageLinks = (stages: ItemStage[] | undefined): SourceLink[] =>
  (stages ?? []).map((s) => ({ label: `段階 ${s.stage}: ${s.dungeon}`, href: honoluluShopHref(s.stage), note: s.featured ? '目玉の品' : undefined }));

export function HonoluluItemPage({ session, arg }: { session: HonoluluSession; arg: string | undefined }): ReactNode {
  const revision = useHonoluluRevision(session);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<ItemSort>('id');
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const items = useMemo(() => honoluluItems(session), [session, revision]);
  const byRow = useMemo(() => new Map(items.map((it) => [it.row, it])), [items]);
  const stages = useMemo(() => itemStages(session), [session, revision]);
  const selected = useSticky(arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined, (r) => byRow.has(r), () => items[0]?.row ?? 0);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const q = query.trim();
  const categories = [...new Set(items.map((x) => x.category))].sort((a, b) => a - b);
  const rows = useMemo(() => sortItems(items.filter((x) => {
    if (q && !x.name.includes(q) && String(x.row) !== q) return false;
    if (filter.startsWith('c')) return x.category === Number(filter.slice(1));
    if (filter === 'shop') return stages.has(x.row);
    if (filter === 'changed') return itemChanged(session, x.row);
    return true;
  }), sort, (x) => ({ id: x.row, name: x.name, price: x.price, sell: x.sell, kind: x.category })), [items, q, filter, sort, stages, session, revision]);
  const it = byRow.get(selected);
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={setQuery} placeholder="名前・行で検索" filter={filter} setFilter={setFilter}
          options={[['all', 'すべて'], ...categories.map((c): [string, string] => [`c${c}`, categoryName(c)]), ['shop', 'お店で買える'], ['changed', '変更したもの']]} />
        <ItemListControls sort={sort} setSort={setSort} sorts={PLAIN_ITEM_SORTS} />
        <BookList rows={rows} total={items.length} id={(x) => x.row} selected={selected} href={honoluluItemHref} listRef={list}
          changed={(x) => itemChanged(session, x.row)}
          columns={[
            { head: '名前', cell: (x) => x.name },
            { head: '分類', className: 'muted nowrap', cell: (x) => categoryName(x.category) },
            { head: '買値', className: 'num', cell: (x) => x.price || '' },
          ]} />
      </div>
      <div className="book-detail" ref={detail}>
        {it && <ItemDetail key={it.row} session={session} it={it} stages={stages.get(it.row)} />}
      </div>
    </div>
  );
}

function ItemDetail({ session, it, stages }: { session: HonoluluSession; it: HonoluluItem; stages: ItemStage[] | undefined }): ReactNode {
  const rows = honoluluItemRows(session);
  const sub = itemSubRow(session, it.row);
  const context = session.master.context();
  const onEdit = (): void => session.edited();
  return (
    <>
      <div className="book-head">
        <h2>{it.name}</h2>
        <span className="muted">{`itemData 行 ${it.row}  ${categoryName(it.category)}`}</span>
      </div>
      <div className="book-top">
        <div>
          <TextEditor session={session} row={it.row} />
          <PriceEditor session={session} row={it.row} />
        </div>
        {it.category === CLOTH_CATEGORY && sub && <ClothTexture session={session} hash={sub.rows.get(sub.row, 'texture')} />}
      </div>
      <div className="row">
        <span className="muted small">変更はマスター (56562135) の itemData.bin とメッセージとして書き出されます。</span>
        {itemChanged(session, it.row) && <button onClick={() => { revertItem(session, it.row); onEdit(); }}>このアイテムの変更を元に戻す</button>}
      </div>
      <ItemSources shops={stageLinks(stages)} note="宝箱・モンスターのドロップは itemGroup の解析 (naauao#45) のあとで足します。お店は拠点の 1 軒だけで、品揃えがダンジョンの進み具合で段階ごとに変わります。" />
      <details className="row-fields-box">
        <summary>{`itemData の行 ${it.row} のすべての欄`}</summary>
        <RowFields def={rows.def} row={rows.row(it.row)} original={rows.originalRow(it.row)} context={context} />
      </details>
      {sub && (
        <details className="row-fields-box">
          <summary>{`${sub.rows.def.file.replace('.bin', '')} の行 ${sub.row} のすべての欄`}</summary>
          <RowFields def={sub.rows.def} row={sub.rows.row(sub.row)} original={sub.rows.originalRow(sub.row)} context={context} />
        </details>
      )}
    </>
  );
}

/** The name, the description and the clerk's description: their previews, edited on a click (a shared one once). */
function TextEditor({ session, row }: { session: HonoluluSession; row: number }): ReactNode {
  const texts = session.messages.texts;
  return (
    <table className="enc-table desc-table">
      <tbody>
        {itemTextIds(session, row).map(({ key, label, id, same }) => {
          const offset = field(HONOLULU_ITEM_DATA, key).offset;
          return (
            <tr key={key}>
              <th title={`itemData +0x${offset.toString(16).toUpperCase()}${id ? `、メッセージ ${id}` : ''}`}>{label}</th>
              <td className="book-desc">
                {!id ? <span className="muted">なし</span>
                  : same ? <span className="muted">{`${same}と同じメッセージ`}</span>
                  : texts.editable(id) ? <MessageEditor texts={texts} id={id} compact apply={(f) => { f(); session.edited(); }} />
                  : <span>{texts.preview(id)}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The buying and the selling price (G). */
function PriceEditor({ session, row }: { session: HonoluluSession; row: number }): ReactNode {
  const rows = honoluluItemRows(session);
  const number = (key: 'price' | 'sell', label: string): ReactNode => {
    const now = rows.get(row, key);
    const was = rows.original(row, key);
    const [min, max] = fieldRange(field(HONOLULU_ITEM_DATA, key));
    return (
      <label className="stat">
        <span className="muted">{label}</span>
        <span>
          <NumberInput value={now} min={min} max={max} className={`num-input ${now !== was ? 'edited' : ''}`} title={now !== was ? `元の値 ${was}` : ''}
            onCommit={(v) => { rows.set(row, key, v); session.edited(); }} />
          {' G'}
        </span>
      </label>
    );
  };
  return (
    <div className="item-fields">
      <div className="stats">
        {number('price', '買値')}
        {number('sell', '売値')}
      </div>
    </div>
  );
}

/** The texture of clothes (their only look). */
function ClothTexture({ session, hash }: { session: HonoluluSession; hash: number }): ReactNode {
  const t = useAsync(() => clothTextures(session).texture(hash), [session, hash]);
  const where = `B50A5EA9 / ${hex8(hash)}`;
  return (
    <div className="model-placeholder item-texture">
      {t === undefined ? <div className="muted small">{`${where} を読み込み中…`}</div>
        : t instanceof Error ? <div className="error">{`${where} を読めませんでした: ${t.message}`}</div>
        : t === null ? <div className="muted small">{`${where} が見つかりません`}</div>
        : <TextureThumb t={t} />}
      <div className="muted small">{`ふくのテクスチャ (${where})`}</div>
    </div>
  );
}

