// Picking a monster from their photos (encounter groups, a monster's next form).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MonsterBook } from '../game/monsters';
import { monsterRef } from '../pages/monsters';
import type { Session } from '../session';
import { Dialog } from './Dialog';
import { Photo } from './Photo';

/** Pick a monster from the photos (with the row and the level: forms of a boss share their name). */
export function MonsterPicker({ session, book, current, title = 'モンスターを選ぶ', onPick, onClose }: {
  session: Session; book: MonsterBook; current: number; title?: string; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => grid.current?.querySelector('.current')?.scrollIntoView({ block: 'center' }), []);
  const q = query.trim();
  const shown = book.monsters.filter((m) => !q || m.name.includes(q));
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="名前で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="picker-list">
        <div className="monster-grid" ref={grid}>
          {shown.map((m) => (
            <button key={m.row} className={`monster-cell${m.row === current ? ' current' : ''}`} onClick={() => onPick(m.row)}>
              <Photo model={monsterRef(session.game, book, m)} className="photo photo-lg" />
              <span>{m.name}</span>
              <span className="muted small">{`#${m.row} Lv${m.level}`}</span>
            </button>
          ))}
          {!shown.length && <div className="muted">見つかりません</div>}
        </div>
      </div>
    </Dialog>
  );
}
