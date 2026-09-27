// Picking an action (a monster's skill) from a searchable table; actions have no model to show.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ACTION_KIND, ELEMENT, type ActionBook } from '../game/actions';
import { Dialog } from './Dialog';

type Filter = 'skill' | 'monster' | 'all';

/**
 * A dialog listing actionData rows by name, category, element and the monsters using them. "モンスターのワザ"
 * shows every action at least one monster has; the other filters also show the rest (items' effects too).
 */
export function ActionPicker({ actions, title = 'ワザを選ぶ', current, onPick, onClose }: {
  actions: ActionBook;
  title?: string;
  current?: number;
  onPick: (row: number) => void;
  onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('skill');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.querySelector('tr.current')?.scrollIntoView({ block: 'center' }), []);
  const q = query.trim();
  const shown = actions.actions.filter((a) => {
    if (a.row === 0) return false;
    const users = actions.refsOf(a.row).monsters;
    if (filter === 'skill' && !users.length) return false;
    if (filter === 'monster' && a.kind === 2) return false;
    return !q || String(a.row) === q || a.name.includes(q) || users.some((m) => m.name.includes(q));
  });
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="名前・番号・使うモンスターで絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="skill">モンスターのワザ</option>
          <option value="monster">アイテム以外</option>
          <option value="all">すべて</option>
        </select>
      </div>
      <div className="picker-list" ref={list}>
        <table className="book-table action-pick">
          <thead><tr><th>#</th><th>名前</th><th>種類</th><th>属性</th><th>持つモンスター</th></tr></thead>
          <tbody>
            {shown.map((a) => {
              const users = actions.refsOf(a.row).monsters;
              return (
                <tr key={a.row} className={a.row === current ? 'active current' : ''} onClick={() => onPick(a.row)}>
                  <td className="num muted">{a.row}</td>
                  <td>{a.name || <span className="muted">(名前なし)</span>}{a.formChange ? <span className="muted small">{` → 変身 #${a.formChange}`}</span> : null}</td>
                  <td className="muted">{ACTION_KIND[a.kind] ?? a.kind}</td>
                  <td>{ELEMENT[a.element] ?? a.element}</td>
                  <td className="muted small">{users.slice(0, 3).map((m) => m.name).join('、')}{users.length > 3 ? ` ほか ${users.length - 3}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <div className="muted">見つかりません</div>}
      </div>
    </Dialog>
  );
}
