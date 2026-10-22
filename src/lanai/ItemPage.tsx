// RPG FREE!'s item book (#/items/<row>): every valid item of ItemData with its kind, rarity, prices, description and
// model (ItemDataCore, items.ts), an equipment's effects (EquipInfo, equipment.ts), and giving an item the model of another game's item (#100).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Count, EditedMark, ListFilter, useActiveRow, useScrollTop, useSticky } from '../ui/book';
import { ModelView } from '../ui/ModelView';
import { Photo } from '../ui/Photo';
import { PortItemButton } from '../ui/PortLook';
import { hex8 } from '../util/bytes';
import { LANAI_ITEM_KINDS, lanaiItemDescription, lanaiItemRef, lanaiItems, textureOnlyKind, type LanaiItem } from './items';
import { lanaiEquipRow, lanaiItemEffects } from './equipment';
import { LanaiEquipEffects } from './EquipEffects';
import { useLanaiRevision } from './MonsterEditor';
import { lanaiDropIndex, lanaiSlotSource, lanaiSourceIndex, lanaiSourcesScanned, type LanaiSourceIndex } from './itemSources';
import { ItemListControls, ItemSources, rarityMatches, sortItems, type ItemSort, type RarityFilter, type SourceLink } from '../ui/ItemSources';
import type { LanaiSession } from './session';

export const lanaiItemHref = (row: number): string => `#/items/${row}`;
const PAGE = 300;
const kindName = (k: number): string => LANAI_ITEM_KINDS[k] ?? `種類 0x${k.toString(16).toUpperCase()}`;

/** The shops and chests of every content: null until asked for (the first time reads every content's archive). */
function useSourceIndex(session: LanaiSession, revision: number): { index: LanaiSourceIndex | null; progress: string; error: string; scan: () => void } {
  const [on, setOn] = useState(() => lanaiSourcesScanned(session));
  const [index, setIndex] = useState<LanaiSourceIndex | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!on) return;
    let live = true;
    lanaiSourceIndex(session, (done, total) => live && setProgress(`${done} / ${total}`)).then(
      (x) => live && (setIndex(x), setError('')),
      (e: unknown) => live && (setError((e as Error).message), setOn(false)),
    );
    return () => {
      live = false;
    };
  }, [session, revision, on]);
  return { index, progress, error, scan: () => { setProgress('…'); setOn(true); } };
}

