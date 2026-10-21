// Pieces of the item books shared by RPG2, RPG3 and RPG FREE!: where an item is got (the shops that sell it, the
// monsters that drop it, the chests that hold it, each linked to its page), and the sort and ☆ filter of the list.
import { Fragment, type ReactNode } from 'react';

/** A shop or a monster that gives the item, with a note ("ジュエル 30", "レア・1/64"). */
export interface SourceLink {
  label: string;
  href: string;
  note?: string;
  title?: string;
}

/** A chest that can hold the item: where it is, the contents' table and the chance of the item in it. */
export interface ChestLink {
  place: string;
  href: string;
  /** The cell or the record on the map. */
  at?: string;
  /** The contents' table ("#12"). */
  table: string;
  /** % of this item when the chest is opened. */
  chance: number;
}

/** What a list of sources is: the links, or what is shown while they are not known (loading, a button to look). */
type Sources<T> = T[] | { pending: ReactNode };

const count = <T,>(s: Sources<T>): string => (Array.isArray(s) ? ` (${s.length})` : '');

export const chanceText = (c: number): string => `${c.toFixed(c < 10 ? 1 : 0)}%`;

/** The shops, the monsters and the chests of an item. */
export function ItemSources({ shops, drops, chests, noChests = 'なし' }: {
  shops: Sources<SourceLink>;
  drops: Sources<SourceLink>;
  chests: Sources<ChestLink>;
  /** Shown when no chest holds the item (what was counted). */
  noChests?: string;
}): ReactNode {
  return (
    <>
      <div className="book-cols">
        <section>
          <h3>{`お店${count(shops)}`}</h3>
          <LinkList links={shops} />
        </section>
        <section>
          <h3>{`落とすモンスター${count(drops)}`}</h3>
          <LinkList links={drops} />
        </section>
      </div>
      <h3>{`宝箱${count(chests)}`}</h3>
      {!Array.isArray(chests) ? chests.pending
        : chests.length
          ? <table className="enc-table book-chests">
              <tbody>
                <tr><th>場所</th><th>位置</th><th>中身の表</th><th>確率</th></tr>
                {chests.map((c, i) => (
                  <tr key={i}>
                    <td><a href={c.href}>{c.place}</a></td>
                    <td className="muted">{c.at ?? ''}</td>
                    <td className="num muted">{c.table}</td>
                    <td className="num">{chanceText(c.chance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          : <div className="muted">{noChests}</div>}
    </>
  );
}

function LinkList({ links }: { links: Sources<SourceLink> }): ReactNode {
  if (!Array.isArray(links)) return links.pending;
  if (!links.length) return <div className="muted">なし</div>;
  return (
    <ul>
      {links.map((l, i) => (
        <li key={i}>
          <a href={l.href} title={l.title}>{l.label}</a>
          {l.note && <Fragment>{' '}<span className="muted">{`(${l.note})`}</span></Fragment>}
        </li>
      ))}
    </ul>
  );
}

/** How the list is ordered. Unpriced items (0 G) stay at the end of a price order either way. */
export type ItemSort = 'id' | 'name' | 'price-asc' | 'price-desc' | 'sell-asc' | 'sell-desc' | 'rarity-asc' | 'rarity-desc';

export const ITEM_SORTS: [ItemSort, string][] = [
  ['id', 'ID 順'],
  ['name', '名前順'],
  ['price-asc', '買値の安い順'],
  ['price-desc', '買値の高い順'],
  ['sell-asc', '売値の安い順'],
  ['sell-desc', '売値の高い順'],
  ['rarity-asc', '☆ の少ない順'],
  ['rarity-desc', '☆ の多い順'],
];

/** What an item is sorted by. */
export interface ItemSortKeys {
  id: number;
  name: string;
  price: number;
  sell: number;
  rarity: number;
}

const byName = new Intl.Collator('ja');

/** The items in the order of `sort` (a stable sort: equal keys keep the ID order). */
export function sortItems<T>(rows: T[], sort: ItemSort, keys: (t: T) => ItemSortKeys): T[] {
  if (sort === 'id') return rows;
  const ks = new Map(rows.map((r) => [r, keys(r)]));
  const k = (r: T): ItemSortKeys => ks.get(r)!;
  const [field, dir] = sort.split('-') as ['name' | 'price' | 'sell' | 'rarity', 'asc' | 'desc' | undefined];
  const sign = dir === 'desc' ? -1 : 1;
  const cmp = (a: T, b: T): number => {
    const x = k(a), y = k(b);
    if (field === 'name') return (!x.name ? 1 : 0) - (!y.name ? 1 : 0) || byName.compare(x.name, y.name);
    if (field === 'rarity') return sign * (x.rarity - y.rarity);
    const p = x[field], q = y[field];
    return (!p ? 1 : 0) - (!q ? 1 : 0) || sign * (p - q);
  };
  return [...rows].sort((a, b) => cmp(a, b) || k(a).id - k(b).id);
}

/** The ☆ filter: 'all' or a number of stars. */
export type RarityFilter = 'all' | `${number}`;

export const rarityMatches = (f: RarityFilter, rarity: number): boolean => f === 'all' || rarity === Number(f);

/** The order and the ☆ filter of an item list (below its search box). */
export function ItemListControls({ sort, setSort, rarity, setRarity, rarities }: {
  sort: ItemSort;
  setSort: (s: ItemSort) => void;
  rarity: RarityFilter;
  setRarity: (r: RarityFilter) => void;
  /** The ☆ the items have. */
  rarities: number[];
}): ReactNode {
  return (
    <div className="row">
      <label className="small muted">{'並び '}
        <select value={sort} onChange={(e) => setSort(e.target.value as ItemSort)}>
          {ITEM_SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
      <label className="small muted">{'☆ '}
        <select value={rarity} onChange={(e) => setRarity(e.target.value as RarityFilter)}>
          <option value="all">すべて</option>
          {[...new Set([...rarities, ...(rarity === 'all' ? [] : [Number(rarity)])])].sort((a, b) => a - b).map((r) => <option key={r} value={String(r)}>{`☆ ${r}`}</option>)}
        </select>
      </label>
    </div>
  );
}
