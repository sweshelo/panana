// Picking an item from their photos (the shop list and the chest contents of the map editor share it).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Game } from '../game/game';
import { ITEM_CATEGORY, type Item, type ItemBook } from '../game/items';
import { itemRef } from '../pages/items';
import { Dialog } from './Dialog';
import { Photo } from './Photo';

/**
 * A dialog with every item as a photo, filtered by name, ID or category. `unavailable` greys out items that
 * cannot be picked (and says why in their tooltip); `current` is highlighted and scrolled into view.
 */
export function ItemPicker({ game, items, title = 'アイテムを選ぶ', current, unavailable, onPick, onClose }: {
  game: Game;
  items: ItemBook;
  title?: string;
  current?: number;
  unavailable?: (it: Item) => string | null;
  onPick: (id: number) => void;
  onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => grid.current?.querySelector('.current')?.scrollIntoView({ block: 'center' }), []);
  const q = query.trim();
  const c = cat ? Number(cat) : 0;
  const shown = items.items.filter((it) => (!c || (it.categoryByte & 0xf) === c) && (!q || it.name.includes(q) || String(it.id) === q));
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" placeholder="名前か ID で絞り込み" className="picker-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">すべての分類</option>
          {Object.entries(ITEM_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="picker-list">
        <div className="monster-grid" ref={grid}>
          {shown.map((it) => {
            const why = unavailable?.(it) ?? null;
            return (
              <button
                key={it.id}
                className={`monster-cell${why ? ' sold' : ''}${it.id === current ? ' current' : ''}`}
                disabled={!!why}
                title={why ?? `#${it.id} ${it.category}${it.price ? `・${it.price} G` : '・買値 0'}`}
                onClick={() => onPick(it.id)}
              >
                <Photo model={itemRef(game, it)} className="photo photo-lg" />
                <span>{it.name}</span>
                <span className="muted small">{it.price ? `${it.price} G` : '0 G'}</span>
              </button>
            );
          })}
          {!shown.length && <div className="muted">見つかりません</div>}
        </div>
      </div>
    </Dialog>
  );
}
