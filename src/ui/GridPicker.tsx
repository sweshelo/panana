// A <dialog> picking an entry (a monster, an item) from a grid of pictures, filtered by name or number and by category.
// MonsterPicker and ItemPicker fill it from RPG2's books; RPG3's books fill it from their own tables.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

export interface GridEntry {
  id: number;
  name: string;
  /** The picture (a photo or a badge, with the class "photo photo-lg"). */
  icon: ReactNode;
  sub?: string;
  title?: string;
  /** Why the entry cannot be picked (greyed out); null or undefined when it can. */
  unavailable?: string | null;
  /** Matched by the category filter. */
  category?: number;
}

/** A section of the grid: a heading and the ids of its entries (e.g. "このワザを持つモンスター"). */
export interface GridSection {
  label: string;
  ids: number[];
}

/** A choice that is not an entry (e.g. 0 = 電波人間), shown first without a picture. */
export interface PickerChoice {
  value: number;
  label: string;
  sub?: string;
}

/**
 * Every entry as a picture with its name. `sections` come first, each under its heading, then every entry (under
 * "すべて" when there are sections or choices); `current` is highlighted and scrolled into view.
 */
export function GridPicker({ title, entries, current, sections = [], choices = [], categories, placeholder = '名前か番号で絞り込み', onPick, onClose }: {
  title: string;
  entries: GridEntry[];
  current?: number;
  sections?: GridSection[];
  choices?: PickerChoice[];
  /** Category filter: value → label. */
  categories?: Record<number, string>;
  placeholder?: string;
  onPick: (id: number) => void;
  onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => grid.current?.querySelector('.current')?.scrollIntoView({ block: 'center' }), []);
  const q = query.trim();
  const c = cat ? Number(cat) : 0;
  const match = (e: GridEntry): boolean => (!c || e.category === c) && (!q || e.name.includes(q) || String(e.id) === q);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const cell = (e: GridEntry, key: string): ReactNode => (
    <button key={key} className={`monster-cell${e.unavailable ? ' sold' : ''}${e.id === current ? ' current' : ''}`} disabled={!!e.unavailable}
      title={e.unavailable ?? e.title} onClick={() => onPick(e.id)}>
      {e.icon}
      <span>{e.name}</span>
      {e.sub && <span className="muted small">{e.sub}</span>}
    </button>
  );
  const shown = [
    ...sections.map((s) => ({ label: s.label, list: s.ids.map((id) => byId.get(id)).filter((e): e is GridEntry => !!e && match(e)) })),
    { label: sections.length || choices.length ? 'すべて' : '', list: entries.filter(match) },
  ].filter((s) => s.list.length);
  const shownChoices = choices.filter((x) => !q || x.label.includes(q));
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" placeholder={placeholder} className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        {categories && (
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">すべての分類</option>
            {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
      </div>
      <div className="picker-list" ref={grid}>
        {shownChoices.length > 0 && (
          <div className="monster-grid">
            {shownChoices.map((x) => (
              <button key={`c${x.value}`} className={`monster-cell${x.value === current ? ' current' : ''}`} onClick={() => onPick(x.value)}>
                <span className="photo photo-lg picker-none" />
                <span>{x.label}</span>
                {x.sub && <span className="muted small">{x.sub}</span>}
              </button>
            ))}
          </div>
        )}
        {shown.map((s, i) => (
          <section key={i}>
            {s.label && <h4 className="picker-heading">{s.label}</h4>}
            <div className="monster-grid">{s.list.map((e) => cell(e, `${i}:${e.id}`))}</div>
          </section>
        ))}
        {!shown.length && !shownChoices.length && <div className="muted">見つかりません</div>}
      </div>
    </Dialog>
  );
}