export function LanaiItemPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<ItemSort>('id');
  const [rarity, setRarity] = useState<RarityFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const items = useMemo(() => lanaiItems(session), [session, revision]);
  const byRow = useMemo(() => new Map(items.map((it) => [it.row, it])), [items]);
  const selected = useSticky(arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined, (r) => byRow.has(r), () => items[0]?.row ?? 0);
  useActiveRow(list, selected);
  useScrollTop(detail, selected);
  const core = session.need('ItemDataCore');
  const drops = useMemo(() => lanaiDropIndex(session), [session, revision]);
  const sources = useSourceIndex(session, revision);
  const effects = useMemo(() => new Map(items.map((it) => [it.row, lanaiItemEffects(session, it).join(' ')])), [items, session, revision]);
  const changed = (x: LanaiItem): boolean => {
    if (core.rowChanged(x.core)) return true;
    const e = lanaiEquipRow(session, x);
    return !!e && e.table.rowChanged(e.row);
  };
  const q = query.trim();
  const groups = [...new Set(items.map((it) => it.kind & 0xf0))].sort((a, b) => a - b);
  const rows = useMemo(() => sortItems(items.filter((it) => {
    if (q && !it.name.includes(q) && !effects.get(it.row)?.includes(q) && String(it.row) !== q && hex8(it.id) !== q.toUpperCase()) return false;
    if (!rarityMatches(rarity, it.rarity)) return false;
    if (filter.startsWith('g')) return (it.kind & 0xf0) === Number(filter.slice(1));
    if (filter === 'shop') return !!sources.index?.shops.has(it.id) || !!lanaiSlotSource(session, it);
    if (filter === 'chest') return !!sources.index?.chests.has(it.id);
    if (filter === 'drop') return drops.has(it.id);
    if (filter === 'changed') return changed(it);
    return true;
  }), sort, (x) => ({ id: x.row, name: x.name, price: x.buy, sell: x.sell, rarity: x.rarity })), [items, q, filter, rarity, sort, drops, sources.index, session, core, revision, effects]);
  const scanned = !!sources.index;
  const it = byRow.get(selected);
  const equip = it ? lanaiEquipRow(session, it) : null;
  return (
    <div className="book">
      <div className="book-side">
        <ListFilter query={query} setQuery={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="名前・効果・行・ID で検索" filter={filter} setFilter={(v) => { setFilter(v); setLimit(PAGE); }}
          options={[['all', 'すべて'], ...groups.map((g): [string, string] => [`g${g}`, kindName(items.find((x) => (x.kind & 0xf0) === g)!.kind).split(':')[0]!]),
            ...(scanned ? [['shop', 'お店で買える'], ['chest', '宝箱から出る']] as [string, string][] : []), ['drop', 'モンスターが落とす'], ['changed', '変更したもの']]} />
        <ItemListControls sort={sort} setSort={(v) => { setSort(v); setLimit(PAGE); }} rarity={rarity} setRarity={(v) => { setRarity(v); setLimit(PAGE); }} rarities={items.map((x) => x.rarity)} />
        <div className="book-list" ref={list}>
          <Count shown={rows.length} total={items.length} />
          <table className="book-table">
            <thead><tr><th></th><th>行</th><th>名前</th><th>種類</th><th>☆</th><th>買値</th></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((x) => (
                <tr key={x.row} className={x.row === selected ? 'active' : ''} onClick={() => (location.hash = lanaiItemHref(x.row))}>
                  <td className="photo-cell"><Photo model={lanaiItemRef(session, x)} /></td>
                  <td className="num muted">{x.row}</td>
                  <td>{x.name}{changed(x) && <EditedMark text=" ●" />}</td>
                  <td className="muted nowrap">{kindName(x.kind)}</td>
                  <td className="num">{x.rarity}</td>
                  <td className="num">{x.buy || ''}</td>
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
            {equip && <LanaiEquipEffects session={session} equip={equip} kind={it.kind} onEdit={() => session.edited()} />}
            <div className="row">
              {changed(it) && <button onClick={() => {
                if (core.rowChanged(it.core)) core.setRow(it.core, core.originalRow(it.core)!);
                if (equip?.table.rowChanged(equip.row)) equip.table.setRow(equip.row, equip.table.originalRow(equip.row)!);
                session.edited();
              }}>このアイテムの変更を元に戻す</button>}
              {it.model !== 0 && !textureOnlyKind(it.kind) && <PortItemButton target="lanai" id={it.row} onDone={() => session.edited()} />}
              {textureOnlyKind(it.kind) && <span className="muted small">ふく・床・壁はテクスチャだけの品なので、ほかの作品のモデルにはできません。</span>}
            </div>
            <ItemSources
              shops={sources.index ? [...(sources.index.shops.get(it.id) ?? []), ...slotLink(session, it)] : { pending: <ScanButton sources={sources} what="店" extra={slotLink(session, it)} /> }}
              drops={drops.get(it.id) ?? []}
              chests={sources.index ? sources.index.chests.get(it.id) ?? [] : { pending: <ScanButton sources={sources} what="宝箱" /> }}
              noChests="なし (コンテンツのマップに置かれた宝箱のみ数えます)" />
          </>
        )}
      </div>
    </div>
  );
}

const slotLink = (session: LanaiSession, it: LanaiItem): SourceLink[] => {
  const l = lanaiSlotSource(session, it);
  return l ? [l] : [];
};

/** The button that reads every content for the shops and chests (and the random slot, known without it). */
function ScanButton({ sources, what, extra = [] }: { sources: ReturnType<typeof useSourceIndex>; what: string; extra?: SourceLink[] }): ReactNode {
  return (
    <div>
      {extra.map((l, i) => <div key={i}><a href={l.href}>{l.label}</a>{l.note && <span className="muted">{` (${l.note})`}</span>}</div>)}
      {sources.progress
        ? <div className="muted small">{`コンテンツを読み込み中 (${sources.progress})`}</div>
        : <button onClick={sources.scan} title="127 のコンテンツのアーカイブを読みます (一度読めば、このあとはすぐに出ます)">{`すべてのコンテンツの${what}を調べる`}</button>}
      {sources.error && <div className="error">{sources.error}</div>}
    </div>
  );
}
