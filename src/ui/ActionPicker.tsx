// Picking an action (a monster's skill) from a searchable table; actions have no model to show. ActionPicker fills it
// from RPG2's ActionBook; RPG3's books fill ActionTablePicker from their own tables.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { actionKindLabel, ELEMENT, type ActionBook } from '../game/actions';
import { Dialog } from './Dialog';

export interface ActionEntry {
  row: number;
  name: string;
  /** After the name, e.g. " → 変身 #3". */
  note?: string;
  kind: string;
  element: string;
  /** Names of the monsters using it. */
  users: string[];
  /** The filters (keys of `filters`) that keep the entry. */
  tags: string[];
}

/**
 * A dialog listing actions by name, kind, element and the monsters using them, searchable by name, number or monster.
 * The first of `filters` is the default; 'all' keeps every entry.
 */
export function ActionTablePicker({ title = 'ワザを選ぶ', entries, filters, current, onPick, onClose }: {
  title?: string;
  entries: ActionEntry[];
  filters: [string, string][];
  current?: number;
  onPick: (row: number) => void;
  onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(filters[0]?.[0] ?? 'all');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.querySelector('tr.current')?.scrollIntoView({ block: 'center' }), []);
  const q = query.trim();
  const shown = entries.filter((a) => (filter === 'all' || a.tags.includes(filter)) && (!q || String(a.row) === q || a.name.includes(q) || a.users.some((n) => n.includes(q))));
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="名前・番号・使うモンスターで絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {filters.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <div className="picker-list" ref={list}>
        <table className="book-table action-pick">
          <thead><tr><th>#</th><th>名前</th><th>種類</th><th>属性</th><th>持つモンスター</th></tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.row} className={a.row === current ? 'active current' : ''} onClick={() => onPick(a.row)}>
                <td className="num muted">{a.row}</td>
                <td>{a.name || <span className="muted">(名前なし)</span>}{a.note ? <span className="muted small">{a.note}</span> : null}</td>
                <td className="muted">{a.kind}</td>
                <td>{a.element}</td>
                <td className="muted small">{a.users.slice(0, 3).join('、')}{a.users.length > 3 ? ` ほか ${a.users.length - 3}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div className="muted">見つかりません</div>}
      </div>
    </Dialog>
  );
}

/**
 * RPG2's actionData rows. "モンスターのワザ" shows every action at least one monster has; the other filters also show
 * the rest (items' effects too).
 */
export function ActionPicker({ actions, title = 'ワザを選ぶ', current, onPick, onClose }: {
  actions: ActionBook;
  title?: string;
  current?: number;
  onPick: (row: number) => void;
  onClose: () => void;
}): ReactNode {
  const entries = actions.actions.filter((a) => a.row !== 0).map((a): ActionEntry => {
    const users = actions.refsOf(a.row).monsters.map((m) => m.name);
    return {
      row: a.row,
      name: a.name,
      note: a.formChange ? ` → 変身 #${a.formChange}` : undefined,
      kind: actionKindLabel(a.kind, a.type),
      element: ELEMENT[a.element] ?? String(a.element),
      users,
      tags: [...(users.length ? ['skill'] : []), ...(a.kind !== 2 ? ['monster'] : [])],
    };
  });
  return <ActionTablePicker title={title} entries={entries} filters={[['skill', 'モンスターのワザ'], ['monster', 'アイテム以外'], ['all', 'すべて']]} current={current} onPick={onPick} onClose={onClose} />;
}
