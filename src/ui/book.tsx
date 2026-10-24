// Pieces shared by the book pages (a searchable list on the left, the selected entry on the right).
import { useEffect, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Session } from '../session';

/** What the shell gives every page: the route argument, and a counter bumped each time the page is shown. */
export interface PageProps {
  session: Session;
  arg: string | undefined;
  /** Bumped every time the page is shown (pages recompute what the other pages may have changed). */
  visit: number;
}

/** A counter to re-render after an edit of the (mutable) game data. */
export function useEdits(): [number, () => void] {
  return useReducer((n: number) => n + 1, 0);
}

/** The last value that passed `valid` (the route argument is kept while it is missing or wrong). */
export function useSticky<T>(value: T | undefined, valid: (v: T) => boolean, fallback: () => T): T {
  const last = useRef<T | undefined>(undefined);
  if (value !== undefined && valid(value)) last.current = value;
  else if (last.current === undefined || !valid(last.current)) last.current = fallback();
  return last.current;
}

/** Keeps the active row of the list in view when the selection changes. */
export function useActiveRow(list: RefObject<HTMLElement | null>, selected: unknown): void {
  useEffect(() => {
    list.current?.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' });
  }, [list, selected]);
}

/** Scrolls the detail back to the top when another entry is shown (edits keep the position). */
export function useScrollTop(detail: RefObject<HTMLElement | null>, selected: unknown): void {
  useEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
  }, [detail, selected]);
}

/** A column of a book's list after the row number (and the photo). */
export interface BookColumn<T> {
  head: string;
  className?: string;
  cell: (row: T) => ReactNode;
}

const BOOK_PAGE = 300;

/**
 * A book's list: the count, a row per entry (a click opens it), the first rows shown and a button for more. `photo`
 * adds a photo column before the row number; a game whose entries have no model (初代's items) gives none.
 */
export function BookList<T>({ rows, total, id, selected, href, columns, photo, changed, listRef }: {
  rows: T[];
  total: number;
  /** The entry's number (the row, the ID): the first column and the key. */
  id: (row: T) => number;
  selected: number;
  href: (id: number) => string;
  /** The columns after the number; the first one gets the edited mark. */
  columns: BookColumn<T>[];
  photo?: (row: T) => ReactNode;
  changed?: (row: T) => boolean;
  listRef: RefObject<HTMLDivElement | null>;
}): ReactNode {
  const [limit, setLimit] = useState(BOOK_PAGE);
  // a new search or filter starts from the first rows again
  useEffect(() => setLimit(BOOK_PAGE), [rows.length]);
  return (
    <div className="book-list" ref={listRef}>
      <Count shown={rows.length} total={total} />
      <table className="book-table">
        <thead><tr>{photo && <th></th>}<th>行</th>{columns.map((c) => <th key={c.head}>{c.head}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, limit).map((x) => (
            <tr key={id(x)} className={id(x) === selected ? 'active' : ''} onClick={() => (location.hash = href(id(x)))}>
              {photo && <td className="photo-cell">{photo(x)}</td>}
              <td className="num muted">{id(x)}</td>
              {columns.map((c, i) => <td key={c.head} className={c.className}>{c.cell(x)}{i === 0 && changed?.(x) && <EditedMark text=" ●" />}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && <div className="row"><button onClick={() => setLimit(limit + BOOK_PAGE * 5)}>{`続きを表示 (${rows.length - limit} 件)`}</button></div>}
    </div>
  );
}

export function Count({ shown, total, unit = '件' }: { shown: number; total: number; unit?: string }): ReactNode {
  return <div className="muted small">{`${shown} / ${total} ${unit}`}</div>;
}

/** Search box and filter of a list. */
export function ListFilter<F extends string>({ query, setQuery, placeholder, filter, setFilter, options }: {
  query: string;
  setQuery: (q: string) => void;
  placeholder: string;
  filter: F;
  setFilter: (f: F) => void;
  options: [F, string][];
}): ReactNode {
  return (
    <div className="row">
      <input type="search" placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} />
      <select value={filter} onChange={(e) => setFilter(e.target.value as F)}>
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </div>
  );
}

export const EditedMark = ({ title = '変更した', text = '●' }: { title?: string; text?: string }): ReactNode => (
  <span className="edited-mark" title={title}>{text}</span>
);

/**
 * A number box that applies a typed value when it is left or Enter is pressed (like the DOM's change event), and a
 * step of its spinner / arrow keys at once; a value outside min..max goes back to the current one.
 */
export function NumberInput({ value, min, max, className = 'num-input', title, onCommit }: {
  value: number; min: number; max: number; className?: string; title?: string; onCommit: (v: number) => void;
}): ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  // the value last applied: the box may tell the same change twice (change, then blur) before the new value comes back
  const last = useRef(value);
  last.current = value;
  const commit = (el: HTMLInputElement): void => {
    const v = Math.round(Number(el.value));
    if (el.value !== '' && Number.isFinite(v) && v >= min && v <= max) {
      if (v !== last.current) {
        last.current = v;
        onCommit(v);
      }
    } else el.value = String(last.current);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  // follow the value from outside (undo, another pane) unless the box is being typed in
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = String(value);
  }, [value]);
  // The DOM's change event (React's onChange is the input event): the spinner buttons, the arrow keys and the wheel
  // fire it at each step, typing only when the box is left or Enter is pressed, so a half-typed number is not applied.
  // The browsers tell a step from typing in the input event differently (inputType), so that one is not used.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = (): void => commitRef.current(el);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return (
    <input
      ref={ref}
      type="number"
      min={min}
      max={max}
      defaultValue={value}
      className={className}
      title={title}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget)}
    />
  );
}

/** A text box applied when left (or on Enter for one line). */
export function TextBox({ value, multi, edited, onCommit }: { value: string; multi: boolean; edited: boolean; onCommit: (v: string) => void }): ReactNode {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (): void => {
    if (text !== value) onCommit(text);
  };
  const cls = `name-input${edited ? ' edited' : ''}`;
  return multi
    ? <textarea className={cls} rows={2} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    : <input type="text" className={cls} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}
