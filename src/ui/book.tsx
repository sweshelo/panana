// Pieces shared by the book pages (a searchable list on the left, the selected entry on the right).
import { useEffect, useReducer, useRef, type ReactNode, type RefObject } from 'react';
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
  // follow the value from outside (undo, another pane) unless the box is being typed in
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = String(value);
  }, [value]);
  const commit = (el: HTMLInputElement): void => {
    const v = Math.round(Number(el.value));
    if (el.value !== '' && Number.isFinite(v) && v >= min && v <= max) {
      if (v !== value) onCommit(v);
    } else el.value = String(value);
  };
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
      // the spinner buttons and the arrow keys step the value without typing: apply it at once (typing waits for
      // Enter / leaving the box, so a half-typed number is not applied)
      onInput={(e) => !(e.nativeEvent as InputEvent).inputType && commit(e.currentTarget)}
    />
  );
}
