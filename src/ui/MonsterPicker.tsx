// Picking a monster from their photos (encounter groups, a monster's next form, the monsters of a preview).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Monster, MonsterBook } from '../game/monsters';
import { monsterRef } from '../pages/monsters';
import type { Session } from '../session';
import { Dialog } from './Dialog';
import { Photo } from './Photo';

/** A section of the picker: a heading and its monster rows (e.g. "このワザを持つモンスター"). */
export interface MonsterGroup {
  label: string;
  rows: number[];
}

/** A choice that is not a monster row (e.g. 0 = 電波人間), shown first without a photo. */
export interface PickerChoice {
  value: number;
  label: string;
  sub?: string;
}

/**
 * Pick a monster from the photos (with the row and the level: forms of a boss share their name). `groups` come first,
 * each under its heading, then every monster under "すべて"; `choices` are other values before them.
 */
export function MonsterPicker({ session, book, current, title = 'モンスターを選ぶ', groups = [], choices = [], onPick, onClose }: {
  session: Session; book: MonsterBook; current: number; title?: string; groups?: MonsterGroup[]; choices?: PickerChoice[];
  onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => grid.current?.querySelector('.current')?.scrollIntoView({ block: 'center' }), []);
  const q = query.trim();
  const match = (m: Monster): boolean => !q || m.name.includes(q);
  const cell = (m: Monster, key: string): ReactNode => (
    <button key={key} className={`monster-cell${m.row === current ? ' current' : ''}`} onClick={() => onPick(m.row)}>
      <Photo model={monsterRef(session.game, book, m)} className="photo photo-lg" />
      <span>{m.name}</span>
      <span className="muted small">{`#${m.row} Lv${m.level}`}</span>
    </button>
  );
  const sections = [
    ...groups.map((g) => ({ label: g.label, list: g.rows.map((r) => book.monster(r)).filter((m): m is Monster => !!m && match(m)) })),
    { label: groups.length || choices.length ? 'すべて' : '', list: book.monsters.filter(match) },
  ].filter((s) => s.list.length);
  const shownChoices = choices.filter((c) => !q || c.label.includes(q));
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="名前で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="picker-list" ref={grid}>
        {shownChoices.length > 0 && (
          <div className="monster-grid">
            {shownChoices.map((c) => (
              <button key={`c${c.value}`} className={`monster-cell${c.value === current ? ' current' : ''}`} onClick={() => onPick(c.value)}>
                <span className="photo photo-lg picker-none" />
                <span>{c.label}</span>
                {c.sub && <span className="muted small">{c.sub}</span>}
              </button>
            ))}
          </div>
        )}
        {sections.map((s, i) => (
          <section key={i}>
            {s.label && <h4 className="picker-heading">{s.label}</h4>}
            <div className="monster-grid">{s.list.map((m) => cell(m, `${i}:${m.row}`))}</div>
          </section>
        ))}
        {!sections.length && !shownChoices.length && <div className="muted">見つかりません</div>}
      </div>
    </Dialog>
  );
}
