// The list side of the monster books of RPG2, RPG3 and RPG FREE!: search and filter, the count, and the table of
// photo, number, name (marked when edited), level, HP and how many groups or maps have the monster. Each game passes
// its rows; a game that does not know where its monsters appear leaves the last column out.
import type { ReactNode, RefObject } from 'react';
import { Count, EditedMark, ListFilter } from './book';

export interface MonsterListRow {
  row: number;
  icon: ReactNode;
  name: string;
  level: number | undefined;
  hp: number | undefined;
  /** The groups / maps with the monster (blank for 0). */
  count?: number;
  changed?: boolean;
}

export function MonsterList<F extends string>({ query, setQuery, filter, setFilter, options, rows, total, selected, href, countHead, listRef }: {
  query: string;
  setQuery: (q: string) => void;
  filter: F;
  setFilter: (f: F) => void;
  options: [F, string][];
  rows: MonsterListRow[];
  total: number;
  selected: number;
  href: (row: number) => string;
  /** Heading of the count column ("出現", "群れ"); no column when undefined. */
  countHead?: string;
  listRef: RefObject<HTMLDivElement | null>;
}): ReactNode {
  return (
    <div className="book-side">
      <ListFilter query={query} setQuery={setQuery} placeholder="名前・ワザ・ドロップで検索" filter={filter} setFilter={setFilter} options={options} />
      <div className="book-list" ref={listRef}>
        <Count shown={rows.length} total={total} />
        <table className="book-table">
          <thead><tr><th></th><th>#</th><th>名前</th><th>Lv</th><th>HP</th>{countHead && <th>{countHead}</th>}</tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.row} className={m.row === selected ? 'active' : ''} onClick={() => (location.hash = href(m.row))}>
                <td className="photo-cell">{m.icon}</td>
                <td className="num muted">{m.row}</td>
                <td>{m.name || <span className="muted">(名前なし)</span>}{m.changed && <EditedMark text=" ●" />}</td>
                <td className="num">{m.level ?? ''}</td>
                <td className="num">{m.hp ?? ''}</td>
                {countHead && <td className="num muted">{m.count || ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
